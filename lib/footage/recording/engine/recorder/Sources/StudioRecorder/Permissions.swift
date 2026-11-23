// Reading and raising the permissions a recording needs. When to ask, and when to relaunch, is the machine's
// (RecorderCore/RecorderMachine.swift); this is how.
import AppKit
import AVFoundation
import RecorderCore

extension Permission {
  /// The System Settings pane that holds its toggle.
  var settingsURL: URL {
    let pane = switch self {
    case .screen: "Privacy_ScreenCapture"
    case .input: "Privacy_ListenEvent"
    case .camera: "Privacy_Camera"
    case .microphone: "Privacy_Microphone"
    }
    return URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)")!
  }

  /// Whether this process holds it. Screen and input answers are fixed at launch; `grantedInFreshProcess` isn't.
  var granted: Bool {
    switch self {
    case .screen: CGPreflightScreenCaptureAccess()
    case .input: CGPreflightListenEventAccess()
    case .camera: AVCaptureDevice.authorizationStatus(for: .video) == .authorized
    case .microphone: AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }
  }

  /// Raises macOS's own prompt. It shows once per permission; after that it's System Settings, so a second ask opens
  /// the pane instead.
  func request(openingSettings: Bool) async {
    switch self {
    case .screen: CGRequestScreenCaptureAccess()
    case .input: CGRequestListenEventAccess()
    case .camera: _ = await AVCaptureDevice.requestAccess(for: .video)
    case .microphone: _ = await AVCaptureDevice.requestAccess(for: .audio)
    }
    if openingSettings && !granted { NSWorkspace.shared.open(settingsURL) }
  }

  /// What the config needs and this process lacks.
  static func missing(for config: RecorderConfig) -> [Permission] {
    needed(camera: config.camera != nil, mic: config.mic != nil).filter { !$0.granted }
  }

  static var grantedNow: Set<Permission> { Set(allCases.filter(\.granted)) }
}

/// The permissions a new process of this app holds: the recorder's own binary run with `--granted`, which macOS
/// attributes to this app, and which reads the grants as they stand now. None when the child can't run.
func grantedInFreshProcess() -> Set<Permission> {
  let child = Process()
  child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
  child.arguments = ["--granted"]
  let pipe = Pipe()
  child.standardOutput = pipe
  guard (try? child.run()) != nil else { return [] }
  child.waitUntilExit()
  let data = pipe.fileHandleForReading.readDataToEndOfFile()
  return Set((try? JSONDecoder().decode([Permission].self, from: data)) ?? [])
}

func printGrantedPermissions() {
  print(String(data: try! JSONEncoder().encode(Permission.allCases.filter(\.granted)), encoding: .utf8)!)
}

/// Opens a new copy of the app; `failed` hears why it couldn't. On success this copy quits.
@MainActor
func relaunch(failed: @escaping @MainActor (String) -> Void) {
  let configuration = NSWorkspace.OpenConfiguration()
  configuration.createsNewApplicationInstance = true
  NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration) { _, error in
    DispatchQueue.main.async {
      if let error { failed(error.localizedDescription) } else { NSApp.terminate(nil) }
    }
  }
}
