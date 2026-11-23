// The recorder's lifecycle, whole: every phase it can be in, every event that moves it, and the one pure transition
// that owns every change, returning the next state and the effects to perform. The app performs the effects and
// feeds what happens back as events; nothing else writes the state. What runs alongside a phase (the menu's input
// check, the track watch, the permission poll) is derived from the state, and started and stopped by the diff.
import Foundation

/// A take as the machine sees it: its folder. The app's take is its `Recording`.
public protocol RecorderTake {
  var folder: URL { get }
}

/// A recording's tracks, as recording.json's `tracks`, `leftOut` and `problems` key them.
public enum RecorderTrack: String, CaseIterable, Comparable, Sendable {
  case camera, input, mic, screen
  public static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }
}

/// What a press means while a take is still opening its tracks.
public enum AfterStart: Sendable { case record, stop, quit }

public enum RecorderPhase<Take: RecorderTake> {
  /// The config needs permissions this process lacks (never empty); nothing records until they're granted.
  /// `watching` while the permission poll looks for screen or input grants, which reach only a new process.
  case needsPermission(missing: [Permission], watching: Bool)
  /// A screen or input grant arrived: a new copy of the app is opening, and this one quits once it has.
  case relaunching(missing: [Permission])
  case idle
  /// Opening the tracks. A press is ignored, so a double press can't start a second take; a stop or quit asked
  /// for meanwhile waits for the take to start, then ends it.
  case starting(then: AfterStart)
  case recording(Take)
  /// Finishing the take's files; `quitAfter` when Quit or SIGTERM came during the take.
  case stopping(Take, quitAfter: Bool)
  /// The app may quit. Terminal: every later event is ignored.
  case exited
}

/// The phases by name, so a test can check every one is reachable.
public enum RecorderPhaseName: CaseIterable, Sendable {
  case needsPermission, relaunching, idle, starting, recording, stopping, exited
}

/// What runs alongside a phase, started and stopped as the state enters and leaves it.
public enum RecorderActivity: CaseIterable, Sendable {
  /// The menu's live mic level and camera picture: while the menu is open and no take holds the devices.
  case inputCheck
  /// Each second, looks for a camera or mic gone quiet or a screen stream stopped: while recording.
  case trackWatch
  /// Polls a fresh process for screen and input grants: while waiting on them.
  case permissionPoll
}

public struct RecorderInputPick: Equatable, Sendable {
  public let kind: RecorderInputKind
  public let name: String
  public init(kind: RecorderInputKind, name: String) {
    self.kind = kind
    self.name = name
  }
}

public enum RecorderInputKind: String, Sendable { case mic, camera, screen }

public struct RecorderState<Take: RecorderTake> {
  public fileprivate(set) var phase: RecorderPhase<Take>
  /// The current or latest take's track problems: kept after it stops so the menu still shows them, cleared when
  /// the next take starts, and never cleared or rewritten mid-take.
  public fileprivate(set) var trackProblems: [RecorderTrack: String] = [:]
  /// Why a finished take didn't reach the library; shown until the next take starts.
  public fileprivate(set) var libraryFailure: LibraryHandoffFailure?
  public fileprivate(set) var menuOpen = false
  /// The command-line take (`--record-seconds`): one take, stopped after its length, then the process exits, 0 if
  /// it recorded and 1 if it never started. It skips permissions (it runs under the terminal's) and the library.
  public let oneTake: Bool

  /// The menu-bar app at launch, and its first effects.
  public static func launch(missing: [Permission]) -> RecorderStep<Take> {
    if missing.isEmpty { return RecorderStep(state: RecorderState(phase: .idle, oneTake: false), effects: []) }
    return RecorderStep(
      state: RecorderState(phase: .needsPermission(missing: missing, watching: false), oneTake: false), effects: [.askForPermissions(missing)])
  }

  /// The command-line take at launch: it starts recording at once.
  public static func launchOneTake() -> RecorderStep<Take> {
    RecorderStep(state: RecorderState(phase: .starting(then: .record), oneTake: true), effects: [.beginTake])
  }

  /// What the config needs and this process lacks.
  public var missingPermissions: [Permission] {
    switch phase {
    case .needsPermission(let missing, _), .relaunching(let missing): missing
    default: []
    }
  }

  /// No take holds the devices or is on its way: the menu may pick inputs and check them.
  public var atRest: Bool {
    switch phase {
    case .needsPermission, .idle: true
    default: false
    }
  }

  public var activities: Set<RecorderActivity> {
    var running: Set<RecorderActivity> = []
    if menuOpen && atRest { running.insert(.inputCheck) }
    if case .recording = phase { running.insert(.trackWatch) }
    if case .needsPermission(_, watching: true) = phase { running.insert(.permissionPoll) }
    return running
  }
}

extension RecorderPhase {
  public var name: RecorderPhaseName {
    switch self {
    case .needsPermission: .needsPermission
    case .relaunching: .relaunching
    case .idle: .idle
    case .starting: .starting
    case .recording: .recording
    case .stopping: .stopping
    case .exited: .exited
    }
  }

  /// The take recording or finishing, if any.
  public var take: Take? {
    switch self {
    case .recording(let take), .stopping(let take, _): take
    default: nil
    }
  }
}

public enum RecorderEvent<Take: RecorderTake> {
  /// The hotkey or the menu's Start/Stop item.
  case toggleRequested
  /// The command-line take's timer or a signal: stop, never start.
  case stopRequested
  /// Quit or SIGTERM. The app quits at once unless a take is under way, which is finished first.
  case quitRequested
  case takeStarted(Take)
  case takeFailedToStart(TakeStartFailure)
  /// What the track watch found this second; problems already known come again and are ignored.
  case trackProblemsFound([RecorderTrack: String])
  /// The stopping take's files are finished.
  case takeEnded
  case libraryAddFailed(LibraryHandoffFailure)
  case menuOpened
  case menuClosed
  case inputPicked(RecorderInputPick)
  /// The menu's Allow item for a missing permission.
  case allowRequested(Permission)
  /// What this process holds after a prompt: camera and mic grants show here, screen and input never do.
  case permissionsChecked(granted: Set<Permission>)
  /// The permission poll's tick: this process's grants, and a fresh process's, which see screen and input.
  case permissionsPolled(granted: Set<Permission>, grantedInFreshProcess: Set<Permission>)
  case relaunchFailed(String)
}

public enum RecorderEffect<Take: RecorderTake> {
  case log(String)
  case startActivity(RecorderActivity)
  case stopActivity(RecorderActivity)
  /// Raises each missing permission's prompt in turn, then sends `.permissionsChecked`.
  case askForPermissions([Permission])
  /// Raises its prompt, or opens its System Settings pane once the prompt has been used, then sends `.permissionsChecked`.
  case requestPermission(Permission)
  /// Opens a new copy of the app, then quits; sends `.relaunchFailed` if it can't.
  case relaunch
  /// Opens a new take's tracks once the input check has let go of the devices, then sends `.takeStarted` or
  /// `.takeFailedToStart`.
  case beginTake
  /// Writes the take's problems to its recording.json.
  case recordTrackProblems(Take, [RecorderTrack: String])
  /// Sounds an alert: there's no window to show one.
  case alertTrackProblem
  /// Stops the take's tracks and finishes its files with these problems, then sends `.takeEnded`.
  case endTake(Take, problems: [RecorderTrack: String])
  /// Runs the bundle's library add on the take's folder, detached; sends `.libraryAddFailed` if it fails.
  case handOffToLibrary(URL)
  /// Writes the pick to config.json, for the next take.
  case saveInputPick(RecorderInputPick)
  /// Lets a quit that waited on a take go ahead.
  case replyToQuit
  /// Sends `.stopRequested` once the command-line take has run its length.
  case scheduleOneTakeStop
  case exitProcess(Int32)
}

public struct RecorderStep<Take: RecorderTake> {
  public let state: RecorderState<Take>
  public let effects: [RecorderEffect<Take>]
}

/// The recorder's one transition. Activities that stop come first among the effects (the input check lets go of
/// the devices before a take opens them, and the poll stops before a relaunch, so a slow launch can't see the same
/// grant and start a second copy); those that start come last.
public func recorderTransition<Take>(_ state: RecorderState<Take>, _ event: RecorderEvent<Take>) -> RecorderStep<Take> {
  var next = state
  let effects = next.apply(event)
  let before = state.activities
  let after = next.activities
  let stops = RecorderActivity.allCases.filter { before.contains($0) && !after.contains($0) }.map(RecorderEffect<Take>.stopActivity)
  let starts = RecorderActivity.allCases.filter { !before.contains($0) && after.contains($0) }.map(RecorderEffect<Take>.startActivity)
  return RecorderStep(state: next, effects: stops + effects + starts)
}

extension RecorderState {
  fileprivate mutating func apply(_ event: RecorderEvent<Take>) -> [RecorderEffect<Take>] {
    if case .exited = phase { return [] }
    switch (event, phase) {
    case (.toggleRequested, .needsPermission(let missing, _)):
      // A take missing a track would be found out only afterwards: ask again instead of recording.
      return [.log("not recording: \(missing[0].title) isn't allowed"), .requestPermission(missing[0])]
    case (.toggleRequested, .idle):
      phase = .starting(then: .record)
      return [.beginTake]
    case (.toggleRequested, .recording(let take)), (.stopRequested, .recording(let take)):
      phase = .stopping(take, quitAfter: false)
      return [.endTake(take, problems: trackProblems)]
    case (.stopRequested, .starting(.record)):
      phase = .starting(then: .stop)
      return []

    case (.quitRequested, .needsPermission), (.quitRequested, .relaunching), (.quitRequested, .idle):
      phase = .exited
      return []
    case (.quitRequested, .starting):
      phase = .starting(then: .quit)
      return []
    case (.quitRequested, .recording(let take)):
      phase = .stopping(take, quitAfter: true)
      return [.endTake(take, problems: trackProblems)]
    case (.quitRequested, .stopping(let take, _)):
      phase = .stopping(take, quitAfter: true)
      return []

    case (.takeStarted(let take), .starting(let then)):
      trackProblems = [:]
      libraryFailure = nil
      let started = RecorderEffect<Take>.log("recording to \(take.folder.path)")
      switch then {
      case .record:
        phase = .recording(take)
        return [started] + (oneTake ? [.scheduleOneTakeStop] : [])
      case .stop, .quit:
        phase = .stopping(take, quitAfter: then == .quit)
        return [started, .endTake(take, problems: [:])]
      }
    case (.takeFailedToStart(let failure), .starting(let then)):
      phase = then == .quit ? .exited : .idle
      return [.log("couldn't start: \(failure)")] + (then == .quit ? [.replyToQuit] : []) + (oneTake ? [.exitProcess(1)] : [])

    case (.trackProblemsFound(let found), .recording(let take)):
      let new = found.filter { trackProblems[$0.key] == nil }
      guard !new.isEmpty else { return [] }
      trackProblems.merge(new) { known, _ in known }
      return new.sorted { $0.key < $1.key }.map { .log("\($0.key.rawValue) \($0.value)") }
        + [.recordTrackProblems(take, trackProblems), .alertTrackProblem]

    case (.takeEnded, .stopping(let take, let quitAfter)):
      phase = quitAfter ? .exited : .idle
      if oneTake { return [.log("recorded \(take.folder.path)"), .exitProcess(0)] }
      return [.log("recorded \(take.folder.path)"), .handOffToLibrary(take.folder)] + (quitAfter ? [.replyToQuit] : [])

    case (.libraryAddFailed(let failure), _):
      libraryFailure = failure
      return []

    case (.menuOpened, _):
      menuOpen = true
      return []
    case (.menuClosed, _):
      menuOpen = false
      return []
    case (.inputPicked(let pick), _) where atRest:
      return [.saveInputPick(pick)]

    case (.allowRequested(let permission), .needsPermission(let missing, _)) where missing.contains(permission):
      return [.requestPermission(permission)]
    case (.permissionsChecked(let granted), .needsPermission(let missing, _)):
      let stillMissing = missing.stillMissing(granted: granted)
      // Watching starts once a prompt has been raised: before that, a fresh process would see nothing new.
      phase = stillMissing.isEmpty ? .idle : .needsPermission(missing: stillMissing, watching: stillMissing.contains { $0.takesEffectOnRelaunch })
      return []
    case (.permissionsPolled(let granted, let fresh), .needsPermission(let missing, watching: true)):
      let stillMissing = missing.stillMissing(granted: granted)
      if let arrived = stillMissing.first(where: { $0.takesEffectOnRelaunch && fresh.contains($0) }) {
        // Nothing records meanwhile, so a relaunch never cuts a take.
        phase = .relaunching(missing: stillMissing)
        return [.log("\(arrived.title) granted: relaunching"), .relaunch]
      }
      phase = stillMissing.isEmpty ? .idle : .needsPermission(missing: stillMissing, watching: true)
      return []
    case (.relaunchFailed(let reason), .relaunching(let missing)):
      phase = .needsPermission(missing: missing, watching: false)
      return [.log("relaunch failed: \(reason)")]

    default:
      return []
    }
  }
}

extension [Permission] {
  /// Camera and mic grants reach this process at once; screen and input wait for the relaunch.
  fileprivate func stillMissing(granted: Set<Permission>) -> [Permission] {
    filter { $0.takesEffectOnRelaunch || !granted.contains($0) }
  }
}
