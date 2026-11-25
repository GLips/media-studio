// The Mac's own sound: everything its apps play, but the recorder's, through ScreenCaptureKit as stereo AAC. A
// stream of its own beside the screen's, because a window's stream hears only that window's app, and this one hears
// every app whatever the screen records. SCK stamps its audio on the host clock already.
import AVFoundation
import RecorderCore
import ScreenCaptureKit

final class SystemAudioTrack: NSObject, SCStreamOutput, SCStreamDelegate {
  static let sampleRate = 48_000
  let writer: TrackWriter
  private let clockLog: ClockLog
  private let queue = DispatchQueue(label: "recorder.system", qos: .userInteractive)
  private var stream: SCStream!
  /// The capture queue's own.
  private var buffers = 0

  static func make(config: SystemAudioConfig, url: URL, clockLog: ClockLog) async throws(TrackFailure) -> SystemAudioTrack {
    let content: SCShareableContent
    do { content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) } catch { throw .system(error) }
    // A display's filter is only the way in: with no app left out, SCK hears every app's sound, whichever display.
    guard let display = content.displays.first else { throw .noDisplayToHearThrough }
    let writer = try TrackWriter(
      track: .system, url: url, fileType: .m4a, mediaType: .audio,
      settings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: sampleRate,
        AVNumberOfChannelsKey: 2,
        AVEncoderBitRateKey: config.bitrateKbps * 1000,
      ])
    return SystemAudioTrack(filter: SCContentFilter(display: display, excludingWindows: []), writer: writer, clockLog: clockLog)
  }

  private init(filter: SCContentFilter, writer: TrackWriter, clockLog: ClockLog) {
    self.writer = writer
    self.clockLog = clockLog
    super.init()
    let configuration = SCStreamConfiguration()
    configuration.capturesAudio = true
    configuration.excludesCurrentProcessAudio = true
    configuration.sampleRate = Self.sampleRate
    configuration.channelCount = 2
    // SCK always captures a picture too: keep it as small and as rare as it allows.
    configuration.width = 2
    configuration.height = 2
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
    configuration.showsCursor = false
    stream = SCStream(filter: filter, configuration: configuration, delegate: self)
  }

  func start() async throws(TrackFailure) {
    do {
      // The picture is taken in and dropped: with no output for it, SCK logs every frame it drops.
      try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
      try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
      try await stream.startCapture()
    } catch {
      writer.discard()
      throw .system(error)
    }
  }

  func stop() async {
    try? await stream.stopCapture()
    queue.sync {}
    await writer.finish(at: nil)
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .audio, sample.isValid else { return }
    let pts = sample.presentationTimeStamp
    if buffers % 50 == 0 { clockLog.write(track: .system, host: pts, media: pts, arrival: HostClock.now()) }
    buffers += 1
    writer.append(sample)
  }

  /// Why SCK stopped the stream mid-take; read on the main thread.
  @MainActor private(set) var stopError: String?

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    log("system: capture stopped: \(error.localizedDescription)")
    DispatchQueue.main.async { self.stopError = error.localizedDescription }
  }
}
