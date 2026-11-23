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
  /// The timers of the activities that tick: the track watch and the permission poll.
  private var timers: [RecorderActivity: Timer] = [:]

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
        await take.end(problems: problems)
        send(.takeEnded)
      }
    case .handOffToLibrary(let folder):
      handOffToLibrary(folder) { [weak self] failure in self?.send(.libraryAddFailed(failure)) }
    case .saveInputPick(let pick):
      saveInputPick(pick)
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
      timers[activity] = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated {
          guard let self, case .recording(let take) = self.state.phase else { return }
          let found = take.findTrackProblems(known: self.state.trackProblems)
          if !found.isEmpty { self.send(.trackProblemsFound(found)) }
        }
      }
    case .permissionPoll:
      // A fresh process sees screen and input grants that this one can't.
      timers[activity] = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.send(.permissionsPolled(granted: Permission.grantedNow, grantedInFreshProcess: grantedInFreshProcess()))
        }
      }
    }
  }

  /// Applies the pick to config.json as it stands now, so edits made there since launch are kept, and take effect,
  /// rather than overwritten.
  private func saveInputPick(_ pick: RecorderInputPick) {
    do {
      var picked = try RecorderConfig.load(from: configURL)
      switch pick.kind {
      case .mic: picked.mic?.device = pick.name
      case .camera: picked.camera?.device = pick.name
      case .screen: picked.screen.display = pick.name
      }
      try picked.save(to: configURL)
      config = picked
      log("picked \(pick.kind.rawValue) \(pick.name)")
    } catch {
      log("couldn't pick \(pick.kind.rawValue) \(pick.name): \(error)")
    }
  }
}
