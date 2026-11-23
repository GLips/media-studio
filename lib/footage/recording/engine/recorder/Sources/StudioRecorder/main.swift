// Studio Recorder: a menu-bar app with no window. One global key starts a recording of screen, camera, mic and
// input log, and stops it; the menu-bar dot is red while it records.
//
//   StudioRecorder                         the menu-bar app (run as its app bundle, so permissions stick)
//   StudioRecorder --record-seconds 60     record once for 60 s and exit; SIGINT/SIGTERM stop it early
//   StudioRecorder --granted               print the permissions a fresh process holds, as JSON (see Permissions.swift)
//   StudioRecorder --check-inputs 5        log what the menu's live check sees of the picked inputs for 5 s, and exit;
//                                          run it through the bundle (`open -a … --args`) so it holds the app's grants
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
  private(set) var state = State.idle {
    didSet {
      onChange?()
      if quitting { finishForQuit() }
    }
  }
  /// The current or latest take's track problems, kept after it stops so the menu still shows them.
  private(set) var problems: [String: String] = [:]
  private var trackCheck: Timer?
  /// Set by Quit (or SIGTERM) during a take: the take is stopped and finished, then the app quits.
  private var quitting = false
  var onChange: (() -> Void)?
  /// Read as each recording begins, so an input picked in the menu takes effect at the next one.
  private(set) var config: RecorderConfig
  private let configURL: URL
  /// Absent in the command-line test mode, which runs under the terminal's permissions.
  let permissions: Permissions?

  init(config: RecorderConfig, configURL: URL, permissions: Permissions?) {
    self.config = config
    self.configURL = configURL
    self.permissions = permissions
  }

  /// Makes `name` the input of its kind for the next recording and writes it to config.json. The menu offers this
  /// only while idle, and only for a camera or mic the config already records.
  func pickInput(_ kind: RecorderInputKind, named name: String) {
    switch kind {
    case .mic: config.mic?.device = name
    case .camera: config.camera?.device = name
    case .screen: config.screen.display = name
    }
    do {
      try config.save(to: configURL)
      log("picked \(kind.rawValue) \(name)")
    } catch {
      log("couldn't save the \(kind.rawValue) picked: \(error)")
    }
    onChange?()
  }

  /// A track failing mid-take sounds an alert (there's no window to show one) and lists itself in the menu.
  private func watch(_ recording: Recording) {
    trackCheck = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self, recording.checkTracks() else { return }
        self.problems = recording.problems
        NSSound(named: "Basso")?.play()
        self.onChange?()
      }
    }
  }

  var isRecording: Bool { if case .recording = state { true } else { false } }

  /// Whether the app may quit now; if not, it stops the take and replies to the pending terminate once finished.
  func mayQuitNow() -> Bool {
    if case .idle = state { return true }
    quitting = true
    finishForQuit()
    return false
  }

  private func finishForQuit() {
    switch state {
    case .recording: toggle()
    case .idle: NSApp.reply(toApplicationShouldTerminate: true)
    case .starting, .stopping: break
    }
  }

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
          problems = [:]
          state = .recording(recording)
          watch(recording)
        } catch {
          log("couldn't start: \(error)")
          state = .idle
        }
      }
    case .recording(let recording):
      state = .stopping
      trackCheck?.invalidate()
      trackCheck = nil
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
final class MenuBarDot: NSObject, NSMenuDelegate {
  private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  private let recorder: Recorder
  private let toggleItem = NSMenuItem(title: "", action: #selector(toggle), keyEquivalent: "")
  private let menu = NSMenu()
  private var permissionItems: [NSMenuItem] = []
  private let inputMenu: InputMenu

  init(recorder: Recorder) {
    self.recorder = recorder
    inputMenu = InputMenu(recorder: recorder)
    super.init()
    toggleItem.target = self
    menu.addItem(toggleItem)
    let open = NSMenuItem(title: "Open Recordings Folder", action: #selector(openFolder), keyEquivalent: "")
    open.target = self
    menu.addItem(open)
    menu.addItem(.separator())
    for inputItem in inputMenu.items { menu.addItem(inputItem) }
    menu.addItem(.separator())
    let about = NSMenuItem(title: "About \(recorderDisplayName)", action: #selector(showAbout), keyEquivalent: "")
    about.target = self
    menu.addItem(about)
    menu.addItem(NSMenuItem(title: "Quit \(recorderDisplayName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    item.menu = menu
    menu.delegate = self
    recorder.onChange = { [weak self] in
      self?.inputMenu.recorderChanged()
      self?.refresh()
    }
    recorder.permissions?.onChange = { [weak self] in self?.refresh() }
    refresh()
  }

  private func refresh() {
    let missing = recorder.permissions?.missing ?? []
    let glyph = switch recorder.state {
    // The amber mark means "look at the menu": a missing permission, or a track that failed in the last take.
    case .idle where !missing.isEmpty || !recorder.problems.isEmpty: "MenuBarNeedsPermission"
    case .idle: "MenuBarIdleTemplate"
    case .starting, .stopping: "MenuBarBusyTemplate"
    case .recording: "MenuBarRecording"
    }
    item.button?.image = menuBarGlyph(glyph)
    let problems = recorder.problems.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }
    item.button?.toolTip = !missing.isEmpty
      ? "\(recorderDisplayName) needs \(missing.map(\.title).joined(separator: ", "))"
      : problems.isEmpty ? "\(recorderDisplayName) (\(recorder.config.hotkey))" : "\(recorderDisplayName): \(problems.joined(separator: "; "))"
    // Each missing permission is a menu item at the top that asks for it again; each track problem a line above it.
    for old in permissionItems { menu.removeItem(old) }
    let problemItems = recorder.problems.sorted { $0.key < $1.key }.map { track, problem in
      NSMenuItem(title: "⚠︎ \(track.capitalized) \(problem)", action: nil, keyEquivalent: "")
    }
    permissionItems = problemItems + missing.map { permission in
      let item = NSMenuItem(title: "Allow \(permission.title)…", action: #selector(allow(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = permission.rawValue
      return item
    }
    for (index, permissionItem) in permissionItems.enumerated() { menu.insertItem(permissionItem, at: index) }
    if !permissionItems.isEmpty {
      let separator = NSMenuItem.separator()
      menu.insertItem(separator, at: permissionItems.count)
      permissionItems.append(separator)
    }
    toggleItem.title = recorder.isRecording ? "Stop Recording (\(recorder.config.hotkey))" : "Start Recording (\(recorder.config.hotkey))"
  }

  func menuWillOpen(_ menu: NSMenu) { inputMenu.menuOpened() }
  func menuDidClose(_ menu: NSMenu) { inputMenu.menuClosed() }

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

/// A menu-bar glyph from the bundle's Resources/menu-bar/ (Resources/ in the package). A `…Template` glyph takes
/// the menu bar's own colour; the recording and permission glyphs keep theirs.
@MainActor
func menuBarGlyph(_ name: String) -> NSImage? {
  guard let url = Bundle.main.resourceURL?.appendingPathComponent("menu-bar/\(name).pdf"), let image = NSImage(contentsOf: url) else { return nil }
  image.size = NSSize(width: 18, height: 18)
  image.isTemplate = name.hasSuffix("Template")
  return image
}

final class RecorderAppDelegate: NSObject, NSApplicationDelegate {
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    MainActor.assumeIsolated { recorder.mayQuitNow() ? .terminateNow : .terminateLater }
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

let configURL = argument("--config").map { URL(fileURLWithPath: $0) } ?? RecorderConfig.defaultURL
let config: RecorderConfig
do {
  config = try RecorderConfig.load(from: configURL)
} catch {
  log("config: \(error)")
  exit(1)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let testSeconds = argument("--record-seconds").flatMap(Double.init)
let recorder = MainActor.assumeIsolated { Recorder(config: config, configURL: configURL, permissions: testSeconds == nil ? Permissions(config: config) : nil) }
var keepAlive: [AnyObject] = []

if let seconds = argument("--check-inputs").flatMap(Double.init) {
  MainActor.assumeIsolated {
    let check = InputCheck()
    log("inputs: mics \(RecorderInputs.mics().map(\.localizedName)), cameras \(RecorderInputs.cameras().map(\.localizedName)), screens \(RecorderInputs.screens().map(\.localizedName))")
    log("inputs: picked mic \(config.mic?.device ?? "off"), camera \(config.camera?.device ?? "off"), screen \(RecorderInputs.screen(named: config.screen.display)?.localizedName ?? "none")")
    check.start(config: config)
    let ticks = Timer(timeInterval: 0.5, repeats: true) { _ in
      MainActor.assumeIsolated { log("inputs: mic \(check.micSignal), camera \(check.picture)") }
    }
    RunLoop.main.add(ticks, forMode: .common)
    keepAlive.append(ticks)
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
      check.stopAndWait()
      exit(0)
    }
  }
} else if let seconds = testSeconds {
  // One recording, then exit: how the sync and crash tests run without the menu bar.
  MainActor.assumeIsolated {
    var stopScheduled = false
    recorder.onChange = {
      switch recorder.state {
      // A run that never reached recording failed to start: the tests must see that.
      case .idle: exit(stopScheduled ? 0 : 1)
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
    let delegate = RecorderAppDelegate()
    app.delegate = delegate
    keepAlive.append(delegate)
    // pkill (a reinstall) quits the way the menu does, finishing a take first.
    Foundation.signal(SIGTERM, SIG_IGN)
    let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    terminate.setEventHandler { NSApp.terminate(nil) }
    terminate.resume()
    keepAlive.append(terminate)
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
