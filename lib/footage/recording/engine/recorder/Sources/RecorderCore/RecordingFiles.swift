// The files a take writes besides its media, as typed records: recording.json (studio-recording/1, which the
// studio's StudioRecordingJson schema reads), and the lines of clock.jsonl and input.jsonl. A key renamed here is
// a format change: those readers must change with it.
import Foundation

public enum RecordingStatus: String, Encodable, Sendable {
  /// From the first samples until the take stops cleanly; a take left so was killed, or is live.
  case recording
  case complete
}

/// The geometry of the display a screen track recorded, which maps the input log's global points onto its pixels.
public struct DisplayGeometry: Encodable, Sendable {
  public var name: String
  /// The display's rectangle in global points: origin at the main display's top left, y down (Quartz).
  public var boundsPoints: [Double]
  /// Pixels per point: the screen track's pixel = (point - bounds origin) × scale.
  public var scale: Double
  public var widthPixels: Int
  public var heightPixels: Int

  public init(name: String, boundsPoints: [Double], scale: Double, widthPixels: Int, heightPixels: Int) {
    self.name = name
    self.boundsPoints = boundsPoints
    self.scale = scale
    self.widthPixels = widthPixels
    self.heightPixels = heightPixels
  }
}

/// The window a screen track recorded. Where it sat on screen, and where its picture sat in the track's pixels, can
/// change through the take, so they're lines of `file` (window.jsonl), which map the input log's global points onto
/// the track's pixels moment by moment.
public struct RecordedWindow: Encodable, Sendable {
  public var title: String
  public var app: String
  public static let fileName = "window.jsonl"
  public let file = RecordedWindow.fileName

  public init(title: String, app: String) {
    self.title = title
    self.app = app
  }
}

/// A window.jsonl line: from `t` (seconds from the take's start, on the host clock) until the next line, the window
/// covered `boundsPoints` in global points (origin at the main display's top left, y down), and its picture covered
/// `contentPixels` of the screen track. Both are [x, y, width, height].
public struct RecordingWindowLine: Encodable, Sendable, Equatable {
  public let t: Double
  public let boundsPoints: [Double]
  public let contentPixels: [Double]

  public init(t: Double, boundsPoints: [Double], contentPixels: [Double]) {
    self.t = t
    self.boundsPoints = boundsPoints
    self.contentPixels = contentPixels
  }
}

/// One track as recording.json lists it; each track fills the fields it has.
public struct RecordingTrackEntry: Encodable, Sendable {
  public var file: String
  /// When its first sample arrived on the host clock, from the take's start.
  public var startSeconds: Double
  public var device: String?
  /// A screen track names the display it recorded, or the window.
  public var display: DisplayGeometry?
  public var window: RecordedWindow?
  public var sourceFormat: String?
  public var channel: Int?
  public var sampleRate: Double?
  public var latencySeconds: Double?
  /// How far the host clock ran ahead of the track's own sample clock over the take (the mic's).
  public var hostDriftSeconds: Double?
  public var captureDroppedFrames: Int?
  public var writerDroppedFrames: Int?

  public init(file: String, startSeconds: Double) {
    self.file = file
    self.startSeconds = startSeconds
  }
}

/// recording.json.
public struct StudioRecordingFile: Encodable, Sendable {
  public struct InputEntry: Encodable, Sendable {
    public let file = "input.jsonl"
    public let coordinates = "global-points"
  }

  public let format = "studio-recording/1"
  public var status: RecordingStatus
  public var startedAt: String
  /// Written once the take stops cleanly.
  public var durationSeconds: Double?
  /// Only tracks whose file was written: a track that never got a sample has none, and is under `leftOut`.
  public var tracks: [String: RecordingTrackEntry]
  /// Absent when the input log couldn't start.
  public var input: InputEntry?
  public let clockLog = "clock.jsonl"
  public var leftOut: [String: String]?
  public var problems: [String: String]?

  public init(
    status: RecordingStatus, startedAt: String, durationSeconds: Double?, tracks: [RecorderTrack: RecordingTrackEntry],
    leftOut: [RecorderTrack: TrackFailure], problems: [RecorderTrack: String]
  ) {
    self.status = status
    self.startedAt = startedAt
    self.durationSeconds = durationSeconds
    self.tracks = Dictionary(uniqueKeysWithValues: tracks.map { ($0.key.rawValue, $0.value) })
    input = leftOut[.input] == nil ? InputEntry() : nil
    self.leftOut = leftOut.isEmpty ? nil : Dictionary(uniqueKeysWithValues: leftOut.map { ($0.key.rawValue, $0.value.description) })
    self.problems = problems.isEmpty ? nil : Dictionary(uniqueKeysWithValues: problems.map { ($0.key.rawValue, $0.value) })
  }

  public func encoded() throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return try encoder.encode(self)
  }
}

/// A clock.jsonl line: how a device's clock runs against the host clock. `host` is when the sample happened on the
/// host clock, `media` where it sits in the track's own timeline (both seconds since the take started), `arrival`
/// when the recorder received it.
public struct RecordingClockLine: Encodable, Sendable {
  public let track: String
  public let host: Double
  public let media: Double
  public let arrival: Double

  public init(track: RecorderTrack, host: Double, media: Double, arrival: Double) {
    self.track = track.rawValue
    self.host = host
    self.media = media
    self.arrival = arrival
  }
}

/// An input.jsonl line: `t` in seconds from the take's start on the host clock, x and y in global points.
public struct InputLogLine: Encodable, Sendable {
  public enum Event: Sendable {
    case key(down: Bool, keyCode: Int64, key: String?, isRepeat: Bool)
    case modifiers
    case mouseButton(down: Bool, button: String, clicks: Int64, x: Double, y: Double)
    case mouseMove(x: Double, y: Double)
    case mouseDrag(x: Double, y: Double)
    case scroll(dx: Double, dy: Double, x: Double, y: Double)
    /// Events lost while macOS had switched the tap off for being slow.
    case gap
  }

  public let t: Double
  public let event: Event
  /// Held modifiers as ctrl, opt, shift, cmd, fn; every event but a gap carries them.
  public let modifiers: [String]

  public init(t: Double, event: Event, modifiers: [String]) {
    self.t = t
    self.event = event
    self.modifiers = modifiers
  }

  private enum Key: String, CodingKey { case t, type, keyCode, key, `repeat`, button, clicks, x, y, dx, dy, modifiers }

  public func encode(to encoder: any Encoder) throws {
    var line = encoder.container(keyedBy: Key.self)
    try line.encode(t, forKey: .t)
    func at(_ x: Double, _ y: Double) throws {
      try line.encode(x, forKey: .x)
      try line.encode(y, forKey: .y)
    }
    switch event {
    case .key(let down, let keyCode, let key, let isRepeat):
      try line.encode(down ? "keyDown" : "keyUp", forKey: .type)
      try line.encode(keyCode, forKey: .keyCode)
      try line.encodeIfPresent(key, forKey: .key)
      if isRepeat { try line.encode(true, forKey: .repeat) }
    case .modifiers:
      try line.encode("modifiers", forKey: .type)
    case .mouseButton(let down, let button, let clicks, let x, let y):
      try line.encode(down ? "mouseDown" : "mouseUp", forKey: .type)
      try line.encode(button, forKey: .button)
      try line.encode(clicks, forKey: .clicks)
      try at(x, y)
    case .mouseMove(let x, let y):
      try line.encode("mouseMove", forKey: .type)
      try at(x, y)
    case .mouseDrag(let x, let y):
      try line.encode("mouseDrag", forKey: .type)
      try at(x, y)
    case .scroll(let dx, let dy, let x, let y):
      try line.encode("scroll", forKey: .type)
      try line.encode(dx, forKey: .dx)
      try line.encode(dy, forKey: .dy)
      try at(x, y)
    case .gap:
      try line.encode("gap", forKey: .type)
      return
    }
    try line.encode(modifiers, forKey: .modifiers)
  }
}
