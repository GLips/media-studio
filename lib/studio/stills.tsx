// stills.tsx: a project's still images (OG images, thumbnails, social posts) as one-frame compositions. A design is a
// component that reads the frame's size from useStillFrame and lays itself out from it, so one design renders at every
// preset. Stills read the frame from useVideoConfig, never W/H (frame.ts), which are the video's.
//
// Root.tsx registers one composition per design × preset × variant; `studio still` renders them (lib/render-stills.ts),
// and `studio still --sheet` lays a design's variants out by their axes (lib/still-sheet.ts).

import { useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { Artifact, Img, useDelayRender, useVideoConfig } from 'remotion';
import type { Rect } from './camera.ts';
import { DISPLAY_FONT, useStudioFontsReady } from './fonts.ts';
import { stillFitArtifactName, type StillFitReport, type StillPreset } from './still-presets.ts';

/** What a design's variants vary: each axis (headline, image) and its values, in the order a sheet lays them out. */
export type StillAxes = Readonly<Record<string, readonly string[]>>;
export type StillAxisValues<A extends StillAxes> = { [K in keyof A]: A[K][number] };

/**
 * One design: its component, the presets it renders at, and its variant axes. Every combination of the axes' values is
 * a variant, and `props` gives the component's props for one.
 */
export type StillDesign<P, A extends StillAxes> = {
  component: ComponentType<P>;
  presets: readonly StillPreset[];
  axes: A;
  props: (values: StillAxisValues<A>) => P;
};

/** A variant, resolved: where it sits on each axis and the props it renders with. */
export type StillVariant = { axes: Readonly<Record<string, string>>; props: object };
/** A design as Root.tsx registers it, its variants keyed by name (their axis values joined by `-`, in axis order). */
export type ResolvedStillDesign = { component: ComponentType<any>; presets: readonly StillPreset[]; axes: StillAxes; variants: Readonly<Record<string, StillVariant>> };
export type StillsDef = { designs: Readonly<Record<string, ResolvedStillDesign>> };

const STILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Types one design for defineStills: `props` gets each axis's values as literals. The design's name is its key there.
 *   stillDesign({ component: Card, presets: ['og'], axes: { headline: ['short', 'long'] }, props: ({ headline }) => …})
 */
export function stillDesign<P, const A extends StillAxes>(design: StillDesign<P, A>): StillDesign<P, A> {
  return design;
}

/**
 * A project's stills.tsx default-exports this, each design made by stillDesign. Names become file and composition
 * names, so they're kebab-case. `any`: each design's `props` takes its own axes' values, which no one type admits.
 */
export function defineStills(designs: Readonly<Record<string, StillDesign<any, any>>>): StillsDef {
  const resolved: Record<string, ResolvedStillDesign> = {};
  for (const [name, { component, presets, axes, props }] of Object.entries(designs) as [string, StillDesign<object, StillAxes>][]) {
    if (!STILL_NAME.test(name)) throw new Error(`defineStills: design "${name}" isn't kebab-case`);
    if (!presets.length) throw new Error(`defineStills: design "${name}" has no presets`);
    const axisNames = Object.keys(axes);
    if (!axisNames.length) throw new Error(`defineStills: design "${name}" has no axes (one with a single value makes one variant)`);
    for (const axis of axisNames) {
      if (!axes[axis].length) throw new Error(`defineStills: ${name}'s axis "${axis}" has no values`);
      for (const v of axes[axis]) if (!STILL_NAME.test(v)) throw new Error(`defineStills: ${name}'s ${axis} "${v}" isn't kebab-case`);
    }
    const combinations = axisNames.reduce<StillAxisValues<StillAxes>[]>((acc, axis) => acc.flatMap((c) => axes[axis].map((v) => ({ ...c, [axis]: v }))), [{}]);
    const variants: Record<string, StillVariant> = {};
    for (const values of combinations) {
      const variant = axisNames.map((a) => values[a]).join('-');
      // Joined values can collide: `a-b` × `c` and `a` × `b-c`.
      if (variants[variant]) throw new Error(`defineStills: ${name} has two variants named "${variant}"; rename a value`);
      variants[variant] = { axes: values, props: props(values) };
    }
    resolved[name] = { component, presets, axes, variants };
  }
  return { designs: resolved };
}

/**
 * The frame a design lays out in. `u` is 1% of the shorter side, the unit for type and margins, so a design keeps its
 * proportions at every preset. `wide` is a landscape frame (OG, YouTube), where text sits beside the subject rather
 * than under it; a square frame is not wide.
 */
export function useStillFrame() {
  const { width: w, height: h } = useVideoConfig();
  return { w, h, u: Math.min(w, h) / 100, wide: w > h * 1.25 };
}

// ---------- images ----------

/** Something drawn at a known size: a capture (captures/index.ts) or a generated image (generated/images.ts). */
export type StillImage = { src: string; w: number; h: number };

/**
 * Covers `box` with `image`, cropped around `focus`, in the image's own units (a capture's page pixels). A point keeps
 * that spot as near the box's centre as the image's edges allow. A rect is the subject: the image scales so the whole
 * subject fits the box, and never below covering it.
 */
export function CoverImage({ image, box, focus, style }: { image: StillImage; box: Rect; focus: { x: number; y: number; w?: number; h?: number }; style?: CSSProperties }) {
  const cover = Math.max(box.w / image.w, box.h / image.h);
  const subject = focus.w && focus.h ? Math.min(box.w / focus.w, box.h / focus.h) : 0;
  const scale = Math.max(cover, subject);
  const cx = focus.x + (focus.w ?? 0) / 2, cy = focus.y + (focus.h ?? 0) / 2;
  // Centre the focus, then pull back so no edge of the box shows past the image.
  const left = Math.min(0, Math.max(box.w - image.w * scale, box.w / 2 - cx * scale));
  const top = Math.min(0, Math.max(box.h - image.h * scale, box.h / 2 - cy * scale));
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden', ...style }}>
      <Img src={image.src} style={{ position: 'absolute', left, top, width: image.w * scale, height: image.h * scale, maxWidth: 'none' }} />
    </div>
  );
}

// ---------- fitted type ----------

/** Archivo's widths FitText tries, widest first. It narrows before it shrinks. */
const FIT_STRETCHES = [100, 88, 76, 66];
/** A narrower width is kept only when it sets the text at least this much larger than the widest width that fits. */
const FIT_NARROWING_GAIN = 1.15;


/**
 * Sets `text` as large as fits `box`, up to `max` px and down to `min`, measured in the browser once the fonts are in.
 * On Archivo it narrows first (width 100% → 66%), keeping a narrower width only when that buys about 15% more size.
 * Lines are balanced. A text that fits only at `min`, or not even there, fails the still check (lib/still-check.ts), so
 * `studio still` won't write it. `name` names it there, unique within the still.
 */
export function FitText({ name, text, box, max, min, align = 'end', style }: {
  name: string; text: string; box: Rect; max: number; min: number;
  /** Where the lines sit in the box when they're shorter than it. */
  align?: 'start' | 'center' | 'end';
  /** Type other than size and width: weight, colour, line height, tracking. The family defaults to Archivo. */
  style?: CSSProperties;
}) {
  const ready = useStudioFontsReady();
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<StillFitReport | null>(null);
  const { delayRender, continueRender } = useDelayRender();
  const pending = useRef<number | null>(null);

  useLayoutEffect(() => {
    pending.current = delayRender(`fitting ${name}`);
    return () => {
      if (pending.current !== null) continueRender(pending.current);
      pending.current = null;
    };
  }, [name, text, box.w, box.h, max, min, delayRender, continueRender]);

  useLayoutEffect(() => {
    if (!ready) return;
    const el = inner.current!, frame = outer.current!;
    // Whole pixels on both sides: scrollWidth/Height round, so a fractional box would fail every size.
    const fits = (size: number, stretch: number) => {
      el.style.fontSize = `${size}px`;
      el.style.fontStretch = `${stretch}%`;
      return el.scrollWidth <= el.clientWidth && el.scrollHeight <= frame.clientHeight;
    };
    const largest = (stretch: number) => {
      if (fits(max, stretch)) return { stretch, size: max, fits: true };
      if (!fits(min, stretch)) return { stretch, size: min, fits: false };
      let lo = min, hi = max;
      while (hi - lo > 0.25) {
        const mid = (lo + hi) / 2;
        if (fits(mid, stretch)) lo = mid; else hi = mid;
      }
      return { stretch, size: Math.max(min, Math.floor(lo * 4) / 4), fits: true };
    };
    const fitting = FIT_STRETCHES.map(largest).filter((t) => t.fits);
    // The widest width that fits, unless a narrower one sets it 15% larger (the widest of those); with none fitting,
    // the narrowest at the floor.
    const base = fitting[0];
    const best = base
      ? (fitting.find((t) => t.size >= base.size * FIT_NARROWING_GAIN) ?? base)
      : { stretch: FIT_STRETCHES.at(-1)!, size: min, fits: false };
    // Set here as well as by the render: when the fit equals React's last values, React writes nothing, and the DOM
    // would keep the last size tried.
    fits(best.size, best.stretch);
    setFit({ name, text, size: best.size, stretch: best.stretch, max, min, atFloor: best.size <= min, overflows: !best.fits });
  }, [ready, name, text, box.w, box.h, max, min]);

  useLayoutEffect(() => {
    if (!fit || fit.text !== text || pending.current === null) return;
    continueRender(pending.current);
    pending.current = null;
  }, [fit, text, continueRender]);

  const justify = { start: 'flex-start', center: 'center', end: 'flex-end' }[align];
  return (
    <div ref={outer} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, display: 'flex', flexDirection: 'column', justifyContent: justify }}>
      <div
        ref={inner}
        data-still-fit={name}
        // What the still probe waits for.
        {...(fit?.text === text && { 'data-still-fitted': '' })}
        style={{
          fontFamily: DISPLAY_FONT, textWrap: 'balance', overflowWrap: 'normal', ...style,
          fontSize: fit ? fit.size : max, fontStretch: `${fit ? fit.stretch : 100}%`,
        }}
      >
        {text}
      </div>
      {fit && <Artifact filename={stillFitArtifactName(name)} content={JSON.stringify(fit)} />}
    </div>
  );
}
