// One track's file. Every track is written in movie fragments, so a recording killed mid-take keeps everything up
// to its last fragment; keyframes come at the fragment interval so each fragment decodes on its own.
import AVFoundation
import RecorderCore
import Synchronization

/// The one clock every track's timestamps are put on before they're written: the Mac's host clock.
enum HostClock {
  static let clock = CMClockGetHostTimeClock()
  static func now() -> CMTime { CMClockGetTime(clock) }
}

let fragmentSeconds = 2.0

/// The host times of the first and latest samples, where the samples appended so far end, and samples the writer
/// wasn't ready for (in real time they are dropped, not queued).
struct TrackProgress {
  var firstPTS: CMTime?
  var lastPTS: CMTime?
  /// None until a sample is appended; a dropped sample or a failed writer never moves it.
  var appendedEnd: CMTime?
  var notReady = 0
}

final class TrackWriter {
  let track: RecorderTrack
  let url: URL
  private let writer: AVAssetWriter
  private let input: AVAssetWriterInput
  /// Read on the main thread while the capture queue writes. A lock, not an actor: an append runs in the capture
  /// callback, which must never wait on an actor hop, and a queued hop could reorder samples.
  private let shared = Mutex(TrackProgress())
  /// The capture queue's own: never read elsewhere until the queue has drained.
  private var lastEnd: CMTime?
  private(set) var appended = 0
  private var failureLogged = false

  var progress: TrackProgress { shared.withLock { $0 } }
  var firstPTS: CMTime? { progress.firstPTS }

  init(track: RecorderTrack, url: URL, fileType: AVFileType, mediaType: AVMediaType, settings: [String: Any]) throws(TrackFailure) {
    self.track = track
    self.url = url
    do {
      writer = try AVAssetWriter(outputURL: url, fileType: fileType)
    } catch {
      throw .system(error)
    }
    writer.movieFragmentInterval = CMTime(seconds: fragmentSeconds, preferredTimescale: 600)
    input = AVAssetWriterInput(mediaType: mediaType, outputSettings: settings)
    input.expectsMediaDataInRealTime = true
    writer.add(input)
    guard writer.startWriting() else { throw writer.error.map(TrackFailure.system) ?? .writerWouldNotStart(track) }
  }

  /// Appends a sample already on the host clock. Call from the track's one capture queue.
  func append(_ sample: CMSampleBuffer) {
    let pts = sample.presentationTimeStamp
    let first = shared.withLock { progress in
      defer { progress.lastPTS = pts }
      guard progress.firstPTS == nil else { return false }
      progress.firstPTS = pts
      return true
    }
    if first { writer.startSession(atSourceTime: pts) }
    guard writer.status == .writing else {
      if !failureLogged { log("\(track.rawValue): writer \(writer.status.rawValue): \(writer.error?.localizedDescription ?? "?")") }
      failureLogged = true
      return
    }
    guard input.isReadyForMoreMediaData else {
      shared.withLock { $0.notReady += 1 }
      return
    }
    if input.append(sample) {
      appended += 1
      let end = pts + (sample.duration.isValid ? sample.duration : .zero)
      lastEnd = end
      shared.withLock { $0.appendedEnd = end }
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
    if writer.status == .failed { log("\(track.rawValue): finishing failed: \(writer.error?.localizedDescription ?? "?")") }
  }
}
