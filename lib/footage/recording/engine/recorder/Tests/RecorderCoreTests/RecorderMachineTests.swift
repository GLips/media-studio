// The recorder's machine, driven through its one transition: the paths Graham relies on, and invariants held over
// seeded random event orders, since its events come from devices, prompts and child processes in any order.
import Foundation
import RecorderCore
import Testing

struct FakeTake: RecorderTake, Equatable {
  let id: Int
  var folder: URL { URL(fileURLWithPath: "/takes/\(id)") }
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
    case .saveInputPick: "saveInputPick"
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
  #expect(names(effects) == ["start inputCheck", "stop inputCheck", "beginTake"])

  (state, effects) = run(state, [.takeStarted(take), .toggleRequested, .takeEnded])
  #expect(state.phase.name == .idle)
  #expect(names(effects) == ["log", "start trackWatch", "stop trackWatch", "endTake", "log", "handOff", "start inputCheck"])
}

@Test func aQuitDuringATakeFinishesItHandsItOffThenQuits() {
  let take = FakeTake(id: 1)
  let (state, effects) = run(atIdle, [.toggleRequested, .quitRequested, .takeStarted(take), .toggleRequested, .takeEnded])
  #expect(state.phase.name == .exited)
  #expect(names(effects) == ["beginTake", "log", "endTake", "log", "handOff", "replyToQuit"])
}

@Test func aTrackProblemIsKeptThroughTheTakeAndClearedByTheNext() {
  let (state, effects) = run(atIdle, [
    .toggleRequested, .takeStarted(FakeTake(id: 1)),
    .trackProblemsFound([.camera: "sent nothing"]),
    .trackProblemsFound([.camera: "stopped sending at 9.0 s", .mic: "sent nothing"]),
    .toggleRequested, .takeEnded,
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

@Test func permissionsGrantedInSettingsUnblockOrRelaunch() {
  let launch = State.launch(missing: [.screen, .camera])
  #expect(names(launch.effects) == ["askForPermissions"])
  var (state, effects) = run(launch, [.toggleRequested, .permissionsChecked(granted: [.camera])])
  // A press while a permission is missing asks again instead of recording; screen waits on a fresh process.
  #expect(names(effects) == ["askForPermissions", "log", "request screen", "start permissionPoll"])
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
    .takeEnded, .takeEnded,
    .libraryAddFailed(.exited(status: 1)),
    .menuOpened, .menuClosed,
    .inputPicked(RecorderInputPick(kind: .mic, name: "Scarlett")),
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
  let file = StudioRecordingFile(
    status: .complete, startedAt: "2026-11-22T18:19:29.847-08:00", durationSeconds: 12.5, tracks: [.mic: mic],
    leftOut: [.camera: .noSamples], problems: [.mic: "sent nothing"])
  let json = try #require(try JSONSerialization.jsonObject(with: file.encoded()) as? [String: Any])
  #expect(Set(json.keys) == ["format", "status", "startedAt", "durationSeconds", "tracks", "input", "clockLog", "leftOut", "problems"])
  #expect(json["format"] as? String == "studio-recording/1")
  #expect(json["status"] as? String == "complete")
  #expect(json["leftOut"] as? [String: String] == ["camera": "no samples arrived"])
  #expect(Set(((json["tracks"] as? [String: Any])?["mic"] as? [String: Any] ?? [:]).keys) == ["file", "startSeconds", "channel", "hostDriftSeconds"])
}
