import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placedSoundClipsOf, soundEnvelopeGainAt, soundEnvelopeOf, type SoundClipFrameReport } from './sound-clip.ts';

// A 30 ms quarter-sine fade in, as a clean edge of a recorded line.
const fade = (s: number) => Math.sin((Math.PI / 2) * Math.min(1, s / 0.03));

test('a fade compiles to a few points that follow its curve, and a held gain to a constant', () => {
  const envelope = soundEnvelopeOf(fade, 2, 'line');
  assert.ok(Array.isArray(envelope) && envelope.length < 40, `${Array.isArray(envelope) ? envelope.length : 0} points`);
  for (let s = 0; s <= 0.05; s += 0.0001) assert.ok(Math.abs(soundEnvelopeGainAt(envelope, s) - fade(s)) < 1e-3, `at ${s}`);
  assert.equal(soundEnvelopeOf(0.5, 2, 'line'), 0.5);
  assert.throws(() => soundEnvelopeOf(() => Number.NaN, 1, 'line'), /line's volume is NaN/);
});

test('a clip mounted on many frames is one clip, two plays of one sound are two, and every frame must report', () => {
  const click = { id: 'sfx click 0', src: 'http://x/click.wav', from: 0, duration: null, loop: false, gain: 1, scene: 'hook' };
  // Frames 0–2 see one click 0.1 s after frame 1; frame 2 also sees a second click 0.5 s later.
  const reports: SoundClipFrameReport[] = [
    { frame: 0, clips: [{ ...click, fromNow: 1 / 30 + 0.1 }] },
    { frame: 1, clips: [{ ...click, fromNow: 0.1 }] },
    { frame: 2, clips: [{ ...click, fromNow: 0.1 - 1 / 30 }, { ...click, fromNow: 0.6 - 1 / 30 }] },
  ];
  const placed = placedSoundClipsOf(reports, 30, 3);
  assert.deepEqual(placed.map((c) => Math.round(c.start * 1e6) / 1e6), [1 / 30 + 0.1, 1 / 30 + 0.6].map((s) => Math.round(s * 1e6) / 1e6));
  assert.throws(() => placedSoundClipsOf(reports, 30, 4), /heard from 3 of 4 frames/);
  const drifting: SoundClipFrameReport[] = reports.map(({ frame, clips }) => ({ frame, clips: [Object.assign(structuredClone(clips[0]), { gain: frame })] }));
  assert.throws(() => placedSoundClipsOf(drifting, 30, 3), /volume differs between frame/);
});
