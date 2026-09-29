// stills.tsx: a project's still images (OG images, thumbnails, social posts) as one-frame compositions. A design is a
// component that reads the frame's size from useStillFrame and lays itself out from it, so one design renders at every
// preset; a kit piece that reads useVideoFormat fits the still's frame too.
//
// Root.tsx registers one composition per design × preset × variant; `studio still` renders them (lib/output/render/engine/render-stills.ts),
// and `studio still --sheet` lays a design's variants out by their axes (lib/output/stills/engine/still-sheet.ts).

import { createContext, useContext, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { Artifact, Img, useDelayRender, useVideoConfig } from 'remotion';
import type { Rect } from '#lib/picture/camera/models/camera.ts';
import { useStudioFontsReady } from '#lib/picture/type/studio/fonts.ts';
import { ARCHIVO_FACE, MONO_FONT, type StudioFace } from '#lib/picture/type/models/faces.ts';
import { STILL_UI_ZONES, stillFitArtifactName, type StillFitReport, type StillPreset } from '../models/still-presets.ts';

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

/** Which preset a still renders at; Root.tsx provides it around each still. */
export const StillPresetContext = createContext<StillPreset | null>(null);

/**
 * The frame a design lays out in. `u` is 1% of the shorter side, the unit for type and margins, so a design keeps its
 * proportions at every preset. `wide` is a landscape frame (OG, YouTube), where text sits beside the subject rather
 * than under it; a square frame is not wide. `safe` is the frame less the platform's full-width bars (a story's top
 * and reply bars): text and logos go inside it, pictures may run under the bars. `zones` is every UI zone, corners
 * too (YouTube's duration badge), for a design to keep text out of.
 */
export function useStillFrame() {
  const { width: w, height: h } = useVideoConfig();
  const preset = useContext(StillPresetContext);
  if (!preset) throw new Error('useStillFrame is for a still: render it through defineStills');
  const zones = STILL_UI_ZONES[preset];
  let top = 0, bottom = h;
  for (const { rect } of zones.filter((z) => z.rect.w >= w)) {
    if (rect.y <= 0) top = Math.max(top, rect.y + rect.h);
    else bottom = Math.min(bottom, rect.y);
  }
  return { w, h, u: Math.min(w, h) / 100, wide: w > h * 1.25, preset, zones, safe: { x: 0, y: top, w, h: bottom - top } };
}

// ---------- images ----------

/** Something drawn at a known size: a capture (captures/index.ts) or a generated image (generated/images.ts). */
export type StillImage = { src: string; w: number; h: number };

/**
 * Covers `box` with `image`, cropped around `focus`, in the image's own units (a capture's page pixels). A point keeps
 * that spot as near the box's centre as the image's edges allow. A rect is the subject: the image scales so the whole
 * subject fits the box, and never below covering it.
 */
export function CoverImage({ image, box, focus, style }: { image: StillImage; box: Rect; focus: StillFocus; style?: CSSProperties }) {
  const { scale, left, top } = coverPlacement(image, box, focus);
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden', ...style }}>
      <Img src={image.src} style={{ position: 'absolute', left, top, width: image.w * scale, height: image.h * scale, maxWidth: 'none' }} />
    </div>
  );
}

/** A point, or a rect (the subject), in the image's own units. */
export type StillFocus = { x: number; y: number; w?: number; h?: number };

/** Where CoverImage draws `image` in `box`: its scale, and its top-left from the box's. */
function coverPlacement(image: StillImage, box: Rect, focus: StillFocus) {
  const cover = Math.max(box.w / image.w, box.h / image.h);
  const subject = focus.w && focus.h ? Math.min(box.w / focus.w, box.h / focus.h) : 0;
  const scale = Math.max(cover, subject);
  const cx = focus.x + (focus.w ?? 0) / 2, cy = focus.y + (focus.h ?? 0) / 2;
  // Centre the focus, then pull back so no edge of the box shows past the image.
  const left = Math.min(0, Math.max(box.w - image.w * scale, box.w / 2 - cx * scale));
  const top = Math.min(0, Math.max(box.h - image.h * scale, box.h / 2 - cy * scale));
  return { scale, left, top };
}

// ---------- the reel's vocabulary, still ----------

/** How a StillCard is turned, in degrees: `rx` tips the top edge away, `ry` turns the right edge away, `rz` clockwise. */
export type StillCardTilt = { rx: number; ry: number; rz: number };
/** The reel's resting tilt for a UI card (PLANE_REST_POSE, models/reel/capture-plane.ts). */
export const STILL_CARD_TILT: StillCardTilt = { rx: 3, ry: -8, rz: 0 };

/**
 * A capture as a card in space, the reel's CapturePlane held still: `image` on a rounded card turned by `tilt`,
 * casting a shadow on the ground. A rect `focus` is the card: the card takes its shape, as large as fits `room`, and
 * shows only it, so no page around the subject creeps in; a point `focus` fills `room`, cropped around it. `lift` is one
 * control (a rect in the image's units) drawn again raised toward the viewer, with its own shadow, and ringed in `ring`
 * if given: the tap the reel shows, frozen. It grows about 6% as it rises, so it covers a sliver of what's around it:
 * lift a control with a little space around it, and pad the rect into that space. Put the card on a full-bleed field.
 */
export function StillCard({ image, room, focus, tilt = STILL_CARD_TILT, radius, lift, ring }: {
  image: StillImage; room: Rect; focus: StillFocus;
  tilt?: StillCardTilt;
  /** Corner radius in px (default 3% of the card's shorter side). */
  radius?: number;
  lift?: Rect;
  ring?: string;
}) {
  const fit = focus.w && focus.h ? Math.min(room.w / focus.w, room.h / focus.h) : 0;
  const box = fit ? { x: room.x + (room.w - focus.w! * fit) / 2, y: room.y + (room.h - focus.h! * fit) / 2, w: focus.w! * fit, h: focus.h! * fit } : room;
  const { scale, left, top } = coverPlacement(image, box, focus);
  const side = Math.min(box.w, box.h);
  const r = radius ?? 0.03 * side;
  const drawn = { position: 'absolute', left, top, width: image.w * scale, height: image.h * scale, maxWidth: 'none' } as const;
  const liftBox = lift && { x: left + lift.x * scale, y: top + lift.y * scale, w: lift.w * scale, h: lift.h * scale };
  const liftR = liftBox && 0.12 * Math.min(liftBox.w, liftBox.h);
  return (
    // Perspective on the parent, preserve-3d on the card: the lift is a sibling of the clipped face, since overflow
    // hidden flattens its children onto the card.
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, perspective: 4 * Math.max(box.w, box.h) }}>
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) rotateZ(${tilt.rz}deg)` }}>
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: r, boxShadow: `0 ${0.05 * side}px ${0.12 * side}px rgba(0, 0, 0, 0.45), 0 ${0.01 * side}px ${0.02 * side}px rgba(0, 0, 0, 0.3)` }}>
          <Img src={image.src} style={drawn} />
        </div>
        {liftBox && (
          <div style={{
            position: 'absolute', left: liftBox.x, top: liftBox.y, width: liftBox.w, height: liftBox.h, overflow: 'hidden', borderRadius: liftR,
            transform: `translateZ(${0.05 * side}px) scale(1.04)`,
            boxShadow: `0 ${0.03 * side}px ${0.06 * side}px rgba(0, 0, 0, 0.5)${ring ? `, 0 0 0 ${0.012 * side}px ${ring}` : ''}`,
          }}>
            <Img src={image.src} style={{ ...drawn, left: -lift.x * scale, top: -lift.y * scale }} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The reel HUD's chrome held still: corner brackets inset from the frame, and a mono label beside each top bracket.
 * Labels go at the top only, since YouTube's badge takes the bottom right. It frames a still as a
 * frame of the reel; leave it off a still that isn't one.
 */
export function StillHud({ ink, left, right }: {
  /** One ink, or one for the top (brackets and labels) and one for the bottom brackets, on a frame split top and bottom. */
  ink: string | { top: string; bottom: string };
  left?: string;
  right?: string;
}) {
  const { w, h, u, safe } = useStillFrame();
  const inks = typeof ink === 'string' ? { top: ink, bottom: ink } : ink;
  // Inset from the safe area's edges: a story's brackets sit inside its bars.
  const at = { x: 3.5 * u, top: safe.y + 3.5 * u, bottom: h - safe.y - safe.h + 3.5 * u };
  const arm = 3 * u, weight = Math.max(2, 0.28 * u), size = 1.7 * u;
  const corner = (x: number, y: number, sx: 1 | -1, sy: 1 | -1) => {
    const line = `${weight}px solid ${sy > 0 ? inks.top : inks.bottom}`;
    return (
      <div key={`${sx}${sy}`} style={{
        position: 'absolute', left: sx > 0 ? x : x - arm, top: sy > 0 ? y : y - arm, width: arm, height: arm, boxSizing: 'border-box',
        [sy > 0 ? 'borderTop' : 'borderBottom']: line, [sx > 0 ? 'borderLeft' : 'borderRight']: line,
      }} />
    );
  };
  const label = { position: 'absolute', top: at.top + arm * 0.35, fontFamily: MONO_FONT, fontSize: size, fontWeight: 600, letterSpacing: '0.08em', lineHeight: 1, color: inks.top, whiteSpace: 'nowrap' } as const;
  return (
    <>
      {corner(at.x, at.top, 1, 1)}{corner(w - at.x, at.top, -1, 1)}{corner(at.x, h - at.bottom, 1, -1)}{corner(w - at.x, h - at.bottom, -1, -1)}
      {left && <div style={{ ...label, left: at.x + arm * 1.3 }}>{left}</div>}
      {right && <div style={{ ...label, right: at.x + arm * 1.3 }}>{right}</div>}
    </>
  );
}

// ---------- fitted type ----------

/** The widths FitText tries, widest first, on a face with a width axis. It narrows before it shrinks. */
const FIT_STRETCHES = [100, 88, 76, 66];
/** A narrower width is kept only when it sets the text at least this much larger than the widest width that fits. */
const FIT_NARROWING_GAIN = 1.15;


/**
 * Sets `text` as large as fits `box`, up to `max` px and down to `min`, measured in the browser once the fonts are in,
 * in `face` (Archivo, or a brand's `brand.fonts.display`). On a face with a width axis it narrows first (width 100% →
 * 66%, within the axis), keeping a narrower width only when that buys about 15% more size; on one without, it shrinks.
 * Lines are balanced. A text that fits only at `min`, or not even there, fails the still check (lib/output/stills/models/still-check.ts), so
 * `studio still` won't write it. `name` names it there, unique within the still.
 */
export function FitText({ name, text, box, max, min, face = ARCHIVO_FACE, align = 'end', style }: {
  name: string; text: string; box: Rect; max: number; min: number;
  face?: StudioFace;
  /** Where the lines sit in the box when they're shorter than it. */
  align?: 'start' | 'center' | 'end';
  /** Type other than face, size and width: weight, colour, line height, tracking. */
  style?: Omit<CSSProperties, 'fontFamily' | 'fontSize' | 'fontStretch'>;
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
  }, [name, text, box.w, box.h, max, min, face.family, face.stretch?.[0], face.stretch?.[1], delayRender, continueRender]);

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
    const [lo, hi] = face.stretch ?? [100, 100];
    const inAxis = FIT_STRETCHES.filter((s) => s >= lo && s <= hi);
    // An axis that holds none of them: its width nearest 100%.
    const stretches = inAxis.length ? inAxis : [Math.min(hi, Math.max(lo, 100))];
    const fitting = stretches.map(largest).filter((t) => t.fits);
    // The widest width that fits, unless a narrower one sets it 15% larger (the widest of those); with none fitting,
    // the narrowest at the floor.
    const base = fitting[0];
    const best = base
      ? (fitting.find((t) => t.size >= base.size * FIT_NARROWING_GAIN) ?? base)
      : { stretch: stretches.at(-1)!, size: min, fits: false };
    // Set here as well as by the render: when the fit equals React's last values, React writes nothing, and the DOM
    // would keep the last size tried.
    fits(best.size, best.stretch);
    setFit({ name, text, size: best.size, stretch: best.stretch, max, min, atFloor: best.size <= min, overflows: !best.fits });
  }, [ready, name, text, box.w, box.h, max, min, face.family, face.stretch?.[0], face.stretch?.[1]]);

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
          textWrap: 'balance', overflowWrap: 'normal', ...style, fontFamily: face.family,
          fontSize: fit ? fit.size : max, fontStretch: `${fit ? fit.stretch : 100}%`,
        }}
      >
        {text}
      </div>
      {fit && <Artifact filename={stillFitArtifactName(name)} content={JSON.stringify(fit)} />}
    </div>
  );
}
