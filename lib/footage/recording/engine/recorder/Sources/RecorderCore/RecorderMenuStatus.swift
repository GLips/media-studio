// What the menu-bar item says about the recorder's state: its glyph and clock, tooltip, warnings, Start/Stop title,
// recent takes and the studio app.
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
  public let studioApp: StudioAppItems

  /// The menu's studio app section: a line saying where it stands, then what can be done with it.
  public struct StudioAppItems: Equatable {
    public enum Action: Equatable { case start, stop }

    public let title: String
    public let toolTip: String?
    /// Start or Stop; none while one is under way, or while something else holds the port.
    public let action: Action?
    public let openEnabled: Bool
  }

  /// A recent take's menu item: what it says, and the folder its click names.
  public struct RecentTakeItem: Equatable {
    public let title: String
    public let folder: URL
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
      }
      return ([when, length] + (place.map { [$0] } ?? [])).joined(separator: " · ")
    }
  }

  /// `now` and `calendar` say which takes were today or yesterday.
  public init<Take>(_ state: RecorderState<Take>, hotkey: String, appName: String, now: Date = Date(), calendar: Calendar = .current) {
    let missing = state.missingPermissions
    let problems = (state.trackProblems.map { ($0.key.rawValue, $0.value) }
      + (state.libraryFailure.map { [("library", $0.description)] } ?? [])
      + (state.studioAppFailure.map { [studioAppProblem($0.command, $0.reason)] } ?? []))
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
      let toolTip = if case .inLibrary = take.place { "Open it in the studio's library" } else { "Show it in the Finder" }
      return RecentTakeItem(title: RecentTakeItem.title(of: take, now: now, calendar: calendar), folder: take.folder, toolTip: toolTip)
    }
    studioApp = StudioAppItems(state.studioApp)
  }
}

extension RecorderMenuStatus.StudioAppItems {
  public init(_ state: StudioAppState) {
    let (said, toolTip, action): (String, String?, Action?) = switch state {
    case .unknown: ("Checking…", nil, .start)
    case .running(let url, let stale):
      ("Running", [url?.absoluteString, stale ? "the code changed since it started: the next open restarts it" : nil].compactMap(\.self).joined(separator: "; "), .stop)
    case .stopped: ("Stopped", nil, .start)
    case .unhealthy(let detail): ("Not responding", detail, .stop)
    case .foreign(let detail): ("Port taken", detail, nil)
    case .starting: ("Starting…", nil, nil)
    case .stopping: ("Stopping…", nil, nil)
    }
    title = "Studio App: \(said)"
    self.toolTip = toolTip.flatMap { $0.isEmpty ? nil : $0 }
    self.action = action
    openEnabled = state != .stopping
  }
}

/// A failed studio app command as a warning's (key, text): `⚠︎ Open failed: port 4317 is taken…`.
private func studioAppProblem(_ command: StudioAppCommand, _ reason: String) -> (String, String) {
  switch command {
  case .start: ("studio app", "didn't start: \(reason)")
  case .stop: ("studio app", "didn't stop: \(reason)")
  case .open, .openItem: ("open", "failed: \(reason)")
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
