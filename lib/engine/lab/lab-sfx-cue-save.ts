// lab-sfx-cue-save.ts: the cue editor's save, exactly as `studio sfx draft` writes a list: sfx/cues.json, then
// generated/sfx-cues.ts and its WAVs. The editor only ever changes a cue's edits (sound, nudge, volume), so the posted
// cues are matched to the file's by event id and only those three fields are taken: a stale tab can't rewrite a draft
// or an event from under a redraft.
import { readSfxCueList, writeSfxCueList, writeSfxCueModule } from '#sfx/cue-module.ts';
import type { SfxCue } from '#sfx/cues.ts';
import { resolveSfxParams, type SfxRequest } from '#sfx/library.ts';
import { projectFolderNamed } from '#engine/review/project-media.ts';
import type { LabSfxCueEdit, LabSfxCuePayload } from '#models/lab/lab-catalog.ts';
import { buildLabCatalog, LAB_SFX_CUE_DEMO_PROJECT, labSfxCueRevision } from './lab-catalog.ts';

/** The edit is refused as asked: the web layer answers 400. */
export class LabSfxCueRequestError extends Error {}
/** cues.json changed since the editor loaded it: the web layer answers 409. */
export class LabSfxCueStaleError extends Error {}

export function saveLabSfxCueEdits(project: string, { revision, edits }: { revision: string; edits: readonly LabSfxCueEdit[] }): LabSfxCuePayload {
  // The editor only ever opens the demo project, so nothing else is written through it.
  if (project !== LAB_SFX_CUE_DEMO_PROJECT) throw new LabSfxCueRequestError(`${project} isn't the lab's cue-list project`);
  const dir = projectFolderNamed(project);
  const onDisk = readSfxCueList(dir);
  if (!onDisk) throw new LabSfxCueRequestError('the project has no sfx/cues.json to save into');
  if (revision !== labSfxCueRevision(dir)) throw new LabSfxCueStaleError('sfx/cues.json has changed since the editor loaded it: reload to see the new version (unsaved edits here are lost)');
  const byId = new Map(edits.map((e) => [e.id, e]));
  const same = byId.size === onDisk.cues.length && onDisk.cues.every((c) => byId.has(c.event.id));
  if (!same) throw new LabSfxCueRequestError('the cues are not the ones in sfx/cues.json (was it redrafted?): reload the editor');

  const cues = onDisk.cues.map(({ sound: _s, nudge: _n, volume: _v, ...cue }): SfxCue => {
    const edit = byId.get(cue.event.id)!;
    return {
      ...cue,
      ...(edit.sound !== undefined && { sound: edit.sound === null ? null : checkedSfxRequest(edit.sound, cue.event.id) }),
      ...(edit.nudge !== undefined && { nudge: edit.nudge }),
      ...(edit.volume !== undefined && { volume: edit.volume }),
    };
  });
  writeSfxCueList(dir, { ...onDisk, cues });
  writeSfxCueModule(dir);
  return buildLabCatalog({ exported: false }).catalog.sfxCues!;
}

/** A request lib/sfx can render: its parameters are checked by the library itself. */
function checkedSfxRequest(request: SfxRequest, id: string): SfxRequest {
  try {
    resolveSfxParams(request);
  } catch (error) {
    throw new LabSfxCueRequestError(`${id}: ${(error as Error).message}`);
  }
  return request;
}
