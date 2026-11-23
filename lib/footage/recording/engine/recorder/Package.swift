// swift-tools-version:6.0
import PackageDescription

// RecorderCore is the pure part: the recorder's lifecycle machine, its failures and the files it writes, with no
// AppKit or AVFoundation, so `swift test` checks it without touching a device.
let package = Package(
  name: "StudioRecorder",
  platforms: [.macOS("15.2")],
  targets: [
    .target(name: "RecorderCore", path: "Sources/RecorderCore"),
    .executableTarget(
      name: "StudioRecorder",
      dependencies: ["RecorderCore"],
      path: "Sources/StudioRecorder",
      swiftSettings: [.swiftLanguageMode(.v5)],
      linkerSettings: [.linkedFramework("ScreenCaptureKit"), .linkedFramework("Carbon")]
    ),
    .testTarget(name: "RecorderCoreTests", dependencies: ["RecorderCore"], path: "Tests/RecorderCoreTests"),
  ]
)
