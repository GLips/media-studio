// The global start/stop key, through Carbon's RegisterEventHotKey: it needs no permission, and the key reaches
// only the recorder, never the app in front.
import Carbon.HIToolbox

final class HotKey {
  private var ref: EventHotKeyRef?
  private var handler: EventHandlerRef?
  private let action: () -> Void

  /// `spec` is modifiers and one key joined by `+`: ctrl, opt (alt), cmd, shift; a letter, digit, f1–f20, space.
  init(_ spec: String, action: @escaping () -> Void) throws(HotKeyFailure) {
    self.action = action
    var modifiers: UInt32 = 0
    var keyCode: UInt32?
    for part in spec.lowercased().split(separator: "+").map(String.init) {
      switch part {
      case "ctrl", "control": modifiers |= UInt32(controlKey)
      case "opt", "option", "alt": modifiers |= UInt32(optionKey)
      case "cmd", "command": modifiers |= UInt32(cmdKey)
      case "shift": modifiers |= UInt32(shiftKey)
      default:
        guard let code = keyCodes[part] else { throw .noKeyNamed(part, spec: spec) }
        keyCode = code
      }
    }
    guard let keyCode else { throw .namesNoKey(spec: spec) }

    var pressed = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(
      GetApplicationEventTarget(),
      { _, _, context in
        Unmanaged<HotKey>.fromOpaque(context!).takeUnretainedValue().action()
        return noErr
      }, 1, &pressed, Unmanaged.passUnretained(self).toOpaque(), &handler)
    let status = RegisterEventHotKey(
      keyCode, modifiers, EventHotKeyID(signature: OSType(0x5354_5243), id: 1), GetApplicationEventTarget(), 0, &ref)
    guard status == noErr else { throw .taken(spec: spec, status: status) }
  }
}

enum HotKeyFailure: Error, CustomStringConvertible {
  case noKeyNamed(String, spec: String)
  case namesNoKey(spec: String)
  case taken(spec: String, status: OSStatus)

  var description: String {
    switch self {
    case .noKeyNamed(let part, let spec): "hotkey \"\(spec)\": no key named \"\(part)\""
    case .namesNoKey(let spec): "hotkey \"\(spec)\" names no key"
    case .taken(let spec, let status): "hotkey \"\(spec)\" is taken by another app (\(status))"
    }
  }
}

private let keyCodes: [String: UInt32] = {
  var codes: [String: UInt32] = [
    "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05, "z": 0x06, "x": 0x07, "c": 0x08, "v": 0x09,
    "b": 0x0B, "q": 0x0C, "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10, "t": 0x11, "1": 0x12, "2": 0x13, "3": 0x14,
    "4": 0x15, "6": 0x16, "5": 0x17, "9": 0x19, "7": 0x1A, "8": 0x1C, "0": 0x1D, "o": 0x1F, "u": 0x20, "i": 0x22,
    "p": 0x23, "l": 0x25, "j": 0x26, "k": 0x28, "n": 0x2D, "m": 0x2E, "space": 0x31,
  ]
  let functionKeys: [UInt32] = [
    0x7A, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6D, 0x67, 0x6F, 0x69, 0x6B, 0x71, 0x6A, 0x40, 0x4F, 0x50, 0x5A,
  ]
  for (index, code) in functionKeys.enumerated() { codes["f\(index + 1)"] = code }
  return codes
}()
