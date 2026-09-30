// photoshop-app.ts: driving Photoshop 2026 from Node with no UI (ExtendScript via `osascript … do javascript`),
// keeping Graham's Photoshop as it was.
//
// A run owns the Photoshop it scripts: it refuses if Photoshop is already running, snapshots the settings folder
// (Brushes.psp, MRUBrushes.psp, patterns, tool options…), launches it in the background, then quits it and puts back,
// byte for byte, the files it changed. Presets it defines are written at quit, then undone. Never delete from a
// preset list by script: by index it removes a different preset than the flat list says, and cost Graham four
// presets once.
//
// A restore never undoes another session's changes (models/photoshop-settings-restore.ts). A run whose Photoshop is
// in use leaves it running, snapshot pending; nothing starts Photoshop meanwhile.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { planPhotoshopSettingsRestore, type PhotoshopRunExit, type PhotoshopSettingsRestorePlan } from '../models/photoshop-settings-restore.ts';

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

/**
 * Quits Photoshop and waits for it to exit. The run's own documents are closed by the scripts that open them, so a
 * document still open isn't the run's: someone is using this Photoshop (Graham once installed brushes in a run's
 * background Photoshop), and it's left running, never closed unsaved nor killed. So is one that won't quit.
 */
async function quitPhotoshop(): Promise<void> {
  if (!photoshopIsRunning()) return;
  let open: string;
  try {
    open = runPhotoshopScript('app.documents.length', { timeoutSeconds: 60 });
  } catch (error) {
    throw new Error(`photoshop: the run's Photoshop doesn't answer scripts (${(error as Error).message.split('\n')[0]}): someone may be using it, so it's left running`, { cause: error });
  }
  if (open !== '0') throw new Error(`photoshop: the run's Photoshop has ${open} documents open that the run didn't leave: someone is using it, so it's left running`);
  osascript(['with timeout of 60 seconds', `tell application id "${PHOTOSHOP_BUNDLE_ID}" to quit`, 'end timeout']);
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
  return readdirSync(PHOTOSHOP_SETTINGS_BACKUPS).toSorted().map((name) => join(PHOTOSHOP_SETTINGS_BACKUPS, name))
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

export type PhotoshopSettingsRestore = { backup: string; files: number; rewritten: string[]; removed: string[]; kept: string[]; setAside?: string };

const readJson = <T>(file: string) => JSON.parse(readFileSync(file, 'utf8')) as T;
const exitRecord = (backup: string) => (existsSync(join(backup, 'exited.json')) ? readJson<PhotoshopRunExit>(join(backup, 'exited.json')) : undefined);

/** Records the settings as the run's Photoshop left them, as the run sees it exit (photoshop-settings-restore.ts). */
function recordPhotoshopExit(backup: string) {
  const exit: PhotoshopRunExit = { exitedAt: new Date().toISOString(), files: hashPhotoshopSettings(PREFERENCES) };
  writeFileSync(join(backup, 'exited.json'), `${JSON.stringify(exit, null, 2)}\n`);
}

/** What restoring `backup` now would do, or why it won't (photoshop-settings-restore.ts). */
export function planPendingPhotoshopRestore(backup: string, force = false): PhotoshopSettingsRestorePlan {
  const snapshot = readJson<SettingsSnapshot>(join(backup, 'snapshot.json'));
  return planPhotoshopSettingsRestore(snapshot.files, hashPhotoshopSettings(PREFERENCES), { exit: exitRecord(backup), force });
}

/**
 * Puts Photoshop's settings back from `backup`, Photoshop not running, as planPhotoshopSettingsRestore allows: changed
 * files rewritten (timestamps kept), added files removed, each checked by hash. Everything overwritten or removed is
 * first copied to `<backup>/replaced-<time>/`, so a restore can be undone. Files another session changed are kept, and listed.
 */
export function restorePhotoshopSettings(backup: string, { force = false }: { force?: boolean } = {}): PhotoshopSettingsRestore {
  if (photoshopIsRunning()) throw new Error('photoshop: quit Photoshop before its settings are restored');
  const plan = planPendingPhotoshopRestore(backup, force);
  if (plan.refused) throw new Error(`photoshop: won't restore ${backup}: ${plan.refused}`);
  const replaced = [...plan.rewrite, ...plan.remove].filter((file) => existsSync(join(PREFERENCES, file)));
  let setAside: string | undefined;
  if (replaced.length) {
    setAside = join(backup, `replaced-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}`);
    for (const file of replaced) {
      mkdirSync(dirname(join(setAside, file)), { recursive: true });
      cpSync(join(PREFERENCES, file), join(setAside, file), { preserveTimestamps: true });
    }
  }
  for (const file of plan.rewrite) {
    const from = join(backup, 'files', file), to = join(PREFERENCES, file);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { preserveTimestamps: true });
    const { atime, mtime } = statSync(from);
    utimesSync(to, atime, mtime);
  }
  for (const file of plan.remove) {
    rmSync(join(PREFERENCES, file));
    // A folder the run made, now empty, goes too.
    for (let d = dirname(join(PREFERENCES, file)); d !== PREFERENCES && readdirSync(d).length === 0; d = dirname(d)) rmdirSync(d);
  }
  const snapshot = readJson<SettingsSnapshot>(join(backup, 'snapshot.json')), after = hashPhotoshopSettings(PREFERENCES);
  const wrong = [...plan.rewrite, ...plan.remove].filter((file) => after[file] !== snapshot.files[file]);
  if (wrong.length) throw new Error(`photoshop: after restoring ${backup}, these differ from the snapshot: ${wrong.join(', ')}${setAside ? `; what they were is in ${setAside}` : ''}`);
  const restore: PhotoshopSettingsRestore = { backup, files: Object.keys(after).length, rewritten: plan.rewrite, removed: plan.remove, kept: plan.keep, ...(setAside && { setAside }) };
  writeFileSync(join(backup, 'restored.json'), `${JSON.stringify({ restoredAt: new Date().toISOString(), ...restore }, null, 2)}\n`);
  return restore;
}

/** Restores every pending snapshot, as restorePhotoshopSettings allows each. */
export function restorePendingPhotoshopSettings({ force = false }: { force?: boolean } = {}): PhotoshopSettingsRestore[] {
  // The oldest snapshot is the state before any of the runs, so it's the one that counts; restore it last.
  return pendingPhotoshopSettingsBackups().toReversed().map((backup) => restorePhotoshopSettings(backup, { force }));
}

export type PhotoshopSession = { run: string; backup: string; version: string };

/**
 * Runs `step` against a Photoshop this run launched, then quits it and restores the snapshot, however `step` ends.
 * Refuses while Photoshop runs or a snapshot is pending. If its Photoshop can't be quit (someone is using it), the
 * snapshot stays pending with no exit record, and a later restore refuses unless forced: nothing says whose changes
 * the settings then hold.
 */
export async function withOwnedPhotoshop<T>(run: string, step: (session: PhotoshopSession) => Promise<T> | T, log: (line: string) => void): Promise<{ result: T; restore: PhotoshopSettingsRestore }> {
  if (!existsSync(PHOTOSHOP_APP)) throw new Error(`photoshop: no Photoshop 2026 at ${PHOTOSHOP_APP}`);
  if (photoshopIsRunning()) throw new Error("photoshop: Photoshop is open. It's Graham's: save and quit it, and the run launches its own and puts his settings back after");
  const pending = pendingPhotoshopSettingsBackups();
  if (pending.length) throw new Error(`photoshop: a run's settings snapshot was never restored (${pending.join(', ')}); see \`npm run photoshop -- check\``);
  const backup = snapshotPhotoshopSettings(run);
  log(`photoshop: settings snapshot in ${backup}`);
  let result: T | undefined, failure: unknown;
  try {
    await launchPhotoshop();
    const version = runPhotoshopScript('app.version');
    log(`photoshop: Photoshop ${version} launched`);
    result = await step({ run, backup, version });
  } catch (error) {
    failure = error;
  }
  // Whatever happened above, the quit and the restore are tried before anything is thrown.
  let restore: PhotoshopSettingsRestore;
  try {
    await quitPhotoshop();
    recordPhotoshopExit(backup);
    restore = restorePhotoshopSettings(backup);
    log(`photoshop: quit; settings restored and checked byte for byte (${restore.files} files, ${restore.rewritten.length} rewritten, ${restore.removed.length} removed${restore.setAside ? `, what they were set aside in ${restore.setAside}` : ''})`);
  } catch (cleanup) {
    const pendingNote = `${(cleanup as Error).message}. Its settings snapshot ${backup} stays pending: once Photoshop is quit, \`npm run photoshop -- check\` says what a restore would do`;
    throw failure ? new AggregateError([failure, cleanup], `photoshop: the run failed (${(failure as Error).message}), and ${pendingNote}`) : new Error(pendingNote);
  }
  if (failure) throw failure;
  return { result: result as T, restore };
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
  for (const backup of pendingPhotoshopSettingsBackups()) {
    const plan = planPendingPhotoshopRestore(backup);
    if (plan.refused) fail(`a settings snapshot was never restored, and restoring it isn't safe: ${backup}: ${plan.refused}`);
    else fail(`a settings snapshot was never restored: ${backup}; \`npm run photoshop -- restore\` would rewrite ${plan.rewrite.length} files and remove ${plan.remove.length}${plan.keep.length ? `, keeping ${plan.keep.length} another session changed since (${plan.keep.join(', ')})` : ''}, setting aside what it replaces`);
  }
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
