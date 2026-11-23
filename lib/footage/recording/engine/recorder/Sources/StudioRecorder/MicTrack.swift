// The mic: one input of the audio interface, as mono AAC. The file's timeline is its sample count, unbroken from
// its first sample; how that count runs against the host clock goes to the clock log, so drift is measured, and
// corrected as metadata rather than by resampling.
import AVFoundation
import RecorderCore
import Synchronization

final class MicTrack: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
  let writer: TrackWriter
  let deviceName: String
  let channel: Int
  /// This device's latency from the config, for recording.json.
  let latencySeconds: Double
  let sampleRate: Double
  /// How far the host clock ran ahead of the mic's sample count by the last buffer, in seconds: positive means
  /// the interface's clock is slow, so its audio needs stretching by (elapsed + drift) / elapsed to meet the host.
  var driftSeconds: Double { drift.withLock { $0 } }
  /// Written on the capture queue, read on the main thread.
  private let drift = Mutex(0.0)
  private let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "recorder.mic", qos: .userInteractive)
  private let clockLog: ClockLog
  /// The capture queue's own: where the file's timeline starts, and how far it has run.
  private var firstHost: CMTime?
  private var frames: Int64 = 0
  private var buffers = 0
  private var monoFormat: CMAudioFormatDescription?

  init(config: MicConfig, url: URL, clockLog: ClockLog) throws(TrackFailure) {
    let mics = RecorderInputs.mics()
    guard let device = RecorderInputs.device(named: config.device, in: mics) else {
      throw .noDevice(.mic, named: config.device, connected: mics.map(\.localizedName))
    }
    guard let source = CMAudioFormatDescriptionGetStreamBasicDescription(device.activeFormat.formatDescription)?.pointee else {
      throw .noAudioFormat(device: device.localizedName)
    }
    let channels = Int(source.mChannelsPerFrame)
    let channel = config.channel(forDevice: device.localizedName)
    guard (1...channels).contains(channel) else { throw .noSuchInput(device: device.localizedName, inputs: channels, wanted: channel) }
    deviceName = device.localizedName
    self.channel = channel
    latencySeconds = (settingForDevice(config.latencyMsByDevice, named: device.localizedName) ?? 0) / 1000
    sampleRate = source.mSampleRate
    self.clockLog = clockLog

    writer = try TrackWriter(
      track: .mic, url: url, fileType: .m4a, mediaType: .audio,
      settings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: sampleRate,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: config.bitrateKbps * 1000,
      ])
    super.init()

    // The writer has made its file by now: a device that can't be set up takes it away again.
    do {
      try configureSession(device: device, channels: channels)
    } catch {
      writer.discard()
      throw error
    }

    var mono = AudioStreamBasicDescription(
      mSampleRate: sampleRate, mFormatID: kAudioFormatLinearPCM, mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
      mBytesPerPacket: 4, mFramesPerPacket: 1, mBytesPerFrame: 4, mChannelsPerFrame: 1, mBitsPerChannel: 32, mReserved: 0)
    CMAudioFormatDescriptionCreate(
      allocator: nil, asbd: &mono, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil,
      formatDescriptionOut: &monoFormat)
  }

  private func configureSession(device: AVCaptureDevice, channels: Int) throws(TrackFailure) {
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    let input: AVCaptureDeviceInput
    do { input = try AVCaptureDeviceInput(device: device) } catch { throw .system(error) }
    guard session.canAddInput(input) else { throw .cantAddToSession(device: device.localizedName) }
    session.addInput(input)
    let output = AVCaptureAudioDataOutput()
    // Every input, unmixed, as float planes: the configured one is picked out below at full level.
    output.audioSettings = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: channels,
      AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsFloatKey: true,
      AVLinearPCMIsNonInterleaved: true,
      AVLinearPCMIsBigEndianKey: false,
    ]
    output.setSampleBufferDelegate(self, queue: queue)
    guard session.canAddOutput(output) else { throw .cantReadAudio(device: device.localizedName) }
    session.addOutput(output)
  }

  /// Starts on its own queue: startRunning blocks for as long as the device takes to open.
  func start() { DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() } }

  func stop() async {
    session.stopRunning()
    queue.sync {}
    await writer.finish(at: nil)
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sample: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let sessionClock = session.synchronizationClock, let monoFormat else { return }
    let host = CMSyncConvertTime(sample.presentationTimeStamp, from: sessionClock, to: HostClock.clock)
    let count = CMSampleBufferGetNumSamples(sample)
    let firstHost = self.firstHost ?? host
    self.firstHost = firstHost
    let pts = firstHost + CMTime(value: frames, timescale: CMTimeScale(sampleRate))
    drift.withLock { $0 = (host - pts).seconds }
    if buffers % 50 == 0 { clockLog.write(track: .mic, host: host, media: pts, arrival: HostClock.now()) }
    buffers += 1
    frames += Int64(count)

    var blockOut: CMBlockBuffer?
    var listSize = 0
    CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sample, bufferListSizeNeededOut: &listSize, bufferListOut: nil, bufferListSize: 0, blockBufferAllocator: nil,
      blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
    let listMemory = UnsafeMutableRawPointer.allocate(byteCount: listSize, alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { listMemory.deallocate() }
    let list = listMemory.bindMemory(to: AudioBufferList.self, capacity: 1)
    let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sample, bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: listSize, blockBufferAllocator: nil,
      blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &blockOut)
    guard status == noErr else { log("mic: unreadable buffer (\(status))"); return }
    let planes = UnsafeMutableAudioBufferListPointer(list)
    // One plane per input is what audioSettings asked for; anything else would be written as garbled mono.
    guard channel - 1 < planes.count, planes[channel - 1].mNumberChannels == 1, Int(planes[channel - 1].mDataByteSize) >= count * 4,
      let data = planes[channel - 1].mData
    else {
      log("mic: buffer isn't one float plane per input (\(planes.count) planes)")
      return
    }
    let bytes = count * 4

    var block: CMBlockBuffer?
    CMBlockBufferCreateWithMemoryBlock(
      allocator: nil, memoryBlock: nil, blockLength: bytes, blockAllocator: nil, customBlockSource: nil, offsetToData: 0,
      dataLength: bytes, flags: kCMBlockBufferAssureMemoryNowFlag, blockBufferOut: &block)
    guard let block else { return }
    CMBlockBufferReplaceDataBytes(with: data, blockBuffer: block, offsetIntoDestination: 0, dataLength: bytes)
    var monoSample: CMSampleBuffer?
    CMAudioSampleBufferCreateReadyWithPacketDescriptions(
      allocator: nil, dataBuffer: block, formatDescription: monoFormat, sampleCount: count, presentationTimeStamp: pts,
      packetDescriptions: nil, sampleBufferOut: &monoSample)
    guard let monoSample else { return }
    writer.append(monoSample)
  }
}
