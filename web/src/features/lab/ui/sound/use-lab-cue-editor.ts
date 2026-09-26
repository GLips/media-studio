import { useEffect, useMemo, useState } from 'react';
import { sfxCueOverrides, sfxCuePlays, type SfxCue, type SfxCueList } from '#sfx/cues.ts';
import type { LabSfxCuePayload } from '#models/lab/lab-catalog.ts';
import { useSaveLabSfxCues } from '#web/features/lab/controllers/use-save-lab-sfx-cues.ts';
import { firstLabCue, groupLabCues, labCueEdits, labCueEditsKey, labCueEventsById } from './lab-cue-state.ts';
import { renderLabCueSound } from './lab-cue-sounds.ts';
import { useLabCueScheduler } from './use-lab-cue-scheduler.ts';
import { useLabCueVideo } from './use-lab-cue-video.ts';

export type LabCueSaveState = { kind: 'idle' | 'saving' } | { kind: 'saved' | 'error'; text: string };

function labCueSaveStateOf(save: ReturnType<typeof useSaveLabSfxCues>): LabCueSaveState {
  if (save.isPending) return { kind: 'saving' };
  if (save.isError) return { kind: 'error', text: `the lab server didn't answer (${save.error.message}): is studio lab still running?` };
  if (save.data?.refusal) return { kind: 'error', text: save.data.message };
  if (save.isSuccess) return { kind: 'saved', text: 'Saved: the next render of the video plays your edits.' };
  return { kind: 'idle' };
}

/**
 * The cue editor's state: the list as edited against `saved` (the catalog's, which a save replaces), what's picked and
 * hovered, the warnings the edits raise, and the video the list plays over. `exported` has nowhere to save, so the
 * edited list downloads instead.
 */
export function useLabCueEditor(saved: LabSfxCuePayload, exported: boolean) {
  const [list, setList] = useState<SfxCueList>(saved.list);
  const [selectedId, setSelectedId] = useState<string | null>(() => firstLabCue(saved.list)?.event.id ?? null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hearList, setHearList] = useState(true);
  const [zoom, setZoom] = useState(1);
  const save = useSaveLabSfxCues();
  const video = useLabCueVideo(saved);
  useLabCueScheduler(video.videoRef, list, hearList);

  // Render every sound the list plays up front, a few per frame, so the first play and the first click are instant.
  useEffect(() => {
    const pending = sfxCuePlays(list).filter((p) => !p.inline).map((p) => p.sound);
    let timer = 0;
    const next = () => {
      pending.splice(0, 3).forEach(renderLabCueSound);
      if (pending.length) timer = window.setTimeout(next, 0);
    };
    next();
    return () => clearTimeout(timer);
  }, [list]);

  const events = useMemo(() => labCueEventsById(list), [list]);
  const warnings = useMemo(() => sfxCueOverrides(list, saved.words), [list, saved]);
  const warningsById = useMemo(() => groupLabCues(warnings, (w) => w.id), [warnings]);
  const unsaved = useMemo(() => {
    const before = new Map(saved.list.cues.map((c) => [c.event.id, labCueEditsKey(c)]));
    return list.cues.filter((c) => before.get(c.event.id) !== labCueEditsKey(c)).length;
  }, [list, saved]);

  useEffect(() => {
    if (!unsaved) return undefined;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const editCue = (id: string, edit: (c: SfxCue) => SfxCue) => {
    setList((l) => ({ ...l, cues: l.cues.map((c) => (c.event.id === id ? edit(c) : c)) }));
    save.reset();
  };

  const pickCue = (cue: SfxCue) => {
    setSelectedId(cue.event.id);
    video.playMoment(cue);
  };

  const submit = () => {
    const sent = list;
    save.mutate({ data: { project: saved.project, revision: saved.revision, edits: labCueEdits(sent) } }, {
      // Edits made while the save was in flight stay; only an untouched list takes the saved one.
      onSuccess: (reply) => { if (reply.saved) setList((current) => (current === sent ? reply.saved.list : current)); },
    });
  };

  // An exported lab has nowhere to save: the edited list goes to the person, who can hand it on.
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(list, null, 2)}\n`], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'cues.json' }).click();
    URL.revokeObjectURL(url);
  };

  return {
    saved, list, events, warnings, warningsById, unsaved, exported, ...video,
    saveState: labCueSaveStateOf(save),
    selectedId, setSelectedId, hoverId, setHoverId, hearList, setHearList, zoom, setZoom,
    editCue, pickCue, persist: exported ? download : submit,
  };
}

export type LabCueEditorState = ReturnType<typeof useLabCueEditor>;
