// Studio Recorder: a menu-bar app with no window. One global key starts a recording of screen, camera, mic and
// input log, and stops it; the menu-bar dot is red while it records.
//
//   StudioRecorder                         the menu-bar app (run as its app bundle, so permissions stick)
//   StudioRecorder --record-seconds 60     record once for 60 s and exit; SIGINT/SIGTERM stop it early
//   StudioRecorder --granted               print the permissions a fresh process holds, as JSON (see Permissions.swift)
//   StudioRecorder --check-inputs 5        log what the menu's live check sees of the picked inputs for 5 s, and exit;
//                                          run it through the bundle (`open -a … --args`) so it holds the app's grants
//   --config <path>                        another config file than ~/Library/Application Support/StudioRecorder/config.json
import AppKit
import AVFoundation
import RecorderCore

final class RecorderAppDelegate: NSObject, NSApplicationDelegate {
  let app: RecorderApp
  init(app: RecorderApp) { self.app = app }

  /// Quits now unless a take is under way; the machine finishes it first and then replies.
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    MainActor.assumeIsolated {
      app.send(.quitRequested)
      if case .exited = app.state.phase { return .terminateNow }
      return .terminateLater
    }
  }
}

let arguments = CommandLine.arguments
func argument(_ name: String) -> String? {
  arguments.firstIndex(of: name).flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }
}

if arguments.contains("--granted") {
  printGrantedPermissions()
  exit(0)
}

let configURL = argument("--config").map { URL(fileURLWithPath: $0) } ?? RecorderConfig.defaultURL
let config: RecorderConfig
do {
  config = try RecorderConfig.load(from: configURL)
} catch {
  log("config: \(error)")
  exit(1)
}

let nsApp = NSApplication.shared
nsApp.setActivationPolicy(.accessory)
var keepAlive: [AnyObject] = []

/// Each signal becomes an event; ignoring its default action first keeps the process alive to finish a take.
@MainActor
func onSignals(_ signals: [Int32], _ handler: @escaping @MainActor () -> Void) {
  for signal in signals {
    Foundation.signal(signal, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signal, queue: .main)
    source.setEventHandler { MainActor.assumeIsolated { handler() } }
    source.resume()
    keepAlive.append(source)
  }
}

if let seconds = argument("--check-inputs").flatMap(Double.init) {
  MainActor.assumeIsolated {
    let check = InputCheck(pictureRenderer: AVSampleBufferVideoRenderer())
    log("inputs: mics \(RecorderInputs.mics().map(\.localizedName)), cameras \(RecorderInputs.cameras().map(\.localizedName)), screens \(RecorderInputs.screens().map(\.localizedName))")
    log("inputs: picked mic \(config.mic?.device ?? "off"), camera \(config.camera?.device ?? "off"), screen \(RecorderInputs.screen(named: config.screen.display)?.localizedName ?? "none")")
    check.start(config: config)
    let ticks = Timer(timeInterval: 0.5, repeats: true) { _ in
      MainActor.assumeIsolated { log("inputs: mic \(check.micSignal), camera \(check.picture)") }
    }
    RunLoop.main.add(ticks, forMode: .common)
    keepAlive.append(ticks)
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
      check.stop()
      check.awaitDevicesReleased()
      exit(0)
    }
  }
} else if let seconds = argument("--record-seconds").flatMap(Double.init) {
  // One take, then exit: how the sync and crash tests run without the menu bar.
  MainActor.assumeIsolated {
    let app = RecorderApp(config: config, configURL: configURL, launch: RecorderState.launchOneTake(), oneTakeSeconds: seconds)
    keepAlive.append(app)
    onSignals([SIGINT, SIGTERM]) { app.send(.stopRequested) }
    app.start()
  }
} else {
  MainActor.assumeIsolated {
    let app = RecorderApp(config: config, configURL: configURL, launch: RecorderState.launch(missing: Permission.missing(for: config)))
    let delegate = RecorderAppDelegate(app: app)
    nsApp.delegate = delegate
    keepAlive.append(delegate)
    // pkill (a reinstall) quits the way the menu does, finishing a take first.
    onSignals([SIGTERM]) { NSApp.terminate(nil) }
    keepAlive.append(MenuBarDot(app: app))
    do {
      keepAlive.append(try HotKey(config.hotkey) { MainActor.assumeIsolated { app.send(.toggleRequested) } })
    } catch {
      log("\(error)")
    }
    app.start()
  }
}
nsApp.run()
