// Append-only JSON-lines files, written line by line so a killed recording keeps every line before the kill.
import CoreMedia
import Foundation

final class JSONLines {
  private let handle: FileHandle
  private let lock = NSLock()

  init(url: URL) throws {
    FileManager.default.createFile(atPath: url.path, contents: nil)
    handle = try FileHandle(forWritingTo: url)
  }

  func write(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
    lock.lock()
    handle.write(data + Data([0x0A]))
    lock.unlock()
  }

  func close() {
    lock.lock()
    try? handle.close()
    lock.unlock()
  }
}

/// How each device's own clock runs against the host clock, sampled through the recording: `host` is when the
/// sample happened on the host clock, `media` where it sits in the track's own timeline (both seconds since the
/// recording started), `arrival` when the recorder received it.
final class ClockLog {
  private let lines: JSONLines
  let start: CMTime

  init(url: URL, start: CMTime) throws {
    lines = try JSONLines(url: url)
    self.start = start
  }

  func write(track: String, host: CMTime, media: CMTime, arrival: CMTime) {
    lines.write(["track": track, "host": (host - start).seconds, "media": (media - start).seconds, "arrival": (arrival - start).seconds])
  }

  func close() { lines.close() }
}
