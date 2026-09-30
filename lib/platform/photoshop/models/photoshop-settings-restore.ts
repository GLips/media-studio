// photoshop-settings-restore.ts: which of Photoshop's settings files a restore may put back from a run's snapshot
// (engine/photoshop-app.ts does the file work). Settings are compared by hash, each file by its path under
// ~/Library/Preferences.
//
// A snapshot is the state before a run, right to put back only for what the run's own Photoshop changed: after someone
// else's session (Graham's, installing brushes) it wipes his changes too, as it once did (a 191 MB brush install). So
// a run records the settings as its Photoshop left them when it saw it exit, and a restore puts back only files still
// exactly so. Without that record a restore refuses unless forced.

export type PhotoshopSettingsHashes = Record<string, string>;

/** The settings as the run's own Photoshop left them, recorded as the run saw it exit. */
export type PhotoshopRunExit = { exitedAt: string; files: PhotoshopSettingsHashes };

export type PhotoshopSettingsRestorePlan = {
  /** Snapshotted files to write back: missing now, or differing from the snapshot. */
  rewrite: string[];
  /** Files the run added, to remove. */
  remove: string[];
  /** Files changed since the run's Photoshop exited: another session's, left as they are. */
  keep: string[];
  /** Why the restore can't go ahead, when it can't. */
  refused?: string;
};

/**
 * What a restore of `snapshot` does to the settings as they are `now`. With `exit`, only files still as the run's
 * Photoshop left them are touched. Without it, the restore refuses (when anything differs) unless `force`.
 */
export function planPhotoshopSettingsRestore(snapshot: PhotoshopSettingsHashes, now: PhotoshopSettingsHashes, { exit, force = false }: { exit?: PhotoshopRunExit; force?: boolean } = {}): PhotoshopSettingsRestorePlan {
  const differing = [...new Set([...Object.keys(snapshot), ...Object.keys(now)])].filter((file) => snapshot[file] !== now[file]).toSorted();
  // Unchanged since the run's Photoshop exited, so any difference from the snapshot is the run's own.
  const runs = (file: string) => !exit || exit.files[file] === now[file];
  const keep = differing.filter((file) => !runs(file));
  const ours = differing.filter(runs);
  const plan = { rewrite: ours.filter((file) => file in snapshot), remove: ours.filter((file) => !(file in snapshot)), keep };
  if (!exit && differing.length && !force) {
    return {
      ...plan,
      refused: `the run's Photoshop was never seen to exit, so its changes can't be told from a later Photoshop session's, and putting the snapshot back would undo that session's too (${differing.length} files differ: ${differing.join(', ')}). If no one has used Photoshop since the run, restore with --force: every file it replaces is set aside first`,
    };
  }
  return plan;
}
