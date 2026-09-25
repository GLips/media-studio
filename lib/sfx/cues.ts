// cues.ts: a video's sound effects as a cue list: one cue per event (lib/sfx/cue-events.ts), each with the sound the
// draft chose for it, or why it left it silent, and a few alternatives. An agent edits the draft rather than placing
// every sound by hand; `studio check` reports the rules an edit breaks. Pure.
//
// The rules are working defaults to tune by ear, not published standards:
// - a click within 150 ms of the one before stays silent, as Screenify debounces them;
// - an accent goes only on a scene change, a reveal or a big camera move, at most one every 4 s, never on two scene
//   changes in a row, and never under a spoken word (a riser may build under one, but peaks in a gap). The draft
//   prefers scene changes, then big moves, then reveals, and among those the ones with the longest silence around;
// - a whoosh on a camera move lasts as long as the move, and a riser peaks on its reveal.

import { resolveSfxParams, type SfxRequest } from './library.ts';
import type { SfxEvent } from './cue-events.ts';

export const SFX_CUE_RULES = {
  /** Seconds after a sounding click that another stays silent. */
  clickDebounce: 0.15,
  /** Seconds at least between two accents. */
  accentSpacing: 4,
  /** How far a whoosh's approach or recede may differ from its move's, in seconds. */
  fitTolerance: 0.1,
} as const;

/** The per-video click sound. */
export const SFX_CLICK_STYLES = { soft: 'click.soft', mechanical: 'click.crisp', pop: 'pop.soft', tick: 'click.trackpad' } as const;
export type SfxClickStyle = keyof typeof SFX_CLICK_STYLES;

/**
 * One event's cue. `draft` is rewritten by every `studio sfx draft`; `sound`, `nudge` and `volume` are edits, and a
 * redraft keeps them for an event that still exists. `sound: null` silences a cue the draft sounded; setting `sound`
 * (copy an alternative) sounds one it left silent.
 */
export type SfxCue = {
  id: string;
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

/** A cue as it plays: its sound, landing `at` video seconds. What the video imports and timeline.json reports. */
export type SfxCuePlay = { id: string; event: SfxEvent; sound: SfxRequest; at: number; volume: number };

export type Word = { text: string; start: number; end: number };

export const sfxCueSound = (cue: SfxCue): SfxRequest | null => (cue.sound !== undefined ? cue.sound : cue.draft.sound);

export function sfxCuePlays(list: SfxCueList): SfxCuePlay[] {
  return list.cues.flatMap((cue) => {
    const sound = sfxCueSound(cue);
    return sound ? [{ id: cue.id, event: cue.event, sound, at: cue.event.at + (cue.nudge ?? 0), volume: cue.volume ?? cue.event.volume ?? 1 }] : [];
  });
}

const recipeOf = (sound: SfxRequest) => sound.sound.split('.')[0];
const isAccent = (sound: SfxRequest) => resolveSfxParams(sound).recipe.category === 'accent';

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

function wordUnder(sound: SfxRequest, at: number, words: readonly Word[]): Word | undefined {
  const [before, after] = loudSpan(sound);
  return words.find((w) => w.start < at + after && at + before < w.end);
}

const round2 = (x: number) => x.toFixed(2);

/** Seconds of no speech around `at`: from the last word ending before it to the next starting after; 0 under a word. */
function silenceAround(at: number, words: readonly Word[]): number {
  if (words.some((w) => w.start <= at && at < w.end)) return 0;
  const before = Math.max(0, ...words.filter((w) => w.end <= at).map((w) => w.end));
  const after = Math.min(Infinity, ...words.filter((w) => w.start > at).map((w) => w.start));
  return after - before;
}

/** A whoosh's approach and recede to span a move or dissolve, within what the recipe takes. */
function whooshFit(event: SfxEvent): Record<string, number> {
  const clamp = (x: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, x)) * 1000) / 1000;
  return { approach: clamp(event.at - event.from!, 0.05, 2), recede: clamp(event.to! - event.at, 0.1, 2) };
}

/** What the draft would sound for an event, first, then its alternatives. */
function sfxEventOptions(event: SfxEvent, clickStyle: SfxClickStyle): SfxRequest[] {
  const seed = event.id;
  switch (event.kind) {
    case 'click': return [SFX_CLICK_STYLES[clickStyle], ...Object.values(SFX_CLICK_STYLES).filter((s) => s !== SFX_CLICK_STYLES[clickStyle])].map((sound) => ({ sound, seed }));
    case 'key': return ['key', 'key.soft', 'key.mechanical'].map((sound) => ({ sound, seed }));
    case 'placed': return [event.request!];
    case 'scene': return (event.from === undefined ? ['impact.soft', 'whoosh.fast', 'ding.soft'] : ['whoosh.soft', 'whoosh.swell', 'riser.short', 'impact.soft']).map((sound) => ({ sound, seed }));
    case 'camera-move': return ['whoosh', 'whoosh.soft', 'whoosh.fast'].map((sound) => ({ sound, seed, set: whooshFit(event) }));
    case 'reveal': return ['riser.short', 'ding.soft', 'chime.soft', 'pop.soft'].map((sound) => ({ sound, seed }));
  }
}

const EDITS = ['sound', 'nudge', 'volume'] as const;

/**
 * Drafts a cue for every event. Clicks and keys all sound, bar debounced clicks, and placed sounds keep the scene's
 * sound. Accents are chosen by rank (scene changes, then big camera moves, then reveals) and the silence around them,
 * each only where every accent rule holds against those already chosen. Edits in `previous` are kept for events that still exist, and count as chosen first; `dropped`
 * names cues with edits whose events are gone.
 */
export function draftSfxCues(events: readonly SfxEvent[], words: readonly Word[], { clickStyle, previous }: { clickStyle: SfxClickStyle; previous?: SfxCueList | null }): { list: SfxCueList; dropped: string[] } {
  const edits = new Map((previous?.cues ?? []).filter((c) => EDITS.some((k) => c[k] !== undefined)).map((c) => [c.id, Object.fromEntries(EDITS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]]))]));
  const cues: SfxCue[] = events.map((event) => {
    const [sound, ...alternatives] = sfxEventOptions(event, clickStyle);
    return { id: event.id, event, draft: { sound: null, why: '' }, alternatives: [sound, ...alternatives], ...edits.get(event.id) };
  });
  const decide = (cue: SfxCue, sound: SfxRequest | null, why: string) => {
    cue.draft = { sound, why };
    if (sound) cue.alternatives = cue.alternatives.filter((a) => a !== sound);
  };

  let lastClick = -Infinity;
  for (const cue of cues.filter((c) => c.event.kind === 'click')) {
    const gap = cue.event.at - lastClick;
    if (gap < SFX_CUE_RULES.clickDebounce) decide(cue, null, `debounced: ${round2(gap)} s after the click before`);
    else decide(cue, cue.alternatives[0], `click style ${clickStyle}`);
    if (sfxCueSound(cue)) lastClick = cue.event.at;
  }
  for (const cue of cues.filter((c) => c.event.kind === 'key')) decide(cue, cue.alternatives[0], 'typing');
  for (const cue of cues.filter((c) => c.event.kind === 'placed')) decide(cue, cue.alternatives[0], 'placed by the scene');

  const rank = { scene: 0, 'camera-move': 1, reveal: 2 } as Record<string, number>;
  // Within a rank, the longest silence first: a pause the voice leaves is where the video takes a breath, like the
  // lead into a new section.
  const candidates = cues.filter((c) => c.event.kind in rank)
    .sort((a, b) => rank[a.event.kind] - rank[b.event.kind] || silenceAround(b.event.at, words) - silenceAround(a.event.at, words) || a.event.at - b.event.at);
  // Accents already sounding (edits, placed ones) are chosen before any candidate.
  const chosen = cues.filter((c) => sfxCueSound(c) && isAccent(sfxCueSound(c)!));
  for (const cue of candidates) {
    if (cue.event.kind === 'camera-move' && !cue.event.big) {
      decide(cue, null, 'a small camera move');
      continue;
    }
    const sound = cue.alternatives[0];
    const broken = accentRuleBroken(cue, sound, cue.event.at, chosen, words);
    if (broken) decide(cue, null, broken);
    else {
      decide(cue, sound, { scene: 'a scene change', 'camera-move': 'a big camera move', reveal: 'a reveal' }[cue.event.kind as string]!);
      // An edit that silenced it keeps it silent, so it doesn't crowd out its neighbours.
      if (sfxCueSound(cue) && isAccent(sfxCueSound(cue)!) && !chosen.includes(cue)) chosen.push(cue);
    }
  }
  const ids = new Set(events.map((e) => e.id));
  return { list: { version: SFX_CUE_LIST_VERSION, clickStyle, cues }, dropped: [...edits.keys()].filter((id) => !ids.has(id)) };
}

/** The first accent rule an accent at `at` breaks against the others sounding, or null. */
function accentRuleBroken(cue: { id: string; event: SfxEvent }, sound: SfxRequest, at: number, others: readonly { id: string; event: SfxEvent; at?: number; nudge?: number }[], words: readonly Word[]): string | null {
  const { event } = cue;
  if (!['scene', 'reveal', 'placed'].includes(event.kind) && !(event.kind === 'camera-move' && event.big)) {
    return `an accent on ${event.kind === 'camera-move' ? 'a small camera move' : `a ${event.kind}`}: accents go on scene changes, reveals and big camera moves`;
  }
  const atOf = (o: (typeof others)[number]) => o.at ?? o.event.at + (o.nudge ?? 0);
  const near = others.find((o) => o.id !== cue.id && Math.abs(atOf(o) - at) < SFX_CUE_RULES.accentSpacing);
  if (near) return `${round2(Math.abs(atOf(near) - at))} s from the accent on ${near.id}: at most one every ${SFX_CUE_RULES.accentSpacing} s`;
  if (event.kind === 'scene') {
    const next = others.find((o) => o.id !== cue.id && o.event.kind === 'scene' && Math.abs(o.event.index! - event.index!) === 1);
    if (next) return `the scene change beside ${next.id} has an accent: never on every cut`;
  }
  const word = wordUnder(sound, at, words);
  if (word) return `under "${word.text}" (${round2(word.start)}–${round2(word.end)} s)`;
  return null;
}

/**
 * Where the cues as they play break a rule: what `studio check` reports as overridden. The draft breaks none, so
 * each is an edit, or a draft gone stale.
 */
export function sfxCueOverrides(plays: readonly SfxCuePlay[], words: readonly Word[]): { id: string; at: number; problem: string }[] {
  const found: { id: string; at: number; problem: string }[] = [];
  const sorted = [...plays].sort((a, b) => a.at - b.at);
  let lastClick: SfxCuePlay | null = null;
  for (const play of sorted.filter((p) => p.event.kind === 'click')) {
    if (lastClick && play.at - lastClick.at < SFX_CUE_RULES.clickDebounce) {
      found.push({ id: play.id, at: play.at, problem: `sounds ${round2(play.at - lastClick.at)} s after the click before (the draft leaves clicks within ${SFX_CUE_RULES.clickDebounce} s silent)` });
    }
    lastClick = play;
  }
  const accents = sorted.filter((p) => isAccent(p.sound));
  accents.forEach((play, i) => {
    // Against the accents before it only, so a pair too close is reported once.
    const broken = accentRuleBroken(play, play.sound, play.at, accents.slice(0, i), words);
    if (broken) found.push({ id: play.id, at: play.at, problem: broken });
  });
  for (const play of sorted) {
    const { event, sound } = play;
    if (Math.abs(play.at - event.at) > 1e-3) found.push({ id: play.id, at: play.at, problem: `lands ${round2(play.at - event.at)} s off its event` });
    if (recipeOf(sound) === 'whoosh' && event.kind === 'camera-move') {
      const want = whooshFit(event), got = resolveSfxParams(sound).params;
      if (Math.abs(got.approach - want.approach) > SFX_CUE_RULES.fitTolerance || Math.abs(got.recede - want.recede) > SFX_CUE_RULES.fitTolerance) {
        found.push({ id: play.id, at: play.at, problem: `a whoosh of ${round2(got.approach)} + ${round2(got.recede)} s on a move of ${round2(want.approach)} + ${round2(want.recede)} s: it should last as long as the move` });
      }
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/**
 * Cues whose event the video no longer has where the cue list says: a re-voice or retime moved it, or it's gone.
 * Matched by kind and time, not id, so a check of one stretch doesn't misread ids numbered across a whole scene.
 * Only cues landing inside `span` (video seconds) are judged.
 */
export function staleSfxCues(plays: readonly SfxCuePlay[], events: readonly SfxEvent[], span: { from: number; to: number }, fps: number): { id: string; at: number; problem: string }[] {
  return plays.filter((p) => p.event.at >= span.from && p.event.at <= span.to).flatMap((play) => {
    const same = events.filter((e) => e.kind === play.event.kind);
    if (same.some((e) => Math.abs(e.at - play.event.at) <= 1 / fps)) return [];
    const closest = same.reduce<SfxEvent | null>((a, e) => (!a || Math.abs(e.at - play.event.at) < Math.abs(a.at - play.event.at) ? e : a), null);
    const moved = closest && Math.abs(closest.at - play.event.at) < 2 ? `moved to ${round2(closest.at)} s` : 'is gone';
    return [{ id: play.id, at: play.at, problem: `its ${play.event.kind} at ${round2(play.event.at)} s ${moved}: redraft with studio sfx draft` }];
  });
}
