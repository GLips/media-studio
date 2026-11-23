// The recorder's machine, driven through its one transition: the paths Graham relies on, and invariants held over
// seeded random event orders, since its events come from devices, prompts and child processes in any order.
import Foundation
import RecorderCore
import Testing

struct FakeTake: RecorderTake, Equatable {
  let id: Int
  var startProblems: [RecorderTrack: String] = [:]
  var folder: URL { URL(fileURLWithPath: "/takes/2026-11-22 18.0\(id).00") }
  var startedAt: Date { Date(timeIntervalSince1970: 1_795_000_000 + Double(id) * 60) }
}

typealias State = RecorderState<FakeTake>
typealias Event = RecorderEvent<FakeTake>
typealias Effect = RecorderEffect<FakeTake>

/// Runs events from a launch, returning the final state and every effect in order, the launch's first.
func run(_ start: RecorderStep<FakeTake>, _ events: [Event]) -> (state: State, effects: [Effect]) {
  let rest = run(start.state, events)
  return (rest.state, start.effects + rest.effects)
}

func run(_ start: State, _ events: [Event]) -> (state: State, effects: [Effect]) {
  events.reduce((start, [Effect]())) { sofar, event in
    let step = recorderTransition(sofar.0, event)
    return (step.state, sofar.1 + step.effects)
  }
}

func names(_ effects: [Effect]) -> [String] {
  effects.map { effect in
    switch effect {
    case .log: "log"
    case .startActivity(let activity): "start \(activity)"
    case .stopActivity(let activity): "stop \(activity)"
    case .askForPermissions: "askForPermissions"
    case .requestPermission(let permission): "request \(permission.rawValue)"
    case .relaunch: "relaunch"
    case .beginTake: "beginTake"
    case .recordTrackProblems: "recordTrackProblems"
    case .alertTrackProblem: "alert"
    case .endTake: "endTake"
    case .handOffToLibrary: "handOff"
    case .stopLibraryAdd: "stopLibraryAdd"
    case .loadRecentTakes: "loadRecentTakes"
    case .reveal(let folder): "reveal \(folder.path)"
    case .openLibraryItem(let item): "openLibraryItem \(item)"
    case .confirmThrowAway: "confirmThrowAway"
    case .throwAway: "throwAway"
    case .saveInputPick: "saveInputPick"
    case .presentScreenPicker: "presentScreenPicker"
    case .dismissScreenPicker: "dismissScreenPicker"
    case .replyToQuit: "replyToQuit"
    case .scheduleOneTakeStop: "scheduleOneTakeStop"
    case .exitProcess(let code): "exit \(code)"
    }
  }
}

var atIdle: RecorderStep<FakeTake> { State.launch(missing: []) }

@Test func hotkeyStartsAndStopsATakeAndPressesWhileStartingAreIgnored() {
  let take = FakeTake(id: 1)
  var (state, effects) = run(atIdle, [.menuOpened, .toggleRequested, .toggleRequested])
  #expect(state.phase.name == .starting)
  // The check lets go of the devices before the take opens them, and the second press starts nothing.
  #expect(names(effects) == ["loadRecentTakes", "start inputCheck", "stop inputCheck", "beginTake"])

  (state, effects) = run(state, [.takeStarted(take), .toggleRequested, .takeEnded(durationSeconds: 12)])
  #expect(state.phase.name == .idle)
  #expect(names(effects) == ["log", "start trackWatch", "start takeClock", "stop trackWatch", "stop takeClock", "endTake", "log", "handOff", "start inputCheck"])
}

@Test func aQuitDuringATakeFinishesItHandsItOffThenQuits() {
  let take = FakeTake(id: 1)
  let (state, effects) = run(atIdle, [.toggleRequested, .quitRequested, .takeStarted(take), .toggleRequested, .takeEnded(durationSeconds: 12)])
  #expect(state.phase.name == .exited)
  #expect(names(effects) == ["loadRecentTakes", "beginTake", "log", "endTake", "log", "handOff", "replyToQuit"])
}

@Test func aTrackProblemIsKeptThroughTheTakeAndClearedByTheNext() {
  let (state, effects) = run(atIdle, [
    .toggleRequested, .takeStarted(FakeTake(id: 1)),
    .trackProblemsFound([.camera: "sent nothing"]),
    .trackProblemsFound([.camera: "stopped sending at 9.0 s", .mic: "sent nothing"]),
    .toggleRequested, .takeEnded(durationSeconds: 12),
  ])
  #expect(state.trackProblems == [.camera: "sent nothing", .mic: "sent nothing"])
  #expect(names(effects).filter { $0 == "alert" }.count == 2)
  guard case .endTake(_, let written)? = effects.last(where: { if case .endTake = $0 { true } else { false } }) else {
    Issue.record("no endTake")
    return
  }
  #expect(written == state.trackProblems)
  #expect(RecorderMenuStatus(state, hotkey: "k", appName: "R").glyph == .needsAttention)

  let next = run(state, [.toggleRequested, .takeStarted(FakeTake(id: 2))]).state
  #expect(next.trackProblems.isEmpty)
}

let notes = RecorderWindowChoice(id: 42, bundleID: "com.apple.Notes", title: "Notes", app: "Notes", display: "LG UltraFine")

@Test func aWindowPickedInThePickerIsSavedForTheNextTakeAndTheKeyStillRecordsWhilePicking() {
  var (state, effects) = run(atIdle, [.screenPickerRequested, .toggleRequested])
  #expect(names(effects) == ["loadRecentTakes", "presentScreenPicker", "dismissScreenPicker", "beginTake"])
  // A pick arriving after the key started a take is dropped: the take records what was picked before.
  (state, effects) = run(state, [.screenPickerChose(.window(notes))])
  #expect(state.phase.name == .starting && effects.isEmpty)

  (state, effects) = run(atIdle.state, [.screenPickerRequested, .screenPickerChose(.window(notes))])
  #expect(state.phase.name == .idle)
  guard case .saveInputPick(.screen(.window(let saved)))? = effects.last else {
    Issue.record("no window saved: \(names(effects))")
    return
  }
  #expect(saved == notes)
}

@Test func aTakeWhosePickedWindowHadClosedSaysSoAndAlerts() {
  let fellBack = FakeTake(id: 1, startProblems: [.screen: "the picked window had closed"])
  let (state, effects) = run(atIdle, [.toggleRequested, .takeStarted(fellBack), .toggleRequested])
  #expect(names(effects).contains("alert"))
  #expect(state.trackProblems == [.screen: "the picked window had closed"])
  guard case .endTake(_, let written)? = effects.last else {
    Issue.record("no endTake")
    return
  }
  #expect(written == [.screen: "the picked window had closed"])
}

@Test func permissionsGrantedInSettingsUnblockOrRelaunch() {
  let launch = State.launch(missing: [.screen, .camera])
  #expect(names(launch.effects) == ["askForPermissions", "loadRecentTakes"])
  var (state, effects) = run(launch, [.toggleRequested, .permissionsChecked(granted: [.camera])])
  // A press while a permission is missing asks again instead of recording; screen waits on a fresh process.
  #expect(names(effects) == ["askForPermissions", "loadRecentTakes", "log", "request screen", "start permissionPoll"])
  #expect(state.missingPermissions == [.screen])

  (state, effects) = run(state, [
    .permissionsPolled(granted: [.camera], grantedInFreshProcess: []),
    .permissionsPolled(granted: [.camera], grantedInFreshProcess: [.screen, .camera]),
  ])
  #expect(state.phase.name == .relaunching)
  // The poll stops before the relaunch, so a slow launch can't see the same grant and open a second copy.
  #expect(names(effects) == ["stop permissionPoll", "log", "relaunch"])

  let cameraOnly = run(State.launch(missing: [.camera]), [.permissionsChecked(granted: [.camera])]).state
  #expect(cameraOnly.phase.name == .idle)
}

func recent(_ id: Int, _ place: RecorderRecentTake.Place) -> RecorderRecentTake {
  let take = FakeTake(id: id)
  return RecorderRecentTake(folder: take.folder, recordedAt: take.startedAt, durationSeconds: 30, place: place)
}

@Test func theMenuBarClockShowsHowMuchOfTheTakeIsWrittenOnlyWhileRecording() {
  var state = run(atIdle, [.toggleRequested, .takeStarted(FakeTake(id: 1))]).state
  #expect(RecorderMenuStatus(state, hotkey: "k", appName: "R").clock == "0:00")
  state = run(state, [.takeClockTicked(seconds: 65.9)]).state
  #expect(RecorderMenuStatus(state, hotkey: "k", appName: "R").clock == "1:05")
  state = run(state, [.takeClockTicked(seconds: 3723)]).state
  #expect(RecorderMenuStatus(state, hotkey: "k", appName: "R").clock == "1:02:03")
  state = run(state, [.toggleRequested]).state
  #expect(RecorderMenuStatus(state, hotkey: "k", appName: "R").clock == nil)
}

@Test func aFinishedTakeIsListedAsItIsAddedAndALateListingCantMoveIt() {
  let take = FakeTake(id: 2)
  var (state, effects) = run(atIdle, [
    .recentTakesLoaded([recent(1, .inLibrary(item: "one", mediaFolder: URL(fileURLWithPath: "/media/one")))], asked: 1),
    .toggleRequested, .takeStarted(take), .toggleRequested, .takeEnded(durationSeconds: 61),
    // Listed before the add moved it: the recorder knows better.
    .recentTakesLoaded([recent(2, .inRecordings), recent(1, .inLibrary(item: "one", mediaFolder: URL(fileURLWithPath: "/media/one")))], asked: 1),
  ])
  #expect(state.recentTakes.map(\.place) == [.addingToLibrary, .inLibrary(item: "one", mediaFolder: URL(fileURLWithPath: "/media/one"))])
  #expect(state.recentTakes.first?.durationSeconds == 61)

  (state, effects) = run(state, [.libraryAddEnded(take.folder, failure: nil)])
  #expect(names(effects) == ["loadRecentTakes"])
  // The listing asked for before the add ended is stale: it's ignored.
  (state, effects) = run(state, [
    .recentTakesLoaded([], asked: 1),
    .recentTakesLoaded([recent(2, .inLibrary(item: "two", mediaFolder: URL(fileURLWithPath: "/media/two")))], asked: 2),
    .openRecentTakeRequested(take.folder),
  ])
  // The listing is the truth for takes at rest: the one that's gone from it is gone from the menu.
  #expect(state.recentTakes.map(\.folder) == [take.folder])
  #expect(names(effects) == ["openLibraryItem two"])
}

@Test func theTakeRecordingNowIsNeverListedSoNeverThrownAway() {
  let (state, effects) = run(atIdle, [
    .toggleRequested, .takeStarted(FakeTake(id: 3)),
    // A still screen-only take looks killed to the library.
    .recentTakesLoaded([recent(3, .inRecordings), recent(1, .inLibrary(item: "one", mediaFolder: nil))], asked: 1),
    .throwAwayRequested,
  ])
  #expect(state.recentTakes.map(\.folder) == [FakeTake(id: 1).folder])
  guard case .confirmThrowAway(let asked)? = effects.last else {
    Issue.record("no confirmation asked")
    return
  }
  #expect(asked.folder == FakeTake(id: 1).folder)
}

@Test func throwingAwayATakeStillBeingAddedStopsTheAddFirst() {
  let take = FakeTake(id: 1)
  var (state, effects) = run(atIdle, [.toggleRequested, .takeStarted(take), .toggleRequested, .takeEnded(durationSeconds: 5), .throwAwayRequested])
  guard case .confirmThrowAway(let asked)? = effects.last else {
    Issue.record("no confirmation asked")
    return
  }
  #expect(asked.folder == take.folder)
  (state, effects) = run(state, [.throwAwayConfirmed(take.folder), .throwAwayRequested])
  // A second Throw Away while it goes asks nothing.
  #expect(names(effects) == ["log", "stopLibraryAdd"])
  #expect(RecorderMenuStatus(state, hotkey: "k", appName: "R").throwAwayTitle == nil)

  // The stopped add exits non-zero: that's the throw-away going ahead, not a failed add.
  (state, effects) = run(state, [.libraryAddEnded(take.folder, failure: .exited(status: 143))])
  #expect(names(effects) == ["throwAway"])
  #expect(state.libraryFailure == nil)
  (state, effects) = run(state, [.takeThrownAway(take.folder)])
  #expect(state.recentTakes.isEmpty)
  #expect(names(effects) == ["log", "loadRecentTakes"])
}

@Test func aThrowAwayTheLibraryRefusesIsShownAndTheTakeRelisted() {
  let (state, effects) = run(atIdle, [
    .recentTakesLoaded([recent(1, .inLibrary(item: "one", mediaFolder: nil))], asked: 1),
    .throwAwayConfirmed(FakeTake(id: 1).folder),
    .throwAwayFailed(FakeTake(id: 1).folder, reason: "one is used by demo"),
  ])
  #expect(names(effects) == ["loadRecentTakes", "log", "throwAway", "log", "loadRecentTakes"])
  let status = RecorderMenuStatus(state, hotkey: "k", appName: "R")
  #expect(status.warnings == ["⚠︎ Throw away failed: one is used by demo"])
  #expect(status.glyph == .needsAttention)
}

@Test func recentTakesReadStudioLibraryRecordingsJson() throws {
  let json = Data("""
    [{"folder": "/r/2026-11-22 18.19.29", "recordedAt": "2026-11-22T18:19:29.847-08:00", "durationSeconds": 252.4, "item": {"id": "2026-11-22-181929", "mediaFolder": "/m/2026-11-22-181929"}},
     {"folder": "/r/2026-11-22 17.00.00", "recordedAt": "2026-11-22T17:00:00-08:00", "durationSeconds": null, "item": null}]
    """.utf8)
  let takes = try RecorderRecentTake.listed(fromJSON: json)
  #expect(takes.map(\.place) == [.inLibrary(item: "2026-11-22-181929", mediaFolder: URL(fileURLWithPath: "/m/2026-11-22-181929")), .inRecordings])
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
  let now = try #require(ISO8601DateFormatter().date(from: "2026-11-23T09:00:00-08:00"))
  #expect(takes.map { RecorderMenuStatus.RecentTakeItem.title(of: $0, now: now, calendar: calendar) } == [
    "Yesterday 18:19 · 4:12", "Yesterday 17:00 · interrupted · not in the library",
  ])
}

/// SplitMix64: a seeded generator, so a failing order can be replayed by its seed.
struct SeededGenerator: RandomNumberGenerator {
  var state: UInt64
  mutating func next() -> UInt64 {
    state &+= 0x9E37_79B9_7F4A_7C15
    var z = state
    z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
    z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
    return z ^ (z >> 31)
  }
}

func randomEvent(_ rng: inout SeededGenerator) -> Event {
  let permissions = Set(Permission.allCases.filter { _ in Bool.random(using: &rng) })
  let fresh = Set(Permission.allCases.filter { _ in Bool.random(using: &rng) })
  let track = [RecorderTrack.camera, .mic, .screen].randomElement(using: &rng)!
  let events: [Event] = [
    .toggleRequested, .toggleRequested, .stopRequested, .quitRequested,
    // Ids from a small pool, so a stray start sometimes names the take already running.
    .takeStarted(FakeTake(id: Int.random(in: 1...3, using: &rng))), .takeStarted(FakeTake(id: Int.random(in: 1...3, using: &rng))),
    .takeFailedToStart(.noTrackStarted([:])),
    .trackProblemsFound([track: "problem \(Int.random(in: 1...3, using: &rng))"]),
    .takeEnded(durationSeconds: 12), .takeEnded(durationSeconds: 3),
    .takeClockTicked(seconds: Double.random(in: 0...100, using: &rng)),
    .libraryAddEnded(FakeTake(id: Int.random(in: 1...3, using: &rng)).folder, failure: Bool.random(using: &rng) ? nil : .exited(status: 1)),
    .recentTakesLoaded([recent(Int.random(in: 1...3, using: &rng), .inRecordings)], asked: Int.random(in: 1...4, using: &rng)),
    .throwAwayRequested,
    .throwAwayConfirmed(FakeTake(id: Int.random(in: 1...3, using: &rng)).folder),
    .takeThrownAway(FakeTake(id: Int.random(in: 1...3, using: &rng)).folder),
    .throwAwayFailed(FakeTake(id: Int.random(in: 1...3, using: &rng)).folder, reason: "no"),
    .menuOpened, .menuClosed,
    .inputPicked(.mic("Scarlett")),
    .screenPickerRequested, .screenPickerRequested,
    .screenPickerChose(.window(notes)), .screenPickerClosed(failure: nil),
    .allowRequested(Permission.allCases.randomElement(using: &rng)!),
    .permissionsChecked(granted: permissions),
    .permissionsPolled(granted: permissions, grantedInFreshProcess: fresh),
    .relaunchFailed("no"),
  ]
  return events.randomElement(using: &rng)!
}

@Test func invariantsHoldOverRandomEventOrders() {
  var reached: Set<RecorderPhaseName> = []
  for seed in UInt64(1)...400 {
    var rng = SeededGenerator(state: seed)
    let launches: [RecorderStep<FakeTake>] = [atIdle, State.launch(missing: [.screen, .input, .camera, .microphone]), State.launchOneTake()]
    let launch = launches.randomElement(using: &rng)!
    var state = launch.state
    var activities = state.activities
    /// The take the effects have opened and not yet ended: never more than one.
    var beginsOutstanding = launch.effects.contains { if case .beginTake = $0 { true } else { false } } ? 1 : 0
    for _ in 0..<60 {
      reached.insert(state.phase.name)
      let event = randomEvent(&rng)
      let step = recorderTransition(state, event)
      let next = step.state
      let context = "seed \(seed): \(state.phase.name) + \(event) -> \(next.phase.name)"

      for effect in step.effects {
        switch effect {
        case .beginTake: beginsOutstanding += 1
        case .startActivity(let activity): activities.insert(activity)
        case .stopActivity(let activity): activities.remove(activity)
        case .relaunch: #expect(state.phase.take == nil && next.phase.take == nil, "a relaunch cut a take: \(context)")
        default: break
        }
      }
      if case .takeFailedToStart = event, case .starting = state.phase { beginsOutstanding -= 1 }
      if case .takeEnded = event, case .stopping = state.phase { beginsOutstanding -= 1 }
      #expect(beginsOutstanding <= 1, "two takes at once: \(context)")
      #expect(activities == next.activities, "the activities drifted from the state: \(context)")

      if case .exited = state.phase { #expect(step.effects.isEmpty && next.phase.name == .exited, "exited isn't terminal: \(context)") }
      if case .stopping = state.phase, next.phase.name != .stopping {
        #expect([.idle, .exited].contains(next.phase.name), "a stop ended elsewhere: \(context)")
      }
      if case .needsPermission(let missing, _) = next.phase { #expect(!missing.isEmpty, "\(context)") }
      let recentNames = next.recentTakes.map(\.folder.lastPathComponent)
      #expect(recentNames.count <= recorderRecentTakeCount && recentNames == recentNames.sorted(by: >) && Set(recentNames).count == recentNames.count, "recent takes out of order: \(context)")
      if let take = state.phase.take, next.phase.take == take {
        for (track, problem) in state.trackProblems { #expect(next.trackProblems[track] == problem, "a problem changed mid-take: \(context)") }
      }
      state = next
    }
  }
  #expect(reached == Set(RecorderPhaseName.allCases), "never reached: \(Set(RecorderPhaseName.allCases).subtracting(reached))")
}

@Test func recordingJsonKeepsStudioRecordingOneKeys() throws {
  var mic = RecordingTrackEntry(file: "mic.m4a", startSeconds: 0.25)
  mic.channel = 1
  mic.hostDriftSeconds = 0.001
  var screen = RecordingTrackEntry(file: "screen.mp4", startSeconds: 0.1)
  screen.window = RecordedWindow(title: "Notes", app: "Notes")
  let file = StudioRecordingFile(
    status: .complete, startedAt: "2026-11-22T18:19:29.847-08:00", durationSeconds: 12.5, tracks: [.mic: mic, .screen: screen],
    leftOut: [.camera: .noSamples], problems: [.mic: "sent nothing"])
  let json = try #require(try JSONSerialization.jsonObject(with: file.encoded()) as? [String: Any])
  #expect(Set(json.keys) == ["format", "status", "startedAt", "durationSeconds", "tracks", "input", "clockLog", "leftOut", "problems"])
  #expect(json["format"] as? String == "studio-recording/1")
  #expect(json["status"] as? String == "complete")
  #expect(json["leftOut"] as? [String: String] == ["camera": "no samples arrived"])
  #expect(Set(((json["tracks"] as? [String: Any])?["mic"] as? [String: Any] ?? [:]).keys) == ["file", "startSeconds", "channel", "hostDriftSeconds"])
  let window = ((json["tracks"] as? [String: Any])?["screen"] as? [String: Any])?["window"] as? [String: String]
  #expect(window == ["title": "Notes", "app": "Notes", "file": "window.jsonl"])
  // recording-window-log.ts reads these keys.
  let line = try JSONSerialization.jsonObject(with: JSONEncoder().encode(RecordingWindowLine(t: 1, boundsPoints: [0, 0, 1, 1], contentPixels: [0, 0, 2, 2]))) as? [String: Any]
  #expect(Set((line ?? [:]).keys) == ["t", "boundsPoints", "contentPixels"])
}
