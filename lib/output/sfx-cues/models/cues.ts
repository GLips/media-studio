// cues.ts: a video's sound effects, one cue per event, with the sound the draft chose and alternatives. `studio
// check` reports the rules an edit breaks.
//
// The rules are defaults to tune by ear:
// - a click right after another stays silent, as Screenify debounces them;
// - an accent goes only on a scene change, a reveal or a big camera move, never on two scene changes in a row, and
//   never under a spoken word (a riser may build under one, but peaks in a gap);
// - a whoosh lasts as long as its move, and a riser peaks on its reveal.
// A sound a scene placed by hand plays from its `<Sfx>`; its cue is there so the rules count it.

import type { SpokenWord } from '#lib/timing/voice/models/voice-words.ts';
import { roundSfxSeconds, sfxEventSeries, type SfxEvent } from './cue-events.ts';
import { resolveSfxParams, type SfxRequest } from '#lib/timing/sound/models/library.ts';

export const SFX_CUE_RULES = {
  /** Seconds after a sounding click that another stays silent. */
  clickDebounce: 0.15,
  /** Seconds at least between two accents. */
  accentSpacing: 4,
  /** How far a whoosh's approach or recede may differ from its move's, in seconds. */
  fitTolerance: 0.1,
} as const;

/** The per-video click sound: every click cue that isn't edited plays it. */
export const SFX_CLICK_STYLES = { soft: 'click.soft', mechanical: 'click.crisp', pop: 'pop.soft', tick: 'click.trackpad' } as const;
export type SfxClickStyle = keyof typeof SFX_CLICK_STYLES;

/**
 * One event's cue, keyed by `event.id`. `draft` is rewritten by every `studio sfx draft`; `sound`, `nudge` and
 * `volume` are edits, which a redraft keeps. `sound: null` silences a cue the draft sounded; setting `sound` (copy an
 * alternative) sounds one it left silent.
 */
export type SfxCue = {
  event: SfxEvent;
  draft: { sound: SfxRequest | null; why: string };
  alternatives: SfxRequest[];
  sound?: SfxRequest | null;
  /** Seconds to land after (or, negative, before) the event. */
  nudge?: number;
  volume?: number;
};

/** A project's sfx/cues.json. */
export type SfxCueList = { version: 1; clickStyle: SfxClickStyle; cues: SfxCue[] };
export const SFX_CUE_LIST_VERSION = 1;

/**
 * A cue as it sounds, landing `at` video seconds. `inline`: a sound a scene placed, which its `<Sfx>` plays; the list
 * plays the rest.
 */
export type SfxCuePlay = { id: string; event: SfxEvent; sound: SfxRequest; at: number; volume: number; inline: boolean };

const EDITS = ['sound', 'nudge', 'volume'] as const;
/** Whether a cue carries a hand edit (`sound`, `nudge` or `volume`), which a redraft keeps. */
export const isSfxCueEdited = (cue: SfxCue) => EDITS.some((k) => cue[k] !== undefined);
/** The volume a cue plays at unless its `volume` is edited: a marked event's own, else full. */
export const sfxCueOwnVolume = (cue: SfxCue) => ('volume' in cue.event ? cue.event.volume : 1);

export function sfxCueSound(cue: SfxCue, clickStyle: SfxClickStyle): SfxRequest | null {
  const { event } = cue;
  if (event.kind === 'placed') return event.request;
  if (cue.sound !== undefined) return cue.sound;
  if (event.kind === 'click' && cue.draft.sound) return { sound: SFX_CLICK_STYLES[clickStyle], seed: event.id };
  return cue.draft.sound;
}

function sfxCuePlay(cue: SfxCue, sound: SfxRequest): SfxCuePlay {
  const { event } = cue, inline = event.kind === 'placed';
  const own = sfxCueOwnVolume(cue);
  return { id: event.id, event, sound, at: event.at + (inline ? 0 : cue.nudge ?? 0), volume: inline ? own : cue.volume ?? own, inline };
}

/** Every cue that sounds, in time order. */
export function sfxCuePlays(list: SfxCueList): SfxCuePlay[] {
  return list.cues.flatMap((cue) => {
    const sound = sfxCueSound(cue, list.clickStyle);
    return sound ? [sfxCuePlay(cue, sound)] : [];
  }).toSorted((a, b) => a.at - b.at);
}

const recipeOf = (sound: SfxRequest) => sound.sound.split('.')[0];
const isAccent = (sound: SfxRequest) => resolveSfxParams(sound).recipe.category === 'accent';
const seconds = (x: number) => x.toFixed(2);

/**
 * The part of an accent that's loud, in seconds around where it lands: a whoosh's pass, a riser's peak, a hit's
 * attack. Only this has to fall between words.
 */
function loudSpan(sound: SfxRequest): [number, number] {
  switch (recipeOf(sound)) {
    case 'whoosh': return [-0.15, 0.2];
    case 'riser': return [-0.25, 0.1];
    default: return [0, 0.3];
  }
}

/** Seconds of no speech around `at`: from the last word ending before it to the next starting after; 0 under a word. */
function silenceAround(at: number, words: readonly SpokenWord[]): number {
  if (words.some((w) => w.start <= at && at < w.end)) return 0;
  const before = Math.max(0, ...words.filter((w) => w.end <= at).map((w) => w.end));
  const after = Math.min(Infinity, ...words.filter((w) => w.start > at).map((w) => w.start));
  return after - before;
}

/** The stretch a whoosh on `event` should span: a camera move's, or a dissolve's. */
function sfxEventSpan(event: SfxEvent): { from: number; to: number } | null {
  if (event.kind === 'camera-move') return event;
  if (event.kind === 'scene' && event.dissolve) return event.dissolve;
  return null;
}

/** A whoosh's approach and recede to span `from`–`to` passing at `at`, within what the recipe takes. */
function whooshFit(at: number, { from, to }: { from: number; to: number }): Record<string, number> {
  const clamp = (x: number, lo: number, hi: number) => roundSfxSeconds(Math.min(hi, Math.max(lo, x)));
  return { approach: clamp(at - from, 0.05, 2), recede: clamp(to - at, 0.1, 2) };
}

/** What the draft would sound for an event, first, then its alternatives. A placed sound has none: its scene chose it. */
function sfxEventOptions(event: SfxEvent, clickStyle: SfxClickStyle): SfxRequest[] {
  const seed = event.id, span = sfxEventSpan(event);
  const sounds = (names: string[]) => names.map((sound) => ({ sound, seed, ...(span && sound.startsWith('whoosh') && { set: whooshFit(event.at, span) }) }));
  switch (event.kind) {
    case 'click': return sounds([SFX_CLICK_STYLES[clickStyle], ...Object.values(SFX_CLICK_STYLES).filter((s) => s !== SFX_CLICK_STYLES[clickStyle])]);
    case 'key': return sounds(['key', 'key.soft', 'key.mechanical']);
    case 'placed': return [event.request];
    case 'scene': return sounds(event.dissolve ? ['whoosh.soft', 'whoosh.swell', 'riser.short', 'impact.soft'] : ['impact.soft', 'whoosh.fast', 'ding.soft']);
    case 'camera-move': return sounds(['whoosh', 'whoosh.soft', 'whoosh.fast']);
    case 'reveal': return sounds(['riser.short', 'ding.soft', 'chime.soft', 'pop.soft']);
  }
}

function clickTooSoon(play: SfxCuePlay, lastClickAt: number): string | null {
  const gap = play.at - lastClickAt;
  return gap < SFX_CUE_RULES.clickDebounce ? `${seconds(gap)} s after the click before (within ${SFX_CUE_RULES.clickDebounce} s, clicks stay silent)` : null;
}

/** The first accent rule `play` breaks against the other accents sounding, or null. */
function accentRuleBroken(play: SfxCuePlay, others: readonly SfxCuePlay[], words: readonly SpokenWord[]): string | null {
  const { event, sound, at } = play;
  if (event.kind === 'click' || event.kind === 'key' || (event.kind === 'camera-move' && !event.big)) {
    return `an accent on ${event.kind === 'camera-move' ? 'a small camera move' : `a ${event.kind}`}: accents go on scene changes, reveals and big camera moves`;
  }
  const near = others.find((o) => o.id !== play.id && Math.abs(o.at - at) < SFX_CUE_RULES.accentSpacing);
  if (near) return `${seconds(Math.abs(near.at - at))} s from the accent on ${near.id}: at most one every ${SFX_CUE_RULES.accentSpacing} s`;
  if (event.kind === 'scene') {
    const beside = others.find((o) => o.event.kind === 'scene' && Math.abs(o.event.index - event.index) === 1);
    if (beside) return `the scene change beside ${beside.id} has an accent: never on every cut`;
  }
  const [before, after] = loudSpan(sound);
  const word = words.find((w) => w.start < at + after && at + before < w.end);
  if (word) return `under "${word.text}" (${seconds(word.start)}–${seconds(word.end)} s)`;
  return null;
}

const ACCENT_RANK: Partial<Record<SfxEvent['kind'], number>> = { scene: 0, 'camera-move': 1, reveal: 2 };
const ACCENT_REASON: Partial<Record<SfxEvent['kind'], string>> = { scene: 'a scene change', 'camera-move': 'a big camera move', reveal: 'a reveal' };

/** How many events each numbered series has (`click:speed` → 6), so a redraft can tell when ids have shifted. */
function seriesCounts(events: readonly SfxEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) if (e.id !== sfxEventSeries(e.id)) counts.set(sfxEventSeries(e.id), (counts.get(sfxEventSeries(e.id)) ?? 0) + 1);
  return counts;
}

/**
 * Drafts a cue for every event, picking accents by rank (scene changes, big moves, reveals) and the silence around
 * them, wherever every accent rule holds.
 *
 * Edits in `previous` carry over by event id and sound first. Ids number a series in order, so a series that gained
 * or lost events drops its edits into `dropped`.
 */
export function draftSfxCues(events: readonly SfxEvent[], words: readonly SpokenWord[], { clickStyle, previous }: { clickStyle: SfxClickStyle; previous?: SfxCueList | null }): { list: SfxCueList; dropped: { id: string; why: string }[] } {
  const ids = new Set(events.map((e) => e.id)), before = seriesCounts(previous?.cues.map((c) => c.event) ?? []), now = seriesCounts(events);
  const edits = new Map<string, Pick<SfxCue, (typeof EDITS)[number]>>(), dropped: { id: string; why: string }[] = [];
  for (const cue of previous?.cues.filter(isSfxCueEdited) ?? []) {
    const { id } = cue.event, series = sfxEventSeries(id);
    if (!ids.has(id)) dropped.push({ id, why: 'the video no longer has its event' });
    else if (series !== id && before.get(series) !== now.get(series)) dropped.push({ id, why: `${series} has ${now.get(series)} events now, not ${before.get(series)}, so its ids have shifted` });
    else edits.set(id, Object.fromEntries(EDITS.filter((k) => cue[k] !== undefined).map((k) => [k, cue[k]])));
  }

  const cues: SfxCue[] = events.map((event) => ({ event, draft: { sound: null, why: '' }, alternatives: sfxEventOptions(event, clickStyle), ...edits.get(event.id) }));
  const decide = (cue: SfxCue, sound: SfxRequest | null, why: string) => {
    cue.draft = { sound, why };
    if (sound) cue.alternatives = cue.alternatives.filter((a) => a !== sound);
  };
  const soundingPlay = (cue: SfxCue) => {
    const sound = sfxCueSound(cue, clickStyle);
    return sound && sfxCuePlay(cue, sound);
  };

  let lastClickAt = -Infinity;
  for (const cue of cues) {
    const { kind } = cue.event;
    if (kind === 'click') {
      const debounced = clickTooSoon(sfxCuePlay(cue, cue.alternatives[0]), lastClickAt);
      decide(cue, debounced ? null : cue.alternatives[0], debounced ? `debounced: ${debounced}` : `click style ${clickStyle}`);
      const play = soundingPlay(cue);
      if (play) lastClickAt = play.at;
    } else if (kind === 'key') decide(cue, cue.alternatives[0], 'typing');
    else if (kind === 'placed') decide(cue, cue.alternatives[0], 'plays from its <Sfx> in the scene');
  }

  // Within a rank, the longest silence first: a pause the voice leaves is where the video takes a breath, like the
  // lead into a new section.
  const candidates = cues.filter((c) => ACCENT_RANK[c.event.kind] !== undefined)
    .toSorted((a, b) => ACCENT_RANK[a.event.kind]! - ACCENT_RANK[b.event.kind]! || silenceAround(b.event.at, words) - silenceAround(a.event.at, words) || a.event.at - b.event.at);
  const accents = cues.flatMap((c) => {
    const play = soundingPlay(c);
    return play && isAccent(play.sound) ? [play] : [];
  });
  for (const cue of candidates) {
    const broken = accentRuleBroken(sfxCuePlay(cue, cue.alternatives[0]), accents, words);
    decide(cue, broken ? null : cue.alternatives[0], broken ?? ACCENT_REASON[cue.event.kind]!);
    const play = soundingPlay(cue);
    if (play && isAccent(play.sound) && !accents.some((a) => a.id === play.id)) accents.push(play);
  }
  return { list: { version: SFX_CUE_LIST_VERSION, clickStyle, cues }, dropped };
}

export type SfxCueProblem = { id: string; at: number; problem: string };

/**
 * Where the cues as they sound break a rule: what `studio check` reports as overridden. The draft breaks none, so
 * each is an edit.
 */
export function sfxCueOverrides(list: SfxCueList, words: readonly SpokenWord[]): SfxCueProblem[] {
  const found: SfxCueProblem[] = [], plays = sfxCuePlays(list), accents: SfxCuePlay[] = [];
  let lastClickAt = -Infinity;
  for (const play of plays) {
    const note = (problem: string | null) => problem && found.push({ id: play.id, at: play.at, problem });
    if (play.event.kind === 'click') {
      note(clickTooSoon(play, lastClickAt));
      lastClickAt = play.at;
    }
    // Against the accents before it only, so a pair too close is reported once. A placed accent is its scene's
    // choice and isn't judged, but the list's accents are judged against it.
    if (isAccent(play.sound)) {
      if (!play.inline) note(accentRuleBroken(play, accents, words));
      accents.push(play);
    }
    if (play.inline) continue;
    if (Math.abs(play.at - play.event.at) > 1e-3) note(`lands ${seconds(play.at - play.event.at)} s off its event`);
    const span = sfxEventSpan(play.event);
    if (span && recipeOf(play.sound) === 'whoosh') {
      const want = whooshFit(play.event.at, span), got = resolveSfxParams(play.sound).params;
      if (Math.abs(got.approach - want.approach) > SFX_CUE_RULES.fitTolerance || Math.abs(got.recede - want.recede) > SFX_CUE_RULES.fitTolerance) {
        note(`a whoosh of ${seconds(got.approach)} + ${seconds(got.recede)} s on a ${play.event.kind === 'scene' ? 'dissolve' : 'move'} of ${seconds(want.approach)} + ${seconds(want.recede)} s: it should last as long`);
      }
    }
  }
  for (const cue of list.cues.filter((c) => c.event.kind === 'placed' && isSfxCueEdited(c))) {
    found.push({ id: cue.event.id, at: cue.event.at, problem: 'edits do nothing to a placed sound, which plays from its <Sfx>: change that instead' });
  }
  return found.toSorted((a, b) => a.at - b.at);
}

/**
 * Stale cues: a cue whose event moved or went, or an event with no cue. Matched by kind and time, not id, as a check
 * of one stretch would misread ids numbered across a scene. Placed sounds are judged too: accents keep clear of them.
 *
 * `partial`: moves and reveals under way at the first frame checked go unmeasured, so unjudged.
 */
export function staleSfxCues(list: SfxCueList, events: readonly SfxEvent[], { from, to, fps, partial }: { from: number; to: number; fps: number; partial: boolean }): SfxCueProblem[] {
  const judged = (e: SfxEvent) => e.at >= from && e.at <= to && !(partial && (e.kind === 'camera-move' || e.kind === 'reveal'));
  const matching = (e: SfxEvent, among: readonly SfxEvent[]) => among.filter((o) => o.kind === e.kind).toSorted((a, b) => Math.abs(a.at - e.at) - Math.abs(b.at - e.at))[0];
  const cued = list.cues.map((c) => c.event);
  const stale = cued.filter(judged).flatMap((event) => {
    const closest = matching(event, events);
    if (closest && Math.abs(closest.at - event.at) <= 1 / fps) return [];
    const moved = closest && Math.abs(closest.at - event.at) < 2 ? `moved to ${seconds(closest.at)} s` : 'is gone';
    return [{ id: event.id, at: event.at, problem: `its ${event.kind} at ${seconds(event.at)} s ${moved}: redraft with studio sfx draft` }];
  });
  const uncued = events.filter(judged).flatMap((event) => {
    const closest = matching(event, cued);
    if (closest && Math.abs(closest.at - event.at) <= 1 / fps) return [];
    return [{ id: event.id, at: event.at, problem: `a ${event.kind} the cue list has no cue for${event.kind === 'click' || event.kind === 'key' ? ', so it plays nothing' : ''}: redraft with studio sfx draft` }];
  });
  return [...stale, ...uncued].toSorted((a, b) => a.at - b.at);
}

/** The report lines for stale cues (which fail) and overrides (which don't). */
export function formatSfxCueReport(list: SfxCueList, { stale, overrides }: { stale: readonly SfxCueProblem[]; overrides: readonly SfxCueProblem[] }): string[] {
  const line = (mark: string) => (p: SfxCueProblem) => `  ${mark} ${p.at.toFixed(2)}s  sfx ${p.id}: ${p.problem}`;
  const counts = [stale.length && `${stale.length} stale`, overrides.length && `${overrides.length} overriding a rule`].filter(Boolean).join(', ');
  return [...stale.map(line('✗')), ...overrides.map(line('!')), `sfx: ${sfxCuePlays(list).length} cues sounding${counts ? `, ${counts}` : ' ✓'}`];
}

/** One line per cue: when, what, and the sound or why it's silent. */
export function formatSfxCueList(list: SfxCueList): string[] {
  return list.cues.map((cue) => {
    const sound = sfxCueSound(cue, list.clickStyle);
    const set = sound?.set && Object.keys(sound.set).length ? ` ${Object.entries(sound.set).map(([k, v]) => `${k}=${v}`).join(',')}` : '';
    return `${cue.event.at.toFixed(2).padStart(7)}  ${cue.event.id.padEnd(38)} ${sound ? `${sound.sound}${set}` : `– ${cue.draft.why}`}${isSfxCueEdited(cue) ? '  (edited)' : ''}`;
  });
}
