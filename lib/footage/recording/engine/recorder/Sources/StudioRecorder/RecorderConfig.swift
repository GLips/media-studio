// The recorder's settings, in a JSON file. First launch writes the defaults (Graham's desk: the LG display, the
// A6400 through the Cam Link, the Scarlett Solo). The menu picks the screen, camera and mic and writes them back;
// everything else is edited in the file.
import Foundation

struct RecorderConfig: Codable {
  /// The global key that starts and stops a recording, as `ctrl+opt+cmd+r`; see HotKey.swift for the names.
  var hotkey: String
  /// Each recording is a folder in here. `~` expands.
  var recordingsDir: String
  var screen: ScreenConfig
  /// Absent records no camera.
  var camera: CameraConfig?
  /// Absent records no mic.
  var mic: MicConfig?

  static let defaults = RecorderConfig(
    hotkey: "ctrl+opt+cmd+r",
    recordingsDir: "~/Movies/Studio Recordings",
    screen: ScreenConfig(display: "LG UltraFine", fps: 30, bitrateMbps: 16, showsCursor: true),
    camera: CameraConfig(device: "Cam Link", width: 3840, height: 2160, fps: 30, bitrateMbps: 30, latencyMsByDevice: ["Cam Link": 160]),
    mic: MicConfig(device: "Scarlett Solo", channelByDevice: ["Scarlett": 1], bitrateKbps: 192, latencyMsByDevice: [:])
  )

  var recordingsURL: URL { URL(fileURLWithPath: (recordingsDir as NSString).expandingTildeInPath) }

  static let defaultURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/StudioRecorder/config.json")

  /// Reads the config at `url`, writing the defaults there first when there's none.
  static func load(from url: URL) throws(RecorderConfigFailure) -> RecorderConfig {
    if !FileManager.default.fileExists(atPath: url.path) {
      do {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      } catch {
        throw .unwritable(error)
      }
      try defaults.save(to: url)
    }
    let data: Data
    do { data = try Data(contentsOf: url) } catch { throw .unreadable(error) }
    do { return try JSONDecoder().decode(RecorderConfig.self, from: data) } catch { throw .malformed(error) }
  }

  func save(to url: URL) throws(RecorderConfigFailure) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    do { try encoder.encode(self).write(to: url, options: .atomic) } catch { throw .unwritable(error) }
  }
}

/// Why config.json couldn't be read or written. Each describes itself as Foundation's error does, the sentence the
/// log shows.
enum RecorderConfigFailure: Error, CustomStringConvertible {
  case unreadable(any Error)
  /// Read, but not a config: bad JSON, or a field missing or of the wrong type.
  case malformed(any Error)
  case unwritable(any Error)

  var description: String {
    switch self {
    case .unreadable(let error), .malformed(let error), .unwritable(let error): "\(error)"
    }
  }
}

/// A per-device setting from a table keyed by part of the device's name: the longest key the name contains wins,
/// so `"Scarlett Solo"` beats `"Scarlett"`. Nil when no key matches.
func settingForDevice<Value>(_ table: [String: Value], named deviceName: String) -> Value? {
  table.filter { deviceName.localizedCaseInsensitiveContains($0.key) }.max { $0.key.count < $1.key.count }?.value
}

struct ScreenConfig: Codable {
  /// `main`, or part of a display's name as System Settings shows it; the menu writes the whole name.
  var display: String
  var fps: Int
  var bitrateMbps: Double
  var showsCursor: Bool
}

struct CameraConfig: Codable {
  /// Part of the capture device's name; the menu writes the whole name.
  var device: String
  /// The size written; the device's own format is scaled to it.
  var width: Int
  var height: Int
  var fps: Int
  var bitrateMbps: Double
  /// How late each device's frames arrive against the world (the Elgato path is about 160 ms), by part of its
  /// name; a device not listed is taken as 0. Copied into each recording's metadata as its correction, never
  /// applied to the media. Kept per device so picking another camera in the menu never carries the Elgato's over.
  var latencyMsByDevice: [String: Double]
}

struct MicConfig: Codable {
  var device: String
  /// The interface input that carries the mic, 1-based, by part of the device's name; a device not listed uses
  /// input 1. The Scarlett Solo's XLR is input 1, its instrument jack 2.
  var channelByDevice: [String: Int]
  var bitrateKbps: Int
  /// As the camera's `latencyMsByDevice`.
  var latencyMsByDevice: [String: Double]

  func channel(forDevice deviceName: String) -> Int { settingForDevice(channelByDevice, named: deviceName) ?? 1 }
}
