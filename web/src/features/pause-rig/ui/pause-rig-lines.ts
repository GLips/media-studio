// pause-rig-lines.ts: what the pause rig plays: lines from several library takes, each cut through the real cleanup, and
// the short clips around each pause it changed or filler it took. Pure.
import type { SpokenPauseKind } from '#lib/footage/transcript/models/spoken-pauses.ts';
import { spokenItemTimeAt, spokenPieceSeconds, spokenStretchSeconds, type RecordedSpeech, type SpokenStretch } from '#lib/timing/voice/models/recorded-speech.ts';

/** A line of a take, in item seconds, and what it's in the playlist to test. */
export type PauseRigLineSpec = { item: string; from: number; to: number; about: string };

// Several takes, slow (214148, 3.8 syllables a second) to fast (125659, 6.7), each with a mid-phrase hesitation, a
// pause where a sentence ends, or a filler; the cap trial's 4.5 s restart is the one long enough to be cut.
export const PAUSE_RIG_LINES: readonly PauseRigLineSpec[] = [
  { item: '2026-11-25-142828', from: 19.5, to: 26.2, about: '"And, um, I am curious": a filler in a long stop' },
  { item: '2026-11-22-cap-trial-lg-ultrafine-2026-11-22-4-10-pm', from: 83.0, to: 88.5, about: '"inside TK … can be operated": a 2.2 s hesitation' },
  { item: '2026-11-22-cap-trial-lg-ultrafine-2026-11-22-4-10-pm', from: 28.5, to: 40.3, about: '"a definition that… Each agent": a 4.5 s restart' },
  { item: '2026-11-25-110327', from: 90.5, to: 97.5, about: 'two hesitations of 1.3 s in a row' },
  { item: '2026-11-25-110327', from: 5.0, to: 11.0, about: '"open up the … Recording studio": a hesitation after "the"' },
  { item: '2026-11-25-115211', from: 126.0, to: 137.0, about: 'boundaries and an "uh…" hesitation' },
  { item: '2026-11-23-212522', from: 4.0, to: 12.5, about: 'a 1.4 s boundary, then hesitations' },
  { item: '2026-11-25-110127', from: 33.0, to: 41.0, about: 'quick boundaries, "10 or … 15?"' },
  { item: '2026-11-22-214148', from: 3.5, to: 10.5, about: 'a slow speaker trailing off: "and… That"' },
  { item: '2026-11-24-125659', from: 0, to: 12, about: 'fast speech, short pauses: little should change' },
];

// The confirmation pass's lines, by index: a long hesitation, boundaries with an "uh", a long boundary, fast speech.
export const PAUSE_RIG_CONFIRM_LINES: readonly number[] = [1, 5, 6, 9];

/** A stretch of a line the rig plays, in item seconds, and the pause or filler it's centred on. */
export type PauseRigClip = { line: number; from: number; to: number; about: string; pause?: { kind: SpokenPauseKind; from: number; heard: number } };

// Seconds of the take either side of what a clip is about, as recorded.
const CLIP_CONTEXT = 1.5;
// "1 or 2?" leads into its pause with this many seconds of the line as played, back to the start of a word, so a few
// whole words set up the pause, and plays a second on after it.
const PICK_LEAD = 2.25, PICK_AFTER = 1;
// Pauses shorter than this play as recorded under any pacing worth asking about.
const PICK_PAUSE = 0.4;
// The join from a lead-in to its line: both edges sit in quiet beside their words.
const LEAD_IN_JOIN = { crossfade: 0.02, fadeOut: 0 };
// Clip edges to the millisecond, so a logged clip reads cleanly.
const ms = (t: number) => Math.round(t * 1000) / 1000;

/** The line second a stretch plays item second `t` at: before its first piece, its start; past its last, its end. */
export function pauseRigLineTimeOf({ pieces }: Pick<SpokenStretch, 'pieces'>, t: number): number {
  let at = 0;
  for (const p of pieces) {
    if (t < p.from) return at;
    if (t <= p.to) return at + (t - p.from) / (p.speed ?? 1);
    at += spokenPieceSeconds(p);
  }
  return at;
}

/**
 * Where a clip leading `lead` seconds as played into the pause at item second `pauseFrom` starts, on item time: on
 * the start of a word in `line`, or when the line holds too little before it, of one in the take before the line
 * (`words`, item time), bounded only by the take's first word.
 */
export function pauseRigLeadStart(words: readonly { start: number; end: number }[], line: RecordedSpeech, pauseFrom: number, lead: number): number {
  const before = pauseRigLineTimeOf(line, pauseFrom);
  if (before >= lead) return spokenItemTimeAt(line, line.heard.findLast((w) => w.start <= before - lead)?.start ?? 0);
  const target = line.from - (lead - before);
  // Only words said whole before the line, so the lead-in has something to play.
  const whole = words.filter((w) => w.end <= line.from);
  return Math.min(line.from, (whole.findLast((w) => w.start <= target) ?? whole[0])?.start ?? line.from);
}

/**
 * `line` with `lead`, a stretch of the same take just before it, played first: as one speech the rig's player plays
 * through, joined in a short crossfade. Only what playing reads is joined; its removals and unheard are `line`'s.
 */
export function pauseRigWithLeadIn(lead: RecordedSpeech, line: RecordedSpeech): RecordedSpeech {
  // A lead-in's out-edge pads into the quiet past the line's in-edge: it ends where the line starts instead.
  const over = Math.max(0, lead.to - line.from);
  const leadPieces = lead.pieces.map((p, k) => (k === lead.pieces.length - 1 ? Object.assign({}, p, { to: p.to - over }) : p));
  const off = spokenStretchSeconds({ pieces: leadPieces }), later = (t: number) => t + off;
  const sound = lead.sound && line.sound && {
    ...line.sound,
    fade: { in: lead.sound.fade.in, out: line.sound.fade.out },
    pieces: [
      ...lead.sound.pieces.map((p, k, all) => (k === all.length - 1 ? Object.assign({}, p, { duration: p.duration - over }) : p)),
      ...line.sound.pieces.map((p) => Object.assign({}, p, { at: later(p.at) })),
    ],
    joins: [...lead.sound.joins, LEAD_IN_JOIN, ...line.sound.joins],
    dips: [...lead.sound.dips, ...line.sound.dips.map((d) => Object.assign({}, d, { start: later(d.start), end: later(d.end) }))],
  };
  return {
    ...line, from: lead.from, pieces: [...leadPieces, ...line.pieces], edges: { in: lead.edges.in, out: line.edges.out }, sound,
    heard: [...lead.heard, ...line.heard.map((w) => Object.assign({}, w, { start: later(w.start), end: later(w.end) }))],
    pauses: line.pauses.map((p) => Object.assign({}, p, { at: later(p.at) })),
  };
}

/** Each pause `speech` sped up or cut and each filler or stutter it took, as clips of the take around them, in order. */
export function pauseRigClipsOf(line: number, speech: RecordedSpeech): PauseRigClip[] {
  const around = (from: number, to: number, about: string) => ({ line, from: ms(Math.max(speech.from, from - CLIP_CONTEXT)), to: ms(Math.min(speech.to, to + CLIP_CONTEXT)), about });
  const pauses = speech.pauses.filter((p) => p.speed > 1).map((p) => Object.assign(around(p.from, p.to, `${p.kind} ${(p.to - p.from).toFixed(2)} s`), { pause: { kind: p.kind, from: p.from, heard: p.to - p.from } }));
  const taken = speech.removals.filter((r) => r.kind !== 'pause' && !r.left).map((r) => around(r.from, r.to, `${r.kind} "${r.text}"`));
  return [...pauses, ...taken].toSorted((a, b) => a.from - b.from);
}

/**
 * A clip around each pause in `speech` long enough for pacing to change, from a few whole words before it to a
 * second after. A pause beside a word lying wholly in `quiet` (item time) is left out: whisper wrote a word
 * where nothing was said, leaving no speech to judge the pause by.
 */
export function pauseRigPickClipsOf(line: number, speech: RecordedSpeech, quiet: readonly { start: number; end: number }[]): PauseRigClip[] {
  const words = speech.heard.map((w) => ({ start: spokenItemTimeAt(speech, w.start), end: spokenItemTimeAt(speech, w.end) }));
  const silent = (w: { start: number; end: number } | undefined) => !w || quiet.some((q) => q.start <= w.start && w.end <= q.end);
  const playedAt = (t: number) => spokenItemTimeAt(speech, Math.max(0, t));
  const leadIn = (t: number) => speech.heard.findLast((w) => w.start <= t)?.start ?? 0;
  return speech.pauses.filter((p) => p.to - p.from >= PICK_PAUSE)
    .filter((p) => !silent(words.findLast((w) => w.start < p.from)) && !silent(words.find((w) => w.end > p.to)))
    .map((p) => ({
      line, from: ms(Math.max(speech.from, playedAt(leadIn(pauseRigLineTimeOf(speech, p.from) - PICK_LEAD)))),
      to: ms(Math.min(speech.to, playedAt(pauseRigLineTimeOf(speech, p.to) + PICK_AFTER))),
      about: `${p.kind} of ${(p.to - p.from).toFixed(2)} s`, pause: { kind: p.kind, from: p.from, heard: p.to - p.from },
    }));
}
