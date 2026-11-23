// The screen, through ScreenCaptureKit, at the display's full pixel size in HEVC. SCK stamps frames on the host
// clock already, and sends none while the screen sits still, so the file has a variable frame rate.
import AVFoundation
import ScreenCaptureKit

struct DisplayGeometry: Codable {
  var name: String
  /// The display's rectangle in global points: origin at the main display's top left, y down (Quartz).
  var boundsPoints: [Double]
  /// Pixels per point: the screen track's pixel = (point - bounds origin) × scale.
  var scale: Double
  var widthPixels: Int
  var heightPixels: Int
}

final class ScreenTrack: NSObject, SCStreamOutput, SCStreamDelegate {
  let writer: TrackWriter
  let geometry: DisplayGeometry
  private let stream: SCStream
  private let queue = DispatchQueue(label: "recorder.screen", qos: .userInteractive)

  static func make(config: ScreenConfig, url: URL) async throws -> ScreenTrack {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let screens = NSScreen.screens
    func name(_ display: SCDisplay) -> String {
      screens.first { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == display.displayID }?
        .localizedName ?? "display \(display.displayID)"
    }
    let display: SCDisplay
    if config.display == "main" {
      guard let main = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else { throw RecorderError("no main display") }
      display = main
    } else {
      guard let named = content.displays.first(where: { name($0).localizedCaseInsensitiveContains(config.display) }) else {
        throw RecorderError("no display named like \"\(config.display)\"; there are: \(content.displays.map(name).joined(separator: ", "))")
      }
      display = named
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
      name: "screen", url: url, fileType: .mp4, mediaType: .video,
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
    return ScreenTrack(stream: SCStream(filter: filter, configuration: streamConfig, delegate: nil), writer: writer, geometry: geometry)
  }

  private init(stream: SCStream, writer: TrackWriter, geometry: DisplayGeometry) {
    self.stream = stream
    self.writer = writer
    self.geometry = geometry
    super.init()
  }

  func start() async throws {
    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
    try await stream.startCapture()
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

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    log("screen: capture stopped: \(error.localizedDescription)")
  }
}
