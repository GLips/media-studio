// The menu's live check of the picked mic and camera, before a take: the mic's level on its configured input,
// and the camera's picture, which it also reads for whether one arrives. The machine runs it only while the menu is
// open and no take holds the devices, and it never locks a device's configuration: its session may pick the
// camera's format, which a recording then sets its own.
import AVFoundation
import Synchronization

/// What the menu shows for the camera.
enum CameraPicture: Equatable {
  case notConnected
  case notAllowed
  case opening
  case live
  /// Connected but sending nothing (an A6400 asleep behind the Cam Link sends no frames), or only black.
  case noPicture(String)
}

/// What the menu shows for the mic.
enum MicSignal: Equatable {
  case notConnected
  case notAllowed
  case noSuchInput(Int)
  /// The input's level in dBFS, as the capture connection measures it: about -120 silent, 0 full scale.
  case level(Float)
}

final class InputCheck: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
  /// The camera's side of the check: off (none configured, or stopped), failed before a session could open, or
  /// watching one.
  private enum CameraProbe {
    case off
    case failed(CameraPicture)
    case watching(AVCaptureSession, AVCaptureVideoDataOutput, since: Date)
  }

  private enum MicProbe {
    case off
    case failed(MicSignal)
    case metering(AVCaptureSession, AVCaptureConnection?, channel: Int)
  }

  /// Starting and stopping sessions block for as long as a device takes to open; they run here, in order.
  private let sessionQueue = DispatchQueue(label: "recorder.input-check")
  private let frameQueue = DispatchQueue(label: "recorder.input-check.frames")
  private var camera = CameraProbe.off
  private var mic = MicProbe.off
  /// Written on the frame queue, read on the main thread.
  private let lastFrame = Mutex<(at: Date, black: Bool)?>(nil)
  /// Shows each camera frame as it arrives; used on the frame queue only.
  private let pictureRenderer: AVSampleBufferVideoRenderer

  init(pictureRenderer: AVSampleBufferVideoRenderer) {
    self.pictureRenderer = pictureRenderer
  }

  @MainActor
  func start(config: RecorderConfig) {
    stop()
    lastFrame.withLock { $0 = nil }
    clearPicture()
    if let cameraConfig = config.camera { camera = openCamera(named: cameraConfig.device) }
    if let micConfig = config.mic { mic = openMic(config: micConfig) }
  }

  /// Stops both sessions in the background, after any start still opening a device.
  @MainActor
  func stop() {
    var sessions: [AVCaptureSession] = []
    if case .watching(let session, let output, _) = camera {
      // A stopping session still sends frames until `stopRunning` returns; cut them off now, so none lands after
      // the next start's `clearPicture` and shows the old camera.
      output.setSampleBufferDelegate(nil, queue: nil)
      sessions.append(session)
    }
    if case .metering(let session, _, _) = mic { sessions.append(session) }
    camera = .off
    mic = .off
    sessionQueue.async { for session in sessions { session.stopRunning() } }
  }

  /// Returns once every session a stop let go of has stopped: a take is about to open the same devices.
  func awaitDevicesReleased() {
    sessionQueue.sync {}
  }

  /// Takes the last image off the menu's picture, so a warning isn't read over a frozen one.
  func clearPicture() {
    frameQueue.async { [pictureRenderer] in pictureRenderer.flush(removingDisplayedImage: true, completionHandler: nil) }
  }

  @MainActor
  private func openCamera(named name: String) -> CameraProbe {
    guard let device = RecorderInputs.device(named: name, in: RecorderInputs.cameras()) else { return .failed(.notConnected) }
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else { return .failed(.notAllowed) }
    let session = AVCaptureSession()
    session.beginConfiguration()
    guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else { return .failed(.noPicture("can't open")) }
    session.addInput(input)
    // Frames at the menu picture's Retina pixel width, drawn 1:1. The output's scaler shrinks the camera's 4K
    // cleanly; an AVCaptureVideoPreviewLayer shrinks it on the GPU at draw time, which blurs and aliases. The
    // height keeps the camera's aspect, as the output requires: a 4:3 camera letterboxes in the 16:9 picture.
    let source = device.activeFormat.formatDescription.dimensions
    let width = Int(CameraPreviewView.pictureSize.width * 2)
    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
      kCVPixelBufferWidthKey as String: width,
      kCVPixelBufferHeightKey as String: width * Int(source.height) / Int(source.width) / 2 * 2,
    ]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: frameQueue)
    if session.canAddOutput(output) { session.addOutput(output) }
    session.commitConfiguration()
    sessionQueue.async { session.startRunning() }
    return .watching(session, output, since: Date())
  }

  @MainActor
  private func openMic(config: MicConfig) -> MicProbe {
    guard let device = RecorderInputs.device(named: config.device, in: RecorderInputs.mics()) else { return .failed(.notConnected) }
    guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else { return .failed(.notAllowed) }
    let session = AVCaptureSession()
    session.beginConfiguration()
    guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else { return .failed(.notConnected) }
    session.addInput(input)
    // The connection meters each of the device's inputs; the output only has to be there for audio to flow.
    let output = AVCaptureAudioDataOutput()
    output.setSampleBufferDelegate(self, queue: frameQueue)
    if session.canAddOutput(output) { session.addOutput(output) }
    session.commitConfiguration()
    sessionQueue.async { session.startRunning() }
    return .metering(session, output.connection(with: .audio), channel: config.channel(forDevice: device.localizedName))
  }

  /// Read each tick while the menu is open.
  @MainActor
  var picture: CameraPicture {
    switch camera {
    case .off: return .opening
    case .failed(let picture): return picture
    case .watching(_, _, let since):
      let frame = lastFrame.withLock { $0 }
      let now = Date()
      // A camera takes a moment to open: until then, no frame isn't yet "no picture".
      guard let frame, now.timeIntervalSince(frame.at) < 1 else {
        return now.timeIntervalSince(since) < 3 ? .opening : .noPicture("no picture")
      }
      return frame.black ? .noPicture("black picture") : .live
    }
  }

  @MainActor
  var micSignal: MicSignal {
    switch mic {
    case .off: return .level(-120)
    case .failed(let signal): return signal
    case .metering(_, let connection, let channel):
      guard let channels = connection?.audioChannels, !channels.isEmpty else { return .level(-120) }
      guard channels.indices.contains(channel - 1) else { return .noSuchInput(channel) }
      return .level(channels[channel - 1].averagePowerLevel)
    }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sample: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard output is AVCaptureVideoDataOutput, let image = sample.imageBuffer else { return }
    let black = isBlack(image)
    lastFrame.withLock { $0 = (Date(), black) }
    if pictureRenderer.status == .failed || pictureRenderer.requiresFlushToResumeDecoding { pictureRenderer.flush() }
    // A late frame is dropped rather than queued: the picture should be now, not a backlog.
    guard pictureRenderer.isReadyForMoreMediaData else { return }
    if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true) as? [NSMutableDictionary] {
      attachments.first?[kCMSampleAttachmentKey_DisplayImmediately] = true
    }
    pictureRenderer.enqueue(sample)
  }
}

/// Whether a 420v frame is black throughout: no luma sample above the video-range black level (16) plus a margin.
/// A real room, however dim, has something brighter. It reads a grid about 160 samples wide, whatever the
/// frame's size.
private func isBlack(_ image: CVPixelBuffer) -> Bool {
  CVPixelBufferLockBaseAddress(image, .readOnly)
  defer { CVPixelBufferUnlockBaseAddress(image, .readOnly) }
  guard let base = CVPixelBufferGetBaseAddressOfPlane(image, 0) else { return false }
  let width = CVPixelBufferGetWidthOfPlane(image, 0)
  let height = CVPixelBufferGetHeightOfPlane(image, 0)
  let stride = CVPixelBufferGetBytesPerRowOfPlane(image, 0)
  let luma = base.assumingMemoryBound(to: UInt8.self)
  let step = max(1, width / 160)
  for y in Swift.stride(from: 0, to: height, by: step) {
    for x in Swift.stride(from: 0, to: width, by: step) where luma[y * stride + x] > 28 { return false }
  }
  return true
}
