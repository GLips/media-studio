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
  private(set) var firstPTS: CMTime?
  private(set) var lastEnd: CMTime?
  private(set) var appended = 0
  /// Samples the writer wasn't ready for: in real time they are dropped, not queued.
  private(set) var notReady = 0
  private var failureLogged = false
  /// Called once, with the host time of the track's first sample.
  var onFirstSample: ((CMTime) -> Void)?

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
    if firstPTS == nil {
      writer.startSession(atSourceTime: pts)
      firstPTS = pts
      onFirstSample?(pts)
    }
    guard writer.status == .writing else {
      if !failureLogged { log("\(name): writer \(writer.status.rawValue): \(writer.error?.localizedDescription ?? "?")") }
      failureLogged = true
      return
    }
    guard input.isReadyForMoreMediaData else { notReady += 1; return }
    if input.append(sample) {
      appended += 1
      let duration = sample.duration.isValid ? sample.duration : .zero
      lastEnd = pts + duration
    }
  }

  /// Ends the file at `end` on the host clock (a screen that sat still has its last frame held until then).
  func finish(at end: CMTime?) async {
    guard firstPTS != nil else { writer.cancelWriting(); try? FileManager.default.removeItem(at: url); return }
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
