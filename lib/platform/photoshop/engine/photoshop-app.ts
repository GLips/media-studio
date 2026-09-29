// photoshop-app.ts: driving Photoshop 2026 on this Mac from Node, with no UI: ExtendScript through `osascript … do
// javascript`, on top of photoshop-actions.jsxinc (vid-100). And keeping Graham's Photoshop exactly as it was.
//
// Photoshop is Graham's own app. A studio run owns the Photoshop it scripts, start to end: it refuses if Photoshop is
// already running (his documents, his state), snapshots the whole settings folder (brush presets in Brushes.psp and
// MRUBrushes.psp, patterns, tool options, recent files and document sizes), launches Photoshop in the background,
// and afterwards closes its own documents unsaved, quits, and puts the settings folder back byte for byte. So what a
// run does to the preset lists in memory (an .abr appended, a probe tip or pattern defined) is written at quit and
// then undone from the snapshot, and nothing is ever deleted from a preset list by script (deleting by index removes
// a different preset than the flat list says; it cost Graham four presets once).
//
// A run that dies before its restore leaves its snapshot marked pending; restorePendingPhotoshopSettings puts it back
// (`npm run photoshop -- restore`), and nothing starts Photoshop while one is pending.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';

export const PHOTOSHOP_BUNDLE_ID = 'com.adobe.Photoshop';
export const PHOTOSHOP_APP = '/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app';
/** Photoshop 2026's own state: the settings folder, and the file beside it naming its preset folders. */
const PREFERENCES = join(homedir(), 'Library/Preferences');
const PHOTOSHOP_SETTINGS_ENTRIES = ['Adobe Photoshop 2026 Settings', 'Adobe Photoshop 2026 Paths'] as const;
/** Where snapshots go: outside work/ and the temp dir, so one survives a crashed run to be restored. */
export const PHOTOSHOP_SETTINGS_BACKUPS = join(homedir(), 'Library/Application Support/media-studio/photoshop-settings');

const ACTIONS = readFileSync(new URL('./photoshop-actions.jsxinc', import.meta.url), 'utf8');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function osascript(lines: readonly string[]): string {
  return execFileSync('osascript', lines.flatMap((line) => ['-e', line]), { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
}

export function photoshopIsRunning(): boolean {
  return osascript([`application id "${PHOTOSHOP_BUNDLE_ID}" is running`]) === 'true';
}

/**
 * Runs `body` inside Photoshop after photoshop-actions.jsxinc, and returns the value of its last expression as text.
 * `data` is in scope as the global `JOB`, written as a literal. A script error throws with Photoshop's message and line.
 */
export function runPhotoshopScript(body: string, { data, timeoutSeconds = 600 }: { data?: unknown; timeoutSeconds?: number } = {}): string {
  return withStudioTemp('photoshop-script', (dir) => {
    const file = join(dir, 'script.jsx');
    // The byte order mark makes ExtendScript read the file as UTF-8, so a brush's non-ASCII name in JOB survives.
    writeFileSync(file, `\ufeff${ACTIONS}\nvar JOB = ${JSON.stringify(data ?? null)};\n${body}\n`);
    return osascript([
      `with timeout of ${timeoutSeconds} seconds`,
      `tell application id "${PHOTOSHOP_BUNDLE_ID}" to do javascript "$.evalFile(File('${file}'))"`,
      'end timeout',
    ]);
  });
}

async function waitFor(what: string, seconds: number, ready: () => boolean): Promise<void> {
  const until = Date.now() + seconds * 1000;
  while (!ready()) {
    if (Date.now() > until) throw new Error(`photoshop: ${what} after ${seconds} s`);
    await sleep(1000);
  }
}

// Asked bare, not through runPhotoshopScript, so a fault in the studio's own scripts can't read as a Photoshop still starting.
const scriptable = () => {
  try {
    return osascript(['with timeout of 10 seconds', `tell application id "${PHOTOSHOP_BUNDLE_ID}" to do javascript "app.version"`, 'end timeout']) !== '';
  } catch {
    return false;
  }
};

/** Launches Photoshop in the background (`open -g`, so it doesn't take focus) and waits until it takes scripts. */
async function launchPhotoshop(): Promise<void> {
  execFileSync('open', ['-g', '-b', PHOTOSHOP_BUNDLE_ID]);
  await waitFor('still not taking scripts', 180, scriptable);
}

/** Closes every open document unsaved (they're all the run's own), then quits and waits for Photoshop to exit. */
async function quitPhotoshop(): Promise<void> {
  if (photoshopIsRunning()) {
    // Unsaved documents would make quit ask whether to save them: a dialog.
    runPhotoshopScript('while (app.documents.length) app.documents[0].close(SaveOptions.DONOTSAVECHANGES); "closed"', { timeoutSeconds: 120 });
    osascript([`tell application id "${PHOTOSHOP_BUNDLE_ID}" to quit`]);
  }
  await waitFor('still running after quit', 180, () => !photoshopIsRunning());
}

type SettingsSnapshot = { takenAt: string; files: Record<string, string> };

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Every file under Photoshop's settings entries, by its path relative to ~/Library/Preferences, with its hash. */
function hashPhotoshopSettings(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (path: string) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) for (const entry of readdirSync(path)) walk(join(path, entry));
    else files[relative(root, path)] = sha256(path);
  };
  for (const entry of PHOTOSHOP_SETTINGS_ENTRIES) walk(join(root, entry));
  return files;
}

/** Snapshots that were never restored, oldest first. */
export function pendingPhotoshopSettingsBackups(): string[] {
  if (!existsSync(PHOTOSHOP_SETTINGS_BACKUPS)) return [];
  return readdirSync(PHOTOSHOP_SETTINGS_BACKUPS).sort().map((name) => join(PHOTOSHOP_SETTINGS_BACKUPS, name))
    .filter((dir) => existsSync(join(dir, 'snapshot.json')) && !existsSync(join(dir, 'restored.json')));
}

function snapshotPhotoshopSettings(run: string): string {
  const dir = join(PHOTOSHOP_SETTINGS_BACKUPS, run);
  mkdirSync(join(dir, 'files'), { recursive: true });
  for (const entry of PHOTOSHOP_SETTINGS_ENTRIES) {
    if (existsSync(join(PREFERENCES, entry))) cpSync(join(PREFERENCES, entry), join(dir, 'files', entry), { recursive: true, preserveTimestamps: true });
  }
  const snapshot: SettingsSnapshot = { takenAt: new Date().toISOString(), files: hashPhotoshopSettings(join(dir, 'files')) };
  if (JSON.stringify(snapshot.files) !== JSON.stringify(hashPhotoshopSettings(PREFERENCES))) throw new Error(`photoshop: the settings changed while ${dir} was being taken`);
  writeFileSync(join(dir, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  return dir;
}

export type PhotoshopSettingsRestore = { backup: string; files: number; rewritten: string[]; removed: string[] };

/**
 * Puts Photoshop's settings back from `backup` with Photoshop not running: every snapshotted file rewritten whose
 * bytes differ (its timestamps kept), every file the run added removed, then every file hashed against the snapshot.
 */
export function restorePhotoshopSettings(backup: string): PhotoshopSettingsRestore {
  if (photoshopIsRunning()) throw new Error('photoshop: quit Photoshop before its settings are restored');
  const snapshot = JSON.parse(readFileSync(join(backup, 'snapshot.json'), 'utf8')) as SettingsSnapshot;
  const now = hashPhotoshopSettings(PREFERENCES);
  const rewritten: string[] = [], removed: string[] = [];
  for (const [file, hash] of Object.entries(snapshot.files)) {
    if (now[file] === hash) continue;
    const from = join(backup, 'files', file), to = join(PREFERENCES, file);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { preserveTimestamps: true });
    const { atime, mtime } = statSync(from);
    utimesSync(to, atime, mtime);
    rewritten.push(file);
  }
  for (const file of Object.keys(now)) {
    if (file in snapshot.files) continue;
    rmSync(join(PREFERENCES, file));
    removed.push(file);
    // A folder the run made, now empty, goes too.
    for (let d = dirname(join(PREFERENCES, file)); d !== PREFERENCES && readdirSync(d).length === 0; d = dirname(d)) rmdirSync(d);
  }
  const after = hashPhotoshopSettings(PREFERENCES);
  const wrong = [...new Set([...Object.keys(after), ...Object.keys(snapshot.files)])].filter((file) => after[file] !== snapshot.files[file]);
  if (wrong.length) throw new Error(`photoshop: after restoring ${backup}, these differ from the snapshot: ${wrong.join(', ')}`);
  const restore = { backup, files: Object.keys(after).length, rewritten, removed };
  writeFileSync(join(backup, 'restored.json'), `${JSON.stringify({ restoredAt: new Date().toISOString(), ...restore }, null, 2)}\n`);
  return restore;
}

export function restorePendingPhotoshopSettings(): PhotoshopSettingsRestore[] {
  // The oldest snapshot is the state before any of the runs, so it's the one that counts; restore it last.
  return pendingPhotoshopSettingsBackups().reverse().map(restorePhotoshopSettings);
}

export type PhotoshopSession = { run: string; backup: string; version: string };

/**
 * Runs `step` against a Photoshop this run launched, and afterwards quits it and restores the settings snapshot,
 * however `step` ends. Refuses to start while Photoshop is running or a snapshot is pending.
 */
export async function withOwnedPhotoshop<T>(run: string, step: (session: PhotoshopSession) => Promise<T> | T, log: (line: string) => void): Promise<{ result: T; restore: PhotoshopSettingsRestore }> {
  if (!existsSync(PHOTOSHOP_APP)) throw new Error(`photoshop: no Photoshop 2026 at ${PHOTOSHOP_APP}`);
  if (photoshopIsRunning()) throw new Error("photoshop: Photoshop is open. It's Graham's: save and quit it, and the run launches its own and puts his settings back after");
  const pending = pendingPhotoshopSettingsBackups();
  if (pending.length) throw new Error(`photoshop: a run's settings snapshot was never restored (${pending.join(', ')}); run \`npm run photoshop -- restore\` first`);
  const backup = snapshotPhotoshopSettings(run);
  log(`photoshop: settings snapshot in ${backup}`);
  let result: T;
  try {
    await launchPhotoshop();
    const version = runPhotoshopScript('app.version');
    log(`photoshop: Photoshop ${version} launched`);
    result = await step({ run, backup, version });
  } finally {
    await quitPhotoshop();
    const restore = restorePhotoshopSettings(backup);
    log(`photoshop: quit; settings restored and checked byte for byte (${restore.files} files, ${restore.rewritten.length} rewritten, ${restore.removed.length} removed)`);
  }
  return { result, restore: JSON.parse(readFileSync(join(backup, 'restored.json'), 'utf8')) as PhotoshopSettingsRestore };
}

export type PhotoshopCheck = { ok: boolean; lines: string[] };

/** Whether a run could start now, and why not: nothing here changes Photoshop or its settings. */
export function checkPhotoshop(): PhotoshopCheck {
  const lines: string[] = [];
  let ok = true;
  const fail = (line: string) => { ok = false; lines.push(`✗ ${line}`); };
  if (!existsSync(PHOTOSHOP_APP)) fail(`no Photoshop 2026 at ${PHOTOSHOP_APP}`);
  else {
    const version = spawnSync('defaults', ['read', join(PHOTOSHOP_APP, 'Contents/Info.plist'), 'CFBundleShortVersionString'], { encoding: 'utf8' }).stdout.trim();
    lines.push(`✓ Photoshop ${version} installed`);
  }
  const settings = join(PREFERENCES, PHOTOSHOP_SETTINGS_ENTRIES[0]);
  for (const file of ['Brushes.psp', 'MRUBrushes.psp']) {
    if (existsSync(join(settings, file))) lines.push(`✓ ${file} present, ${statSync(join(settings, file)).size} bytes: snapshotted and put back byte for byte`);
    else lines.push(`· no ${file} yet: Photoshop writes it on quit, and the restore removes it again`);
  }
  const pending = pendingPhotoshopSettingsBackups();
  if (pending.length) fail(`a settings snapshot was never restored: ${pending.join(', ')}; run \`npm run photoshop -- restore\``);
  if (photoshopIsRunning()) {
    let documents = '?';
    try {
      documents = runPhotoshopScript('app.documents.length', { timeoutSeconds: 10 });
    } catch {
      // A modal dialog or a busy Photoshop doesn't answer; saying so is the check's job, not a failure of it.
      documents = 'unknown (Photoshop isn\'t answering scripts: a dialog may be open)';
    }
    fail(`Photoshop is open (${documents} documents): it's Graham's, so a run won't touch it. Save and quit it first`);
  } else lines.push('✓ Photoshop is not running: a run launches its own in the background and quits it after');
  return { ok, lines };
}
