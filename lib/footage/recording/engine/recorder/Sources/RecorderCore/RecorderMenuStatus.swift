// What the menu-bar item says about the recorder's state: its glyph, tooltip, warnings and Start/Stop title.
import Foundation

public struct RecorderMenuStatus: Equatable {
  /// A glyph in the bundle's Resources/menu-bar/. A `…Template` glyph takes the menu bar's own colour.
  public enum Glyph: String {
    case idle = "MenuBarIdleTemplate"
    /// Amber, meaning "look at the menu": a missing permission, or something that failed in the last take.
    case needsAttention = "MenuBarNeedsPermission"
    case busy = "MenuBarBusyTemplate"
    case recording = "MenuBarRecording"
  }

  public let glyph: Glyph
  public let toolTip: String
  /// Lines at the top of the menu, one per track problem or library failure, above the Allow items.
  public let warnings: [String]
  /// The missing permissions, each an Allow item that asks again.
  public let allow: [Permission]
  public let toggleTitle: String

  public init<Take>(_ state: RecorderState<Take>, hotkey: String, appName: String) {
    let missing = state.missingPermissions
    let problems = (state.trackProblems.map { ($0.key.rawValue, $0.value) } + (state.libraryFailure.map { [("library", $0.description)] } ?? []))
      .sorted { $0.0 < $1.0 }
    glyph = switch state.phase {
    case .needsPermission, .relaunching: .needsAttention
    case .idle: problems.isEmpty ? .idle : .needsAttention
    case .starting, .stopping, .exited: .busy
    case .recording: .recording
    }
    toolTip = !missing.isEmpty
      ? "\(appName) needs \(missing.map(\.title).joined(separator: ", "))"
      : problems.isEmpty ? "\(appName) (\(hotkey))" : "\(appName): \(problems.map { "\($0.0) \($0.1)" }.joined(separator: "; "))"
    warnings = problems.map { "⚠︎ \($0.0.capitalized) \($0.1)" }
    allow = missing
    if case .recording = state.phase {
      toggleTitle = "Stop Recording (\(hotkey))"
    } else {
      toggleTitle = "Start Recording (\(hotkey))"
    }
  }
}
