// The menu-bar item and its menu, drawn from the recorder's state (RecorderMenuStatus) after every change: the glyph
// with the take's clock beside it while recording, and the menu's warnings, Start/Stop, recent takes, inputs and the
// studio app.
import AppKit
import RecorderCore

/// The name a person sees, set once in the bundle by `studio recorder install`.
let recorderDisplayName = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Studio Recorder"

@MainActor
final class MenuBarDot: NSObject, NSMenuDelegate {
  // Variable: the clock widens it while recording.
  private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  private let app: RecorderApp
  private let toggleItem = NSMenuItem(title: "", action: #selector(toggle), keyEquivalent: "")
  private let menu = NSMenu()
  /// The warnings and Allow items at the top of the menu, replaced on each redraw.
  private var statusItems: [NSMenuItem] = []
  /// The recent takes, after `recentTakesAfter`, replaced on each redraw.
  private var recentTakeItems: [NSMenuItem] = []
  private let recentTakesAfter = NSMenuItem.separator()
  private let inputMenu: InputMenu
  /// The studio app's section, after the inputs: where it stands, Start or Stop, and Open Studio.
  private let studioAppStateItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")
  private let studioAppActionItem = NSMenuItem(title: "", action: #selector(studioAppAction), keyEquivalent: "")
  private let studioAppOpenItem = NSMenuItem(title: "Open Studio", action: #selector(openStudio), keyEquivalent: "")

  init(app: RecorderApp) {
    self.app = app
    inputMenu = InputMenu(app: app)
    super.init()
    app.inputMenu = inputMenu
    toggleItem.target = self
    menu.addItem(toggleItem)
    let open = NSMenuItem(title: "Open Recordings Folder", action: #selector(openFolder), keyEquivalent: "")
    open.target = self
    menu.addItem(open)
    menu.addItem(recentTakesAfter)
    for inputItem in inputMenu.items { menu.addItem(inputItem) }
    menu.addItem(.separator())
    studioAppActionItem.target = self
    studioAppOpenItem.target = self
    for studioAppItem in [studioAppStateItem, studioAppActionItem, studioAppOpenItem] { menu.addItem(studioAppItem) }
    menu.addItem(.separator())
    let about = NSMenuItem(title: "About \(recorderDisplayName)", action: #selector(showAbout), keyEquivalent: "")
    about.target = self
    menu.addItem(about)
    menu.addItem(NSMenuItem(title: "Quit \(recorderDisplayName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    item.menu = menu
    menu.delegate = self
    item.button?.font = NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
    app.onChange = { [weak self] in self?.render() }
  }

  private func render() {
    inputMenu.render()
    let status = RecorderMenuStatus(app.state, hotkey: app.config.hotkey, appName: recorderDisplayName)
    item.button?.image = menuBarGlyph(status.glyph)
    item.button?.title = status.clock.map { " \($0)" } ?? ""
    item.button?.imagePosition = status.clock == nil ? .imageOnly : .imageLeading
    item.button?.toolTip = status.toolTip
    renderRecentTakes(status)
    renderStudioApp(status.studioApp)
    for old in statusItems { menu.removeItem(old) }
    statusItems = status.warnings.map { NSMenuItem(title: $0, action: nil, keyEquivalent: "") } + status.allow.map { permission in
      let item = NSMenuItem(title: "Allow \(permission.title)…", action: #selector(allow(_:)), keyEquivalent: "")
      item.target = self
      item.representedObject = permission.rawValue
      return item
    }
    for (index, statusItem) in statusItems.enumerated() { menu.insertItem(statusItem, at: index) }
    if !statusItems.isEmpty {
      let separator = NSMenuItem.separator()
      menu.insertItem(separator, at: statusItems.count)
      statusItems.append(separator)
    }
    toggleItem.title = status.toggleTitle
  }

  private func renderRecentTakes(_ status: RecorderMenuStatus) {
    for old in recentTakeItems { menu.removeItem(old) }
    recentTakeItems = []
    guard !status.recentTakes.isEmpty else { return }
    recentTakeItems.append(NSMenuItem(title: "Recent Takes", action: nil, keyEquivalent: ""))
    for take in status.recentTakes {
      let takeItem = NSMenuItem(title: take.title, action: #selector(openRecentTake(_:)), keyEquivalent: "")
      takeItem.target = self
      takeItem.representedObject = take.folder
      takeItem.toolTip = take.toolTip
      recentTakeItems.append(takeItem)
    }
    recentTakeItems.append(.separator())
    let at = menu.index(of: recentTakesAfter) + 1
    for (offset, takeItem) in recentTakeItems.enumerated() { menu.insertItem(takeItem, at: at + offset) }
  }

  private func renderStudioApp(_ studioApp: RecorderMenuStatus.StudioAppItems) {
    studioAppStateItem.title = studioApp.title
    studioAppStateItem.toolTip = studioApp.toolTip
    studioAppActionItem.isHidden = studioApp.action == nil
    studioAppActionItem.title = studioApp.action == .stop ? "Stop Studio App" : "Start Studio App"
    // A menu item with no action is drawn disabled: Open Studio greys out while the app stops.
    studioAppOpenItem.action = studioApp.openEnabled ? #selector(openStudio) : nil
  }

  func menuWillOpen(_ menu: NSMenu) { app.send(.menuOpened) }
  func menuDidClose(_ menu: NSMenu) { app.send(.menuClosed) }

  @objc private func toggle() { app.send(.toggleRequested) }
  @objc private func openRecentTake(_ sender: NSMenuItem) {
    guard let folder = sender.representedObject as? URL else { return }
    app.send(.openRecentTakeRequested(folder))
  }
  @objc private func studioAppAction() {
    switch RecorderMenuStatus(app.state, hotkey: app.config.hotkey, appName: recorderDisplayName).studioApp.action {
    case .start: app.send(.studioAppStartRequested)
    case .stop: app.send(.studioAppStopRequested)
    case nil: break
    }
  }
  @objc private func openStudio() { app.send(.studioAppOpenRequested) }
  @objc private func showAbout() {
    NSApp.activate()
    NSApp.orderFrontStandardAboutPanel(nil)
  }
  @objc private func allow(_ sender: NSMenuItem) {
    guard let permission = (sender.representedObject as? String).flatMap(Permission.init(rawValue:)) else { return }
    app.send(.allowRequested(permission))
  }
  @objc private func openFolder() {
    try? FileManager.default.createDirectory(at: app.config.recordingsURL, withIntermediateDirectories: true)
    NSWorkspace.shared.open(app.config.recordingsURL)
  }
}

/// A menu-bar glyph from the bundle's Resources/menu-bar/ (Resources/ in the package). A `…Template` glyph takes
/// the menu bar's own colour; the recording and permission glyphs keep theirs.
@MainActor
private func menuBarGlyph(_ glyph: RecorderMenuStatus.Glyph) -> NSImage? {
  guard let url = Bundle.main.resourceURL?.appendingPathComponent("menu-bar/\(glyph.rawValue).pdf"), let image = NSImage(contentsOf: url) else { return nil }
  image.size = NSSize(width: 18, height: 18)
  image.isTemplate = glyph.rawValue.hasSuffix("Template")
  return image
}
