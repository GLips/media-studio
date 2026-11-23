// The input log: a listen-only event tap (Input Monitoring permission, no Accessibility) writing every key, click,
// move and scroll as one JSON line. It can't alter or swallow events, and macOS withholds keys typed while secure
// input is on (password fields), so passwords never reach the log.
//
// `t` is seconds since the recording started on the host clock. Positions are global points, origin at the main
// display's top left, y down; recording.json's screen geometry maps them onto the screen track's pixels.
import AppKit
import CoreMedia
import RecorderCore

final class InputLog {
  private let lines: JSONLines<InputLogLine>
  private let start: CMTime
  /// The tap and its run-loop source, from `begin` until `end`.
  private var tap: (port: CFMachPort, source: CFRunLoopSource)?

  init(url: URL, start: CMTime) throws {
    lines = try JSONLines(url: url)
    self.start = start
  }

  func begin() throws(TrackFailure) {
    let types: [CGEventType] = [
      .keyDown, .keyUp, .flagsChanged, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown,
      .otherMouseUp, .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel,
    ]
    let mask = types.reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
    guard
      let port = CGEvent.tapCreate(
        tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly, eventsOfInterest: mask,
        callback: { _, type, event, context in
          Unmanaged<InputLog>.fromOpaque(context!).takeUnretainedValue().record(type, event)
          return Unmanaged.passUnretained(event)
        }, userInfo: Unmanaged.passUnretained(self).toOpaque())
    else { throw .inputMonitoringNeeded }
    let source = CFMachPortCreateRunLoopSource(nil, port, 0)!
    tap = (port, source)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: port, enable: true)
  }

  func end() {
    if let tap {
      CGEvent.tapEnable(tap: tap.port, enable: false)
      CFMachPortInvalidate(tap.port)
      CFRunLoopRemoveSource(CFRunLoopGetMain(), tap.source, .commonModes)
    }
    tap = nil
    lines.close()
  }

  private func record(_ type: CGEventType, _ event: CGEvent) {
    // A tap the system disabled for being slow is turned back on; the events it missed are gone.
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      if let tap { CGEvent.tapEnable(tap: tap.port, enable: true) }
      lines.write(InputLogLine(t: (HostClock.now() - start).seconds, event: .gap, modifiers: []))
      return
    }
    // CGEvent timestamps are host-clock nanoseconds (CLOCK_UPTIME_RAW), the clock every track is on.
    let t = (CMTime(value: CMTimeValue(event.timestamp), timescale: 1_000_000_000) - start).seconds
    let (x, y) = (event.location.x, event.location.y)
    let logged: InputLogLine.Event
    switch type {
    case .keyDown, .keyUp:
      let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
      let key = (namedKeys[keyCode] ?? NSEvent(cgEvent: event)?.charactersIgnoringModifiers).flatMap { $0.isEmpty ? nil : $0 }
      logged = .key(down: type == .keyDown, keyCode: keyCode, key: key, isRepeat: event.getIntegerValueField(.keyboardEventAutorepeat) != 0)
    case .flagsChanged:
      logged = .modifiers
    case .leftMouseDown, .rightMouseDown, .otherMouseDown, .leftMouseUp, .rightMouseUp, .otherMouseUp:
      let down = type == .leftMouseDown || type == .rightMouseDown || type == .otherMouseDown
      logged = .mouseButton(down: down, button: buttonName(type, event), clicks: event.getIntegerValueField(.mouseEventClickState), x: x, y: y)
    case .mouseMoved:
      logged = .mouseMove(x: x, y: y)
    case .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
      logged = .mouseDrag(x: x, y: y)
    case .scrollWheel:
      logged = .scroll(
        dx: event.getDoubleValueField(.scrollWheelEventPointDeltaAxis2), dy: event.getDoubleValueField(.scrollWheelEventPointDeltaAxis1), x: x, y: y)
    default:
      return
    }
    lines.write(InputLogLine(t: t, event: logged, modifiers: modifierNames(event.flags)))
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

/// Keys whose characters are control codes or nothing, by their names on the keyboard.
private let namedKeys: [Int64: String] = [
  36: "return", 48: "tab", 49: "space", 51: "delete", 53: "escape", 76: "enter", 117: "forwardDelete", 115: "home",
  119: "end", 116: "pageUp", 121: "pageDown", 123: "left", 124: "right", 125: "down", 126: "up", 122: "f1", 120: "f2",
  99: "f3", 118: "f4", 96: "f5", 97: "f6", 98: "f7", 100: "f8", 101: "f9", 109: "f10", 103: "f11", 111: "f12",
]
