// The input log: a listen-only event tap (Input Monitoring permission, no Accessibility) writing every key, click,
// move and scroll as one JSON line. It can't alter or swallow events, and macOS withholds keys typed while secure
// input is on (password fields), so passwords never reach the log.
//
// `t` is seconds since the recording started on the host clock. Positions are global points, origin at the main
// display's top left, y down; recording.json's screen geometry maps them onto the screen track's pixels.
import AppKit
import CoreMedia

final class InputLog {
  private let lines: JSONLines
  private let start: CMTime
  private var tap: CFMachPort?
  private var source: CFRunLoopSource?

  init(url: URL, start: CMTime) throws {
    lines = try JSONLines(url: url)
    self.start = start
  }

  func begin() throws {
    let types: [CGEventType] = [
      .keyDown, .keyUp, .flagsChanged, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown,
      .otherMouseUp, .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel,
    ]
    let mask = types.reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
    guard
      let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly, eventsOfInterest: mask,
        callback: { _, type, event, context in
          Unmanaged<InputLog>.fromOpaque(context!).takeUnretainedValue().record(type, event)
          return Unmanaged.passUnretained(event)
        }, userInfo: Unmanaged.passUnretained(self).toOpaque())
    else { throw RecorderError("the input log needs Input Monitoring: System Settings › Privacy & Security › Input Monitoring") }
    self.tap = tap
    source = CFMachPortCreateRunLoopSource(nil, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
  }

  func end() {
    if let tap { CGEvent.tapEnable(tap: tap, enable: false); CFMachPortInvalidate(tap) }
    if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
    lines.close()
  }

  private func record(_ type: CGEventType, _ event: CGEvent) {
    // A tap the system disabled for being slow is turned back on; the events it missed are gone.
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
      lines.write(["t": (HostClock.now() - start).seconds, "type": "gap"])
      return
    }
    // CGEvent timestamps are host-clock nanoseconds (CLOCK_UPTIME_RAW), the clock every track is on.
    var line: [String: Any] = ["t": (CMTime(value: CMTimeValue(event.timestamp), timescale: 1_000_000_000) - start).seconds]
    let location = event.location
    let modifiers = modifierNames(event.flags)
    switch type {
    case .keyDown, .keyUp:
      line["type"] = type == .keyDown ? "keyDown" : "keyUp"
      line["keyCode"] = event.getIntegerValueField(.keyboardEventKeycode)
      if let key = NSEvent(cgEvent: event)?.charactersIgnoringModifiers, !key.isEmpty { line["key"] = key }
      if event.getIntegerValueField(.keyboardEventAutorepeat) != 0 { line["repeat"] = true }
    case .flagsChanged:
      line["type"] = "modifiers"
    case .leftMouseDown, .rightMouseDown, .otherMouseDown, .leftMouseUp, .rightMouseUp, .otherMouseUp:
      let down = type == .leftMouseDown || type == .rightMouseDown || type == .otherMouseDown
      line["type"] = down ? "mouseDown" : "mouseUp"
      line["button"] = buttonName(type, event)
      line["clicks"] = event.getIntegerValueField(.mouseEventClickState)
    case .mouseMoved:
      line["type"] = "mouseMove"
    case .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
      line["type"] = "mouseDrag"
    case .scrollWheel:
      line["type"] = "scroll"
      line["dx"] = event.getDoubleValueField(.scrollWheelEventPointDeltaAxis2)
      line["dy"] = event.getDoubleValueField(.scrollWheelEventPointDeltaAxis1)
    default:
      return
    }
    if type != .keyDown && type != .keyUp && type != .flagsChanged {
      line["x"] = location.x
      line["y"] = location.y
    }
    line["modifiers"] = modifiers
    lines.write(line)
  }
}

private func modifierNames(_ flags: CGEventFlags) -> [String] {
  [(CGEventFlags.maskControl, "ctrl"), (.maskAlternate, "opt"), (.maskShift, "shift"), (.maskCommand, "cmd"), (.maskSecondaryFn, "fn")]
    .filter { flags.contains($0.0) }.map(\.1)
}

private func buttonName(_ type: CGEventType, _ event: CGEvent) -> String {
  switch type {
  case .leftMouseDown, .leftMouseUp: "left"
  case .rightMouseDown, .rightMouseUp: "right"
  default: "button\(event.getIntegerValueField(.mouseEventButtonNumber))"
  }
}
