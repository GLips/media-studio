// sfx-waveform.tsx: one rendered sound drawn as its waveform, with a time ruler, a marker where its hit lands, the
// last take faintly behind it, and a playhead while it plays.
import { useEffect, useRef } from 'react';
import { LAB_COLORS } from '../../ui.tsx';

const WAVE_W = 1200, WAVE_H = 240, RULER_H = 22;

/** A ruler step that gives roughly six to twelve ticks across `seconds`. */
const rulerStep = (seconds: number) => [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2].find((s) => seconds / s <= 12) ?? 5;

function drawSfxWave(ctx: CanvasRenderingContext2D, samples: Float32Array, pxPerSample: number, scale: number, color: string) {
  const mid = ((WAVE_H - RULER_H) / 2) * scale;
  ctx.fillStyle = color;
  const columns = Math.ceil(samples.length * pxPerSample);
  for (let x = 0; x < columns; x++) {
    const from = Math.floor(x / pxPerSample), to = Math.min(samples.length, Math.floor((x + 1) / pxPerSample));
    let lo = 0, hi = 0;
    for (let i = from; i < Math.max(to, from + 1); i++) {
      lo = Math.min(lo, samples[i] ?? 0);
      hi = Math.max(hi, samples[i] ?? 0);
    }
    ctx.fillRect(x, (WAVE_H - RULER_H) / 2 - hi * mid, 1, Math.max(1, (hi - lo) * mid));
  }
}

export function SfxWaveform({ samples, ghost, rate, landsAt, playhead }: {
  samples: Float32Array; ghost?: Float32Array; rate: number; landsAt: number; playhead: number | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Both takes share one time scale, with a little room after the longer one.
  const seconds = (Math.max(samples.length, ghost?.length ?? 0) / rate) * 1.04;
  useEffect(() => {
    const ctx = canvas.current!.getContext('2d')!;
    ctx.clearRect(0, 0, WAVE_W, WAVE_H);
    const pxPerSample = WAVE_W / (seconds * rate);
    // Drawn to fill the height: every sound is levelled quietly under the voice, so at true scale most are a sliver.
    const peak = [samples, ghost ?? samples].reduce((m, s) => s.reduce((a, v) => Math.max(a, Math.abs(v)), m), 1e-6);
    const scale = 0.92 / peak;
    ctx.fillStyle = LAB_COLORS.line;
    ctx.fillRect(0, (WAVE_H - RULER_H) / 2, WAVE_W, 1);
    if (ghost) drawSfxWave(ctx, ghost, pxPerSample, scale, 'rgba(141,138,131,0.35)');
    drawSfxWave(ctx, samples, pxPerSample, scale, LAB_COLORS.cream);
    const step = rulerStep(seconds);
    ctx.font = '12px "JetBrains Mono", monospace';
    for (let t = 0; t <= seconds; t += step) {
      const x = (t / seconds) * WAVE_W;
      ctx.fillStyle = LAB_COLORS.line;
      ctx.fillRect(x, WAVE_H - RULER_H, 1, 6);
      ctx.fillStyle = LAB_COLORS.dim;
      ctx.fillText(`${Number(t.toFixed(2))} s`, x + 4, WAVE_H - 6);
    }
  }, [samples, ghost, rate, seconds]);
  return (
    <div className="sfx-wave">
      <canvas ref={canvas} width={WAVE_W} height={WAVE_H} />
      <div className="sfx-lands" style={{ left: `${(landsAt / seconds) * 100}%` }}>
        <span className="hud">where the hit lands · {landsAt.toFixed(2)} s</span>
      </div>
      {playhead !== null && <div className="sound-playhead" style={{ left: `${(playhead / seconds) * 100}%` }} />}
    </div>
  );
}
