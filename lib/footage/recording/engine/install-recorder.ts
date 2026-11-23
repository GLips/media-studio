// Builds the native recorder (recorder/, a Swift package) into ~/Applications/Studio Recorder.app and starts it.
// It's an app bundle signed with an Apple Development identity, not a bare binary, because macOS keys Screen
// Recording, Camera, Microphone and Input Monitoring grants to the signer and bundle id: they then survive rebuilds.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';

const RECORDER_PACKAGE_DIR = join(import.meta.dirname, 'recorder');
const RECORDER_BUNDLE_ID = 'studio.media.recorder';
/** The one place the recorder's name is set: its app, menu, tooltips and About read it from the bundle. */
const RECORDER_DISPLAY_NAME = 'Studio Recorder';
export const RECORDER_APP_PATH = join(homedir(), 'Applications', `${RECORDER_DISPLAY_NAME}.app`);

/**
 * How the recorder hands a finished recording to the library (LibraryHandoff.swift): this checkout's CLI under this
 * node, with this shell's PATH, since an app launchd starts has no ffmpeg on its own PATH. Reinstall after moving
 * the checkout. No proxies: their hardware encodes would compete with the next take's; `studio library finish` makes them.
 */
const studioLibraryAddCommand = () => [
  '/usr/bin/env', `PATH=${process.env.PATH ?? '/usr/bin:/bin'}`, process.execPath, join(STUDIO_ROOT, 'cli', 'studio.ts'), 'library', 'add', '--move', '--no-proxies',
];

const xmlText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const recorderBundlePropertyList = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>${RECORDER_BUNDLE_ID}</string>
  <key>CFBundleName</key><string>${RECORDER_DISPLAY_NAME}</string>
  <key>CFBundleDisplayName</key><string>${RECORDER_DISPLAY_NAME}</string>
  <key>CFBundleExecutable</key><string>StudioRecorder</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>LSUIElement</key><true/>
  <key>NSCameraUsageDescription</key><string>Records the camera as its own track.</string>
  <key>NSMicrophoneUsageDescription</key><string>Records the mic as its own track.</string>
  <key>StudioLibraryAdd</key><array>${studioLibraryAddCommand().map((arg) => `<string>${xmlText(arg)}</string>`).join('')}</array>
</dict>
</plist>
`;

/** The first Apple Development signing identity in the login keychain, by its SHA-1. */
function appleDevelopmentIdentity(): string {
  const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  const match = /^\s*\d+\)\s+([0-9A-F]{40})\s+"Apple Development:/m.exec(identities);
  if (!match) throw new Error('no Apple Development signing identity in the keychain: the recorder needs one so its permissions survive rebuilds (Xcode › Settings › Accounts)');
  return match[1];
}

/** Builds, bundles, signs and installs the recorder, quitting a running one first; returns the app's path. */
export function installStudioRecorder(options: { identity?: string; launch: boolean }): string {
  execFileSync('swift', ['build', '-c', 'release', '--package-path', RECORDER_PACKAGE_DIR], { stdio: ['ignore', 'inherit', 'inherit'] });
  spawnSync('pkill', ['-x', 'StudioRecorder']);
  rmSync(RECORDER_APP_PATH, { recursive: true, force: true });
  const macos = join(RECORDER_APP_PATH, 'Contents', 'MacOS');
  mkdirSync(macos, { recursive: true });
  cpSync(join(RECORDER_PACKAGE_DIR, '.build', 'release', 'StudioRecorder'), join(macos, 'StudioRecorder'));
  writeFileSync(join(RECORDER_APP_PATH, 'Contents', 'Info.plist'), recorderBundlePropertyList());
  // Resources/ isn't a SwiftPM resource bundle: the app reads its icon and menu-bar glyphs from Contents/Resources.
  const resources = join(RECORDER_APP_PATH, 'Contents', 'Resources');
  cpSync(join(RECORDER_PACKAGE_DIR, 'Resources', 'AppIcon.icns'), join(resources, 'AppIcon.icns'));
  cpSync(join(RECORDER_PACKAGE_DIR, 'Resources', 'menu-bar'), join(resources, 'menu-bar'), { recursive: true });
  execFileSync('codesign', ['--force', '--sign', options.identity ?? appleDevelopmentIdentity(), RECORDER_APP_PATH], { stdio: 'inherit' });
  if (options.launch) execFileSync('open', [RECORDER_APP_PATH]);
  return RECORDER_APP_PATH;
}
