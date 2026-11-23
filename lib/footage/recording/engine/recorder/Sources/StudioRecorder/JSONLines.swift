// Append-only JSON-lines files, written line by line so a killed recording keeps every line before the kill.
import CoreMedia
import Foundation
import RecorderCore
import Synchronization

final class JSONLines<Line: Encodable> {
  /// Nil once closed: an event tap can still be mid-callback when the take ends, and its line is dropped. A lock,
  /// not an actor: capture callbacks and the event tap write here, and lines must land in the order they happened.
  private let handle: Mutex<FileHandle?>
  private let encoder = JSONEncoder()

  init(url: URL) throws(JSONLinesFailure) {
    FileManager.default.createFile(atPath: url.path, contents: nil)
    do { handle = Mutex(try FileHandle(forWritingTo: url)) } catch { throw .unopenable(error) }
    encoder.outputFormatting = [.sortedKeys]
  }

  func write(_ line: Line) {
    guard let data = try? encoder.encode(line) else { return }
    handle.withLock { $0?.write(data + Data([0x0A])) }
  }

  func close() {
    handle.withLock { handle in
      try? handle?.close()
      handle = nil
    }
  }
}

/// Why a log file couldn't be opened for writing, described as Foundation's error describes itself.
enum JSONLinesFailure: Error, CustomStringConvertible {
  case unopenable(any Error)

  var description: String {
    switch self {
    case .unopenable(let error): "\(error)"
    }
  }
}

/// How each device's own clock runs against the host clock, sampled through the take (clock.jsonl).
final class ClockLog {
  private let lines: JSONLines<RecordingClockLine>
  let start: CMTime

  init(url: URL, start: CMTime) throws(JSONLinesFailure) {
    lines = try JSONLines(url: url)
    self.start = start
  }

  func write(track: RecorderTrack, host: CMTime, media: CMTime, arrival: CMTime) {
    lines.write(RecordingClockLine(track: track, host: (host - start).seconds, media: (media - start).seconds, arrival: (arrival - start).seconds))
  }

  func close() { lines.close() }
}
