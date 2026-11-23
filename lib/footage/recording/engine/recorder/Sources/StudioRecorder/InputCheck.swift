// The menu's live check of the picked mic and camera, before a take: the mic's level on its configured input,
// and the camera's picture, which it also reads for whether one arrives. It runs only while the menu is open and
// the recorder idles, and never locks a device's configuration: its session may pick the camera's format, which a
// recording then sets its own.
import AVFoundation

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
  /// Starting and stopping sessions block for as long as a device takes to open; they run here, in order.
  private let sessionQueue = DispatchQueue(label: "recorder.input-check")
  private let frameQueue = DispatchQueue(label: "recorder.input-check.frames")
  private var cameraSession: AVCaptureSession?
  private var cameraOutput: AVCaptureVideoDataOutput?
  private var micSession: AVCaptureSession?
  private var micConnection: AVCaptureConnection?
  private var micChannel = 1
  private var cameraFailure: CameraPicture?
  private var micFailure: MicSignal?
  private var startedAt = Date.distantPast
  /// Written on the frame queue, read on the main thread, under `lock`.
  private var lastFrame: (at: Date, black: Bool)?
  private let lock = NSLock()
  /// Shows each camera frame as it arrives; used on the frame queue only.
  private let pictureRenderer: AVSampleBufferVideoRenderer

  init(pictureRenderer: AVSampleBufferVideoRenderer) {
    self.pictureRenderer = pictureRenderer
  }

  @MainActor
  func start(config: RecorderConfig) {
    stop()
    startedAt = Date()
    lock.withLock { lastFrame = nil }
    clearPicture()
    if let camera = config.camera { startCamera(named: camera.device) }
    if let mic = config.mic { startMic(config: mic) }
  }

  /// Stops both sessions in the background, after any start still opening a device.
  @MainActor
  func stop() {
    let sessions = [cameraSession, micSession].compactMap { $0 }
    // A stopping session still sends frames until `stopRunning` returns; cut them off now, so none lands after
    // the next start's `clearPicture` and shows the old camera.
    cameraOutput?.setSampleBufferDelegate(nil, queue: nil)
    cameraOutput = nil
    cameraSession = nil
    micSession = nil
    micConnection = nil
    cameraFailure = nil
    micFailure = nil
    sessionQueue.async { for session in sessions { session.stopRunning() } }
  }

  /// Takes the last image off the menu's picture, so a warning isn't read over a frozen one.
  func clearPicture() {
    frameQueue.async { [pictureRenderer] in pictureRenderer.flush(removingDisplayedImage: true, completionHandler: nil) }
  }

  /// Stops both sessions and returns once they have: a recording is about to open the same devices.
  @MainActor
  func stopAndWait() {
    stop()
    sessionQueue.sync {}
  }

  @MainActor
  private func startCamera(named name: String) {
    guard let device = RecorderInputs.device(named: name, in: RecorderInputs.cameras()) else { cameraFailure = .notConnected; return }
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else { cameraFailure = .notAllowed; return }
    let session = AVCaptureSession()
    session.beginConfiguration()
    guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
      cameraFailure = .noPicture("can't open")
      return
    }
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
    cameraSession = session
    cameraOutput = output
    sessionQueue.async { session.startRunning() }
  }

  @MainActor
  private func startMic(config: MicConfig) {
    guard let device = RecorderInputs.device(named: config.device, in: RecorderInputs.mics()) else { micFailure = .notConnected; return }
    guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else { micFailure = .notAllowed; return }
    micChannel = config.channel(forDevice: device.localizedName)
    let session = AVCaptureSession()
    session.beginConfiguration()
    guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
      micFailure = .notConnected
      return
    }
    session.addInput(input)
    // The connection meters each of the device's inputs; the output only has to be there for audio to flow.
    let output = AVCaptureAudioDataOutput()
    output.setSampleBufferDelegate(self, queue: frameQueue)
    if session.canAddOutput(output) { session.addOutput(output) }
    session.commitConfiguration()
    micSession = session
    micConnection = output.connection(with: .audio)
    sessionQueue.async { session.startRunning() }
  }

  /// Read each tick while the menu is open.
  @MainActor
  var picture: CameraPicture {
    if let cameraFailure { return cameraFailure }
    let frame = lock.withLock { lastFrame }
    let now = Date()
    // A camera takes a moment to open: until then, no frame isn't yet "no picture".
    guard let frame, now.timeIntervalSince(frame.at) < 1 else {
      return now.timeIntervalSince(startedAt) < 3 ? .opening : .noPicture("no picture")
    }
    return frame.black ? .noPicture("black picture") : .live
  }

  @MainActor
  var micSignal: MicSignal {
    if let micFailure { return micFailure }
    guard let channels = micConnection?.audioChannels, !channels.isEmpty else { return .level(-120) }
    guard channels.indices.contains(micChannel - 1) else { return .noSuchInput(micChannel) }
    return .level(channels[micChannel - 1].averagePowerLevel)
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sample: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard output is AVCaptureVideoDataOutput, let image = sample.imageBuffer else { return }
    let black = isBlack(image)
    lock.withLock { lastFrame = (Date(), black) }
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
