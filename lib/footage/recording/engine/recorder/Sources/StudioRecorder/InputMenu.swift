// The menu's inputs section: a picker each for mic, camera and screen, the mic's live level under its picker and
// the camera's picture under its. The check runs only while the menu is open and nothing records.
import AppKit
import AVFoundation

enum RecorderInputKind: String { case mic, camera, screen }

@MainActor
final class InputMenu: NSObject, NSMenuDelegate, NSMenuItemValidation {
  /// In menu order, for the menu bar dot to insert.
  let items: [NSMenuItem]
  private let recorder: Recorder
  private let check = InputCheck()
  private let micPicker = NSMenuItem(title: "", action: nil, keyEquivalent: "")
  private let cameraPicker = NSMenuItem(title: "", action: nil, keyEquivalent: "")
  private let screenPicker = NSMenuItem(title: "", action: nil, keyEquivalent: "")
  private let meterItem = NSMenuItem()
  private let previewItem = NSMenuItem()
  private let meter = LevelMeterView()
  private let preview = CameraPreviewView()
  private var tick: Timer?
  private var menuIsOpen = false

  init(recorder: Recorder) {
    self.recorder = recorder
    meterItem.view = meter
    previewItem.view = preview
    items = [micPicker, meterItem, cameraPicker, previewItem, screenPicker]
    super.init()
    for picker in [micPicker, cameraPicker, screenPicker] {
      picker.submenu = NSMenu()
      picker.submenu?.delegate = self
    }
  }

  private var idle: Bool { if case .idle = recorder.state { true } else { false } }

  /// Called as the menu opens: names the picked inputs and starts the live check.
  func menuOpened() {
    menuIsOpen = true
    updatePickerTitles()
    startCheck()
  }

  func menuClosed() {
    menuIsOpen = false
    stopCheck(waiting: false)
  }

  /// Called on every recorder state change. A recording is about to open the same devices: the check lets go of
  /// them before `Recording.begin` runs, which is why this waits. Back to idle with the menu open, it checks again.
  func recorderChanged() {
    guard menuIsOpen else { return }
    updatePickerTitles()
    if idle && tick == nil { startCheck() }
    if !idle { stopCheck(waiting: true) }
  }

  private func startCheck() {
    guard idle else { return }
    showCheckItems(true)
    check.start(config: recorder.config)
    preview.show(session: check.previewSession)
    showCheck()
    // Common modes: a menu tracks in its own run loop mode, where a default-mode timer never fires.
    let timer = Timer(timeInterval: 1.0 / 20, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.showCheck() } }
    RunLoop.main.add(timer, forMode: .common)
    tick = timer
  }

  private func showCheckItems(_ showing: Bool) {
    meterItem.isHidden = !showing || recorder.config.mic == nil
    previewItem.isHidden = !showing || recorder.config.camera == nil
  }

  private func stopCheck(waiting: Bool) {
    showCheckItems(false)
    tick?.invalidate()
    tick = nil
    preview.show(session: nil)
    if waiting { check.stopAndWait() } else { check.stop() }
  }

  private func showCheck() {
    meter.signal = check.micSignal
    preview.picture = check.picture
  }

  private func updatePickerTitles() {
    let config = recorder.config
    micPicker.title = "Mic: " + pickedName(config.mic.map { RecorderInputs.device(named: $0.device, in: RecorderInputs.mics())?.localizedName ?? "\($0.device) (not connected)" })
    cameraPicker.title = "Camera: " + pickedName(config.camera.map { RecorderInputs.device(named: $0.device, in: RecorderInputs.cameras())?.localizedName ?? "\($0.device) (not connected)" })
    screenPicker.title = "Screen: " + (RecorderInputs.screen(named: config.screen.display)?.localizedName ?? "\(config.screen.display) (not connected)")
  }

  /// A track left out of config.json has no picker: turning it back on means its settings, which live there.
  private func pickedName(_ name: String?) -> String { name ?? "off (config.json)" }

  // The submenus list what's connected when each opens, so a camera plugged in since shows up.
  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    let config = recorder.config
    let (kind, names, picked): (RecorderInputKind, [String], String?) = switch menu {
    case micPicker.submenu:
      (.mic, RecorderInputs.mics().map(\.localizedName), config.mic.flatMap { RecorderInputs.device(named: $0.device, in: RecorderInputs.mics())?.localizedName })
    case cameraPicker.submenu:
      (.camera, RecorderInputs.cameras().map(\.localizedName), config.camera.flatMap { RecorderInputs.device(named: $0.device, in: RecorderInputs.cameras())?.localizedName })
    default:
      (.screen, RecorderInputs.screens().map(\.localizedName), RecorderInputs.screen(named: config.screen.display)?.localizedName)
    }
    for name in names {
      let item = NSMenuItem(title: name, action: #selector(pick(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = [kind.rawValue, name]
      item.state = name == picked ? .on : .off
      menu.addItem(item)
    }
    if names.isEmpty { menu.addItem(NSMenuItem(title: "None connected", action: nil, keyEquivalent: "")) }
  }

  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    guard item.action == #selector(pick(_:)) else { return true }
    let kind = (item.representedObject as? [String]).flatMap { RecorderInputKind(rawValue: $0[0]) }
    return idle && (kind == .screen || (kind == .mic ? recorder.config.mic != nil : recorder.config.camera != nil))
  }

  @objc private func pick(_ sender: NSMenuItem) {
    // A take the hotkey started while this submenu was open leaves its items enabled until AppKit revalidates.
    guard idle, let pair = sender.representedObject as? [String], let kind = RecorderInputKind(rawValue: pair[0]) else { return }
    recorder.pickInput(kind, named: pair[1])
  }
}

/// The mic's level as a bar, -60 dBFS to 0, green into amber above -12 and red above -3.
final class LevelMeterView: NSView {
  var signal = MicSignal.level(-120) { didSet { if signal != oldValue { needsDisplay = true } } }

  init() { super.init(frame: NSRect(x: 0, y: 0, width: 280, height: 22)) }
  required init?(coder: NSCoder) { fatalError("not from a nib") }

  override func draw(_ dirtyRect: NSRect) {
    let inset: CGFloat = 20
    let bar = NSRect(x: inset, y: 7, width: bounds.width - inset * 2, height: 8)
    let note: String? = switch signal {
    case .notConnected: "not connected"
    case .notAllowed: "Microphone not allowed"
    case .noSuchInput(let channel): "has no input \(channel)"
    case .level: nil
    }
    if let note {
      (note as NSString).draw(at: NSPoint(x: inset, y: 3), withAttributes: [.font: NSFont.menuFont(ofSize: 12), .foregroundColor: NSColor.secondaryLabelColor])
      return
    }
    guard case .level(let db) = signal else { return }
    NSColor.quaternaryLabelColor.setFill()
    NSBezierPath(roundedRect: bar, xRadius: 3, yRadius: 3).fill()
    let fraction = CGFloat(min(max((db + 60) / 60, 0), 1))
    guard fraction > 0 else { return }
    let color: NSColor = db > -3 ? .systemRed : db > -12 ? .systemYellow : .systemGreen
    color.setFill()
    NSBezierPath(roundedRect: NSRect(x: bar.minX, y: bar.minY, width: bar.width * fraction, height: bar.height), xRadius: 3, yRadius: 3).fill()
  }
}

/// The camera's picture, 16:9, with what's wrong written over it when there's no picture.
final class CameraPreviewView: NSView {
  var picture = CameraPicture.opening { didSet { if picture != oldValue { showPicture() } } }
  private let previewLayer = AVCaptureVideoPreviewLayer()
  private let label = NSTextField(labelWithString: "")

  init() {
    super.init(frame: NSRect(x: 0, y: 0, width: 280, height: 142))
    wantsLayer = true
    let frame = NSRect(x: 20, y: 6, width: 240, height: 135)
    let backdrop = CALayer()
    backdrop.frame = frame
    backdrop.backgroundColor = NSColor.black.cgColor
    backdrop.cornerRadius = 4
    backdrop.masksToBounds = true
    previewLayer.frame = backdrop.bounds
    previewLayer.videoGravity = .resizeAspect
    backdrop.addSublayer(previewLayer)
    layer?.addSublayer(backdrop)
    label.frame = NSRect(x: frame.minX, y: frame.midY - 9, width: frame.width, height: 18)
    label.alignment = .center
    label.textColor = .white
    label.font = .menuFont(ofSize: 12)
    addSubview(label)
    showPicture()
  }

  required init?(coder: NSCoder) { fatalError("not from a nib") }

  func show(session: AVCaptureSession?) { previewLayer.session = session }

  private func showPicture() {
    label.stringValue = switch picture {
    case .live: ""
    case .opening: "Opening…"
    case .notConnected: "Not connected"
    case .notAllowed: "Camera not allowed"
    case .noPicture(let why): "⚠︎ " + why.prefix(1).uppercased() + why.dropFirst()
    }
  }
}
