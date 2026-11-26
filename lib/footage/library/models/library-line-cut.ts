// library-line-cut.ts: the pieces a line keeps on item time and the marks review places on line time.
// Inner word cuts seek quiet first, then a loudness dip where the words run together.
import { SPOKEN_CLEANUP_RULES, type SpokenDisfluencyRule } from '#lib/footage/transcript/models/spoken-disfluencies.ts';
import type { SpokenWord } from '#lib/footage/transcript/models/spoken-word.ts';
import type { SpokenDip, SpokenEdge, SpokenJoin, SpokenPiece, SpokenRemoval, SpokenUnheard } from '#lib/timing/voice/models/recorded-speech.ts';

/** How a line from a recording is cleaned: project-wide (libraryFootage) or on one line (its `speech`). */
export type LibraryLineCleanup = {
  /** The rules its words are cleaned by. Default SPOKEN_CLEANUP_RULES; `[]` takes no word out. */
  rules?: readonly SpokenDisfluencyRule[];
  /** The longest pause kept between its words, in seconds; a longer one is shortened to it. Default 0.5; Infinity keeps every pause. */
  pauseCap?: number;
};

/**
 * One line's own choices beside its cleanup: item seconds whose removal it restores (`keep`, a moment inside the words
 * or pause taken out, as review shows it) and whose word or unheard speech it takes out (`cut`).
 */
export type LibraryLineEdits = LibraryLineCleanup & { keep?: readonly number[]; cut?: readonly number[] };

/** Where a line is cut: its edges and pieces on item time, and what it leaves out, keeps, hears and turns down, on line time. */
export type LibraryLineCut = {
  from: number;
  to: number;
  edges: { in: SpokenEdge; out: SpokenEdge };
  pieces: SpokenPiece[];
  joins: SpokenJoin[];
  removals: SpokenRemoval[];
  unheard: SpokenUnheard[];
  heard: SpokenWord[];
  dips: SpokenDip[];
};

type Span = { start: number; end: number };

/** A sound a line holds: a word heard, or speech whisper wrote no word for (`unheard`, its text empty). */
export type LibraryLineSound = SpokenWord & { unheard?: true };

/** A track a line is cut from, on item time: its sounds in order, and its levelled copy's quiet, breaths and clicks. */
export type LibraryLineVoice = {
  sounds: readonly LibraryLineSound[];
  quiet: readonly Span[];
  soft: readonly Span[];
  clicks: readonly Span[];
  /** Half-dB below full scale per window, its origin and window length on item time. */
  envelope?: { levels: Uint8Array; start: number; step: number };
};

/** The longest pause a recorded line keeps between its words unless its cleanup sets `pauseCap`, in seconds. */
export const LIBRARY_PAUSE_CAP = 0.5;
// Sound kept past a word's quiet onset (its decay into the room) and before its words (the breath).
const EDGE_PAD_OUT = 0.1, EDGE_PAD_IN = 0.12;
const EDGE_QUIET_MIN = 0.1;
// A breath turned down by this much (gain), within the ticket's 6–10 dB; never removed, as a line without one gasps.
const BREATH_GAIN = 0.4;
// Room either side of a click it's taken out over.
const CLICK_MARGIN = 0.005;
// A breath this far into the word after it still leads it: a transcript starts a word at the end of the quiet.
const BREATH_REACH = 0.05;

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
const middle = (s?: Span) => (s ? (s.start + s.end) / 2 : undefined);
const long = (q: Span) => q.end - q.start >= EDGE_QUIET_MIN;
const inside = (spans: readonly Span[], t: number) => spans.find((q) => q.start <= t && t <= q.end);

/**
 * An edge `pad` seconds (negative: before) from where `word` meets quiet span `q`, kept inside it. A word the
 * transcript runs past the quiet meets it at its far side, so the edge keeps away from the next sound's onset.
 */
const edgeInQuiet = (q: Span, word: number, pad: number) => {
  const reach = Math.min(Math.abs(pad), (q.end - q.start) / 2);
  if (pad > 0) return word < q.end ? Math.min(q.end, Math.max(q.start, word) + pad) : q.start + reach;
  return word > q.start ? Math.max(q.start, Math.min(q.end, word) + pad) : q.end - reach;
};

// An edge with no quiet: midway to the neighbouring sound, or with no neighbour, padded past the sound itself.
const unquietEdge = (word: number, beside: number | undefined, pad: number) => (beside === undefined ? word + pad : (word + beside) / 2);

/** The breath before sound `i`: a soft span after the sound before it, reaching no further than just into it. */
function breathBefore({ sounds, soft }: LibraryLineVoice, i: number): Span | undefined {
  const after = sounds[i - 1]?.end ?? -Infinity;
  return soft.findLast((s) => s.start >= after && s.end <= sounds[i].start + BREATH_REACH && s.end > after);
}

/** Where a piece starting at sound `i` begins: in the quiet before its breath and after the sound before it. */
function leadEdge(voice: LibraryLineVoice, i: number): number {
  const { sounds, quiet } = voice, breath = breathBefore(voice, i);
  const start = breath?.start ?? sounds[i].start, before = middle(sounds[i - 1]) ?? -Infinity;
  const leads = quiet.filter((q) => q.start < (breath?.start ?? middle(sounds[i])!) && q.end > before);
  const lead = leads.findLast(long) ?? leads.at(-1);
  return lead ? edgeInQuiet(lead, start, -EDGE_PAD_IN) : unquietEdge(start, sounds[i - 1]?.end, -EDGE_PAD_IN);
}

/** Where a piece ending at sound `i` ends: in the quiet its sound decays into, before the sound after it. */
function decayEdge({ sounds, quiet }: LibraryLineVoice, i: number): number {
  const end = sounds[i].end, after = middle(sounds[i + 1]) ?? Infinity;
  const decays = quiet.filter((q) => q.end > middle(sounds[i])! && q.start < after);
  const decay = decays.find(long) ?? decays[0];
  return decay ? edgeInQuiet(decay, end, EDGE_PAD_OUT) : unquietEdge(end, sounds[i + 1]?.start, EDGE_PAD_OUT);
}

// At 5 dB below both shoulders a trough can take a cut. Under 10 dB the outgoing vowel needs a decay of its own.
const DIP_DEPTH_HALF_DB = 10, DEEP_DIP_HALF_DB = 20, DIP_REACH = 0.12;

// A cut within voicing lets the outgoing vowel decay before the short overlap with the next sound.
const VOICED_JOIN: SpokenJoin = { fadeOut: 0.06, crossfade: 0.01 };
const QUIET_JOIN: SpokenJoin = { fadeOut: 0, crossfade: 0.02 };

/** The deepest RMS trough near the boundary, strictly between word middles. Each byte counts half-dB down. */
function dipBetween({ envelope, sounds }: LibraryLineVoice, i: number, minDepth: number) {
  if (!envelope) return undefined;
  const { levels, start, step } = envelope;
  const boundary = (sounds[i].end + sounds[i + 1].start) / 2;
  const center = (k: number) => start + (k + 0.5) * step;
  const reach = Math.round(DIP_REACH / step);
  const first = Math.max(1, Math.ceil((boundary - DIP_REACH - start) / step - 0.5));
  const last = Math.min(levels.length - 2, Math.floor((boundary + DIP_REACH - start) / step - 0.5));
  let best: { index: number; contrast: number } | undefined;
  for (let k = first; k <= last; k++) {
    if (center(k) <= middle(sounds[i])! || center(k) >= middle(sounds[i + 1])!) continue;
    const depth = levels[k];
    const left = levels.subarray(Math.max(0, k - reach), k);
    const right = levels.subarray(k + 1, k + reach + 1);
    const contrast = depth - Math.max(Math.min(...left), Math.min(...right));
    if (contrast < minDepth) continue;
    // Quantization can flatten a trough across several windows. Both slopes must rise as they leave it.
    if (left.findLast((v) => v !== depth)! > depth || right.find((v) => v !== depth)! > depth) continue;
    if (best === undefined || depth > levels[best.index] || (depth === levels[best.index] && Math.abs(center(k) - boundary) < Math.abs(center(best.index) - boundary))) {
      best = { index: k, contrast };
    }
  }
  return best && { time: center(best.index), shallow: best.contrast < DEEP_DIP_HALF_DB };
}

/** A disfluency a rule found, or a sound a line cuts (`cut`), as indexes into the voice's sounds. */
type Find = { kind: string; flag: string | undefined; from: number; to: number };

/** A run of the line's sounds taken out, and the finds behind it; `forced` when the line's `cut` asks for one. */
type Taken = { first: number; last: number; finds: Find[]; forced: boolean };

/**
 * The line whose sounds' middles lie between `asked` and `askedTo`, cut by `edits`. Throws when no word lies between,
 * when every word would be taken out, or when a keep or cut moment names nothing there.
 */
export function cutLibraryLine(voice: LibraryLineVoice, asked: number, askedTo: number, edits: LibraryLineEdits, where: string): LibraryLineCut {
  const { sounds } = voice;
  const first = sounds.findIndex((s) => middle(s)! >= asked), last = sounds.findLastIndex((s) => middle(s)! <= askedTo);
  if (first < 0 || last < first || !sounds.slice(first, last + 1).some((s) => !s.unheard)) throw new Error(`${where} has no words said between ${asked} and ${askedTo} s to speak a line from`);
  const keep = new Set(edits.keep ?? []), kept = new Set<number>();
  const keeps = (from: number, to: number) => [...keep].filter((t) => from <= t && t <= to).map((t) => kept.add(t)).length > 0;

  // The rules see the line's words alone; each find maps back to the sounds it covers.
  const said = [...Array(last - first + 1).keys()].map((k) => first + k).filter((i) => !sounds[i].unheard);
  const found = (edits.rules ?? SPOKEN_CLEANUP_RULES).flatMap((rule) => rule(said.map((i) => sounds[i])))
    .map(({ kind, flag, first: word, count }): Find => ({ kind, flag, from: said[word], to: said[word + count - 1] }))
    // Two rules finding the same words ("we- we" is a stutter and a false start) make one removal, the first rule's.
    .filter(({ from, to }, k, all) => all.findIndex((f) => f.from === from && f.to === to) === k);
  const restored = found.filter(({ from, to }) => keeps(sounds[from].start, sounds[to].end));
  const forced = (edits.cut ?? []).map((t) => {
    const i = sounds.findIndex((s, k) => k >= first && k <= last && s.start <= t && t <= s.end);
    if (i < 0) throw new Error(`${where} says nothing at ${t} s in the line from ${asked} to ${askedTo} s to cut`);
    // A cut on a find the line left in (no quiet beside it) takes the whole find.
    return found.find((f) => f.from <= i && i <= f.to && !restored.includes(f)) ?? { kind: 'cut', flag: undefined, from: i, to: i };
  });
  const takenBy = new Map<number, { finds: Set<Find>; forced: boolean }>();
  for (const find of new Set([...found.filter((f) => !restored.includes(f)), ...forced])) {
    for (let i = find.from; i <= find.to; i++) {
      const at = takenBy.get(i) ?? { finds: new Set(), forced: false };
      at.finds.add(find);
      at.forced ||= forced.includes(find);
      takenBy.set(i, at);
    }
  }
  // Runs of taken sounds, each kept whole unless both its joins land in quiet or a dip (or a line's `cut` asks for it).
  const runs: Taken[] = [];
  for (let i = first; i <= last; i++) {
    const at = takenBy.get(i);
    if (!at) continue;
    const run = runs.at(-1);
    if (run?.last === i - 1) {
      run.last = i;
      at.finds.forEach((f) => run.finds.includes(f) || run.finds.push(f));
      run.forced ||= at.forced;
    } else runs.push({ first: i, last: i, finds: [...at.finds], forced: at.forced });
  }
  const inQuiet = (t: number) => inside(voice.quiet, t) !== undefined;
  const join = (i: number, edge: number, force: boolean) => {
    if (inQuiet(edge)) return { time: edge, shallow: false };
    const dip = dipBetween(voice, i, DIP_DEPTH_HALF_DB);
    if (dip !== undefined || !force) return dip;
    // A forced cut still seeks the trough when the contrast is weak.
    return dipBetween(voice, i, 1) ?? { time: edge, shallow: true };
  };
  const cuts = runs.map((run) => Object.assign(run, {
    from: run.first > first ? join(run.first - 1, decayEdge(voice, run.first - 1), run.forced) : undefined,
    to: run.last < last ? join(run.last, leadEdge(voice, run.last + 1), run.forced) : undefined,
  }));
  const taken = cuts.filter((r) => (r.first === first || r.from !== undefined) && (r.last === last || r.to !== undefined));
  const head = taken.find((r) => r.first === first), tail = taken.find((r) => r.last === last);
  const keptSounds = [...Array(last - first + 1).keys()].map((k) => first + k).filter((i) => !taken.some((run) => run.first <= i && i <= run.last));
  if (!keptSounds.some((i) => !sounds[i].unheard)) throw new Error(`${where}'s line from ${asked} to ${askedTo} s says nothing once its ${taken.flatMap((r) => r.finds.map((f) => f.kind)).join(', ')} are cut: keep one`);

  // Pieces: runs of kept sounds, split where a run was taken and where a pause runs past the cap.
  const cap = edits.pauseCap ?? LIBRARY_PAUSE_CAP;
  const joins: SpokenJoin[] = [];
  const pieces: Span[] = [], gaps: { from: number; to: number; run?: Taken }[] = [], keptPauses: Span[] = [];
  let start = head?.to?.time ?? leadEdge(voice, keptSounds[0]);
  keptSounds.forEach((i, k) => {
    const next = keptSounds[k + 1];
    if (next === undefined) return;
    const run = taken.find((r) => r.first === i + 1);
    if (run) {
      pieces.push({ start, end: run.from!.time });
      joins.push(run.from!.shallow ? VOICED_JOIN : QUIET_JOIN);
      start = run.to!.time;
      gaps.push({ from: pieces.at(-1)!.end, to: start, run });
      return;
    }
    const pause = shortenedPause(voice, i, next, cap);
    // Checked before the cap: a pause kept by review stays kept once a raised cap no longer shortens it.
    const held = keeps(sounds[i].end, sounds[next].start);
    if (!pause) return;
    if (held) {
      keptPauses.push({ start: pause.from, end: pause.to });
      return;
    }
    pieces.push({ start, end: pause.from });
    start = pause.to;
    gaps.push(pause);
    joins.push(QUIET_JOIN);
  });
  pieces.push({ start, end: tail?.from?.time ?? decayEdge(voice, keptSounds.at(-1)!) });
  for (const t of keep) if (!kept.has(t)) throw new Error(`${where}'s line from ${asked} to ${askedTo} s takes nothing out at ${t} s to keep`);

  const at = [0];
  for (const p of pieces.slice(0, -1)) at.push(at.at(-1)! + p.end - p.start);
  const lineTime = (t: number) => {
    const k = Math.max(0, pieces.findLastIndex((p) => p.start <= t));
    return round(at[k] + Math.min(Math.max(t, pieces[k].start), pieces[k].end) - pieces[k].start);
  };
  const removals = gaps.flatMap(({ from, to, run }, k): SpokenRemoval[] => {
    const jump = round(at[k + 1]);
    if (!run) return [{ kind: 'pause', text: '', from: round(from), to: round(to), at: jump, keepAt: round((from + to) / 2) }];
    return removalsOf(run.finds, sounds, jump, forced);
  });
  // A run taken from either end of the line only moves its edge.
  if (head) removals.unshift(...removalsOf(head.finds, sounds, 0, forced));
  if (tail) removals.push(...removalsOf(tail.finds, sounds, lineTime(Infinity), forced));
  // What the line leaves in, at the line second it plays: what its `keep` restored, and runs with no quiet to cut in.
  const left: SpokenRemoval[] = [
    ...restored.flatMap((f) => removalsOf([f], sounds, lineTime(sounds[f.from].start)).map((r) => Object.assign(r, { left: 'kept' as const }))),
    ...cuts.filter((r) => !taken.includes(r))
      .flatMap((r) => removalsOf(r.finds, sounds, lineTime(sounds[r.first].start)).map((x) => Object.assign(x, { left: 'no quiet' as const }))),
    ...keptPauses.map(({ start: from, end: to }) => ({ kind: 'pause', text: '', from: round(from), to: round(to), at: lineTime(from), keepAt: round((from + to) / 2), left: 'kept' as const })),
  ];
  removals.push(...left);
  removals.sort((a, b) => a.at - b.at);

  const within = (span: Span) => pieces.some((p) => p.start <= span.start && span.end <= p.end);
  const dips: SpokenDip[] = [
    ...voice.soft.filter((s) => within(s) && !keptSounds.some((i) => inside([s], middle(sounds[i])!) !== undefined)).map((s) => ({ start: lineTime(s.start), end: lineTime(s.end), gain: BREATH_GAIN })),
    ...voice.clicks.map((c) => ({ start: c.start - CLICK_MARGIN, end: c.end + CLICK_MARGIN })).filter(within)
      .map((c) => ({ start: lineTime(c.start), end: lineTime(c.end), gain: 0 })),
  ].toSorted((a, b) => a.start - b.start);
  const heard = keptSounds.filter((i) => !sounds[i].unheard).map((i) => ({ text: sounds[i].text, start: lineTime(sounds[i].start), end: lineTime(sounds[i].end) }));
  const unheard = keptSounds.filter((i) => sounds[i].unheard).map((i) => ({ from: sounds[i].start, to: sounds[i].end, at: lineTime(sounds[i].start) }));
  const rounded = pieces.map((p) => ({ from: round(p.start), to: round(p.end) }));
  const edgeOf = (t: number): SpokenEdge => (inQuiet(t) ? 'clean' : 'rough');
  return { from: rounded[0].from, to: rounded.at(-1)!.to, edges: { in: edgeOf(pieces[0].start), out: edgeOf(pieces.at(-1)!.end) }, pieces: rounded, joins, removals, unheard, heard, dips };
}

/** The removals a taken run's finds make, all at line second `at`, each restored by a moment inside its first word. */
function removalsOf(finds: readonly Find[], sounds: readonly LibraryLineSound[], at: number, cut: readonly Find[] = []): SpokenRemoval[] {
  return finds.map((find) => ({
    kind: find.kind, text: sounds.slice(find.from, find.to + 1).map((s) => s.text).join(' '), from: sounds[find.from].start, to: sounds[find.to].end, at,
    keepAt: round(middle(sounds[find.from])!), ...(find.flag && { flag: find.flag }), ...(cut.includes(find) && { cut: true as const }),
  }));
}

/**
 * The stretch of the pause between sounds `i` and `next` to take out so `cap` seconds of it stay, or none: kept are
 * the decay after `i` and the quiet before `next`'s breath, so the cut sits in the quiet, and the breath stays whole.
 */
function shortenedPause(voice: LibraryLineVoice, i: number, next: number, cap: number): { from: number; to: number } | undefined {
  const { sounds, quiet } = voice, phrase = breathBefore(voice, next)?.start ?? sounds[next].start;
  if (phrase - sounds[i].end <= cap) return undefined;
  let from = decayEdge(voice, i), to = leadEdge(voice, next);
  const fromQuiet = inside(quiet, from), toQuiet = inside(quiet, to);
  if (!fromQuiet || !toQuiet) return undefined;
  // Shorter than the cap once cut: the decay side takes the difference first, the breath side what's left.
  const short = cap - ((from - sounds[i].end) + (phrase - to));
  if (short > 0) {
    const later = Math.min(fromQuiet.end, from + short);
    to = Math.max(toQuiet.start, to - (short - (later - from)));
    from = later;
  }
  return from < to ? { from, to } : undefined;
}
