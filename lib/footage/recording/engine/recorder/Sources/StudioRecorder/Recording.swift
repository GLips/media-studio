// One take: a folder holding a file per track, the input log, the clock log and recording.json, which says how the
// tracks line up. Tracks are never retimed to fit: each file starts at its own first sample, and its offset and
// corrections are numbers in recording.json, applied by whoever reads the recording. Which tracks started is fixed
// when the take begins; what goes wrong later is the machine's (RecorderCore), handed in to be written.
import AVFoundation
import RecorderCore

final class Recording: RecorderTake {
  let folder: URL
  private let start: CMTime
  let startedAt: Date
  private let screen: ScreenTrack?
  private let camera: CameraTrack?
  private let mic: MicTrack?
  private let input: InputLog
  private let clockLog: ClockLog
  /// The tracks that couldn't start, and why; each started track is the one above that isn't nil.
  private let startFailures: [RecorderTrack: TrackFailure]

  /// Opens every configured track. One that can't start (a camera unplugged) is left out and named in
  /// recording.json; the rest record. Returns once every started track has its first sample.
  static func begin(config: RecorderConfig) async throws(TakeStartFailure) -> Recording {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
    let startedAt = Date()
    let folder = config.recordingsURL.appendingPathComponent(formatter.string(from: startedAt))
    let start: CMTime
    let clockLog: ClockLog
    let input: InputLog
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      start = HostClock.now()
      clockLog = try ClockLog(url: folder.appendingPathComponent("clock.jsonl"), start: start)
      input = try InputLog(url: folder.appendingPathComponent("input.jsonl"), start: start)
    } catch {
      throw .folderUnwritable(error)
    }

    var failures: [RecorderTrack: TrackFailure] = [:]
    // Camera and mic open first and in the background: they are the slowest to deliver a first sample.
    var camera: CameraTrack?
    if let cameraConfig = config.camera {
      do {
        camera = try CameraTrack(config: cameraConfig, url: folder.appendingPathComponent("camera.mp4"), clockLog: clockLog)
        camera?.start()
      } catch { failures[.camera] = error }
    }
    var mic: MicTrack?
    if let micConfig = config.mic {
      do {
        mic = try MicTrack(config: micConfig, url: folder.appendingPathComponent("mic.m4a"), clockLog: clockLog)
        mic?.start()
      } catch { failures[.mic] = error }
    }
    var screen: ScreenTrack?
    do {
      let track = try await ScreenTrack.make(config: config.screen, url: folder.appendingPathComponent("screen.mp4"))
      try await track.start()
      screen = track
    } catch { failures[.screen] = error }
    guard screen != nil || camera != nil || mic != nil else {
      for (track, failure) in failures.sorted(by: { $0.key < $1.key }) { log("\(track.rawValue) left out: \(failure)") }
      clockLog.close()
      input.end()
      throw .noTrackStarted(failures)
    }
    do { try input.begin() } catch { failures[.input] = error }
    for (track, failure) in failures.sorted(by: { $0.key < $1.key }) { log("\(track.rawValue) left out: \(failure)") }

    let recording = Recording(
      folder: folder, start: start, startedAt: startedAt, screen: screen, camera: camera, mic: mic, input: input, clockLog: clockLog,
      startFailures: failures)
    await recording.awaitFirstSamples()
    recording.write(status: .recording, problems: [:], stoppedAt: nil)
    return recording
  }

  private init(
    folder: URL, start: CMTime, startedAt: Date, screen: ScreenTrack?, camera: CameraTrack?, mic: MicTrack?, input: InputLog,
    clockLog: ClockLog, startFailures: [RecorderTrack: TrackFailure]
  ) {
    self.folder = folder
    self.start = start
    self.startedAt = startedAt
    self.screen = screen
    self.camera = camera
    self.mic = mic
    self.input = input
    self.clockLog = clockLog
    self.startFailures = startFailures
  }

  private var writers: [(RecorderTrack, TrackWriter)] {
    [(.screen, screen?.writer), (.camera, camera?.writer), (.mic, mic?.writer)].compactMap { track, writer in writer.map { (track, $0) } }
  }

  /// The menu's dot turns red only once every track has its first sample (the mic takes about a second to open), so
  /// whatever Graham says after it turns red is on every track. Its offsets are written then.
  private func awaitFirstSamples() async {
    let deadline = ContinuousClock.now + .seconds(5)
    while writers.contains(where: { $0.1.firstPTS == nil }) && ContinuousClock.now < deadline {
      try? await Task.sleep(for: .milliseconds(20))
    }
  }

  /// Looks for a camera or mic that went quiet (an HDMI signal lost, a cable pulled) or a screen stream that stopped,
  /// skipping tracks with a problem already. The screen isn't timed out: a still screen sends no frames.
  @MainActor
  func findTrackProblems(known: [RecorderTrack: String]) -> [RecorderTrack: String] {
    let now = HostClock.now()
    var found: [RecorderTrack: String] = [:]
    for (track, writer) in writers where track != .screen && known[track] == nil {
      if let last = writer.progress.lastPTS {
        if (now - last).seconds > 2 { found[track] = "stopped sending at \(String(format: "%.1f", (last - start).seconds)) s" }
      } else if (now - start).seconds > 5 {
        found[track] = "sent nothing"
      }
    }
    if known[.screen] == nil, let error = screen?.stopError { found[.screen] = "stopped: \(error)" }
    return found
  }

  /// How much of the take its tracks have written: up to the latest sample any of them has, on the take's own clock.
  @MainActor
  var writtenSeconds: Double {
    writers.compactMap { $0.1.progress.lastPTS }.map(seconds).max() ?? 0
  }

  /// Rewrites recording.json mid-take with the take's problems.
  func recordProblems(_ problems: [RecorderTrack: String]) {
    write(status: .recording, problems: problems, stoppedAt: nil)
  }

  /// Returns the take's length.
  func end(problems: [RecorderTrack: String]) async -> Double {
    let end = HostClock.now()
    // The tap's callbacks run on the main run loop: tear it down there, between callbacks.
    await MainActor.run { input.end() }
    async let screenDone: Void? = screen?.stop(at: end)
    async let cameraDone: Void? = camera?.stop(at: end)
    async let micDone: Void? = mic?.stop()
    _ = await (screenDone, cameraDone, micDone)
    clockLog.close()
    write(status: .complete, problems: problems, stoppedAt: end)
    return seconds(end)
  }

  private func seconds(_ time: CMTime) -> Double { (time - start).seconds }

  private func write(status: RecordingStatus, problems: [RecorderTrack: String], stoppedAt: CMTime?) {
    var tracks: [RecorderTrack: RecordingTrackEntry] = [:]
    var leftOut = startFailures
    for (track, writer) in writers {
      // A track that never got a sample (a camera with no HDMI signal) has no file: it's left out, not listed.
      guard let first = writer.firstPTS else {
        if stoppedAt != nil { leftOut[track] = .noSamples }
        continue
      }
      var entry = RecordingTrackEntry(file: writer.url.lastPathComponent, startSeconds: seconds(first))
      switch track {
      case .screen:
        entry.display = screen?.geometry
        entry.writerDroppedFrames = writer.progress.notReady
      case .camera:
        entry.device = camera?.deviceName
        entry.sourceFormat = camera?.sourceFormat
        entry.latencySeconds = camera?.latencySeconds
        entry.captureDroppedFrames = camera?.droppedByCapture
        entry.writerDroppedFrames = writer.progress.notReady
      case .mic:
        entry.device = mic?.deviceName
        entry.channel = mic?.channel
        entry.sampleRate = mic?.sampleRate
        entry.latencySeconds = mic?.latencySeconds
        entry.hostDriftSeconds = mic?.driftSeconds
      case .input:
        break
      }
      tracks[track] = entry
    }
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    iso.timeZone = .current
    let file = StudioRecordingFile(
      status: status, startedAt: iso.string(from: startedAt), durationSeconds: stoppedAt.map(seconds), tracks: tracks, leftOut: leftOut,
      problems: problems)
    do {
      try file.encoded().write(to: folder.appendingPathComponent("recording.json"), options: .atomic)
    } catch {
      log("couldn't write recording.json: \(error)")
    }
  }
}
