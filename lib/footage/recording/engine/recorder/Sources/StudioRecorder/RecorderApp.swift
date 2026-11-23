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
  /// The library adds running, by their take's folder, for a throw-away to stop.
  private var libraryAdds: [URL: Process] = [:]
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
      libraryAdds[folder] = handOffToLibrary(folder) { [weak self] failure in
        self?.libraryAdds[folder] = nil
        self?.send(.libraryAddEnded(folder, failure: failure))
      }
    case .stopLibraryAdd(let folder):
      libraryAdds[folder]?.terminate()
    case .loadRecentTakes(let asked):
      let recordings = config.recordingsURL
      Task {
        do throws(StudioCommandFailure) {
          let listed = try await runStudioCommand("StudioLibraryRecordings", folder: recordings)
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
      openLibraryItem(item)
    case .reveal(let folder):
      // A take being added has left its folder part way: the recordings folder shows where it was.
      let shown = FileManager.default.fileExists(atPath: folder.path) ? folder : folder.deletingLastPathComponent()
      NSWorkspace.shared.open(shown)
    case .confirmThrowAway(let take):
      // After this transition's effects: the alert's modal loop runs timers and tasks, which send events of their own.
      DispatchQueue.main.async { [weak self] in
        guard let self, self.confirmThrowAway(take) else { return }
        self.send(.throwAwayConfirmed(take.folder))
      }
    case .throwAway(let folder):
      Task {
        do throws(StudioCommandFailure) {
          _ = try await runStudioCommand("StudioLibraryRemoveTake", folder: folder)
          send(.takeThrownAway(folder))
        } catch {
          send(.throwAwayFailed(folder, reason: error.description))
        }
      }
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

  /// Asks once before a take is thrown away; true on Throw Away.
  private func confirmThrowAway(_ take: RecorderRecentTake) -> Bool {
    let alert = NSAlert()
    let item = RecorderMenuStatus.RecentTakeItem.title(of: take)
    alert.messageText = "Throw away the take from \(item)?"
    alert.informativeText = "It's removed from the library with its media and transcript, for good."
    alert.alertStyle = .warning
    let throwAway = alert.addButton(withTitle: "Throw Away")
    throwAway.hasDestructiveAction = true
    alert.addButton(withTitle: "Cancel")
    NSApp.activate()
    return alert.runModal() == .alertFirstButtonReturn
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
