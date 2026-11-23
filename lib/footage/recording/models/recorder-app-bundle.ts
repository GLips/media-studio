// recorder-app-bundle.ts: what Studio Recorder.app says about itself in its Info.plist, the recorder's names and the
// command it hands each finished recording to. Pure: the installer passes in the machine's facts (this checkout,
// this node, this shell's PATH) and writes the text.

/** The one place the recorder's name is set: its app, menu, tooltips and About read it from the bundle. */
export const RECORDER_DISPLAY_NAME = 'Studio Recorder';
/** The SwiftPM product and the bundle's executable; `pkill -x` finds a running recorder by it. */
export const RECORDER_EXECUTABLE_NAME = 'StudioRecorder';
/** macOS keys the recorder's Screen Recording, Camera, Mic and Input Monitoring grants to this id and the signer. */
const RECORDER_BUNDLE_ID = 'studio.media.recorder';

/** The machine the recorder is installed from: the checkout whose CLI it hands recordings to, under which node and PATH. */
export interface RecorderInstallHost {
  readonly studioRoot: string;
  readonly nodePath: string;
  readonly shellPath: string;
}

/**
 * How the recorder hands a finished recording to the library (LibraryHandoff.swift appends the take's folder): this
 * checkout's CLI under this node, with this shell's PATH, since an app launchd starts has no ffmpeg on its own PATH.
 * Reinstall after moving the checkout. No proxies: their hardware encodes would compete with the next take's;
 * `studio library finish` makes them.
 */
export const recorderLibraryAddCommand = (host: RecorderInstallHost): readonly string[] => [
  '/usr/bin/env', `PATH=${host.shellPath}`, host.nodePath, `${host.studioRoot}/cli/studio.ts`, 'library', 'add', '--move', '--no-proxies',
];

const xmlText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Contents/Info.plist for Studio Recorder.app installed from `host`. */
export const recorderBundlePropertyList = (host: RecorderInstallHost): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>${RECORDER_BUNDLE_ID}</string>
  <key>CFBundleName</key><string>${RECORDER_DISPLAY_NAME}</string>
  <key>CFBundleDisplayName</key><string>${RECORDER_DISPLAY_NAME}</string>
  <key>CFBundleExecutable</key><string>${RECORDER_EXECUTABLE_NAME}</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>LSUIElement</key><true/>
  <key>NSCameraUsageDescription</key><string>Records the camera as its own track.</string>
  <key>NSMicrophoneUsageDescription</key><string>Records the mic as its own track.</string>
  <key>StudioLibraryAdd</key><array>${recorderLibraryAddCommand(host).map((arg) => `<string>${xmlText(arg)}</string>`).join('')}</array>
</dict>
</plist>
`;
