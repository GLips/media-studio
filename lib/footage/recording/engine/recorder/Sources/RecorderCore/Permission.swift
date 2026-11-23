// The four permissions a recording needs. The app asks for each itself, so each is one click from a prompt it raised;
// reading and raising them is the app's (StudioRecorder/Permissions.swift).
import Foundation

public enum Permission: String, CaseIterable, Codable, Sendable {
  case screen, input, camera, microphone

  public var title: String {
    switch self {
    case .screen: "Screen Recording"
    case .input: "Input Monitoring"
    case .camera: "Camera"
    case .microphone: "Microphone"
    }
  }

  /// Screen Recording and Input Monitoring take effect only in a new process: the app relaunches on each new grant.
  public var takesEffectOnRelaunch: Bool { self == .screen || self == .input }

  /// What a config records with needs: always the screen and the input log, and the camera and mic if it has them.
  public static func needed(camera: Bool, mic: Bool) -> [Permission] {
    [.screen, .input] + (camera ? [.camera] : []) + (mic ? [.microphone] : [])
  }
}
