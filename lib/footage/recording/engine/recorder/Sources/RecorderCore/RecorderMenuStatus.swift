// What the menu-bar item says about the recorder's state: its glyph and clock, tooltip, warnings, Start/Stop title
// and recent takes.
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
  /// Beside the glyph while recording: how much of the take is written. None at rest, leaving the glyph alone.
  public let clock: String?
  public let recentTakes: [RecentTakeItem]
  /// The Throw Away item for the newest take; none while there's no take to throw away.
  public let throwAwayTitle: String?

  /// A recent take's menu item: what it says, and the folder its click names.
  public struct RecentTakeItem: Equatable {
    public let title: String
    public let folder: URL
    /// False while it's being thrown away.
    public let enabled: Bool
    /// What a click does: open its page in the library, or show its folder.
    public let toolTip: String

    /// When it began and how long it is, then where it is unless it's in the library: `Today 18:19 · 4:12`.
    public static func title(of take: RecorderRecentTake, now: Date = Date(), calendar: Calendar = .current) -> String {
      let when = take.recordedAt.map { recentTakeWhen($0, now: now, calendar: calendar) } ?? take.folder.lastPathComponent
      let length = take.durationSeconds.map { recorderClock(seconds: Int($0.rounded())) } ?? "interrupted"
      let place: String? = switch take.place {
      case .addingToLibrary: "adding to the library"
      case .inLibrary(_, mediaFolder: nil): "media offline"
      case .inLibrary, .added: nil
      case .inRecordings: "not in the library"
      case .throwingAway: "throwing away…"
      }
      return ([when, length] + (place.map { [$0] } ?? [])).joined(separator: " · ")
    }
  }

  /// `now` and `calendar` say which takes were today or yesterday.
  public init<Take>(_ state: RecorderState<Take>, hotkey: String, appName: String, now: Date = Date(), calendar: Calendar = .current) {
    let missing = state.missingPermissions
    let problems = (state.trackProblems.map { ($0.key.rawValue, $0.value) }
      + (state.libraryFailure.map { [("library", $0.description)] } ?? [])
      + (state.throwAwayFailure.map { [("throw away", "failed: \($0)")] } ?? []))
      .sorted { $0.0 < $1.0 }
    glyph = switch state.phase {
    case .needsPermission, .relaunching: .needsAttention
    case .idle, .pickingScreen: problems.isEmpty ? .idle : .needsAttention
    case .starting, .stopping, .exited: .busy
    case .recording: .recording
    }
    toolTip = !missing.isEmpty
      ? "\(appName) needs \(missing.map(\.title).joined(separator: ", "))"
      : problems.isEmpty ? "\(appName) (\(hotkey))" : "\(appName): \(problems.map { "\($0.0) \($0.1)" }.joined(separator: "; "))"
    warnings = problems.map { "⚠︎ \($0.0.prefix(1).uppercased())\($0.0.dropFirst()) \($0.1)" }
    allow = missing
    if case .recording(_, let elapsed) = state.phase {
      toggleTitle = "Stop Recording (\(hotkey))"
      clock = recorderClock(seconds: elapsed)
    } else {
      toggleTitle = "Start Recording (\(hotkey))"
      clock = nil
    }
    recentTakes = state.recentTakes.map { take in
      let enabled = if case .throwingAway = take.place { false } else { true }
      let toolTip = if case .inLibrary = take.place { "Open it in the studio's library" } else { "Show it in the Finder" }
      return RecentTakeItem(title: RecentTakeItem.title(of: take, now: now, calendar: calendar), folder: take.folder, enabled: enabled, toolTip: toolTip)
    }
    throwAwayTitle = state.recentTakes.first.flatMap { newest in
      if case .throwingAway = newest.place { return nil }
      return "Throw Away Last Take…"
    }
  }
}

/// `m:ss`, then `h:mm:ss` from an hour.
public func recorderClock(seconds: Int) -> String {
  let (hours, minutes, secs) = (seconds / 3600, seconds / 60 % 60, seconds % 60)
  return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, secs) : String(format: "%d:%02d", minutes, secs)
}

/// `Today 18:19`, `Yesterday 09:02`, else `Nov 20 14:00`, in `calendar`'s time zone.
private func recentTakeWhen(_ date: Date, now: Date, calendar: Calendar) -> String {
  let time = Date.FormatStyle(date: .omitted, time: .shortened, locale: Locale(identifier: "en_GB"), calendar: calendar, timeZone: calendar.timeZone)
  if calendar.isDate(date, inSameDayAs: now) { return "Today \(date.formatted(time))" }
  if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
    return "Yesterday \(date.formatted(time))"
  }
  let day = Date.FormatStyle(locale: Locale(identifier: "en_US"), calendar: calendar, timeZone: calendar.timeZone).month(.abbreviated).day()
  return "\(date.formatted(day)) \(date.formatted(time))"
}
