// The menu's inputs section: a picker each for mic, camera and screen, the mic's live level under its picker and
// the camera's picture under its. The screen's picker opens the system's window and display picker, or picks a
// display by name. The machine says when the check runs (`RecorderActivity.inputCheck`) and when a
// pick is taken; this draws them.
import AppKit
import AVFoundation
import RecorderCore

/// The width of the check's views, which sets the menu's: the camera's picture fills it less a 20 pt inset a side.
private let inputMenuItemWidth: CGFloat = 440

@MainActor
final class InputMenu: NSObject, NSMenuDelegate, NSMenuItemValidation {
  /// In menu order, for the menu bar dot to insert.
  let items: [NSMenuItem]
  let check: InputCheck
  private unowned let app: RecorderApp
  private let micPicker = NSMenuItem(title: "", action: nil, keyEquivalent: "")
  private let cameraPicker = NSMenuItem(title: "", action: nil, keyEquivalent: "")
  private let screenPicker = NSMenuItem(title: "", action: nil, keyEquivalent: "")
  private let meterItem = NSMenuItem()
  private let previewItem = NSMenuItem()
  private let meter = LevelMeterView()
  private let preview = CameraPreviewView()
  /// Redraws the level and the picture while the check runs.
  private var tick: Timer?

  init(app: RecorderApp) {
    self.app = app
    check = InputCheck(pictureRenderer: preview.renderer)
    meterItem.view = meter
    previewItem.view = preview
    items = [micPicker, meterItem, cameraPicker, previewItem, screenPicker]
    super.init()
    for picker in [micPicker, cameraPicker, screenPicker] {
      picker.submenu = NSMenu()
      picker.submenu?.delegate = self
    }
    showCheckItems(false)
  }

  /// Names the picked inputs while the menu is open; called on every change of the recorder's state.
  func render() {
    guard app.state.menuOpen else { return }
    let config = app.config
    micPicker.title = "Mic: " + pickedName(config.mic.map { RecorderInputs.device(named: $0.device, in: RecorderInputs.mics())?.localizedName ?? "\($0.device) (not connected)" })
    cameraPicker.title = "Camera: " + pickedName(config.camera.map { RecorderInputs.device(named: $0.device, in: RecorderInputs.cameras())?.localizedName ?? "\($0.device) (not connected)" })
    screenPicker.title = "Screen: " + screenTitle(config.screen)
  }

  func startCheck() {
    showCheckItems(true)
    check.start(config: app.config)
    showCheck()
    // Common modes: a menu tracks in its own run loop mode, where a default-mode timer never fires.
    let timer = Timer(timeInterval: 1.0 / 20, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.showCheck() } }
    RunLoop.main.add(timer, forMode: .common)
    tick = timer
  }

  func stopCheck() {
    showCheckItems(false)
    tick?.invalidate()
    tick = nil
    check.stop()
  }

  private func showCheckItems(_ showing: Bool) {
    meterItem.isHidden = !showing || app.config.mic == nil
    previewItem.isHidden = !showing || app.config.camera == nil
  }

  private func showCheck() {
    meter.signal = check.micSignal
    let picture = check.picture
    if picture != .live && preview.picture == .live { check.clearPicture() }
    preview.picture = picture
  }

  private func screenTitle(_ screen: ScreenConfig) -> String {
    let display = RecorderInputs.screen(named: screen.display)?.localizedName ?? "\(screen.display) (not connected)"
    guard let window = screen.window else { return display }
    let named = window.title.isEmpty ? window.app : "\(window.title) — \(window.app)"
    return RecorderInputs.windowIsOpen(window) ? named : "\(named) (closed: records \(display))"
  }

  /// A track left out of config.json has no picker: turning it back on means its settings, which live there.
  private func pickedName(_ name: String?) -> String { name ?? "off (config.json)" }

  // The submenus list what's connected when each opens, so a camera plugged in since shows up.
  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    let config = app.config
    let (pick, names, picked): ((String) -> RecorderInputPick, [String], String?) = switch menu {
    case micPicker.submenu:
      (RecorderInputPick.mic, RecorderInputs.mics().map(\.localizedName), config.mic.flatMap { RecorderInputs.device(named: $0.device, in: RecorderInputs.mics())?.localizedName })
    case cameraPicker.submenu:
      (RecorderInputPick.camera, RecorderInputs.cameras().map(\.localizedName), config.camera.flatMap { RecorderInputs.device(named: $0.device, in: RecorderInputs.cameras())?.localizedName })
    default:
      ({ .screen(.display(name: $0)) }, RecorderInputs.screens().map(\.localizedName),
       config.screen.window == nil ? RecorderInputs.screen(named: config.screen.display)?.localizedName : nil)
    }
    if menu == screenPicker.submenu {
      let choose = NSMenuItem(title: "Choose Window or Display…", action: #selector(chooseScreen), keyEquivalent: "")
      choose.target = self
      menu.addItem(choose)
      menu.addItem(.separator())
    }
    for name in names {
      let item = NSMenuItem(title: name, action: #selector(pick(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = PickedInput(pick(name))
      item.state = name == picked ? .on : .off
      menu.addItem(item)
    }
    if names.isEmpty { menu.addItem(NSMenuItem(title: "None connected", action: nil, keyEquivalent: "")) }
  }

  /// A pick is only for a camera or mic the config already records, and only while no take holds the devices.
  func validateMenuItem(_ item: NSMenuItem) -> Bool {
    if item.action == #selector(chooseScreen) {
      if case .idle = app.state.phase { return true }
      return false
    }
    guard let pick = (item.representedObject as? PickedInput)?.pick else { return true }
    let config = app.config
    return switch pick {
    case .mic: app.state.atRest && config.mic != nil
    case .camera: app.state.atRest && config.camera != nil
    case .screen: app.state.atRest
    }
  }

  @objc private func chooseScreen() {
    app.send(.screenPickerRequested)
  }

  // A take the hotkey started while this submenu was open leaves its items enabled until AppKit revalidates: the
  // machine refuses the pick then.
  @objc private func pick(_ sender: NSMenuItem) {
    guard let pick = (sender.representedObject as? PickedInput)?.pick else { return }
    app.send(.inputPicked(pick))
  }
}

/// A picker item's input, boxed for `representedObject`.
private final class PickedInput: NSObject {
  let pick: RecorderInputPick
  init(_ pick: RecorderInputPick) { self.pick = pick }
}

/// The mic's level as a bar, -60 dBFS to 0, green into amber above -12 and red above -3.
final class LevelMeterView: NSView {
  var signal = MicSignal.level(-120) { didSet { if signal != oldValue { needsDisplay = true } } }

  init() { super.init(frame: NSRect(x: 0, y: 0, width: inputMenuItemWidth, height: 22)) }
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

/// The camera's picture, 16:9, with what's wrong written over it when there's no picture. `InputCheck` feeds its
/// renderer frames already at the picture's pixel size.
final class CameraPreviewView: NSView {
  static let pictureSize = NSSize(width: 400, height: 225)
  var picture = CameraPicture.opening { didSet { if picture != oldValue { showPicture() } } }
  var renderer: AVSampleBufferVideoRenderer { displayLayer.sampleBufferRenderer }
  private let displayLayer = AVSampleBufferDisplayLayer()
  private let label = NSTextField(labelWithString: "")

  init() {
    super.init(frame: NSRect(x: 0, y: 0, width: inputMenuItemWidth, height: Self.pictureSize.height + 7))
    wantsLayer = true
    let frame = NSRect(origin: NSPoint(x: 20, y: 6), size: Self.pictureSize)
    displayLayer.frame = frame
    displayLayer.videoGravity = .resizeAspect
    displayLayer.backgroundColor = NSColor.black.cgColor
    displayLayer.cornerRadius = 4
    displayLayer.masksToBounds = true
    layer?.addSublayer(displayLayer)
    label.frame = NSRect(x: frame.minX, y: frame.midY - 9, width: frame.width, height: 18)
    label.alignment = .center
    label.textColor = .white
    label.font = .menuFont(ofSize: 12)
    addSubview(label)
    showPicture()
  }

  required init?(coder: NSCoder) { fatalError("not from a nib") }

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
