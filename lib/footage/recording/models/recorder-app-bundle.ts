// recorder-app-bundle.ts: what Studio Recorder.app says about itself in its Info.plist, the recorder's names and the
// studio commands it runs. Pure: the installer passes in the machine's facts (this checkout,
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
 * The studio commands the recorder runs, by their Info.plist key, with a folder or item id appended where noted. They run this
 * checkout's CLI under this node, with this shell's PATH, since an app launchd starts has no ffmpeg on its own PATH.
 * Reinstall after moving the checkout.
 */
export const recorderStudioCommands = (host: RecorderInstallHost) => {
  const studio = ['/usr/bin/env', `PATH=${host.shellPath}`, host.nodePath, `${host.studioRoot}/cli/studio.ts`];
  return {
    // A finished take's folder (LibraryHandoff.swift). No proxies: their hardware encodes would compete with the next
    // take's; `studio library finish` makes them.
    StudioLibraryAdd: [...studio, 'library', 'add', '--move', '--no-proxies'],
    // The recordings folder: the menu's recent takes, wherever they went.
    StudioLibraryRecordings: [...studio, 'library', 'recordings', '--json', '--limit', '5', '--inbox'],
    // An item id: the menu opens a recent take that's in the library on its page in the studio app.
    StudioLibraryOpen: [...studio, 'library', 'open'],
    // The menu's Studio App section, with nothing appended: where the app stands as the menu opens, and its items.
    StudioAppStatus: [...studio, 'app', 'status', '--json'],
    StudioAppStart: [...studio, 'app', 'start'],
    StudioAppStop: [...studio, 'app', 'stop'],
    StudioAppOpen: [...studio, 'app', 'open'],
  } satisfies Readonly<Record<string, readonly string[]>>;
};

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
  <key>LSMinimumSystemVersion</key><string>15.2</string>
  <key>LSUIElement</key><true/>
  <key>NSCameraUsageDescription</key><string>Records the camera as its own track.</string>
  <key>NSMicrophoneUsageDescription</key><string>Records the mic as its own track.</string>
${Object.entries(recorderStudioCommands(host)).map(([key, command]) => `  <key>${key}</key><array>${command.map((arg) => `<string>${xmlText(arg)}</string>`).join('')}</array>\n`).join('')}</dict>
</plist>
`;
