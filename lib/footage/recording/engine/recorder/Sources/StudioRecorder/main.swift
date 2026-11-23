// StudioRecorder: a menu-bar app with no window. One global key starts a recording of screen, camera, mic and
// input log, and stops it; the menu-bar dot is red while it records.
//
//   StudioRecorder                         the menu-bar app (run as StudioRecorder.app, so permissions stick)
//   StudioRecorder --record-seconds 60     record once for 60 s and exit; SIGINT/SIGTERM stop it early
//   --config <path>                        another config file than ~/Library/Application Support/StudioRecorder/config.json
import AppKit
import AVFoundation

let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/StudioRecorder.log")

func log(_ message: String) {
  let line = "\(ISO8601DateFormatter().string(from: Date())) \(message)\n"
  FileHandle.standardError.write(line.data(using: .utf8)!)
  if let handle = try? FileHandle(forWritingTo: logURL) {
    handle.seekToEndOfFile()
    handle.write(line.data(using: .utf8)!)
    try? handle.close()
  } else {
    try? line.write(to: logURL, atomically: false, encoding: .utf8)
  }
}

/// Asks for every permission at launch, so the first recording doesn't stall on a dialog. Screen Recording and
/// Input Monitoring take effect only after a relaunch.
func requestPermissions() async {
  if !CGPreflightScreenCaptureAccess() { log("asking for Screen Recording"); CGRequestScreenCaptureAccess() }
  if !CGPreflightListenEventAccess() { log("asking for Input Monitoring"); CGRequestListenEventAccess() }
  for media in [AVMediaType.video, .audio] where AVCaptureDevice.authorizationStatus(for: media) != .authorized {
    let granted = await AVCaptureDevice.requestAccess(for: media)
    log("\(media == .video ? "Camera" : "Microphone") access \(granted ? "granted" : "refused")")
  }
}

@MainActor
final class Recorder {
  enum State { case idle, starting, recording(Recording), stopping }
  private(set) var state = State.idle { didSet { onChange?() } }
  var onChange: (() -> Void)?
  let config: RecorderConfig

  init(config: RecorderConfig) { self.config = config }

  var isRecording: Bool { if case .recording = state { true } else { false } }

  /// Presses while a recording starts or stops are ignored, so a double press can't start a second one.
  func toggle() {
    switch state {
    case .idle:
      state = .starting
      Task {
        do {
          let recording = try await Recording.begin(config: config)
          log("recording to \(recording.folder.path)")
          state = .recording(recording)
        } catch {
          log("couldn't start: \(error)")
          state = .idle
        }
      }
    case .recording(let recording):
      state = .stopping
      Task {
        await recording.end()
        log("recorded \(recording.folder.path)")
        state = .idle
      }
    case .starting, .stopping:
      return
    }
  }
}

@MainActor
final class MenuBarDot: NSObject {
  private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  private let recorder: Recorder
  private let toggleItem = NSMenuItem(title: "", action: #selector(toggle), keyEquivalent: "")

  init(recorder: Recorder) {
    self.recorder = recorder
    super.init()
    let menu = NSMenu()
    toggleItem.target = self
    menu.addItem(toggleItem)
    let open = NSMenuItem(title: "Open Recordings Folder", action: #selector(openFolder), keyEquivalent: "")
    open.target = self
    menu.addItem(open)
    menu.addItem(.separator())
    menu.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    item.menu = menu
    recorder.onChange = { [weak self] in self?.refresh() }
    refresh()
  }

  private func refresh() {
    let color: NSColor
    switch recorder.state {
    case .idle: color = .tertiaryLabelColor
    case .starting, .stopping: color = .systemOrange
    case .recording: color = .systemRed
    }
    item.button?.image = NSImage(size: NSSize(width: 14, height: 14), flipped: false) { rect in
      color.setFill()
      NSBezierPath(ovalIn: rect.insetBy(dx: 2, dy: 2)).fill()
      return true
    }
    item.button?.toolTip = "Studio Recorder (\(recorder.config.hotkey))"
    toggleItem.title = recorder.isRecording ? "Stop Recording (\(recorder.config.hotkey))" : "Start Recording (\(recorder.config.hotkey))"
  }

  @objc private func toggle() { recorder.toggle() }
  @objc private func openFolder() {
    try? FileManager.default.createDirectory(at: recorder.config.recordingsURL, withIntermediateDirectories: true)
    NSWorkspace.shared.open(recorder.config.recordingsURL)
  }
}

let arguments = CommandLine.arguments
func argument(_ name: String) -> String? {
  arguments.firstIndex(of: name).flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }
}

let config: RecorderConfig
do {
  config = try RecorderConfig.load(from: argument("--config").map { URL(fileURLWithPath: $0) } ?? RecorderConfig.defaultURL)
} catch {
  log("config: \(error)")
  exit(1)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let recorder = MainActor.assumeIsolated { Recorder(config: config) }
var keepAlive: [AnyObject] = []

if let seconds = argument("--record-seconds").flatMap(Double.init) {
  // One recording, then exit: how the sync and crash tests run without the menu bar.
  MainActor.assumeIsolated {
    var stopScheduled = false
    recorder.onChange = {
      switch recorder.state {
      case .idle: exit(0)
      case .recording where !stopScheduled:
        stopScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { recorder.toggle() }
      default: break
      }
    }
    recorder.toggle()
    for signal in [SIGINT, SIGTERM] {
      Foundation.signal(signal, SIG_IGN)
      let source = DispatchSource.makeSignalSource(signal: signal, queue: .main)
      source.setEventHandler { recorder.toggle() }
      source.resume()
      keepAlive.append(source)
    }
  }
} else {
  MainActor.assumeIsolated {
    keepAlive.append(MenuBarDot(recorder: recorder))
    do {
      keepAlive.append(try HotKey(config.hotkey) { MainActor.assumeIsolated { recorder.toggle() } })
    } catch {
      log("\(error)")
    }
    Task { await requestPermissions() }
  }
}
app.run()
