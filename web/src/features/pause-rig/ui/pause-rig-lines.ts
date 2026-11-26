// pause-rig-lines.ts: what the pause rig plays: lines from several library takes, each cut through the real cleanup, and
// the short clips around each pause it changed or filler it took. Pure.
import { spokenPieceSeconds, type RecordedSpeech, type SpokenStretch } from '#lib/timing/voice/models/recorded-speech.ts';

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

/** A stretch of a line the rig plays, in item seconds, and the pause or filler it's centred on. */
export type PauseRigClip = { line: number; from: number; to: number; about: string };

// Seconds of the take either side of what a clip is about, as recorded.
const CLIP_CONTEXT = 1.5;

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

/** Each pause `speech` sped up or cut and each filler or stutter it took, as clips of the take around them, in order. */
export function pauseRigClipsOf(line: number, speech: RecordedSpeech): PauseRigClip[] {
  const around = (from: number, to: number, about: string) => ({ line, from: Math.max(speech.from, from - CLIP_CONTEXT), to: Math.min(speech.to, to + CLIP_CONTEXT), about });
  const pauses = speech.pauses.filter((p) => p.speed > 1).map((p) => around(p.from, p.to, `${p.kind} ${(p.to - p.from).toFixed(2)} s`));
  const taken = speech.removals.filter((r) => r.kind !== 'pause' && !r.left).map((r) => around(r.from, r.to, `${r.kind} "${r.text}"`));
  return [...pauses, ...taken].toSorted((a, b) => a.from - b.from);
}
