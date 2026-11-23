// The screen, through ScreenCaptureKit, in HEVC: a whole display at its full pixel size, or one window at its size
// when the take began. SCK stamps frames on the host clock already, and sends none while the picture sits still, so
// the file has a variable frame rate.
import AVFoundation
import RecorderCore
import ScreenCaptureKit

/// What a screen track recorded, as recording.json's screen entry describes it.
enum ScreenCaptured {
  case display(DisplayGeometry)
  case window(RecordedWindow)
}

final class ScreenTrack: NSObject, SCStreamOutput, SCStreamDelegate {
  let writer: TrackWriter
  let captured: ScreenCaptured
  /// Why it isn't recording what was picked (the picked window had closed); recording.json's screen problem.
  let startProblem: String?
  /// A window capture's window.jsonl, fed from the capture queue.
  private let placements: WindowPlacementLog?
  private let queue = DispatchQueue(label: "recorder.screen", qos: .userInteractive)

  static func make(config: ScreenConfig, folder: URL, start: CMTime) async throws(TrackFailure) -> ScreenTrack {
    let content: SCShareableContent
    // Every window, not only those on screen: a picked window on another Space or minimized is still there to record.
    do { content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false) } catch { throw .system(error) }
    var startProblem: String?
    if let picked = config.window {
      if let window = content.windows.first(where: { $0.windowID == picked.id && $0.owningApplication?.bundleIdentifier == picked.bundleID }) {
        return try windowTrack(window, picked: picked, config: config, folder: folder, start: start)
      }
      startProblem = "the picked window \"\(picked.title)\" (\(picked.app)) had closed: recorded its display, \(config.display), instead"
    }

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
    let streamConfig = streamConfiguration(config, width: width, height: height)
    return ScreenTrack(
      filter: filter, configuration: streamConfig, writer: try writer(config, folder: folder, width: width, height: height),
      captured: .display(geometry), startProblem: startProblem, placements: nil)
  }

  private static func windowTrack(_ window: SCWindow, picked: WindowConfig, config: ScreenConfig, folder: URL, start: CMTime) throws(TrackFailure) -> ScreenTrack {
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let info = SCShareableContent.info(for: filter)
    let scale = CGFloat(info.pointPixelScale)
    // Even sides, as HEVC's 4:2:0 needs: a window can be any size.
    func even(_ points: CGFloat) -> Int { Int((points * scale / 2).rounded(.up)) * 2 }
    let (width, height) = (even(info.contentRect.width), even(info.contentRect.height))
    let streamConfig = streamConfiguration(config, width: width, height: height)
    // Without its shadow, the picture is the window's frame, so the window's bounds map onto it edge to edge.
    streamConfig.ignoreShadowsSingleWindow = true
    let placements: WindowPlacementLog
    do {
      placements = try WindowPlacementLog(
        url: folder.appendingPathComponent(RecordedWindow.fileName), windowID: window.windowID, start: start,
        firstContentPixels: CGRect(x: 0, y: 0, width: info.contentRect.width * scale, height: info.contentRect.height * scale))
    } catch {
      throw .system(error)
    }
    // The title as it is now: a window's title follows what it shows.
    let recorded = RecordedWindow(title: window.title ?? picked.title, app: window.owningApplication?.applicationName ?? picked.app)
    return ScreenTrack(
      filter: filter, configuration: streamConfig, writer: try writer(config, folder: folder, width: width, height: height),
      captured: .window(recorded), startProblem: nil, placements: placements)
  }

  private static func streamConfiguration(_ config: ScreenConfig, width: Int, height: Int) -> SCStreamConfiguration {
    let streamConfig = SCStreamConfiguration()
    streamConfig.width = width
    streamConfig.height = height
    streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(config.fps))
    streamConfig.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    streamConfig.colorSpaceName = CGColorSpace.sRGB
    streamConfig.showsCursor = config.showsCursor
    streamConfig.queueDepth = 8
    return streamConfig
  }

  private static func writer(_ config: ScreenConfig, folder: URL, width: Int, height: Int) throws(TrackFailure) -> TrackWriter {
    try TrackWriter(
      track: .screen, url: folder.appendingPathComponent("screen.mp4"), fileType: .mp4, mediaType: .video,
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
  }

  private var stream: SCStream!
  /// Polls the window's bounds on the capture queue: a window moved without changing its picture sends no frame.
  private var boundsPoll: DispatchSourceTimer?

  private init(
    filter: SCContentFilter, configuration: SCStreamConfiguration, writer: TrackWriter, captured: ScreenCaptured, startProblem: String?,
    placements: WindowPlacementLog?
  ) {
    self.writer = writer
    self.captured = captured
    self.startProblem = startProblem
    self.placements = placements
    super.init()
    stream = SCStream(filter: filter, configuration: configuration, delegate: self)
  }

  func start() async throws(TrackFailure) {
    if let placements {
      let poll = DispatchSource.makeTimerSource(queue: queue)
      poll.schedule(deadline: .now(), repeating: .milliseconds(33))
      poll.setEventHandler { placements.pollBounds(at: HostClock.now()) }
      poll.resume()
      boundsPoll = poll
    }
    do {
      try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
      try await stream.startCapture()
    } catch {
      throw .system(error)
    }
  }

  func stop(at end: CMTime) async {
    try? await stream.stopCapture()
    queue.sync {
      boundsPoll?.cancel()
      placements?.close()
    }
    await writer.finish(at: end)
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
    // Idle and blank frames carry no picture: the last complete frame holds until the next.
    guard type == .screen, sample.isValid, sample.imageBuffer != nil,
      let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
      let info = attachments.first, let raw = info[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete
    else { return }
    if let placements, let rect = info[.contentRect].flatMap({ CGRect(dictionaryRepresentation: $0 as! CFDictionary) }),
      let pointScale = info[.scaleFactor] as? CGFloat
    {
      // The content rect is in the frame's points; at the frame's scale it's the track's pixels.
      let pixels = CGRect(x: rect.minX * pointScale, y: rect.minY * pointScale, width: rect.width * pointScale, height: rect.height * pointScale)
      placements.frameContent(pixels, at: sample.presentationTimeStamp)
    }
    writer.append(sample)
  }

  /// Why SCK stopped the stream mid-take (a display unplugged, the window closed, the permission revoked); read on
  /// the main thread.
  @MainActor private(set) var stopError: String?

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    log("screen: capture stopped: \(error.localizedDescription)")
    DispatchQueue.main.async { self.stopError = error.localizedDescription }
  }
}

/// window.jsonl: a line each time the window's bounds or its picture's place in the track change. Used only on the
/// screen track's capture queue.
final class WindowPlacementLog {
  private let lines: JSONLines<RecordingWindowLine>
  private let windowID: CGWindowID
  private let start: CMTime
  private var bounds: CGRect?
  private var contentPixels: CGRect
  private var written: RecordingWindowLine?

  init(url: URL, windowID: CGWindowID, start: CMTime, firstContentPixels: CGRect) throws(JSONLinesFailure) {
    lines = try JSONLines(url: url)
    self.windowID = windowID
    self.start = start
    contentPixels = firstContentPixels
  }

  /// Reads where the window is now; a closed window keeps its last bounds.
  func pollBounds(at now: CMTime) {
    let ids = [UnsafeRawPointer(bitPattern: UInt(windowID))] as CFArray
    guard let found = CGWindowListCreateDescriptionFromArray(ids) as? [[CFString: Any]],
      let boundsDictionary = found.first?[kCGWindowBounds], let polled = CGRect(dictionaryRepresentation: boundsDictionary as! CFDictionary)
    else { return }
    bounds = polled
    note(at: now)
  }

  func frameContent(_ pixels: CGRect, at time: CMTime) {
    contentPixels = pixels
    note(at: time)
  }

  func close() { lines.close() }

  private func note(at time: CMTime) {
    guard let bounds else { return }
    let line = RecordingWindowLine(
      // A frame is stamped when it was shown, a poll when it ran: neither may take the log back in time.
      t: max(written?.t ?? 0, (time - start).seconds), boundsPoints: [bounds.minX, bounds.minY, bounds.width, bounds.height].map(Double.init),
      contentPixels: [contentPixels.minX, contentPixels.minY, contentPixels.width, contentPixels.height].map(Double.init))
    if let written, written.boundsPoints == line.boundsPoints && written.contentPixels == line.contentPixels { return }
    lines.write(line)
    written = line
  }
}
