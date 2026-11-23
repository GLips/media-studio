// The recorder's lifecycle, whole: every phase it can be in, every event that moves it, and the one pure transition
// that owns every change, returning the next state and the effects to perform. The app performs the effects and
// feeds what happens back as events; nothing else writes the state. What runs alongside a phase (the menu's input
// check, the track watch, the take's clock, the permission poll) is derived from the state, and started and stopped
// by the diff. Beside the phase it keeps the recent takes the menu lists, each where it is now: being added to the
// library, in it, left in the recordings folder, or being thrown away.
import Foundation

/// A take as the machine sees it: its folder, when it began, and what was already wrong as it began (a picked
/// window that had closed). The app's take is its `Recording`.
public protocol RecorderTake {
  var folder: URL { get }
  var startedAt: Date { get }
  var startProblems: [RecorderTrack: String] { get }
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
  /// The system's window and display picker is up, from the menu; what it picks is what the screen track records
  /// from the next take on.
  case pickingScreen
  /// Opening the tracks. A press is ignored, so a double press can't start a second take; a stop or quit asked
  /// for meanwhile waits for the take to start, then ends it.
  case starting(then: AfterStart)
  /// `elapsedSeconds`: how much of the take its tracks have written, in whole seconds, so the menu bar's clock is
  /// never ahead of what's on disk.
  case recording(Take, elapsedSeconds: Int)
  /// Finishing the take's files; `quitAfter` when Quit or SIGTERM came during the take.
  case stopping(Take, quitAfter: Bool)
  /// The app may quit. Terminal: every later event is ignored.
  case exited
}

/// The phases by name, so a test can check every one is reachable.
public enum RecorderPhaseName: CaseIterable, Sendable {
  case needsPermission, relaunching, idle, pickingScreen, starting, recording, stopping, exited
}

/// What runs alongside a phase, started and stopped as the state enters and leaves it.
public enum RecorderActivity: CaseIterable, Sendable {
  /// The menu's live mic level and camera picture: while the menu is open and no take holds the devices.
  case inputCheck
  /// Each second, looks for a camera or mic gone quiet or a screen stream stopped: while recording.
  case trackWatch
  /// Reads how much of the take is written, several times a second, for the menu bar's clock: while recording.
  case takeClock
  /// Polls a fresh process for screen and input grants: while waiting on them.
  case permissionPoll
}

/// An input picked in the menu, by name as the system shows it, or the screen's picked content.
public enum RecorderInputPick: Equatable, Sendable {
  case mic(String)
  case camera(String)
  case screen(RecorderScreenChoice)
}

public enum RecorderInputKind: String, Sendable { case mic, camera, screen }

/// What the screen track records: a whole display, or one window.
public enum RecorderScreenChoice: Equatable, Sendable {
  case display(name: String)
  case window(RecorderWindowChoice)
}

/// A picked window. `id` is the window server's, which lasts only as long as the window and starts over when the
/// window server does, so a window is the picked one only while both its id and its app's `bundleID` match. Once it
/// closes, takes record `display`, the one it was on when picked, and say so.
public struct RecorderWindowChoice: Equatable, Sendable {
  public let id: UInt32
  public let bundleID: String
  public let title: String
  public let app: String
  public let display: String

  public init(id: UInt32, bundleID: String, title: String, app: String, display: String) {
    self.id = id
    self.bundleID = bundleID
    self.title = title
    self.app = app
    self.display = display
  }
}

/// A recent take, as the menu lists it. Named by its folder in the recordings folder, which it leaves once added.
public struct RecorderRecentTake: Equatable, Sendable {
  public enum Place: Equatable, Sendable {
    /// The library add is running on it.
    case addingToLibrary
    /// Its add finished; the library hasn't been asked for its item yet.
    case added
    /// `mediaFolder` is none while the library's media is offline.
    case inLibrary(item: String, mediaFolder: URL?)
    /// Still in the recordings folder: its add failed, or the recorder was killed in it.
    case inRecordings
    /// Being thrown away; `afterAdd` while its add is stopped first, so nothing it moves is left behind.
    case throwingAway(afterAdd: Bool)
  }

  public let folder: URL
  public let recordedAt: Date?
  /// None for a take the recorder was killed in.
  public let durationSeconds: Double?
  public var place: Place

  public init(folder: URL, recordedAt: Date?, durationSeconds: Double?, place: Place) {
    self.folder = folder
    self.recordedAt = recordedAt
    self.durationSeconds = durationSeconds
    self.place = place
  }

  /// A take's folder is named by when it began (`2026-11-22 18.19.29`): the same take wherever it went, and the
  /// newest sorts first.
  var name: String { folder.lastPathComponent }
}

/// How many recent takes the menu lists; `studio library recordings` is asked for as many.
public let recorderRecentTakeCount = 5

public struct RecorderState<Take: RecorderTake> {
  public fileprivate(set) var phase: RecorderPhase<Take>
  /// The current or latest take's track problems: kept after it stops so the menu still shows them, cleared when
  /// the next take starts, and never cleared or rewritten mid-take.
  public fileprivate(set) var trackProblems: [RecorderTrack: String] = [:]
  /// Why a finished take didn't reach the library; shown until the next take starts.
  public fileprivate(set) var libraryFailure: LibraryHandoffFailure?
  /// The newest takes first, at most `recorderRecentTakeCount`.
  public fileprivate(set) var recentTakes: [RecorderRecentTake] = []
  /// Why the last throw-away failed; shown until the next take starts.
  public fileprivate(set) var throwAwayFailure: String?
  /// The latest listing asked for: an earlier one may have read the library before a throw-away, so it's ignored.
  public fileprivate(set) var recentTakesAsked = 0
  public fileprivate(set) var menuOpen = false
  /// The command-line take (`--record-seconds`): one take, stopped after its length, then the process exits, 0 if
  /// it recorded and 1 if it never started. It skips permissions (it runs under the terminal's) and the library.
  public let oneTake: Bool

  /// The menu-bar app at launch, and its first effects.
  public static func launch(missing: [Permission]) -> RecorderStep<Take> {
    var state = RecorderState(phase: missing.isEmpty ? .idle : .needsPermission(missing: missing, watching: false), oneTake: false)
    let load = state.askForRecentTakes()
    return RecorderStep(state: state, effects: (missing.isEmpty ? [] : [.askForPermissions(missing)]) + [load])
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
    if case .recording = phase { running.formUnion([.trackWatch, .takeClock]) }
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
    case .pickingScreen: .pickingScreen
    case .starting: .starting
    case .recording: .recording
    case .stopping: .stopping
    case .exited: .exited
    }
  }

  /// The take recording or finishing, if any.
  public var take: Take? {
    switch self {
    case .recording(let take, _), .stopping(let take, _): take
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
  /// How much of the recording take is written, in seconds: the take clock's tick.
  case takeClockTicked(seconds: Double)
  /// The stopping take's files are finished, this long.
  case takeEnded(durationSeconds: Double)
  /// The library add of the take at this folder exited: added, or with why not.
  case libraryAddEnded(URL, failure: LibraryHandoffFailure?)
  /// `studio library recordings`' answer, each take in the library or the recordings folder.
  case recentTakesLoaded([RecorderRecentTake], asked: Int)
  case recentTakesUnavailable(String)
  /// A recent take's menu item.
  case openRecentTakeRequested(URL)
  /// The menu's Throw Away item, for the newest take; it asks first.
  case throwAwayRequested
  /// Graham said yes to throwing away the take at this folder.
  case throwAwayConfirmed(URL)
  case takeThrownAway(URL)
  case throwAwayFailed(URL, reason: String)
  case menuOpened
  case menuClosed
  case inputPicked(RecorderInputPick)
  /// The menu's Choose Window or Display item.
  case screenPickerRequested
  case screenPickerChose(RecorderScreenChoice)
  /// The picker closed with nothing picked, or couldn't open (`failure`).
  case screenPickerClosed(failure: String?)
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
  /// Runs the bundle's library add on the take's folder, detached; sends `.libraryAddEnded` when it exits.
  case handOffToLibrary(URL)
  /// Stops the library add running on the take's folder, which undoes what it hadn't finished; it still sends
  /// `.libraryAddEnded`.
  case stopLibraryAdd(URL)
  /// Asks `studio library recordings` for the recent takes; sends `.recentTakesLoaded` or `.recentTakesUnavailable`.
  case loadRecentTakes(asked: Int)
  /// Shows a folder in the Finder: the take's media in the library, else its folder in the recordings folder.
  case reveal(URL)
  /// Asks before throwing the take away; sends `.throwAwayConfirmed` on yes.
  case confirmThrowAway(RecorderRecentTake)
  /// Removes the take wherever it went (`studio library remove --take`); sends `.takeThrownAway` or `.throwAwayFailed`.
  case throwAway(URL)
  /// Writes the pick to config.json, for the next take.
  case saveInputPick(RecorderInputPick)
  /// Shows the system's window and display picker; sends `.screenPickerChose` or `.screenPickerClosed`.
  case presentScreenPicker
  /// Takes the picker down unanswered: a take or a quit came first.
  case dismissScreenPicker
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
    case (.toggleRequested, .pickingScreen):
      // The key records at once, as it always does: with what was picked before.
      phase = .starting(then: .record)
      return [.dismissScreenPicker, .beginTake]
    case (.toggleRequested, .recording(let take, _)), (.stopRequested, .recording(let take, _)):
      phase = .stopping(take, quitAfter: false)
      return [.endTake(take, problems: trackProblems)]
    case (.stopRequested, .starting(.record)):
      phase = .starting(then: .stop)
      return []

    case (.quitRequested, .needsPermission), (.quitRequested, .relaunching), (.quitRequested, .idle):
      phase = .exited
      return []
    case (.quitRequested, .pickingScreen):
      phase = .exited
      return [.dismissScreenPicker]
    case (.quitRequested, .starting):
      phase = .starting(then: .quit)
      return []
    case (.quitRequested, .recording(let take, _)):
      phase = .stopping(take, quitAfter: true)
      return [.endTake(take, problems: trackProblems)]
    case (.quitRequested, .stopping(let take, _)):
      phase = .stopping(take, quitAfter: true)
      return []

    case (.takeStarted(let take), .starting(let then)):
      trackProblems = take.startProblems
      libraryFailure = nil
      throwAwayFailure = nil
      // A take that began wrong sounds the alert a problem mid-take does: Graham hears it before he starts talking.
      let started: [RecorderEffect<Take>] = [.log("recording to \(take.folder.path)")]
        + take.startProblems.sorted { $0.key < $1.key }.map { .log("\($0.key.rawValue) \($0.value)") }
        + (take.startProblems.isEmpty ? [] : [.alertTrackProblem])
      switch then {
      case .record:
        phase = .recording(take, elapsedSeconds: 0)
        return started + (oneTake ? [.scheduleOneTakeStop] : [])
      case .stop, .quit:
        phase = .stopping(take, quitAfter: then == .quit)
        return started + [.endTake(take, problems: trackProblems)]
      }
    case (.takeFailedToStart(let failure), .starting(let then)):
      phase = then == .quit ? .exited : .idle
      return [.log("couldn't start: \(failure)")] + (then == .quit ? [.replyToQuit] : []) + (oneTake ? [.exitProcess(1)] : [])

    case (.takeClockTicked(let seconds), .recording(let take, _)):
      phase = .recording(take, elapsedSeconds: max(0, Int(seconds)))
      return []

    case (.trackProblemsFound(let found), .recording(let take, _)):
      let new = found.filter { trackProblems[$0.key] == nil }
      guard !new.isEmpty else { return [] }
      trackProblems.merge(new) { known, _ in known }
      return new.sorted { $0.key < $1.key }.map { .log("\($0.key.rawValue) \($0.value)") }
        + [.recordTrackProblems(take, trackProblems), .alertTrackProblem]

    case (.takeEnded(let seconds), .stopping(let take, let quitAfter)):
      phase = quitAfter ? .exited : .idle
      if oneTake { return [.log("recorded \(take.folder.path)"), .exitProcess(0)] }
      keepNewest([RecorderRecentTake(folder: take.folder, recordedAt: take.startedAt, durationSeconds: seconds, place: .addingToLibrary)] + recentTakes)
      return [.log("recorded \(take.folder.path)"), .handOffToLibrary(take.folder)] + (quitAfter ? [.replyToQuit] : [])

    case (.libraryAddEnded(let folder, let failure), _):
      let index = recentTakes.firstIndex { $0.folder == folder }
      if let index, recentTakes[index].place == .throwingAway(afterAdd: true) {
        recentTakes[index].place = .throwingAway(afterAdd: false)
        return [.throwAway(folder)]
      }
      if let index { recentTakes[index].place = failure == nil ? .added : .inRecordings }
      guard let failure else { return [askForRecentTakes()] }
      libraryFailure = failure
      return []

    case (.recentTakesLoaded(let loaded, let asked), _):
      guard asked == recentTakesAsked else { return [] }
      remember(listed: loaded)
      return []
    case (.recentTakesUnavailable(let reason), _):
      return [.log("couldn't list the recent takes: \(reason)")]

    case (.openRecentTakeRequested(let folder), _):
      guard let take = recentTakes.first(where: { $0.folder == folder }) else { return [] }
      if case .inLibrary(let item, let mediaFolder) = take.place {
        guard let mediaFolder else { return [.log("can't open \(item): the library's media is offline")] }
        return [.reveal(mediaFolder)]
      }
      return [.reveal(take.folder)]

    case (.throwAwayRequested, _):
      guard let newest = recentTakes.first, !newest.isBeingThrownAway else { return [] }
      return [.confirmThrowAway(newest)]
    case (.throwAwayConfirmed(let folder), _):
      guard let index = recentTakes.firstIndex(where: { $0.folder == folder }), !recentTakes[index].isBeingThrownAway else { return [] }
      throwAwayFailure = nil
      if recentTakes[index].place == .addingToLibrary {
        recentTakes[index].place = .throwingAway(afterAdd: true)
        return [.log("throwing away \(folder.lastPathComponent): stopping its library add"), .stopLibraryAdd(folder)]
      }
      recentTakes[index].place = .throwingAway(afterAdd: false)
      return [.log("throwing away \(folder.lastPathComponent)"), .throwAway(folder)]
    case (.takeThrownAway(let folder), _):
      recentTakes.removeAll { $0.folder == folder }
      return [.log("threw away \(folder.lastPathComponent)"), askForRecentTakes()]
    case (.throwAwayFailed(let folder, let reason), _):
      throwAwayFailure = reason
      // Where it is now is the library's to say: what failed may have removed part of it.
      recentTakes.removeAll { $0.folder == folder }
      return [.log("couldn't throw away \(folder.lastPathComponent): \(reason)"), askForRecentTakes()]

    case (.menuOpened, _):
      menuOpen = true
      return []
    case (.menuClosed, _):
      menuOpen = false
      return []
    case (.inputPicked(let pick), _) where atRest:
      return [.saveInputPick(pick)]
    case (.screenPickerRequested, .idle):
      phase = .pickingScreen
      return [.presentScreenPicker]
    case (.screenPickerChose(let choice), .pickingScreen):
      phase = .idle
      return [.saveInputPick(.screen(choice))]
    case (.screenPickerClosed(let failure), .pickingScreen):
      phase = .idle
      return failure.map { [.log("the screen picker couldn't open: \($0)")] } ?? []

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

extension RecorderRecentTake {
  fileprivate var isBeingThrownAway: Bool {
    if case .throwingAway = place { true } else { false }
  }

  /// Where the recorder itself is moving the take: what a listing says of it can't be newer.
  fileprivate var inFlight: Bool {
    switch place {
    case .addingToLibrary, .throwingAway: true
    case .added, .inLibrary, .inRecordings: false
    }
  }
}

extension RecorderState {
  /// A listing's takes as the recent ones, newest first: a take in flight keeps its own place over what it says.
  fileprivate mutating func remember(listed: [RecorderRecentTake]) {
    let inFlight = recentTakes.filter(\.inFlight)
    // The take recording now: a still screen writes nothing for long enough that the library judges it killed.
    let kept = Set(inFlight.map(\.name) + (phase.take.map { [$0.folder.lastPathComponent] } ?? []))
    keepNewest(inFlight + listed.filter { !kept.contains($0.name) })
  }

  fileprivate mutating func askForRecentTakes() -> RecorderEffect<Take> {
    recentTakesAsked += 1
    return .loadRecentTakes(asked: recentTakesAsked)
  }

  /// The newest takes, each once: of two the same, the first given wins.
  fileprivate mutating func keepNewest(_ takes: [RecorderRecentTake]) {
    var seen: Set<String> = []
    let once = takes.filter { seen.insert($0.name).inserted }
    recentTakes = Array(once.sorted { $0.name > $1.name }.prefix(recorderRecentTakeCount))
  }
}

extension [Permission] {
  /// Camera and mic grants reach this process at once; screen and input wait for the relaunch.
  fileprivate func stillMissing(granted: Set<Permission>) -> [Permission] {
    filter { $0.takesEffectOnRelaunch || !granted.contains($0) }
  }
}

extension RecorderRecentTake {
  /// `studio library recordings --json`'s takes (LibraryRecorderTake in library-recorder-takes.ts).
  public static func listed(fromJSON data: Data) throws -> [RecorderRecentTake] {
    struct Listed: Decodable {
      struct Item: Decodable {
        let id: String
        let mediaFolder: String?
      }
      let folder: String
      let recordedAt: String?
      let durationSeconds: Double?
      let item: Item?
    }
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let whole = ISO8601DateFormatter()
    return try JSONDecoder().decode([Listed].self, from: data).map { take in
      RecorderRecentTake(
        folder: URL(fileURLWithPath: take.folder),
        recordedAt: take.recordedAt.flatMap { withFraction.date(from: $0) ?? whole.date(from: $0) },
        durationSeconds: take.durationSeconds,
        place: take.item.map { .inLibrary(item: $0.id, mediaFolder: $0.mediaFolder.map { URL(fileURLWithPath: $0) }) } ?? .inRecordings)
    }
  }
}
