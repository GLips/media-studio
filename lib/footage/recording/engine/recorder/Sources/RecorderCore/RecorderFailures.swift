// What goes wrong, by what went wrong. Each description is the sentence the log, the menu and recording.json show.
import Foundation

/// Why a track was left out of a take: it couldn't start, or never sent a sample.
public enum TrackFailure: Error, CustomStringConvertible {
  case noDevice(RecorderInputKind, named: String, connected: [String])
  case noFormats(device: String)
  case noAudioFormat(device: String)
  case noSuchInput(device: String, inputs: Int, wanted: Int)
  case cantAddToSession(device: String)
  case cantReadFrames(device: String)
  case cantReadAudio(device: String)
  case writerWouldNotStart(RecorderTrack)
  case inputMonitoringNeeded
  case noSamples
  /// An error a framework threw (a device that won't open, a file that can't be made), as it describes itself.
  case system(any Error)

  public var description: String {
    switch self {
    case .noDevice(let kind, let name, let connected):
      "no \(kind == .screen ? "display" : kind.rawValue) named like \"\(name)\"; there are: \(connected.joined(separator: ", "))"
    case .noFormats(let device): "\(device) offers no formats"
    case .noAudioFormat(let device): "\(device) has no audio format"
    case .noSuchInput(let device, let inputs, let wanted): "\(device) has \(inputs) inputs, not \(wanted)"
    case .cantAddToSession(let device): "can't add \(device) to a capture session"
    case .cantReadFrames(let device): "can't read frames from \(device)"
    case .cantReadAudio(let device): "can't read audio from \(device)"
    case .writerWouldNotStart(let track): "\(track.rawValue): the writer wouldn't start"
    case .inputMonitoringNeeded: "the input log needs Input Monitoring: System Settings › Privacy & Security › Input Monitoring"
    case .noSamples: "no samples arrived"
    case .system(let error): "\(error)"
    }
  }
}

/// Why a take never started.
public enum TakeStartFailure: Error, CustomStringConvertible {
  /// Its folder or its logs couldn't be made.
  case folderUnwritable(any Error)
  case noTrackStarted([RecorderTrack: TrackFailure])

  public var description: String {
    switch self {
    case .folderUnwritable(let error): "\(error)"
    case .noTrackStarted(let leftOut):
      "no track could start: [" + leftOut.sorted { $0.key < $1.key }.map { "\(String(reflecting: $0.key.rawValue)): \(String(reflecting: $0.value.description))" }.joined(separator: ", ") + "]"
    }
  }
}

/// Why a finished take didn't reach the library. It stays in the recordings folder, to add by hand.
public enum LibraryHandoffFailure: Error, CustomStringConvertible {
  case exited(status: Int32)
  case couldNotStart(reason: String)

  public var description: String {
    switch self {
    case .exited(let status): "wasn't added to the library (exit \(status)); see the log"
    case .couldNotStart(let reason): "wasn't added to the library: \(reason)"
    }
  }
}
