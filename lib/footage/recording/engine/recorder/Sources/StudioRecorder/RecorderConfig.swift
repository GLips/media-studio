// The recorder's settings, set once in a JSON file: no window ever asks. First launch writes the defaults
// (Graham's desk: the LG display, the A6400 through the Cam Link, the Scarlett Solo) for him to edit.
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
    camera: CameraConfig(device: "Cam Link", width: 1920, height: 1080, fps: 30, bitrateMbps: 12, latencyMs: 160),
    mic: MicConfig(device: "Scarlett Solo", channel: 1, bitrateKbps: 192, latencyMs: 0)
  )

  var recordingsURL: URL { URL(fileURLWithPath: (recordingsDir as NSString).expandingTildeInPath) }

  static let defaultURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/StudioRecorder/config.json")

  /// Reads the config at `url`, writing the defaults there first when there's none.
  static func load(from url: URL) throws -> RecorderConfig {
    if !FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
      try encoder.encode(defaults).write(to: url)
    }
    return try JSONDecoder().decode(RecorderConfig.self, from: Data(contentsOf: url))
  }
}

struct ScreenConfig: Codable {
  /// `main`, or part of a display's name as System Settings shows it.
  var display: String
  var fps: Int
  var bitrateMbps: Double
  var showsCursor: Bool
}

struct CameraConfig: Codable {
  /// Part of the capture device's name.
  var device: String
  /// The size written; the device's own format is scaled to it.
  var width: Int
  var height: Int
  var fps: Int
  var bitrateMbps: Double
  /// How late the device's frames arrive against the world (the Elgato path is about 160 ms). Copied into each
  /// recording's metadata as its correction; never applied to the media.
  var latencyMs: Double
}

struct MicConfig: Codable {
  var device: String
  /// The interface input that carries the mic, 1-based: the Scarlett Solo's XLR is input 1, its instrument jack 2.
  var channel: Int
  var bitrateKbps: Int
  var latencyMs: Double
}
