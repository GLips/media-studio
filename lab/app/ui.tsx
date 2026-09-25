// ui.tsx: the pieces every lab tab is built from: its plain-words intro, a stage that plays a Remotion composition
// live, and the controls that drive it. Colours are the motion showcase's (projects/2026-09-motion-showcase), so the
// lab looks like the reels it explains.
import { Player } from '@remotion/player';
import type { ComponentType, ReactNode } from 'react';
import { FPS, H, W } from '../../lib/studio/frame.ts';

/** The showcase palette: its ground, ink, cream, red-orange and cobalt. */
export const LAB_COLORS = {
  ground: '#0c0c0e',
  panel: '#16161a',
  line: '#2a2a31',
  cream: '#f3f0e7',
  dim: '#8d8a83',
  red: '#ee4c23',
  cobalt: '#4144f4',
  ink: '#140b0e',
  pass: '#3ccf7a',
} as const;

/**
 * A tab's opening: what the capability is, when a video reaches for it, and what it looks like done badly and well.
 * Written for someone who has never made a video.
 */
export function LabTabIntro({ number, title, what, when, bad, good }: {
  number: number; title: string; what: ReactNode; when: ReactNode; bad: ReactNode; good: ReactNode;
}) {
  return (
    <section className="intro">
      <span className="hud">{String(number).padStart(2, '0')} —</span>
      <h2>{title}</h2>
      <p className="what">{what}</p>
      <div className="intro-grid">
        <div><span className="hud">WHEN A VIDEO USES IT</span><p>{when}</p></div>
        <div className="bad"><span className="hud">DONE BADLY</span><p>{bad}</p></div>
        <div className="good"><span className="hud">DONE WELL</span><p>{good}</p></div>
      </div>
    </section>
  );
}

/**
 * A composition playing live, looped, in a bracketed frame. Its props re-render it as they change, so controls feel
 * immediate. 1920×1080 at the studio's frame rate unless a tab needs another shape.
 */
export function LabStage<P extends Record<string, unknown>>({ component, inputProps, seconds, width = W, height = H, label, controls = true }: {
  component: ComponentType<P>; inputProps: P; seconds: number; width?: number; height?: number; label?: string; controls?: boolean;
}) {
  return (
    <figure className="stage">
      {label && <figcaption className="hud">{label}</figcaption>}
      <Player
        component={component as ComponentType<Record<string, unknown>>}
        inputProps={inputProps}
        durationInFrames={Math.max(1, Math.round(seconds * FPS))}
        fps={FPS}
        compositionWidth={width}
        compositionHeight={height}
        style={{ width: '100%', aspectRatio: `${width} / ${height}` }}
        controls={controls}
        loop
        autoPlay
        acknowledgeRemotionLicense
      />
    </figure>
  );
}

/** The controls beside or under a stage. */
export function LabControls({ children }: { children: ReactNode }) {
  return <div className="controls">{children}</div>;
}

/** A labelled slider with its value shown, and an optional plain-words hint under it. */
export function LabSlider({ label, value, min, max, step = 0.01, onChange, format = (v) => String(v), hint }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; hint?: ReactNode;
}) {
  return (
    <label className="slider">
      <span className="row"><span>{label}</span><output className="hud">{format(value)}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** One of a few named options, as a row of buttons. */
export function LabChoice<T extends string | number>({ label, options, value, onChange, hint }: {
  label: string; options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void; hint?: ReactNode;
}) {
  return (
    <div className="choice">
      <span>{label}</span>
      <div className="choice-row">
        {options.map((o) => (
          <button key={String(o.value)} type="button" className={o.value === value ? 'on' : undefined} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
      {hint && <small>{hint}</small>}
    </div>
  );
}

/** A short aside under a stage: a takeaway, or how to read what's on it. */
export function LabNote({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>;
}
