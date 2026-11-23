// swift-tools-version:6.0
import PackageDescription

let package = Package(
  name: "StudioRecorder",
  platforms: [.macOS(.v15)],
  targets: [
    .executableTarget(
      name: "StudioRecorder",
      path: "Sources/StudioRecorder",
      swiftSettings: [.swiftLanguageMode(.v5)],
      linkerSettings: [.linkedFramework("ScreenCaptureKit"), .linkedFramework("Carbon")]
    )
  ]
)
