// The system's window and display picker (ScreenCaptureKit's SCContentSharingPicker): thumbnails of every window and
// display, picked by clicking. It runs only while the machine is `pickingScreen`; what's picked is kept as a choice in
// config.json, never as a filter, so each take opens its own stream on whatever is picked.
import AppKit
import RecorderCore
import ScreenCaptureKit

@MainActor
final class ScreenPicker: NSObject, SCContentSharingPickerObserver {
  private let send: (RecorderEvent<Recording>) -> Void
  private var observing = false

  init(send: @escaping (RecorderEvent<Recording>) -> Void) {
    self.send = send
  }

  func present() {
    let picker = SCContentSharingPicker.shared
    var configuration = SCContentSharingPickerConfiguration()
    // Browser tabs and whole apps aren't offered: a take records one window or one display.
    configuration.allowedPickerModes = [.singleWindow, .singleDisplay]
    configuration.excludedBundleIDs = Bundle.main.bundleIdentifier.map { [$0] } ?? []
    configuration.allowsChangingSelectedContent = false
    picker.defaultConfiguration = configuration
    if !observing {
      picker.add(self)
      observing = true
    }
    // Active only while picking: an active picker puts the app in the menu bar's screen-sharing menu.
    picker.isActive = true
    NSApp.activate()
    picker.present()
  }

  func dismiss() {
    SCContentSharingPicker.shared.isActive = false
  }

  nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
    let picked = PickedContent(filter)
    DispatchQueue.main.async {
      let choice = picked?.choice
      self.dismiss()
      self.send(choice.map { .screenPickerChose($0) } ?? .screenPickerClosed(failure: "it picked neither a window nor a display"))
    }
  }

  nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
    DispatchQueue.main.async {
      self.dismiss()
      self.send(.screenPickerClosed(failure: nil))
    }
  }

  nonisolated func contentSharingPickerStartDidFailWithError(_ error: any Error) {
    let reason = error.localizedDescription
    DispatchQueue.main.async {
      self.dismiss()
      self.send(.screenPickerClosed(failure: reason))
    }
  }
}

/// What the picker picked, read off its filter where it arrives, so only plain values cross to the main thread.
private enum PickedContent: Sendable {
  case window(id: CGWindowID, title: String, app: String, frame: CGRect)
  case display(CGDirectDisplayID)

  init?(_ filter: SCContentFilter) {
    switch filter.style {
    case .window:
      guard let window = filter.includedWindows.first else { return nil }
      self = .window(id: window.windowID, title: window.title ?? "", app: window.owningApplication?.applicationName ?? "", frame: window.frame)
    case .display:
      guard let display = filter.includedDisplays.first else { return nil }
      self = .display(display.displayID)
    default:
      return nil
    }
  }

  @MainActor var choice: RecorderScreenChoice {
    switch self {
    case .window(let id, let title, let app, let frame):
      .window(RecorderWindowChoice(id: id, title: title, app: app, display: displayName(holding: frame)))
    case .display(let id):
      .display(name: displayName(of: id))
    }
  }
}

/// The name System Settings gives a display, as the config names one.
@MainActor
func displayName(of displayID: CGDirectDisplayID) -> String {
  NSScreen.screens.first { $0.displayID == displayID }?.localizedName ?? "main"
}

/// The display holding the middle of `frame`, in global points (origin at the main display's top left, y down).
@MainActor
func displayName(holding frame: CGRect) -> String {
  let middle = CGPoint(x: frame.midX, y: frame.midY)
  let held = NSScreen.screens.compactMap(\.displayID).first { CGDisplayBounds($0).contains(middle) }
  return held.map(displayName(of:)) ?? "main"
}
