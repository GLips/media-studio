// What's connected, and which of it the config names. The tracks, the menu's pickers and the menu's live check all
// find a device here, so the one the menu shows as picked is the one a recording opens.
import AppKit
import AVFoundation

enum RecorderInputs {
  static func cameras() -> [AVCaptureDevice] {
    AVCaptureDevice.DiscoverySession(
      deviceTypes: [.external, .builtInWideAngleCamera, .continuityCamera], mediaType: .video, position: .unspecified
    ).devices
  }

  static func mics() -> [AVCaptureDevice] {
    AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified).devices
  }

  /// The first connected device whose name contains `name`, as the config names it.
  static func device(named name: String, in devices: [AVCaptureDevice]) -> AVCaptureDevice? {
    devices.first { $0.localizedName.localizedCaseInsensitiveContains(name) }
  }

  static func screens() -> [NSScreen] { NSScreen.screens }

  /// Whether the picked window is still open: a window with its id, of its app (see RecorderWindowChoice).
  static func windowIsOpen(_ window: WindowConfig) -> Bool {
    let ids = [UnsafeRawPointer(bitPattern: UInt(window.id))] as CFArray
    guard let found = (CGWindowListCreateDescriptionFromArray(ids) as? [[CFString: Any]])?.first,
      let pid = found[kCGWindowOwnerPID] as? pid_t
    else { return false }
    return NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == window.bundleID
  }

  /// The display a screen config names: `main`, or the first whose name contains it.
  static func screen(named name: String) -> NSScreen? {
    if name == "main" { return NSScreen.screens.first { $0.displayID == CGMainDisplayID() } }
    return NSScreen.screens.first { $0.localizedName.localizedCaseInsensitiveContains(name) }
  }
}

extension NSScreen {
  var displayID: CGDirectDisplayID? {
    (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
  }
}
