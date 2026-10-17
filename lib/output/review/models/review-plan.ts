// review-plan.ts: the plan's notes and sign-offs read against the storyboard as it is now. A plan note anchors by the
// words it quotes, so it's found again however the line around it was edited, and reads as unplaced once its scene,
// line or quote is gone. A note keeps its field's whole text as it was (`was`), and a scene's sign-off its fields'
// texts, so either shows word by word what changed since; the sign-off's storyboardSceneHash says whether it's stale.
//
// Pure, so the plan page works it out in the browser and the CLI in its short-lived process: the long-running app
// server never imports a project's storyboard.ts.

import type { ResolvedStoryboard } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import type { Storyboard } from '#lib/timing/storyboard/models/storyboard.ts';
import { storyboardSceneHash } from '#lib/timing/storyboard/models/storyboard-sign-off.ts';
import { findScriptPhrase, scriptWords } from '#lib/timing/voice/models/voice-words.ts';
import type { ReviewPlanAnchor, ReviewPlanField, ReviewSignoff } from './review-threads.ts';

// A scene's reads are one cell, so a note on them and a sign-off's texts hold them as one text, a read a line.
const readsText = (reads: readonly string[] | undefined) => (reads ?? []).join('\n');

const sharedWordCount = (a: string, b: string) => {
  const words = new Set(scriptWords(a));
  return scriptWords(b).filter((w) => words.has(w)).length;
};

/**
 * A left-out item a note is on: the one its quote is in, else, for a note that kept its `was`, the one sharing the most
 * words with it, which is the item reworded.
 */
function leftOutItemOf(items: readonly string[], { text, was }: ReviewPlanAnchor): string | undefined {
  if (was !== undefined && items.includes(was)) return was;
  const quoted = text === undefined ? undefined : items.find((item) => findScriptPhrase(scriptWords(item), text) !== null);
  if (quoted !== undefined || was === undefined) return quoted;
  const [best] = items.map((item) => ({ item, shared: sharedWordCount(was, item) })).filter((c) => c.shared > 0).toSorted((a, b) => b.shared - a.shared);
  return best?.item;
}

/**
 * The whole text, as the storyboard has it now, of the field `anchor` quotes: its line, its cell, its brief section or
 * its left-out item; undefined for a note on a whole scene, or once the field is gone.
 */
export function reviewPlanFieldText(storyboard: Storyboard, anchor: ReviewPlanAnchor): string | undefined {
  const row = anchor.scene === undefined ? undefined : storyboard.scenes[anchor.scene];
  const texts: Readonly<Record<ReviewPlanField, () => string | undefined>> = {
    brief: () => (anchor.section === undefined ? undefined : storyboard.brief?.[anchor.section]),
    line: () => (anchor.line === undefined ? undefined : row?.lines?.[anchor.line]?.text),
    onScreen: () => row?.onScreen,
    motion: () => row?.motion,
    reads: () => row && readsText(row.reads),
    scene: () => undefined,
    leftOut: () => leftOutItemOf(storyboard.leftOut ?? [], anchor),
  };
  return texts[anchor.field]();
}

/** A scene's texts as a sign-off keeps them: `onScreen`, `motion`, `reads` and `line:<id>` for each of its lines. */
export function reviewPlanSceneTexts(storyboard: Storyboard, scene: string) {
  const row = storyboard.scenes[scene];
  const lines = Object.entries(row.lines ?? {}).map(([id, line]) => [`line:${id}`, line.text] as const);
  return { onScreen: row.onScreen, motion: row.motion, reads: readsText(row.reads), ...Object.fromEntries(lines) };
}

/** A run of words the same in both texts, only in the new one, or only in the old. */
export type ReviewPlanWordRun = { kind: 'same' | 'added' | 'removed'; text: string };

/**
 * `was` against `now`, word by word (scriptWords' words, so markup and punctuation stay on their word): a longest
 * common run of words is kept, and the rest is removed or added, removals first where both happen at once.
 */
export function reviewPlanWordDiff(was: string, now: string): ReviewPlanWordRun[] {
  const a = scriptWords(was), b = scriptWords(now);
  // lcs[i][j]: the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const words: { kind: ReviewPlanWordRun['kind']; word: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      words.push({ kind: 'same', word: a[i] }); i++; j++;
    } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      words.push({ kind: 'removed', word: a[i] }); i++;
    } else {
      words.push({ kind: 'added', word: b[j] }); j++;
    }
  }
  // Joined into runs, with a change's removals ahead of its additions however the walk interleaved them.
  const runs: ReviewPlanWordRun[] = [];
  for (let at = 0; at < words.length;) {
    if (words[at].kind === 'same') {
      let end = at;
      while (end < words.length && words[end].kind === 'same') end++;
      runs.push({ kind: 'same', text: words.slice(at, end).map((w) => w.word).join(' ') });
      at = end;
      continue;
    }
    let end = at;
    while (end < words.length && words[end].kind !== 'same') end++;
    const changed = words.slice(at, end);
    for (const kind of ['removed', 'added'] as const) {
      const text = changed.filter((w) => w.kind === kind).map((w) => w.word).join(' ');
      if (text) runs.push({ kind, text });
    }
    at = end;
  }
  return runs;
}

/** `Take a [-photo-]{+picture+} of it`: a word diff as plain text, for the hand-off. */
export const formatReviewPlanWordDiff = (runs: readonly ReviewPlanWordRun[]) =>
  runs.map(({ kind, text }) => ({ same: text, added: `{+${text}+}`, removed: `[-${text}-]` })[kind]).join(' ');

/** A field whose text changed: its key as reviewPlanSceneTexts names it (or the note's field), and both texts. */
export type ReviewPlanFieldChange = { key: string; was: string; now: string };

/** `line verdict`, `on screen`: a sign-off text's key as a person reads it. */
export const formatReviewPlanTextKey = (key: string) =>
  key.startsWith('line:') ? `line ${key.slice('line:'.length)}` : { onScreen: 'on screen', motion: 'motion', reads: 'reads' }[key] ?? key;

/** The fields of `scene` whose text differs from `texts`, a sign-off's: a line added or cut reads against nothing. */
export function reviewPlanSceneChanges(storyboard: Storyboard, scene: string, texts: Readonly<Record<string, string>>): ReviewPlanFieldChange[] {
  const now = new Map(Object.entries(reviewPlanSceneTexts(storyboard, scene)));
  const keys = [...new Set([...Object.keys(texts), ...now.keys()])];
  return keys.flatMap((key) => {
    const was = texts[key] ?? '', is = now.get(key) ?? '';
    return was === is ? [] : [{ key, was, now: is }];
  });
}

/** A note's field's text then and now, when it has changed since the note: null with no `was` or nothing changed. */
export function reviewPlanNoteChange(storyboard: Storyboard, anchor: ReviewPlanAnchor): { was: string; now: string } | null {
  if (anchor.was === undefined) return null;
  const now = reviewPlanFieldText(storyboard, anchor);
  return now === undefined || now === anchor.was ? null : { was: anchor.was, now };
}

/**
 * Where a plan note sits now: its scene and line, the quote's words in the line (first and last, from 0), the left-out
 * item it quotes, and the frame of the quote's first word or the scene's origin (null with no timeline or scene). A
 * left-out note quoting nothing has no item: it's on the whole list.
 */
export type ReviewPlanPlacement = {
  scene: string | null; line: string | null; words: [number, number] | null; item: number | null; frame: number | null; unplaced: boolean;
  /** The quoted field's text when the note was written and now, once it has changed (reviewPlanNoteChange). */
  changed: { was: string; now: string } | null;
};

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

// A note that kept its field's text (`was`) stays placed on the field when its quote is reworded away: the field still
// says which line or cell it was on, and the reword is what the reviewer comes to check.
export function placeReviewPlanThread<const S extends Storyboard>(anchor: ReviewPlanAnchor, storyboard: S, resolved: ResolvedStoryboard<S>): ReviewPlanPlacement {
  const sceneGone = anchor.scene !== undefined && !(anchor.scene in storyboard.scenes);
  const scene = anchor.scene === undefined || sceneGone ? null : anchor.scene;
  const row = scene === null ? undefined : storyboard.scenes[scene];
  const lineGone = anchor.line !== undefined && !(row?.lines && anchor.line in row.lines);
  const line = anchor.line === undefined || lineGone ? null : anchor.line;
  // SAFETY: `scene` is a key of the storyboard the timeline was resolved from, so the timeline has it.
  const placed = resolved.timeline && scene !== null ? resolved.timeline.scene(scene as never) : null;
  const origin = placed?.origin ?? null;
  const changed = reviewPlanNoteChange(storyboard, anchor);
  const kept = anchor.was !== undefined && reviewPlanFieldText(storyboard, anchor) !== undefined;

  if (sceneGone || lineGone) return { scene, line, words: null, item: null, frame: origin, unplaced: true, changed: null };
  if (line !== null) {
    const spoken = resolved.voice[line];
    const words = anchor.text === undefined ? null : findScriptPhrase(spoken.words.map((w) => w.text), anchor.text);
    if (anchor.text !== undefined && words === null && !kept) return { scene, line, words: null, item: null, frame: origin, unplaced: true, changed };
    const timed = placed?.lines.find((l) => l.id === line);
    const frame = timed && resolved.timeline ? Math.round(timed.frame + (words ? spoken.words[words[0]].start : 0) * resolved.timeline.fps) : origin;
    return { scene, line, words, item: null, frame, unplaced: false, changed };
  }
  const texts = cellTexts(anchor, storyboard);
  const quote = anchor.text;
  const at = quote === undefined || texts === null ? -1 : texts.findIndex((text) => findReviewPlanQuote(text, quote) !== null);
  const leftOut = storyboard.leftOut ?? [];
  const index = at >= 0 ? at : leftOut.indexOf(reviewPlanFieldText(storyboard, anchor) ?? '');
  const item = anchor.field === 'leftOut' && index >= 0 ? index : null;
  return { scene, line: null, words: null, item, frame: origin, unplaced: texts === null || (quote !== undefined && at < 0 && !kept), changed };
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
 * unknown when the plan doesn't time (a null hash can't say). `at` is when it was signed off; a stale scene's
 * `changes` are its fields reworded since, none when only its timing moved.
 */
export function reviewPlanSignoffs<const S extends Storyboard>(
  storyboard: S, resolved: ResolvedStoryboard<S>, signoffs: readonly ReviewSignoff[],
): { scene: string; state: ReviewPlanSignoffState; at?: string; changes?: ReviewPlanFieldChange[] }[] {
  return Object.keys(storyboard.scenes).map((scene) => {
    const signed = signoffs.findLast((s) => s.on === 'plan' && s.scene === scene);
    const hash = storyboardSceneHash(storyboard, resolved, scene);
    if (!signed || signed.on !== 'plan') return { scene, state: hash === null ? 'unknown' : 'unsigned' };
    if (hash === null) return { scene, state: 'unknown', at: signed.at };
    if (signed.hash === hash) return { scene, state: 'signed', at: signed.at };
    return { scene, state: 'stale', at: signed.at, changes: reviewPlanSceneChanges(storyboard, scene, signed.texts) };
  });
}

/**
 * A plan note as the hand-off places it: its frame on the plan's timeline and the nearest cue of its scene at or
 * before it (`shutter +4f`), the way a video note names its moment.
 */
export type ReviewPlanNotePlace = {
  frame: number | null; words: [number, number] | null; cue?: { name: string; frames: number };
  /** The quoted field's text then and now, once it has changed since the note. */
  changed?: { was: string; now: string };
};

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
  const { frame, words, changed } = placed;
  // SAFETY: placeReviewPlanThread gives a scene only when the storyboard has it, so the timeline does too.
  const cues = frame !== null && placed.scene !== null && resolved.timeline ? resolved.timeline.scene(placed.scene as never).cues : {};
  const before = Object.entries<number>(cues).filter(([, at]) => frame !== null && at <= frame).toSorted(([, a], [, b]) => b - a)[0];
  return { shifted: false, plan: { frame, words, ...(before && frame !== null && { cue: { name: before[0], frames: frame - before[1] } }), ...(changed && { changed }) } };
}
