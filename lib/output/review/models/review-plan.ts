// review-plan.ts: the plan's notes and sign-offs read against the storyboard as it is now. A plan note anchors by the
// words it quotes, so it's found again however the line around it was edited, and reads as unplaced once its scene,
// line or quote is gone. A scene's sign-off holds its storyboardSceneHash, so it goes stale when that scene changes.
//
// Pure, so the plan page works it out in the browser and the CLI in its short-lived process: the long-running app
// server never imports a project's storyboard.ts.

import { textSha256Hex } from '#lib/platform/hash/models/sha256.ts';
import type { ResolvedStoryboard } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import type { Storyboard } from '#lib/timing/storyboard/models/storyboard.ts';
import { canonicalJson, storyboardSceneHash } from '#lib/timing/storyboard/models/storyboard-sign-off.ts';
import { findScriptPhrase, scriptWords } from '#lib/timing/voice/models/voice-words.ts';
import type { ReviewPlanAnchor, ReviewPlanField, ReviewSignoff } from './review-threads.ts';

/** The whole storyboard's hash, as a plan note's `planHash` records it: what the plan was when the note was written. */
export function storyboardPlanHash(storyboard: Storyboard): string {
  return textSha256Hex(canonicalJson(storyboard)).slice(0, 16);
}

/**
 * Where a plan note sits now: its scene and line, the quote's words in the line (first and last, from 0), the left-out
 * item it quotes, and the frame of the quote's first word or the scene's origin (null with no timeline or scene). A
 * left-out note quoting nothing has no item: it's on the whole list.
 */
export type ReviewPlanPlacement = { scene: string | null; line: string | null; words: [number, number] | null; item: number | null; frame: number | null; unplaced: boolean };

/** Where `quote`'s words first run in `text`'s, as word indices: how every plan note finds its words again. */
export const findReviewPlanQuote = (text: string, quote: string): [number, number] | null => findScriptPhrase(scriptWords(text), quote);

/** The cell a note quotes from, as text: a scene's row field, a brief section, or the left-out items. */
function cellTexts(anchor: ReviewPlanAnchor, storyboard: Storyboard): readonly string[] | null {
  if (anchor.field === 'brief') {
    const section = anchor.section === undefined ? undefined : storyboard.brief?.[anchor.section];
    return section === undefined ? null : [section];
  }
  if (anchor.field === 'leftOut') return storyboard.leftOut ?? null;
  const row = anchor.scene === undefined ? undefined : storyboard.scenes[anchor.scene];
  if (!row || anchor.field === 'line') return null;
  const reads = row.reads ?? [];
  const cells = { onScreen: [row.onScreen], motion: [row.motion], reads, scene: [row.onScreen, row.motion, ...reads, ...Object.values(row.lines ?? {}).map((l) => l.text)] };
  return cells[anchor.field];
}

export function placeReviewPlanThread<const S extends Storyboard>(anchor: ReviewPlanAnchor, storyboard: S, resolved: ResolvedStoryboard<S>): ReviewPlanPlacement {
  const sceneGone = anchor.scene !== undefined && !(anchor.scene in storyboard.scenes);
  const scene = anchor.scene === undefined || sceneGone ? null : anchor.scene;
  const row = scene === null ? undefined : storyboard.scenes[scene];
  const lineGone = anchor.line !== undefined && !(row?.lines && anchor.line in row.lines);
  const line = anchor.line === undefined || lineGone ? null : anchor.line;
  // SAFETY: `scene` is a key of the storyboard the timeline was resolved from, so the timeline has it.
  const placed = resolved.timeline && scene !== null ? resolved.timeline.scene(scene as never) : null;
  const origin = placed?.origin ?? null;

  if (sceneGone || lineGone) return { scene, line, words: null, item: null, frame: origin, unplaced: true };
  if (line !== null) {
    const spoken = resolved.voice[line];
    const words = anchor.text === undefined ? null : findScriptPhrase(spoken.words.map((w) => w.text), anchor.text);
    if (anchor.text !== undefined && words === null) return { scene, line, words: null, item: null, frame: origin, unplaced: true };
    const timed = placed?.lines.find((l) => l.id === line);
    const frame = timed && resolved.timeline ? Math.round(timed.frame + (words ? spoken.words[words[0]].start : 0) * resolved.timeline.fps) : origin;
    return { scene, line, words, item: null, frame, unplaced: false };
  }
  const texts = cellTexts(anchor, storyboard);
  const quote = anchor.text;
  const at = quote === undefined || texts === null ? -1 : texts.findIndex((text) => findReviewPlanQuote(text, quote) !== null);
  const item = anchor.field === 'leftOut' && at >= 0 ? at : null;
  return { scene, line: null, words: null, item, frame: origin, unplaced: texts === null || (quote !== undefined && at < 0) };
}

const PLAN_FIELD_WORDS: Readonly<Record<Exclude<ReviewPlanField, 'brief' | 'line' | 'scene'>, string>> = {
  onScreen: 'on screen', motion: 'motion', reads: 'reads', leftOut: 'left out',
};

/** A quote longer than this is cut short where a screen names a note's place; the hand-off gives it whole. */
const PLAN_QUOTE_SHOWN = 48;

/**
 * `plate · line verdict · ‘FODMAPs’`, `brief · Pacing`, `left out · ‘History’`: where a plan note is, as the page, the
 * review's thread and the hand-off all name it. `short` cuts a long quote, for a screen.
 */
export function formatReviewPlanNoteWhere(anchor: ReviewPlanAnchor, { short = false } = {}): string {
  const on = { brief: `brief · ${anchor.section ?? ''}`, line: `line ${anchor.line ?? ''}`, scene: undefined, ...PLAN_FIELD_WORDS }[anchor.field];
  const cut = short && anchor.text !== undefined && anchor.text.length > PLAN_QUOTE_SHOWN;
  const quote = anchor.text !== undefined && `‘${cut ? `${anchor.text.slice(0, PLAN_QUOTE_SHOWN)}…` : anchor.text}’`;
  return [anchor.scene, on, quote].filter(Boolean).join(' · ');
}

export type ReviewPlanSignoffState = 'signed' | 'unsigned' | 'stale' | 'unknown';

/**
 * Each scene's sign-off, in plan order: signed while its hash holds, stale once the scene has changed since, and
 * unknown when the plan doesn't time (a null hash can't say). `at` is when the last sign-off on it was made.
 */
export function reviewPlanSignoffs<const S extends Storyboard>(
  storyboard: S, resolved: ResolvedStoryboard<S>, signoffs: readonly ReviewSignoff[],
): { scene: string; state: ReviewPlanSignoffState; at?: string }[] {
  return Object.keys(storyboard.scenes).map((scene) => {
    const signed = signoffs.findLast((s) => s.on === 'plan' && s.scene === scene);
    const hash = storyboardSceneHash(storyboard, resolved, scene);
    if (!signed) return { scene, state: hash === null ? 'unknown' : 'unsigned' };
    if (hash === null) return { scene, state: 'unknown', at: signed.at };
    return { scene, state: signed.hash === hash ? 'signed' : 'stale', at: signed.at };
  });
}

/**
 * A plan note as the hand-off places it: its frame on the plan's timeline and the nearest cue of its scene at or
 * before it (`shutter +4f`), the way a video note names its moment.
 */
export type ReviewPlanNotePlace = { frame: number | null; words: [number, number] | null; cue?: { name: string; frames: number } };

/** A plan note placed for `studio review notes` and `watch`, or why it can't be: what's gone from the plan. */
export function reviewPlanNotePlacementOf<const S extends Storyboard>(
  anchor: ReviewPlanAnchor, storyboard: S, resolved: ResolvedStoryboard<S>,
): { shifted: false; plan: ReviewPlanNotePlace } | { unplaced: string } {
  const placed = placeReviewPlanThread(anchor, storyboard, resolved);
  if (placed.unplaced) {
    if (anchor.scene !== undefined && placed.scene === null) return { unplaced: `the plan has no scene ${anchor.scene}` };
    if (anchor.line !== undefined && placed.line === null) return { unplaced: `scene ${anchor.scene} has no line ${anchor.line}` };
    if (anchor.field === 'brief' && anchor.section !== undefined && storyboard.brief?.[anchor.section] === undefined) return { unplaced: `the brief has no ${anchor.section} section` };
    return { unplaced: anchor.text === undefined ? `the plan has no ${anchor.field} for it` : `the plan doesn't say "${anchor.text}" there` };
  }
  const { frame, words } = placed;
  // SAFETY: placeReviewPlanThread gives a scene only when the storyboard has it, so the timeline does too.
  const cues = frame !== null && placed.scene !== null && resolved.timeline ? resolved.timeline.scene(placed.scene as never).cues : {};
  const before = Object.entries<number>(cues).filter(([, at]) => frame !== null && at <= frame).toSorted(([, a], [, b]) => b - a)[0];
  return { shifted: false, plan: { frame, words, ...(before && frame !== null && { cue: { name: before[0], frames: frame - before[1] } }) } };
}
