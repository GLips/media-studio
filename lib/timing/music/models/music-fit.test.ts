import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planMusicArrangement, planMusicFit, spliceMusicSpans } from './music-fit.ts';

/** Two pickup beats, 4 bars of drums, 12 bars cycling four chords, then a final hit (bar 17) that rings out to `ringEnd`. */
function syntheticTrack() {
  const rate = 22050, beat = 0.6, bar = 4 * beat, first = 0.3, pickup = 2;
  const barOne = first + pickup * beat, finalHit = barOne + 16 * bar, ringEnd = finalHit + 2;
  const samples = new Float32Array(Math.ceil((ringEnd + 1) * rate));
  const add = (at: number, seconds: number, f: (s: number) => number) => {
    for (let k = 0; k < seconds * rate; k++) samples[Math.round(at * rate) + k] += f(k / rate);
  };
  const beats = Array.from({ length: pickup + 16 * 4 + 1 }, (_, k) => first + k * beat);
  for (const [k, t] of beats.entries()) {
    const one = (k - pickup) % 4 === 0;
    if (t < finalHit) add(t, 0.1, (s) => (one ? 0.8 : 0.35) * Math.exp(-s / 0.02) * Math.sin(2 * Math.PI * 60 * s));
  }
  const chords = [[220, 277, 330], [196, 247, 294], [175, 220, 262], [165, 208, 247]];
  for (let b = 4; b < 16; b++) add(barOne + b * bar, bar, (s) => chords[b % 4].reduce((sum, hz) => sum + 0.08 * Math.sin(2 * Math.PI * hz * s), 0));
  add(finalHit, ringEnd - finalHit, (s) => 0.6 * (1 - s / 2) ** 3 * Math.sin(2 * Math.PI * 110 * s));
  return { samples, rate, beats, bar, pickup, barOne, finalHit, ringEnd };
}

test('fits a track shorter, longer and far longer on its bar lines, keeping its ending last', () => {
  const { samples, rate, beats, bar, pickup, ringEnd } = syntheticTrack();
  for (const targetSeconds of [30, 75, 130]) {
    const plan = planMusicFit({ samples, rate, beats, targetSeconds });
    const [out] = spliceMusicSpans([samples], rate, plan.spans, targetSeconds);
    assert.equal(out.length, Math.round(targetSeconds * rate));
    assert.equal(plan.downbeatPhase, pickup);
    // The ring-out drops under the silence line a little before ringEnd.
    assert.ok(Math.abs(plan.spans.at(-1)!.to - ringEnd) < 0.3, `ends at ${plan.spans.at(-1)!.to}, not the ring-out's end`);
    assert.ok(plan.seams.length > 0);
    for (const [i, span] of plan.spans.slice(1).entries()) {
      const bars = (span.from - plan.spans[i].to) / bar;
      assert.ok(bars !== 0 && Math.abs(bars - Math.round(bars)) < 0.01, `a seam jumps ${bars} bars`);
    }
    for (const seam of plan.seams) assert.ok(plan.downbeats.some((d) => Math.abs(d - seam) < 0.03), `seam at ${seam}s isn't on a downbeat`);
  }
});

test('plays the bars an arrangement lists in order, then the ending and a tail of silence', () => {
  const { samples, rate, beats, bar, barOne, finalHit, ringEnd } = syntheticTrack();
  const plan = planMusicArrangement({ samples, rate, beats, bars: [1, 2, 3, 4, 7, 8, 9, 10, 17], tailSeconds: 1 });
  // Bars 5–6 and 11–16 are skipped: the second run starts two bars on, the ending six.
  assert.deepEqual(plan.spans.slice(1).map((s, i) => Math.round((s.from - plan.spans[i].to) / bar)), [2, 6]);
  assert.equal(plan.downbeats.length, 9);
  for (const seam of plan.seams) assert.ok(plan.downbeats.some((d) => Math.abs(d - seam) < 0.03), `seam at ${seam}s isn't on a downbeat`);
  const ringSeconds = ringEnd - finalHit;
  assert.ok(Math.abs(plan.seconds - (barOne + 8 * bar + ringSeconds + 1)) < 0.3, `${plan.seconds} s long`);
  // The tail is the picture's to hold: the music has rung out under it.
  const [out] = spliceMusicSpans([samples], rate, plan.spans, plan.seconds);
  assert.ok(out.subarray(out.length - Math.round(0.9 * rate)).every((v) => Math.abs(v) < 1e-3), 'the tail isn\'t silent');
});
