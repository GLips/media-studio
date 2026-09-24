// framing-check.ts: turns the probe's per-frame measurements into problems a viewer would notice. Pure;
// lib/render-pipeline.ts renders the frames and prints what comes back.
//
// Two kinds of rule. Every highlight or click marks something the voice is describing, so one under a tag or the
// caption, off the frame or cut off by its panel is a problem wherever it happens. And a scene's `expect` says a named
// highlight must be showing, clear, for a span of the voice: "show what you say".
//
// Bounding boxes, not pixels: an overlap is a problem even if the pixels happen to miss.
//
// Take fits are warnings, not problems: a take played too fast or slow between its pins still shows what's said.
import { H, W } from './studio/frame.ts';
import type { TakeFitStrain } from './studio/take-fit-strain.ts';

type Rect = { x: number; y: number; w: number; h: number };

export type FramingMark = {
  kind: 'subject' | 'tag' | 'caption';
  name?: string;
  rect: Rect;
  /** The part of `rect` its clipping ancestors (a split panel, a phone screen) leave showing. */
  shown: Rect;
  strength: number;
  /** Its own opacity times every ancestor's, the scene's crossfade included. */
  opacity: number;
  /** The scene it belongs to, and that scene's clock; none for the caption. */
  scene?: string;
  sceneT?: number;
};
/** A strained take fit (take-fit-strain.ts) some scene painted on the frame made, with the scenes it could be from. */
export type FramingTakeFitStrain = TakeFitStrain & { scenes: string[] };
export type FramingReport = { frame: number; marks: FramingMark[]; takeFitStrains: FramingTakeFitStrain[] };

/** The artifact the probe emits for each frame. */
export const framingArtifactName = (frame: number) => `framing-${frame}.json`;

export type FramingExpectation = { scene: string; see: string; start: number; end: number };
export type FramingProblem = { from: number; to: number; problem: string; scene?: string };

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// A highlight's glow can graze its panel's edge; a few pixels lost isn't a subject cut off.
const CLIP_SLACK = 4;
const clipped = (m: FramingMark) =>
  m.shown.x - m.rect.x > CLIP_SLACK || m.shown.y - m.rect.y > CLIP_SLACK ||
  m.rect.x + m.rect.w - (m.shown.x + m.shown.w) > CLIP_SLACK || m.rect.y + m.rect.h - (m.shown.y + m.shown.h) > CLIP_SLACK;

/** Why a subject can't be seen clearly in this frame, if it can't. */
function obstruction(m: FramingMark, marks: readonly FramingMark[]): string | null {
  const visible = (o: FramingMark) => o.strength >= 0.5 && o.opacity >= 0.5;
  if (marks.some((o) => o.kind === 'tag' && visible(o) && overlaps(m.rect, o.rect))) return 'is under a tag';
  if (marks.some((o) => o.kind === 'caption' && visible(o) && overlaps(m.rect, o.rect))) return 'is under the caption';
  const r = m.rect;
  if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) return 'runs off the frame';
  if (clipped(m)) return 'is cut off by its panel';
  return null;
}

const label = (m: FramingMark) => (m.name === 'click' ? 'a click' : m.name ? `highlight "${m.name}"` : 'a highlight');

/**
 * Problems across the measured frames, merged into stretches of time. `frames` must include every frame inside each
 * expectation's span; `every` is the spacing elsewhere, so a stretch isn't split by the frames between samples.
 */
export function framingProblems(reports: readonly FramingReport[], expectations: readonly FramingExpectation[], fps: number, every: number): FramingProblem[] {
  const found: { frame: number; problem: string; scene?: string }[] = [];
  const byFrame = new Map(reports.map((r) => [r.frame, r.marks]));

  for (const { frame, marks } of reports) {
    for (const m of marks) {
      if (m.kind !== 'subject' || m.strength < 0.5 || m.opacity < 0.5) continue;
      const why = obstruction(m, marks);
      if (why) found.push({ frame, scene: m.scene, problem: `${label(m)} ${why}` });
    }
  }

  for (const e of expectations) {
    const first = Math.round(e.start * fps), last = Math.max(first, Math.round(e.end * fps) - 1);
    for (let frame = first; frame <= last; frame++) {
      const marks = byFrame.get(frame);
      if (!marks) throw new Error(`frame ${frame} wasn't measured, but "${e.see}" is expected on it`);
      const named = marks.filter((m) => m.kind === 'subject' && m.scene === e.scene && m.name === e.see);
      if (named.length > 1) throw new Error(`scene ${e.scene} draws two highlights named "${e.see}"`);
      const m = named[0];
      const why = !m ? 'isn\'t drawn' : m.strength < 0.5 ? 'is still drawing on, or fading' : m.opacity < 0.5 ? 'is faded out' : obstruction(m, marks);
      if (why) found.push({ frame, scene: e.scene, problem: `expected highlight "${e.see}" ${why} (expect, ${e.start.toFixed(2)}–${e.end.toFixed(2)}s)` });
    }
  }

  const spans: (FramingProblem & { last: number })[] = [];
  for (const f of found.sort((a, b) => a.frame - b.frame)) {
    const open = spans.findLast((s) => s.problem === f.problem && s.scene === f.scene);
    if (open && f.frame - open.last <= every * 1.5) {
      open.last = f.frame;
      open.to = f.frame / fps;
    } else spans.push({ from: f.frame / fps, to: f.frame / fps, problem: f.problem, scene: f.scene, last: f.frame });
  }
  return spans.map(({ last: _, ...s }) => s);
}

/** The frames to measure: every `every`th, plus every frame an expectation covers. */
export function framesToMeasure(durationInFrames: number, every: number, expectations: readonly FramingExpectation[], fps: number): number[] {
  const frames = new Set<number>();
  for (let f = 0; f < durationInFrames; f += every) frames.add(f);
  for (const e of expectations) {
    const first = Math.round(e.start * fps), last = Math.max(first, Math.round(e.end * fps) - 1);
    for (let f = first; f <= Math.min(last, durationInFrames - 1); f++) frames.add(f);
  }
  return [...frames].sort((a, b) => a - b);
}

export type TakeFitWarning = { scene: string; warning: string };

/**
 * Each strained take fit once, by scene. A fit is seen on the frames its scene paints; one seen only in a crossfade
 * names both scenes.
 */
export function takeFitWarnings(reports: readonly FramingReport[]): TakeFitWarning[] {
  const seen = new Map<string, { strain: TakeFitStrain; solo: Set<string>; shared: Set<string> }>();
  for (const s of reports.flatMap((r) => r.takeFitStrains)) {
    const key = `${s.from}\n${s.to}\n${s.speed}`;
    const entry = seen.get(key) ?? { strain: s, solo: new Set<string>(), shared: new Set<string>() };
    seen.set(key, entry);
    if (s.scenes.length === 1) entry.solo.add(s.scenes[0]);
    else entry.shared.add(s.scenes.join(' / '));
  }
  return [...seen.values()].flatMap(({ strain: { from, to, speed }, solo, shared }) => {
    const pace = speed > 1 ? `${speed}× its speed, so it looks sped up` : `${speed}× its speed, so it drifts in slow motion`;
    const warning = `fitTake plays the take between ${from} and ${to} at ${pace}: pin them to words ${speed > 1 ? 'further apart' : 'closer together'}, or film it at the pace the voice needs`;
    return [...(solo.size ? solo : shared)].map((scene) => ({ scene, warning }));
  });
}
