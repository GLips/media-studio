// The studio's library verbs the recorder runs, each a command in the bundle's Info.plist with one folder appended
// (recorder-app-bundle.ts writes them): node, the studio CLI that installed the recorder, and the verb.
//
// Each finished take is handed to the library (`library add --move --no-proxies`) so it appears there with no manual
// step. That add runs detached: transcribing takes minutes, and the recorder is ready for the next take at once. A
// take it fails on stays in the recordings folder, named in the log and the menu, to add by hand. The menu's recent
// takes come from `library recordings`, a click on one in the library is `library open`, and Throw Away is
// `library remove --take`.
import Foundation
import RecorderCore

/// A bundle command by its Info.plist key; none when run outside the bundle (tests, `swift run`).
private func studioCommand(_ key: String) -> [String]? {
  Bundle.main.object(forInfoDictionaryKey: key) as? [String]
}

private func studioProcess(_ command: [String], folder: URL) -> Process {
  studioProcess(command, argument: folder.path)
}

private func studioProcess(_ command: [String], argument: String) -> Process {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: command[0])
  process.arguments = Array(command.dropFirst()) + [argument]
  return process
}

/// Writes a child's stderr to the end of the recorder's log, interleaved with the recorder's own lines.
private func logStderr(of process: Process) {
  process.standardOutput = FileHandle.nullDevice
  let descriptor = open(logURL.path, O_WRONLY | O_APPEND | O_CREAT, 0o644)
  if descriptor >= 0 { process.standardError = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true) }
}

/// Opens a library item's page, detached: when no studio app is running, the verb serves one and keeps running.
func openLibraryItem(_ item: String) {
  guard let command = studioCommand("StudioLibraryOpen") else {
    log("can't open \(item): this build has no StudioLibraryOpen command")
    return
  }
  let process = studioProcess(command, argument: item)
  logStderr(of: process)
  process.terminationHandler = { done in
    if done.terminationStatus != 0 { log("opening \(item) in the library exited \(done.terminationStatus)") }
  }
  do { try process.run() } catch { log("couldn't open \(item) in the library: \(error)") }
}

/// Starts adding `folder` to the library; `ended` is called on the main actor when it exits, with why it failed if it
/// did. Returns the add, which a throw-away stops; none when it couldn't start.
func handOffToLibrary(_ folder: URL, ended: @escaping @MainActor (LibraryHandoffFailure?) -> Void) -> Process? {
  guard let command = studioCommand("StudioLibraryAdd") else {
    Task { @MainActor in ended(.couldNotStart(reason: "this build has no StudioLibraryAdd command")) }
    return nil
  }
  let process = studioProcess(command, folder: folder)
  // Its progress goes to the recorder's log, so a failed add can be read there.
  logStderr(of: process)
  process.terminationHandler = { done in
    let status = done.terminationStatus
    log(status == 0 ? "added \(folder.lastPathComponent) to the library" : "library add of \(folder.lastPathComponent) exited \(status)")
    Task { @MainActor in ended(status == 0 ? nil : .exited(status: status)) }
  }
  do {
    try process.run()
    log("adding \(folder.lastPathComponent) to the library")
    return process
  } catch {
    log("couldn't start the library add: \(error)")
    Task { @MainActor in ended(.couldNotStart(reason: error.localizedDescription)) }
    return nil
  }
}

/// Why a library verb the menu runs failed: the sentence the log and the menu show.
struct StudioCommandFailure: Error, CustomStringConvertible {
  let description: String
}

/// Runs the bundle's command `key` on `folder` to its end; its stdout when it exits 0. When it doesn't, the failure
/// is the last line it wrote to stderr, which is the studio's message for why.
func runStudioCommand(_ key: String, folder: URL) async throws(StudioCommandFailure) -> Data {
  guard let command = studioCommand(key) else { throw StudioCommandFailure(description: "this build has no \(key) command") }
  let process = studioProcess(command, folder: folder)
  let stdout = Pipe(), stderr = Pipe()
  process.standardOutput = stdout
  process.standardError = stderr
  do { try process.run() } catch { throw StudioCommandFailure(description: error.localizedDescription) }
  // Both read at once, so neither pipe fills while the other is read to its end.
  async let out = Task.detached { stdout.fileHandleForReading.readDataToEndOfFile() }.value
  async let err = Task.detached { stderr.fileHandleForReading.readDataToEndOfFile() }.value
  let (output, errors) = await (out, err)
  await Task.detached { process.waitUntilExit() }.value
  guard process.terminationStatus == 0 else {
    let said = String(decoding: errors, as: UTF8.self).split(whereSeparator: \.isNewline).last.map(String.init)
    throw StudioCommandFailure(description: said ?? "exited \(process.terminationStatus)")
  }
  return output
}
