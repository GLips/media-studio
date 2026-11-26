import assert from 'node:assert/strict';
import { test } from 'node:test';
import { duckSpans, musicGainAt, musicLevels, recordedPieceClips, VOICE_LUFS, type MusicTrack } from './mix.ts';

test('music sits at the bed between lines, ducks under them, holds through a short breath, and fades at the ends', () => {
  const track: MusicTrack = { src: 'bed.mp3', duration: 60, lufs: VOICE_LUFS + 2, bpm: 120, beats: [] };
  const levels = musicLevels({ track, bedRelativeLu: -8, duckedRelativeLu: -18 });
  const spans = duckSpans([{ start: 2, end: 4 }, { start: 4.3, end: 6 }, { start: 10, end: 12 }]);
  const db = (t: number) => 20 * Math.log10(musicGainAt(t, spans, levels, 20, { in: true, out: true }));
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a.toFixed(2)} dB, expected ${b}`);

  near(db(8), -10);   // the bed: 8 LU under the voice, from a track 2 LU louder than it
  near(db(3), -20);   // under a line
  near(db(4.15), -20); // a 0.3 s breath between lines doesn't bring it back up
  near(db(6.6), -10); // back up once the release is over
  assert.ok(db(0.5) < -15 && db(19) < -15, 'fades in and out');
});

const closeTo = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} should be ${b}`);

test('a voiced join tapers only the outgoing clip and the next quiet join stays equal-power', () => {
  const [the, voice, call] = recordedPieceClips({
    item: 'take', file: 'mic.wav', dips: [], fade: { in: 0, out: 0 },
    pieces: [0, 1, 2].map((at) => ({ start: 2 * at, at, duration: 1, speed: 1 })),
    joins: [{ fadeOut: 0.06, crossfade: 0.01 }, { fadeOut: 0, crossfade: 0.02 }],
  }, 3);
  closeTo(the.duration, 1.005);
  closeTo(voice.at, 0.995);
  closeTo(the.gain(the.duration - 0.03), Math.SQRT1_2);
  closeTo(the.gain(1), Math.sin(Math.PI / 24) * Math.SQRT1_2);
  closeTo(voice.gain(1 - voice.at), Math.SQRT1_2);
  closeTo(voice.gain(0.01), 1);
  closeTo(call.at, 1.99);
  closeTo(voice.gain(2 - voice.at) ** 2 + call.gain(2 - call.at) ** 2, 1);
  closeTo(voice.gain(1.98 - voice.at), 1);
});
