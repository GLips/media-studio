// What the cue editor reads off a cue: its state (sounding, silent, edited by hand, the scene's own), that state in
// words and colour, the lanes the timeline sorts cues into, and the edits a save sends.
import type { SfxEvent } from '#sfx/cue-events.ts';
import { isSfxCueEdited, SFX_CLICK_STYLES, sfxCueSound, type SfxCue, type SfxCueList } from '#sfx/cues.ts';
import type { SfxRequest } from '#sfx/library.ts';
import type { LabSfxCueEdit } from '#models/lab/lab-catalog.ts';
import { labCueEditWords, sfxDraftWords } from '#models/lab/lab-sound-cue-words.ts';
import { sfxSoundWords } from '#models/lab/lab-sound-words.ts';
import { colors } from '#web/shared/ui/theme.stylex.ts';

export type LabCueState = 'sounding' | 'silent' | 'edited' | 'placed';
export const LAB_CUE_STATES: readonly LabCueState[] = ['sounding', 'silent', 'edited', 'placed'];

export function labCueState(c: SfxCue): LabCueState {
  if (c.event.kind === 'placed') return 'placed';
  if (isSfxCueEdited(c)) return 'edited';
  return c.draft.sound ? 'sounding' : 'silent';
}

export const LAB_CUE_STATE_WORDS: Record<LabCueState, string> = {
  sounding: 'sounds (draft)', silent: 'silent (draft)', edited: 'edited by hand', placed: "the scene's own sound",
};

/** A state's marker: cream sounds, hollow is silent, red-orange is edited, cobalt is a scene's own sound. */
export const LAB_CUE_STATE_MARK: Record<LabCueState, { fill: string; edge: string }> = {
  sounding: { fill: colors.cream, edge: 'transparent' },
  silent: { fill: colors.ground, edge: colors.dim },
  edited: { fill: colors.accent, edge: 'transparent' },
  placed: { fill: colors.cobalt, edge: 'transparent' },
};

export const LAB_SFX_CUE_LANES: readonly { label: string; kinds: readonly SfxEvent['kind'][] }[] = [
  { label: 'Clicks & keys', kinds: ['click', 'key'] },
  { label: 'Scene changes', kinds: ['scene'] },
  { label: 'Camera moves', kinds: ['camera-move'] },
  { label: 'Things appearing', kinds: ['reveal'] },
  { label: "Scenes' own", kinds: ['placed'] },
];

/** The cue the editor opens on: the first scene change with a sound, a moment worth hearing. */
export const firstLabCue = (list: SfxCueList) => list.cues.find((c) => c.event.kind === 'scene' && c.draft.sound);

export const labCueEventsById = (list: SfxCueList): ReadonlyMap<string, SfxEvent> => new Map(list.cues.map((c) => [c.event.id, c.event]));

/** A cue's edits as one comparable string, to count what differs from the saved list. */
export const labCueEditsKey = (c: SfxCue) => JSON.stringify({ s: c.sound === undefined ? 'draft' : c.sound, n: c.nudge ?? null, v: c.volume ?? null });

export const sameSfxRequest = (a: SfxRequest | null | undefined, b: SfxRequest | null | undefined) => JSON.stringify(a) === JSON.stringify(b);

export function groupLabCues<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

/** The sound a cue plays now, given its list's click style. */
export const labCueSoundNow = (cue: SfxCue, list: SfxCueList) => sfxCueSound(cue, list.clickStyle);

/** Why the draft chose what it did for `cue`, as a sentence. */
export const labCueDraftWords = (cue: SfxCue, list: SfxCueList, events: ReadonlyMap<string, SfxEvent>) =>
  sfxDraftWords(cue, SFX_CLICK_STYLES[list.clickStyle], events);

/** A cue's state as the line under the timeline says it. */
export function labCueStateLine(cue: SfxCue, list: SfxCueList): string {
  const now = labCueSoundNow(cue, list);
  const lines: Record<LabCueState, () => string> = {
    placed: () => `the scene plays ${cue.event.kind === 'placed' ? sfxSoundWords(cue.event.request) : 'it'} itself`,
    edited: () => `edited (${labCueEditWords(cue)})${now ? `: plays ${sfxSoundWords(now)}` : ': silent'}`,
    sounding: () => (now ? `plays ${sfxSoundWords(now)}` : 'silent'),
    silent: () => `silent: ${labCueDraftWords(cue, list, labCueEventsById(list))}`,
  };
  return lines[labCueState(cue)]();
}

/** What the draft did with a cue, as the detail panel's bold opening. */
export function labCueDraftHeadline(cue: SfxCue): string {
  if (cue.draft.sound) return `Sounds: ${sfxSoundWords(cue.draft.sound)}.`;
  return cue.event.kind === 'placed' ? 'Plays from the scene.' : 'Left silent.';
}

type LabCueEditKey = 'sound' | 'nudge' | 'volume';
/** The cue with the named edits taken off, back to the draft's for each. */
export function withoutLabCueEdits(cue: SfxCue, ...keys: readonly LabCueEditKey[]): SfxCue {
  const next = { ...cue };
  for (const key of keys) delete next[key];
  return next;
}

/** The list's edits as a save sends them: every cue by id, with only the fields a person set. */
export const labCueEdits = (list: SfxCueList): LabSfxCueEdit[] => list.cues.map((c) => ({
  id: c.event.id,
  ...(c.sound !== undefined && { sound: c.sound }),
  ...(c.nudge !== undefined && { nudge: c.nudge }),
  ...(c.volume !== undefined && { volume: c.volume }),
}));
