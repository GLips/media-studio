// Where the sound lands on each slam of the showcase: for every cut, lens kick and placed sound, the music's transient
// and the placed sound's nearest its frame, in ms after the frame's start, and the gap between the two. The picture
// leads by design. Flags a FLAM (two attacks 15–100 ms apart, heard as two hits) and a SILENT slam (no hit in the
// music there and no placed sound).
//   node projects/2026-09-motion-showcase/tools/sfx-sync.ts
// Timing only: `studio mix --check` judges the levels.
import '../../../lib/studio/tsx-test-hooks.ts';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { default: video, showcaseBars } = await import('../video.tsx');
const FPS = 30, RATE = 16000;

function decode(inputs: string[], filter: string): Float32Array {
  const out = execFileSync('ffmpeg', ['-v', 'error', ...inputs, '-filter_complex', filter, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(out.buffer, out.byteOffset, out.byteLength / 4);
}

// Level in 8 ms windows every 2 ms. Above 1.5 kHz a hit's attack is sharpest; the full band hears a kick's boom.
const HOP = RATE * 0.002, WIN = RATE * 0.008;
const ATTACK_BAND = ',highpass=f=1500';
function envelopeDb(x: Float32Array) {
  const env = new Float32Array(Math.max(0, Math.floor((x.length - WIN) / HOP)));
  for (let i = 0; i < env.length; i++) {
    let sum = 0;
    for (let j = 0; j < WIN; j++) sum += x[i * HOP + j] ** 2;
    env[i] = 10 * Math.log10(sum / WIN + 1e-12);
  }
  return env;
}
// Within [from, to] seconds: the biggest jump over the level 8–16 ms before (its time, the window's centre, and size),
// and the loudest moment, which is where a swell (a whip) lands.
function onsetNear(env: Float32Array, from: number, to: number) {
  const found = { t: NaN, rise: 0, peak: NaN };
  let loudest = -Infinity;
  for (let i = Math.max(8, Math.round(from * RATE / HOP)); i <= Math.min(env.length - 1, Math.round(to * RATE / HOP)); i++) {
    const t = (i * HOP + WIN / 2) / RATE;
    const rise = env[i] - Math.max(env[i - 8], env[i - 6], env[i - 4]);
    if (rise > found.rise) Object.assign(found, { t, rise });
    if (env[i] > loudest) [loudest, found.peak] = [env[i], t];
  }
  return found;
}

const trackFile = fileURLToPath(video.music.track.src);
const musicAttack = envelopeDb(decode(['-i', trackFile], `[0:a]anull${ATTACK_BAND}`));
const musicFull = envelopeDb(decode(['-i', trackFile], '[0:a]anull'));
// A placed sound lands on its `at` to the sample (a strike on its contact, a whip passing, a riser peaking), so its
// time is read, not searched for: an attack search catches a needle's buzz lead ahead of its strike.
const soundLandsAt = new Map<string, number>((video.sounds ?? []).map((s: any) => [s.id, s.at]));

// Every frame the picture slams on: a bar's cut, a lens kick, a placed sound.
const events = new Map<number, { bar: string; what: string[]; soundId?: string }>();
const mark = (f: number, bar: string, what: string, soundId?: string) => {
  const e = events.get(f) ?? { bar, what: [] };
  e.what.push(what);
  if (soundId) e.soundId = soundId;
  events.set(f, e);
};
for (const bar of showcaseBars) {
  if (bar.from > 0) mark(bar.from, bar.id, 'cut');
  for (const f of bar.kicks ?? []) mark(f, bar.id, 'kick');
  for (const s of bar.sounds ?? []) mark(s.at, bar.id, 'sound', `${bar.id}@${s.at}`);
}

const ms = (t: number, f: number) => (Number.isNaN(t) ? '—' : `${Math.round((t - f / FPS) * 1000)}`).padStart(5);
const db = (rise: number) => rise.toFixed(0).padStart(3);
console.log('frame  bar          slam           music ms (rise, full band)   sound ms   gap');
for (const [f, e] of [...events].sort((a, b) => a[0] - b[0])) {
  const T = f / FPS;
  const m = onsetNear(musicAttack, T - 0.1, T + 0.15), full = onsetNear(musicFull, T - 0.1, T + 0.15);
  const at = e.soundId ? soundLandsAt.get(e.soundId)! : NaN;
  const musicHits = m.rise >= 12 || full.rise >= 8;
  const gap = e.soundId && musicHits ? Math.round((at - m.t) * 1000) : NaN;
  const flag = !e.soundId && !musicHits ? 'SILENT' : Math.abs(gap) >= 15 && Math.abs(gap) <= 100 ? 'FLAM' : '';
  console.log(`${String(f).padStart(5)}  ${e.bar.padEnd(11)}  ${e.what.join('+').padEnd(13)}  ${ms(m.t, f)} (${db(m.rise)}, ${db(full.rise)})               ${ms(at, f)}  ${Number.isNaN(gap) ? '    ' : String(gap).padStart(4)}  ${flag}`);
}
