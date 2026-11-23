// The recorder's log: stderr, and ~/Library/Logs/StudioRecorder.log, which the library add appends to as well.
import Foundation

let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/StudioRecorder.log")

func log(_ message: String) {
  let line = "\(ISO8601DateFormatter().string(from: Date())) \(message)\n"
  FileHandle.standardError.write(line.data(using: .utf8)!)
  if let handle = try? FileHandle(forWritingTo: logURL) {
    handle.seekToEndOfFile()
    handle.write(line.data(using: .utf8)!)
    try? handle.close()
  } else {
    try? line.write(to: logURL, atomically: false, encoding: .utf8)
  }
}
