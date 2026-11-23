// Studio Recorder: a menu-bar app with no window. One global key starts a recording of screen, camera, mic and
// input log, and stops it; the menu-bar dot is red while it records.
//
//   StudioRecorder                         the menu-bar app (run as its app bundle, so permissions stick)
//   StudioRecorder --record-seconds 60     record once for 60 s and exit; SIGINT/SIGTERM stop it early
//   StudioRecorder --granted               print the permissions a fresh process holds, as JSON (see Permissions.swift)
//   --config <path>                        another config file than ~/Library/Application Support/StudioRecorder/config.json
import AppKit
import AVFoundation

/// The name a person sees, set once in the bundle by `studio recorder install`.
let recorderDisplayName = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Studio Recorder"

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

@MainActor
final class Recorder {
  enum State { case idle, starting, recording(Recording), stopping }
  private(set) var state = State.idle { didSet { onChange?() } }
  var onChange: (() -> Void)?
  let config: RecorderConfig
  /// Absent in the command-line test mode, which runs under the terminal's permissions.
  let permissions: Permissions?

  init(config: RecorderConfig, permissions: Permissions?) {
    self.config = config
    self.permissions = permissions
  }

  var isRecording: Bool { if case .recording = state { true } else { false } }

  /// Presses while a recording starts or stops are ignored, so a double press can't start a second one.
  func toggle() {
    switch state {
    case .idle:
      // A recording missing a track would be found out only afterwards: ask again instead of recording.
      if let missing = permissions?.missing.first {
        log("not recording: \(missing.title) isn't allowed")
        Task { await permissions?.request(missing) }
        return
      }
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
  private let menu = NSMenu()
  private var permissionItems: [NSMenuItem] = []

  init(recorder: Recorder) {
    self.recorder = recorder
    super.init()
    toggleItem.target = self
    menu.addItem(toggleItem)
    let open = NSMenuItem(title: "Open Recordings Folder", action: #selector(openFolder), keyEquivalent: "")
    open.target = self
    menu.addItem(open)
    menu.addItem(.separator())
    let about = NSMenuItem(title: "About \(recorderDisplayName)", action: #selector(showAbout), keyEquivalent: "")
    about.target = self
    menu.addItem(about)
    menu.addItem(NSMenuItem(title: "Quit \(recorderDisplayName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    item.menu = menu
    recorder.onChange = { [weak self] in self?.refresh() }
    recorder.permissions?.onChange = { [weak self] in self?.refresh() }
    refresh()
  }

  private func refresh() {
    let missing = recorder.permissions?.missing ?? []
    let color: NSColor
    switch recorder.state {
    case .idle where !missing.isEmpty: color = .systemYellow
    case .idle: color = .tertiaryLabelColor
    case .starting, .stopping: color = .systemOrange
    case .recording: color = .systemRed
    }
    item.button?.image = NSImage(size: NSSize(width: 14, height: 14), flipped: false) { rect in
      color.setFill()
      NSBezierPath(ovalIn: rect.insetBy(dx: 2, dy: 2)).fill()
      return true
    }
    item.button?.toolTip = missing.isEmpty
      ? "\(recorderDisplayName) (\(recorder.config.hotkey))"
      : "\(recorderDisplayName) needs \(missing.map(\.title).joined(separator: ", "))"
    // Each missing permission is a menu item at the top that asks for it again.
    for old in permissionItems { menu.removeItem(old) }
    permissionItems = missing.map { permission in
      let item = NSMenuItem(title: "Allow \(permission.title)…", action: #selector(allow(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = permission.rawValue
      return item
    }
    for (index, permissionItem) in permissionItems.enumerated() { menu.insertItem(permissionItem, at: index) }
    if !permissionItems.isEmpty { permissionItems.append(.separator()); menu.insertItem(permissionItems.last!, at: missing.count) }
    toggleItem.title = recorder.isRecording ? "Stop Recording (\(recorder.config.hotkey))" : "Start Recording (\(recorder.config.hotkey))"
  }

  @objc private func toggle() { recorder.toggle() }
  @objc private func showAbout() {
    NSApp.activate()
    NSApp.orderFrontStandardAboutPanel(nil)
  }
  @objc private func allow(_ sender: NSMenuItem) {
    guard let permission = (sender.representedObject as? String).flatMap(Permission.init(rawValue:)) else { return }
    Task { await recorder.permissions?.request(permission) }
  }
  @objc private func openFolder() {
    try? FileManager.default.createDirectory(at: recorder.config.recordingsURL, withIntermediateDirectories: true)
    NSWorkspace.shared.open(recorder.config.recordingsURL)
  }
}

let arguments = CommandLine.arguments
func argument(_ name: String) -> String? {
  arguments.firstIndex(of: name).flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }
}

if arguments.contains("--granted") {
  printGrantedPermissions()
  exit(0)
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
let testSeconds = argument("--record-seconds").flatMap(Double.init)
let recorder = MainActor.assumeIsolated { Recorder(config: config, permissions: testSeconds == nil ? Permissions() : nil) }
var keepAlive: [AnyObject] = []

if let seconds = testSeconds {
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
    Task { await recorder.permissions?.requestMissing() }
  }
}
app.run()
