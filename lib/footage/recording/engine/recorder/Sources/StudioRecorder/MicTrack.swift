// The mic: one input of the audio interface, as mono AAC. The file's timeline is its sample count, unbroken from
// its first sample; how that count runs against the host clock goes to the clock log, so drift is measured, and
// corrected as metadata rather than by resampling.
import AVFoundation

final class MicTrack: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
  let writer: TrackWriter
  let deviceName: String
  let channel: Int
  let sampleRate: Double
  private(set) var frames: Int64 = 0
  /// How far the host clock ran ahead of the mic's sample count by the last buffer, in seconds: positive means
  /// the interface's clock is slow, so its audio needs stretching by (elapsed + drift) / elapsed to meet the host.
  private(set) var driftSeconds = 0.0
  private let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "recorder.mic", qos: .userInteractive)
  private let clockLog: ClockLog
  private var firstHost: CMTime?
  private var buffers = 0
  private var monoFormat: CMAudioFormatDescription?

  init(config: MicConfig, url: URL, clockLog: ClockLog) throws {
    let discovery = AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified)
    guard let device = discovery.devices.first(where: { $0.localizedName.localizedCaseInsensitiveContains(config.device) }) else {
      throw RecorderError("no mic named like \"\(config.device)\"; there are: \(discovery.devices.map(\.localizedName).joined(separator: ", "))")
    }
    guard let source = CMAudioFormatDescriptionGetStreamBasicDescription(device.activeFormat.formatDescription)?.pointee else {
      throw RecorderError("\(device.localizedName) has no audio format")
    }
    let channels = Int(source.mChannelsPerFrame)
    guard (1...channels).contains(config.channel) else { throw RecorderError("\(device.localizedName) has \(channels) inputs, not \(config.channel)") }
    deviceName = device.localizedName
    channel = config.channel
    sampleRate = source.mSampleRate
    self.clockLog = clockLog

    writer = try TrackWriter(
      name: "mic", url: url, fileType: .m4a, mediaType: .audio,
      settings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: sampleRate,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: config.bitrateKbps * 1000,
      ])
    super.init()

    // The writer has made its file by now: a device that can't be set up takes it away again.
    do {
    session.beginConfiguration()
    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else { throw RecorderError("can't add \(device.localizedName) to a capture session") }
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
    guard session.canAddOutput(output) else { throw RecorderError("can't read audio from \(device.localizedName)") }
    session.addOutput(output)
    session.commitConfiguration()
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
    if firstHost == nil { firstHost = host }
    let pts = firstHost! + CMTime(value: frames, timescale: CMTimeScale(sampleRate))
    driftSeconds = (host - pts).seconds
    if buffers % 50 == 0 { clockLog.write(track: "mic", host: host, media: pts, arrival: HostClock.now()) }
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
