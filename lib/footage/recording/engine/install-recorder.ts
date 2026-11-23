// Builds the native recorder (recorder/, a Swift package) into ~/Applications/Studio Recorder.app and starts it.
// It's an app bundle signed with an Apple Development identity, not a bare binary, because macOS keys Screen
// Recording, Camera, Microphone and Input Monitoring grants to the signer and bundle id: they then survive rebuilds.
//
// A sequence, not a lifecycle: each step runs once, in order, and the first failure ends the install.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Config, Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { STUDIO_CHILD_PROCESS } from '#lib/platform/process/engine/studio-child-process.ts';
import { toolStderrReason } from '#lib/platform/process/models/tool-stderr-reason.ts';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { RECORDER_DISPLAY_NAME, RECORDER_EXECUTABLE_NAME, recorderBundlePropertyList } from '../models/recorder-app-bundle.ts';

const RECORDER_PACKAGE_DIR = join(import.meta.dirname, 'recorder');
const RECORDER_APP_PATH = join(homedir(), 'Applications', `${RECORDER_DISPLAY_NAME}.app`);

/** The keychain holds no Apple Development identity to sign with, and none was named. */
export class NoAppleDevelopmentIdentity extends Schema.TaggedError<NoAppleDevelopmentIdentity>()('NoAppleDevelopmentIdentity', {}) {
  override get message(): string {
    return 'no Apple Development signing identity in the keychain: the recorder needs one so its permissions survive rebuilds (Xcode › Settings › Accounts)';
  }
}

/**
 * A tool the install runs exited non-zero or couldn't start. `reason` says why when the install read its output;
 * otherwise its output, inherited by the terminal, does.
 */
export class RecorderInstallStepFailed extends Schema.TaggedError<RecorderInstallStepFailed>()('RecorderInstallStepFailed', {
  step: Schema.Literals(['swift build', 'security find-identity', 'codesign', 'open']),
  exitCode: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return this.exitCode === undefined
      ? `${this.step} couldn't start${this.reason ? `: ${this.reason}` : ''}`
      : `${this.step} exited with ${this.exitCode}: ${this.reason ?? 'its output above says why'}`;
  }
}

const APPLE_DEVELOPMENT_IDENTITY = /^\s*\d+\)\s+([0-9A-F]{40})\s+"Apple Development:/m;

/** Runs a step whose output goes straight to the terminal; fails unless it exits 0. */
const runInstallStep = Effect.fn('RecorderInstall.runStep')(function* (step: RecorderInstallStepFailed['step'], command: ChildProcess.Command) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* spawner.exitCode(command).pipe(Effect.mapError((error) => new RecorderInstallStepFailed({ step, reason: error.message })));
  if (exitCode !== 0) yield* new RecorderInstallStepFailed({ step, exitCode });
});

const inheritOutput = { ...STUDIO_CHILD_PROCESS, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' } as const;

/** The first Apple Development signing identity in the login keychain, by its SHA-1. */
const appleDevelopmentIdentity = Effect.fn('RecorderInstall.appleDevelopmentIdentity')(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const step = 'security find-identity';
  const couldntStart = (error: { readonly message: string }) => new RecorderInstallStepFailed({ step, reason: error.message });
  const handle = yield* spawner.spawn(ChildProcess.make('security', ['find-identity', '-v', '-p', 'codesigning'], STUDIO_CHILD_PROCESS)).pipe(Effect.mapError(couldntStart));
  const [identities, stderr, exitCode] = yield* Effect.all([
    handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
    handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
    handle.exitCode,
  ], { concurrency: 'unbounded' }).pipe(Effect.mapError(couldntStart));
  // A locked or missing keychain fails here; it isn't the same as a keychain holding no identity.
  if (exitCode !== 0) return yield* new RecorderInstallStepFailed({ step, exitCode, reason: toolStderrReason(stderr) || 'it printed nothing' });
  const match = APPLE_DEVELOPMENT_IDENTITY.exec(identities);
  if (!match) return yield* new NoAppleDevelopmentIdentity();
  return match[1];
}, Effect.scoped);

/** Writes the app bundle from the release build: its executable, Info.plist and Resources, over any older one. */
const writeRecorderAppBundle = Effect.fn('RecorderInstall.writeAppBundle')(function* () {
  const fs = yield* FileSystem.FileSystem;
  const shellPath = yield* Config.String('PATH').pipe(Config.withDefault('/usr/bin:/bin'));
  const contents = join(RECORDER_APP_PATH, 'Contents');
  yield* fs.remove(RECORDER_APP_PATH, { recursive: true, force: true });
  yield* fs.makeDirectory(join(contents, 'MacOS'), { recursive: true });
  yield* fs.copyFile(join(RECORDER_PACKAGE_DIR, '.build', 'release', RECORDER_EXECUTABLE_NAME), join(contents, 'MacOS', RECORDER_EXECUTABLE_NAME));
  yield* fs.writeFileString(join(contents, 'Info.plist'), recorderBundlePropertyList({ studioRoot: STUDIO_ROOT, nodePath: process.execPath, shellPath }));
  // Resources/ isn't a SwiftPM resource bundle: the app reads its icon and menu-bar glyphs from Contents/Resources.
  const resources = join(contents, 'Resources');
  yield* fs.makeDirectory(resources);
  yield* fs.copyFile(join(RECORDER_PACKAGE_DIR, 'Resources', 'AppIcon.icns'), join(resources, 'AppIcon.icns'));
  yield* fs.copy(join(RECORDER_PACKAGE_DIR, 'Resources', 'menu-bar'), join(resources, 'menu-bar'));
});

/** Builds, bundles, signs and installs the recorder, quitting a running one first; returns the app's path. */
export const installStudioRecorder = Effect.fn('RecorderInstall.install')(function* (options: { readonly identity?: string; readonly launch: boolean }) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* runInstallStep('swift build', ChildProcess.make('swift', ['build', '-c', 'release', '--package-path', RECORDER_PACKAGE_DIR], inheritOutput));
  // pkill exits 1 when no recorder is running, which is as good as quitting one.
  yield* spawner.exitCode(ChildProcess.make('pkill', ['-x', RECORDER_EXECUTABLE_NAME], STUDIO_CHILD_PROCESS));
  yield* writeRecorderAppBundle();
  const identity = options.identity ?? (yield* appleDevelopmentIdentity());
  yield* runInstallStep('codesign', ChildProcess.make('codesign', ['--force', '--sign', identity, RECORDER_APP_PATH], inheritOutput));
  if (options.launch) yield* runInstallStep('open', ChildProcess.make('open', [RECORDER_APP_PATH], inheritOutput));
  return RECORDER_APP_PATH;
});
