// The recorder's shell: it holds the machine's state (RecorderCore/RecorderMachine.swift), sends it every event,
// and performs the effects each transition returns, with AppKit, AVFoundation and timers. It decides nothing.
import AppKit
import RecorderCore

@MainActor
final class RecorderApp {
  private(set) var state: RecorderState<Recording>
  /// Read as each take begins, so an input picked in the menu takes effect at the next one.
  private(set) var config: RecorderConfig
  private let configURL: URL
  private let launchEffects: [RecorderEffect<Recording>]
  /// How long the command-line take records.
  private let oneTakeSeconds: Double
  /// Called after each transition's effects: the menu redraws.
  var onChange: (() -> Void)?
  /// The menu's inputs, whose check runs as an activity; absent for the command-line take.
  var inputMenu: InputMenu?
  /// The timers of the activities that tick: the track watch, the take's clock and the permission poll.
  private var timers: [RecorderActivity: Timer] = [:]
  private lazy var screenPicker = ScreenPicker { [weak self] event in self?.send(event) }

  init(config: RecorderConfig, configURL: URL, launch: RecorderStep<Recording>, oneTakeSeconds: Double = 0) {
    self.config = config
    self.configURL = configURL
    self.oneTakeSeconds = oneTakeSeconds
    state = launch.state
    launchEffects = launch.effects
  }

  /// Performs the launch state's first effects: asking for missing permissions, or the command-line take's start.
  func start() {
    for effect in launchEffects { perform(effect) }
    onChange?()
  }

  func send(_ event: RecorderEvent<Recording>) {
    let step = recorderTransition(state, event)
    state = step.state
    for effect in step.effects { perform(effect) }
    onChange?()
  }

  private func perform(_ effect: RecorderEffect<Recording>) {
    switch effect {
    case .log(let line):
      log(line)
    case .startActivity(let activity):
      startActivity(activity)
    case .stopActivity(let activity):
      timers.removeValue(forKey: activity)?.invalidate()
      if activity == .inputCheck { inputMenu?.stopCheck() }
    case .askForPermissions(let missing):
      Task {
        for permission in missing {
          log("asking for \(permission.title)")
          await permission.request(openingSettings: false)
        }
        send(.permissionsChecked(granted: Permission.grantedNow))
      }
    case .requestPermission(let permission):
      Task {
        await permission.request(openingSettings: true)
        send(.permissionsChecked(granted: Permission.grantedNow))
      }
    case .relaunch:
      relaunch { [weak self] reason in self?.send(.relaunchFailed(reason)) }
    case .beginTake:
      inputMenu?.check.awaitDevicesReleased()
      let config = config
      Task {
        do throws(TakeStartFailure) {
          send(.takeStarted(try await Recording.begin(config: config)))
        } catch {
          send(.takeFailedToStart(error))
        }
      }
    case .recordTrackProblems(let take, let problems):
      take.recordProblems(problems)
    case .alertTrackProblem:
      NSSound(named: "Basso")?.play()
    case .endTake(let take, let problems):
      Task {
        send(.takeEnded(durationSeconds: await take.end(problems: problems)))
      }
    case .handOffToLibrary(let folder):
      handOffToLibrary(folder) { [weak self] failure in self?.send(.libraryAddEnded(folder, failure: failure)) }
    case .loadRecentTakes(let asked):
      let recordings = config.recordingsURL
      Task {
        do throws(StudioCommandFailure) {
          let listed = try await runStudioCommand("StudioLibraryRecordings", [recordings.path])
          do {
            send(.recentTakesLoaded(try RecorderRecentTake.listed(fromJSON: listed), asked: asked))
          } catch {
            send(.recentTakesUnavailable("studio library recordings printed what the recorder can't read: \(error)"))
          }
        } catch {
          send(.recentTakesUnavailable(error.description))
        }
      }
    case .openLibraryItem(let item):
      runStudioAppCommand(.openItem, "StudioLibraryOpen", [item])
    case .loadStudioAppStatus(let asked):
      Task {
        do throws(StudioCommandFailure) {
          let said = try await runStudioCommand("StudioAppStatus")
          do {
            send(.studioAppStatusLoaded(try StudioAppStatus.parsed(fromJSON: said), asked: asked))
          } catch {
            send(.studioAppStatusUnavailable("studio app status printed what the recorder can't read: \(error)", asked: asked))
          }
        } catch {
          send(.studioAppStatusUnavailable(error.description, asked: asked))
        }
      }
    case .startStudioApp:
      runStudioAppCommand(.start, "StudioAppStart")
    case .stopStudioApp:
      runStudioAppCommand(.stop, "StudioAppStop")
    case .openStudioApp:
      runStudioAppCommand(.open, "StudioAppOpen")
    case .reveal(let folder):
      // A take being added has left its folder part way: the recordings folder shows where it was.
      let shown = FileManager.default.fileExists(atPath: folder.path) ? folder : folder.deletingLastPathComponent()
      NSWorkspace.shared.open(shown)
    case .saveInputPick(let pick):
      saveInputPick(pick)
    case .presentScreenPicker:
      screenPicker.present()
    case .dismissScreenPicker:
      screenPicker.dismiss()
    case .replyToQuit:
      NSApp.reply(toApplicationShouldTerminate: true)
    case .scheduleOneTakeStop:
      DispatchQueue.main.asyncAfter(deadline: .now() + oneTakeSeconds) { [weak self] in self?.send(.stopRequested) }
    case .exitProcess(let code):
      exit(code)
    }
  }

  private func startActivity(_ activity: RecorderActivity) {
    switch activity {
    case .inputCheck:
      inputMenu?.startCheck()
    case .trackWatch:
      timers[activity] = commonModeTimer(every: 1) { [weak self] in
        guard let self, case .recording(let take, _) = self.state.phase else { return }
        let found = take.findTrackProblems(known: self.state.trackProblems)
        if !found.isEmpty { self.send(.trackProblemsFound(found)) }
      }
    case .takeClock:
      // Several reads a second, so the shown second turns over within a quarter second of the take's.
      timers[activity] = commonModeTimer(every: 0.25) { [weak self] in
        guard let self, case .recording(let take, let shown) = self.state.phase else { return }
        let seconds = take.writtenSeconds
        if Int(seconds) != shown { self.send(.takeClockTicked(seconds: seconds)) }
      }
    case .permissionPoll:
      // A fresh process sees screen and input grants that this one can't.
      timers[activity] = commonModeTimer(every: 1.5) { [weak self] in
        self?.send(.permissionsPolled(granted: Permission.grantedNow, grantedInFreshProcess: grantedInFreshProcess()))
      }
    }
  }

  /// A repeating timer in the common modes: a default-mode one stops while the menu is open or an alert is up.
  private func commonModeTimer(every interval: TimeInterval, _ tick: @escaping @MainActor () -> Void) -> Timer {
    let timer = Timer(timeInterval: interval, repeats: true) { _ in MainActor.assumeIsolated { tick() } }
    RunLoop.main.add(timer, forMode: .common)
    return timer
  }

  /// Runs a studio app command to its end, then says how it went.
  private func runStudioAppCommand(_ command: StudioAppCommand, _ key: String, _ arguments: [String] = []) {
    Task {
      do throws(StudioCommandFailure) {
        _ = try await runStudioCommand(key, arguments)
        send(.studioAppCommandEnded(command, failure: nil))
      } catch {
        send(.studioAppCommandEnded(command, failure: error.description))
      }
    }
  }

  /// Applies the pick to config.json as it stands now, so edits made there since launch are kept, and take effect,
  /// rather than overwritten.
  private func saveInputPick(_ pick: RecorderInputPick) {
    do {
      var picked = try RecorderConfig.load(from: configURL)
      switch pick {
      case .mic(let name): picked.mic?.device = name
      case .camera(let name): picked.camera?.device = name
      case .screen(let choice): picked.screen.pick(choice)
      }
      try picked.save(to: configURL)
      config = picked
      log("picked \(pick.logged)")
    } catch {
      log("couldn't pick \(pick.logged): \(error)")
    }
  }
}

extension RecorderInputPick {
  /// As the log names it: `mic Scarlett Solo`, `screen window "Notes" (Notes)`.
  fileprivate var logged: String {
    switch self {
    case .mic(let name): "mic \(name)"
    case .camera(let name): "camera \(name)"
    case .screen(.display(let name)): "screen display \(name)"
    case .screen(.window(let window)): "screen window \"\(window.title)\" (\(window.app))"
    }
  }
}
