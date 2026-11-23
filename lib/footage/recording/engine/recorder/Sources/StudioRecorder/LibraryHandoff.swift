// Hands each finished recording to the footage library, so it appears there with no manual step. The command is the
// bundle's StudioLibraryAdd list (node, the studio CLI that installed the recorder, `library add --move --no-proxies`), written by
// `studio recorder install`; the recording's folder is appended. It runs detached: transcribing and making proxies
// take minutes, and the recorder is ready for the next take at once. A recording it fails on stays in the recordings
// folder, named in the log and the menu, to add by hand.
import Foundation
import RecorderCore

/// The command that adds a recording to the library, from the bundle; none when run outside one (tests, `swift run`).
let libraryAddCommand = Bundle.main.object(forInfoDictionaryKey: "StudioLibraryAdd") as? [String]

/// Starts adding `folder` to the library; `failed` is called on the main actor with what went wrong.
func handOffToLibrary(_ folder: URL, failed: @escaping @MainActor (LibraryHandoffFailure) -> Void) {
  guard let command = libraryAddCommand, let executable = command.first else {
    log("not added to the library: this build has no StudioLibraryAdd command")
    return
  }
  let process = Process()
  process.executableURL = URL(fileURLWithPath: executable)
  process.arguments = Array(command.dropFirst()) + [folder.path]
  // Its progress goes to the recorder's log, so a failed add can be read there. Opened to append, so its lines and
  // the recorder's own interleave rather than overwrite each other.
  process.standardOutput = FileHandle.nullDevice
  let descriptor = open(logURL.path, O_WRONLY | O_APPEND | O_CREAT, 0o644)
  if descriptor >= 0 { process.standardError = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true) }
  process.terminationHandler = { done in
    let status = done.terminationStatus
    log(status == 0 ? "added \(folder.lastPathComponent) to the library" : "library add of \(folder.lastPathComponent) exited \(status)")
    if status != 0 { Task { @MainActor in failed(.exited(status: status)) } }
  }
  do {
    try process.run()
    log("adding \(folder.lastPathComponent) to the library")
  } catch {
    log("couldn't start the library add: \(error)")
    Task { @MainActor in failed(.couldNotStart(reason: error.localizedDescription)) }
  }
}
