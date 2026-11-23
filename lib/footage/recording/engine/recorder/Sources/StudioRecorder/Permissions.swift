// The four permissions a recording needs, asked for by the app itself so each is one click from a prompt it
// raised. Screen Recording and Input Monitoring take effect only in a new process: once both are granted the app
// relaunches itself.
import AppKit
import AVFoundation

enum Permission: String, CaseIterable, Codable {
  case screen, input, camera, microphone

  var title: String {
    switch self {
    case .screen: "Screen Recording"
    case .input: "Input Monitoring"
    case .camera: "Camera"
    case .microphone: "Microphone"
    }
  }

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
}

@MainActor
final class Permissions {
  /// What this process holds; the recorder records only with all four.
  private(set) var missing: [Permission]
  var onChange: (() -> Void)?
  private var poll: Timer?

  init() { missing = Permission.allCases.filter { !$0.granted } }

  /// Asks for each missing permission in turn, then watches for the rest being granted in System Settings.
  func requestMissing() async {
    for permission in missing {
      log("asking for \(permission.title)")
      await permission.request(openingSettings: false)
    }
    refreshCameraAndMic()
    watch()
  }

  func request(_ permission: Permission) async {
    await permission.request(openingSettings: true)
    refreshCameraAndMic()
  }

  /// Camera and mic grants reach this process at once; screen and input wait for the relaunch.
  private func refreshCameraAndMic() {
    let now = missing.filter { $0 == .screen || $0 == .input || !$0.granted }
    if now != missing { missing = now; onChange?() }
  }

  /// Polls a child process for screen and input, which this one can't see change, and relaunches on each new grant.
  /// Nothing records meanwhile (the recorder refuses while anything is missing), so a relaunch never cuts a take.
  private func watch() {
    guard poll == nil, missing.contains(.screen) || missing.contains(.input) else { return }
    poll = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        self.refreshCameraAndMic()
        let fresh = grantedInFreshProcess()
        if let granted = self.missing.first(where: { ($0 == .screen || $0 == .input) && fresh.contains($0) }) {
          log("\(granted.title) granted: relaunching")
          relaunch()
        }
      }
    }
  }
}

/// The permissions a new process of this app holds: the recorder's own binary run with `--granted`, which macOS
/// attributes to this app, and which reads the grants as they stand now.
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
  let granted = Permission.allCases.filter(\.granted)
  print(String(data: try! JSONEncoder().encode(granted), encoding: .utf8)!)
}

@MainActor
func relaunch() {
  let configuration = NSWorkspace.OpenConfiguration()
  configuration.createsNewApplicationInstance = true
  NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration) { _, error in
    if let error { log("relaunch failed: \(error.localizedDescription)"); return }
    DispatchQueue.main.async { NSApp.terminate(nil) }
  }
}
