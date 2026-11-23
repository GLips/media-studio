// The camera, through AVFoundation, scaled to the configured size and written as H.264. Frames are restamped
// from the capture session's clock onto the host clock, so the camera file shares the screen's timeline.
import AVFoundation

final class CameraTrack: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  let writer: TrackWriter
  let deviceName: String
  /// The device format's own size and rate, before scaling.
  let sourceFormat: String
  private(set) var droppedByCapture = 0
  private let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "recorder.camera", qos: .userInteractive)
  private let clockLog: ClockLog

  init(config: CameraConfig, url: URL, clockLog: ClockLog) throws {
    let discovery = AVCaptureDevice.DiscoverySession(
      deviceTypes: [.external, .builtInWideAngleCamera, .continuityCamera], mediaType: .video, position: .unspecified)
    guard let device = discovery.devices.first(where: { $0.localizedName.localizedCaseInsensitiveContains(config.device) }) else {
      throw RecorderError("no camera named like \"\(config.device)\"; there are: \(discovery.devices.map(\.localizedName).joined(separator: ", "))")
    }
    deviceName = device.localizedName
    self.clockLog = clockLog

    // The device sends what its HDMI source sends (the Cam Link offers only 4K at 29.97 from a 4K camera): take
    // the smallest format at least the target size, at the rate nearest the target.
    let candidates = device.formats.filter {
      let size = CMVideoFormatDescriptionGetDimensions($0.formatDescription)
      return Int(size.width) >= config.width && Int(size.height) >= config.height
    }
    guard let format = candidates.min(by: { area($0) < area($1) }) ?? device.formats.max(by: { area($0) < area($1) }) else {
      throw RecorderError("\(device.localizedName) offers no formats")
    }
    let range = format.videoSupportedFrameRateRanges.min { abs($0.maxFrameRate - Double(config.fps)) < abs($1.maxFrameRate - Double(config.fps)) }!
    let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
    sourceFormat = "\(size.width)x\(size.height)@\(String(format: "%.3f", range.maxFrameRate))"

    writer = try TrackWriter(
      name: "camera", url: url, fileType: .mp4, mediaType: .video,
      settings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: config.width,
        AVVideoHeightKey: config.height,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: config.bitrateMbps * 1_000_000,
          AVVideoExpectedSourceFrameRateKey: config.fps,
          AVVideoMaxKeyFrameIntervalDurationKey: fragmentSeconds,
          AVVideoAllowFrameReorderingKey: false,
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        ],
      ])
    super.init()

    session.beginConfiguration()
    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else { throw RecorderError("can't add \(device.localizedName) to a capture session") }
    session.addInput(input)
    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
      kCVPixelBufferWidthKey as String: config.width,
      kCVPixelBufferHeightKey as String: config.height,
    ]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: queue)
    guard session.canAddOutput(output) else { throw RecorderError("can't read frames from \(device.localizedName)") }
    session.addOutput(output)
    try device.lockForConfiguration()
    device.activeFormat = format
    device.activeVideoMinFrameDuration = range.minFrameDuration
    device.activeVideoMaxFrameDuration = range.minFrameDuration
    device.unlockForConfiguration()
    session.commitConfiguration()
  }

  /// Starts on its own queue: startRunning blocks for as long as the device takes to open.
  func start() { DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() } }

  func stop(at end: CMTime) async {
    session.stopRunning()
    queue.sync {}
    await writer.finish(at: end)
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sample: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let sessionClock = session.synchronizationClock else { return }
    let raw = sample.presentationTimeStamp
    let host = CMSyncConvertTime(raw, from: sessionClock, to: HostClock.clock)
    if writer.appended % 30 == 0 { clockLog.write(track: "camera", host: host, media: raw, arrival: HostClock.now()) }
    var timing = CMSampleTimingInfo(duration: sample.duration, presentationTimeStamp: host, decodeTimeStamp: .invalid)
    var restamped: CMSampleBuffer?
    CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: sample, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &restamped)
    if let restamped { writer.append(restamped) }
  }

  func captureOutput(_ output: AVCaptureOutput, didDrop sample: CMSampleBuffer, from connection: AVCaptureConnection) {
    droppedByCapture += 1
  }
}

private func area(_ format: AVCaptureDevice.Format) -> Int {
  let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
  return Int(size.width) * Int(size.height)
}
