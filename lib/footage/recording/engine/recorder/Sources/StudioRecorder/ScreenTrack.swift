// The screen, through ScreenCaptureKit, at the display's full pixel size in HEVC. SCK stamps frames on the host
// clock already, and sends none while the screen sits still, so the file has a variable frame rate.
import AVFoundation
import RecorderCore
import ScreenCaptureKit

final class ScreenTrack: NSObject, SCStreamOutput, SCStreamDelegate {
  let writer: TrackWriter
  let geometry: DisplayGeometry
  private let queue = DispatchQueue(label: "recorder.screen", qos: .userInteractive)

  static func make(config: ScreenConfig, url: URL) async throws(TrackFailure) -> ScreenTrack {
    let content: SCShareableContent
    do { content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) } catch { throw .system(error) }
    let screens = RecorderInputs.screens()
    func name(_ display: SCDisplay) -> String {
      screens.first { $0.displayID == display.displayID }?.localizedName ?? "display \(display.displayID)"
    }
    guard let screen = RecorderInputs.screen(named: config.display),
      let display = content.displays.first(where: { $0.displayID == screen.displayID })
    else {
      throw .noDevice(.screen, named: config.display, connected: content.displays.map(name))
    }
    let filter = SCContentFilter(display: display, excludingWindows: [])
    let info = SCShareableContent.info(for: filter)
    let scale = Double(info.pointPixelScale)
    let width = Int((info.contentRect.width * CGFloat(scale)).rounded())
    let height = Int((info.contentRect.height * CGFloat(scale)).rounded())
    let bounds = CGDisplayBounds(display.displayID)
    let geometry = DisplayGeometry(
      name: name(display), boundsPoints: [bounds.origin.x, bounds.origin.y, bounds.width, bounds.height].map(Double.init),
      scale: scale, widthPixels: width, heightPixels: height)

    let streamConfig = SCStreamConfiguration()
    streamConfig.width = width
    streamConfig.height = height
    streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(config.fps))
    streamConfig.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    streamConfig.colorSpaceName = CGColorSpace.sRGB
    streamConfig.showsCursor = config.showsCursor
    streamConfig.queueDepth = 8

    let writer = try TrackWriter(
      track: .screen, url: url, fileType: .mp4, mediaType: .video,
      settings: [
        AVVideoCodecKey: AVVideoCodecType.hevc,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: config.bitrateMbps * 1_000_000,
          AVVideoExpectedSourceFrameRateKey: config.fps,
          AVVideoMaxKeyFrameIntervalDurationKey: fragmentSeconds,
          AVVideoAllowFrameReorderingKey: false,
        ],
      ])
    return ScreenTrack(filter: filter, configuration: streamConfig, writer: writer, geometry: geometry)
  }

  private var stream: SCStream!

  private init(filter: SCContentFilter, configuration: SCStreamConfiguration, writer: TrackWriter, geometry: DisplayGeometry) {
    self.writer = writer
    self.geometry = geometry
    super.init()
    stream = SCStream(filter: filter, configuration: configuration, delegate: self)
  }

  func start() async throws(TrackFailure) {
    do {
      try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
      try await stream.startCapture()
    } catch {
      throw .system(error)
    }
  }

  func stop(at end: CMTime) async {
    try? await stream.stopCapture()
    queue.sync {}
    await writer.finish(at: end)
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
    // Idle and blank frames carry no picture: the last complete frame holds until the next.
    guard type == .screen, sample.isValid, sample.imageBuffer != nil,
      let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
      let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete
    else { return }
    writer.append(sample)
  }

  /// Why SCK stopped the stream mid-take (a display unplugged, the permission revoked); read on the main thread.
  @MainActor private(set) var stopError: String?

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    log("screen: capture stopped: \(error.localizedDescription)")
    DispatchQueue.main.async { self.stopError = error.localizedDescription }
  }
}
