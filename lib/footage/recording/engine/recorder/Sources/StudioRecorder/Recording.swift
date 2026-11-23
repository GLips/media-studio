// One recording: a folder holding a file per track, the input log, the clock log and recording.json, which says
// how the tracks line up. Tracks are never retimed to fit: each file starts at its own first sample, and its
// offset and corrections are numbers in recording.json, applied by whoever reads the recording.
import AVFoundation

final class Recording {
  let folder: URL
  let start: CMTime
  private let startedAt = Date()
  private var screen: ScreenTrack?
  private var camera: CameraTrack?
  private var mic: MicTrack?
  private let input: InputLog
  private let clockLog: ClockLog
  private let config: RecorderConfig
  private var failures: [String: String] = [:]
  private var stoppedAt: CMTime?

  static func begin(config: RecorderConfig) async throws -> Recording {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
    let folder = config.recordingsURL.appendingPathComponent(formatter.string(from: Date()))
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let recording = try Recording(folder: folder, config: config)
    try await recording.startTracks()
    return recording
  }

  private init(folder: URL, config: RecorderConfig) throws {
    self.folder = folder
    self.config = config
    start = HostClock.now()
    clockLog = try ClockLog(url: folder.appendingPathComponent("clock.jsonl"), start: start)
    input = try InputLog(url: folder.appendingPathComponent("input.jsonl"), start: start)
  }

  /// A track that can't start (a camera unplugged) is left out and named in recording.json; the rest record.
  private func startTracks() async throws {
    // Camera and mic open first and in the background: they are the slowest to deliver a first sample.
    if let cameraConfig = config.camera {
      do {
        let track = try CameraTrack(config: cameraConfig, url: folder.appendingPathComponent("camera.mp4"), clockLog: clockLog)
        track.start()
        camera = track
      } catch { failures["camera"] = "\(error)" }
    }
    if let micConfig = config.mic {
      do {
        let track = try MicTrack(config: micConfig, url: folder.appendingPathComponent("mic.m4a"), clockLog: clockLog)
        track.start()
        mic = track
      } catch { failures["mic"] = "\(error)" }
    }
    do {
      let track = try await ScreenTrack.make(config: config.screen, url: folder.appendingPathComponent("screen.mp4"))
      try await track.start()
      screen = track
    } catch { failures["screen"] = "\(error)" }
    do { try input.begin() } catch { failures["input"] = "\(error)" }
    for (track, failure) in failures { log("\(track) left out: \(failure)") }
    if screen == nil && camera == nil && mic == nil { throw RecorderError("no track could start: \(failures)") }
    // The dot turns red only once every track has its first sample (the mic takes about a second to open), so
    // whatever Graham says after it turns red is on every track. Its offsets are written then.
    let writers = [screen?.writer, camera?.writer, mic?.writer].compactMap { $0 }
    let deadline = Date().addingTimeInterval(5)
    while writers.contains(where: { $0.firstPTS == nil }) && Date() < deadline { try await Task.sleep(for: .milliseconds(20)) }
    writeMetadata(status: "recording")
  }

  func end() async {
    let end = HostClock.now()
    stoppedAt = end
    input.end()
    async let screenDone: Void? = screen?.stop(at: end)
    async let cameraDone: Void? = camera?.stop(at: end)
    async let micDone: Void? = mic?.stop()
    _ = await (screenDone, cameraDone, micDone)
    clockLog.close()
    writeMetadata(status: "complete")
  }

  private func seconds(_ time: CMTime?) -> Double? { time.map { ($0 - start).seconds } }

  private func writeMetadata(status: String) {
    var tracks: [String: Any] = [:]
    if let screen {
      let geometry = screen.geometry
      tracks["screen"] = compact([
        "file": "screen.mp4", "startSeconds": seconds(screen.writer.firstPTS),
        "writerDroppedFrames": screen.writer.notReady,
        "display": [
          "name": geometry.name, "boundsPoints": geometry.boundsPoints, "scale": geometry.scale,
          "widthPixels": geometry.widthPixels, "heightPixels": geometry.heightPixels,
        ],
      ])
    }
    if let camera, let cameraConfig = config.camera {
      tracks["camera"] = compact([
        "file": "camera.mp4", "startSeconds": seconds(camera.writer.firstPTS), "device": camera.deviceName,
        "sourceFormat": camera.sourceFormat, "latencySeconds": cameraConfig.latencyMs / 1000,
        "captureDroppedFrames": camera.droppedByCapture, "writerDroppedFrames": camera.writer.notReady,
      ])
    }
    if let mic, let micConfig = config.mic {
      tracks["mic"] = compact([
        "file": "mic.m4a", "startSeconds": seconds(mic.writer.firstPTS), "device": mic.deviceName, "channel": mic.channel,
        "sampleRate": mic.sampleRate, "latencySeconds": micConfig.latencyMs / 1000,
        "hostDriftSeconds": mic.driftSeconds,
      ])
    }
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    iso.timeZone = .current
    let metadata = compact([
      "format": "studio-recording/1",
      "status": status,
      "startedAt": iso.string(from: startedAt),
      "durationSeconds": seconds(stoppedAt),
      "tracks": tracks,
      "input": failures["input"] == nil ? ["file": "input.jsonl", "coordinates": "global-points"] : nil,
      "clockLog": "clock.jsonl",
      "leftOut": failures.isEmpty ? nil : failures,
    ])
    guard let data = try? JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys]) else { return }
    try? data.write(to: folder.appendingPathComponent("recording.json"), options: .atomic)
  }
}

private func compact(_ dictionary: [String: Any?]) -> [String: Any] { dictionary.compactMapValues { $0 } }
