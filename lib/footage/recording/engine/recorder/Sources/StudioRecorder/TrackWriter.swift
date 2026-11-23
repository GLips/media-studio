// One track's file. Every track is written in movie fragments, so a recording killed mid-take keeps everything up
// to its last fragment; keyframes come at the fragment interval so each fragment decodes on its own.
import AVFoundation

/// The one clock every track's timestamps are put on before they're written: the Mac's host clock.
enum HostClock {
  static let clock = CMClockGetHostTimeClock()
  static func now() -> CMTime { CMClockGetTime(clock) }
}

let fragmentSeconds = 2.0

final class TrackWriter {
  let name: String
  let url: URL
  private let writer: AVAssetWriter
  private let input: AVAssetWriterInput
  private(set) var lastEnd: CMTime?
  private(set) var appended = 0
  private var failureLogged = false
  /// What the main thread reads while the capture queue writes, under `lock`.
  private var shared = TrackProgress()
  private let lock = NSLock()

  /// The host times of the first and latest samples, and samples the writer wasn't ready for (in real time they
  /// are dropped, not queued).
  struct TrackProgress {
    var firstPTS: CMTime?
    var lastPTS: CMTime?
    var notReady = 0
  }

  var progress: TrackProgress {
    lock.lock()
    defer { lock.unlock() }
    return shared
  }
  var firstPTS: CMTime? { progress.firstPTS }

  init(name: String, url: URL, fileType: AVFileType, mediaType: AVMediaType, settings: [String: Any]) throws {
    self.name = name
    self.url = url
    writer = try AVAssetWriter(outputURL: url, fileType: fileType)
    writer.movieFragmentInterval = CMTime(seconds: fragmentSeconds, preferredTimescale: 600)
    input = AVAssetWriterInput(mediaType: mediaType, outputSettings: settings)
    input.expectsMediaDataInRealTime = true
    writer.add(input)
    guard writer.startWriting() else { throw writer.error ?? RecorderError("\(name): the writer wouldn't start") }
  }

  /// Appends a sample already on the host clock. Not thread-safe: call from the track's one capture queue.
  func append(_ sample: CMSampleBuffer) {
    let pts = sample.presentationTimeStamp
    let first = progress.firstPTS == nil
    if first { writer.startSession(atSourceTime: pts) }
    lock.lock()
    if first { shared.firstPTS = pts }
    shared.lastPTS = pts
    lock.unlock()
    guard writer.status == .writing else {
      if !failureLogged { log("\(name): writer \(writer.status.rawValue): \(writer.error?.localizedDescription ?? "?")") }
      failureLogged = true
      return
    }
    guard input.isReadyForMoreMediaData else {
      lock.lock()
      shared.notReady += 1
      lock.unlock()
      return
    }
    if input.append(sample) {
      appended += 1
      let duration = sample.duration.isValid ? sample.duration : .zero
      lastEnd = pts + duration
    }
  }

  /// Removes the file of a track that never got going.
  func discard() {
    writer.cancelWriting()
    try? FileManager.default.removeItem(at: url)
  }

  /// Ends the file at `end` on the host clock (a screen that sat still has its last frame held until then).
  func finish(at end: CMTime?) async {
    guard firstPTS != nil else { discard(); return }
    input.markAsFinished()
    if let end, let lastEnd, end > lastEnd { writer.endSession(atSourceTime: end) }
    await writer.finishWriting()
    if writer.status == .failed { log("\(name): finishing failed: \(writer.error?.localizedDescription ?? "?")") }
  }
}

struct RecorderError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}
