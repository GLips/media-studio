// The menu-bar item and its menu, drawn from the recorder's state (RecorderMenuStatus) after every change.
import AppKit
import RecorderCore

/// The name a person sees, set once in the bundle by `studio recorder install`.
let recorderDisplayName = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Studio Recorder"

@MainActor
final class MenuBarDot: NSObject, NSMenuDelegate {
  private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  private let app: RecorderApp
  private let toggleItem = NSMenuItem(title: "", action: #selector(toggle), keyEquivalent: "")
  private let menu = NSMenu()
  /// The warnings and Allow items at the top of the menu, replaced on each redraw.
  private var statusItems: [NSMenuItem] = []
  private let inputMenu: InputMenu

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
    menu.addItem(.separator())
    for inputItem in inputMenu.items { menu.addItem(inputItem) }
    menu.addItem(.separator())
    let about = NSMenuItem(title: "About \(recorderDisplayName)", action: #selector(showAbout), keyEquivalent: "")
    about.target = self
    menu.addItem(about)
    menu.addItem(NSMenuItem(title: "Quit \(recorderDisplayName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    item.menu = menu
    menu.delegate = self
    app.onChange = { [weak self] in self?.render() }
  }

  private func render() {
    inputMenu.render()
    let status = RecorderMenuStatus(app.state, hotkey: app.config.hotkey, appName: recorderDisplayName)
    item.button?.image = menuBarGlyph(status.glyph)
    item.button?.toolTip = status.toolTip
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

  func menuWillOpen(_ menu: NSMenu) { app.send(.menuOpened) }
  func menuDidClose(_ menu: NSMenu) { app.send(.menuClosed) }

  @objc private func toggle() { app.send(.toggleRequested) }
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
