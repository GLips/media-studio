// probe.tsx: measures what the checks need from a rendered frame and hands it to lib/render-pipeline.ts as artifacts:
// the framing marks (lib/framing-check.ts) and every tagged element's motion sample (lib/motion-tracks.ts). It only
// measures; deciding what's a problem happens in Node, where every frame's report comes together.
//
// Remotion screenshots a frame once no delayRender() is pending, so the probe holds one from the moment the frame
// commits until its reports are in the DOM: layout must be final (see whenLaidOut) before tags have their real widths.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Artifact, useCurrentFrame, useDelayRender } from 'remotion';
import { framingArtifactName, type FramingMark, type FramingReport } from '../framing-check.ts';
import { motionArtifactName, type FrameMotion, type MotionSample, type ScenePhase, type StaggerMembership } from '../motion-tracks.ts';
import type { Rect } from './camera.ts';
import { W } from './frame.ts';
import type { CameraMark } from './motion-tag.ts';
import { whenLaidOut } from './screen-rect.ts';
import { drainTakeFitStrains } from './take-fit-strain.ts';

type ClientRect = { left: number; top: number; right: number; bottom: number };

/** Client pixels (the Studio preview is scaled) to composition pixels, against the root's box. */
function frameMapper(root: HTMLElement) {
  const box = root.getBoundingClientRect();
  const scale = box.width / W;
  return (r: ClientRect): Rect => ({ x: (r.left - box.left) / scale, y: (r.top - box.top) / scale, w: (r.right - r.left) / scale, h: (r.bottom - r.top) / scale });
}

/** Its own opacity times every ancestor's up to the root, the scene's crossfade included. */
function effectiveOpacity(el: Element, root: HTMLElement) {
  let opacity = 1;
  for (let a: Element | null = el; a && a !== root.parentElement; a = a.parentElement) opacity *= Number(getComputedStyle(a).opacity);
  return opacity;
}

function measureFraming(root: HTMLElement, frame: number): FramingReport {
  const toFrame = frameMapper(root);
  const marks = [...root.querySelectorAll<HTMLElement | SVGElement>('[data-framing]')].map((el): FramingMark => {
    const r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    for (let a: Element | null = el.parentElement; a && a !== root.parentElement; a = a.parentElement) {
      const style = getComputedStyle(a);
      if (style.overflow !== 'visible' || style.clipPath !== 'none') {
        const c = a.getBoundingClientRect();
        [left, top, right, bottom] = [Math.max(left, c.left), Math.max(top, c.top), Math.min(right, c.right), Math.min(bottom, c.bottom)];
      }
    }
    const layer = el.closest<HTMLElement>('[data-scene]');
    return {
      kind: el.dataset.framing as FramingMark['kind'],
      ...(el.dataset.name && { name: el.dataset.name }),
      rect: toFrame(r),
      shown: toFrame({ left, top, right: Math.max(left, right), bottom: Math.max(top, bottom) }),
      strength: Number(el.dataset.strength ?? 1),
      opacity: effectiveOpacity(el, root),
      ...(layer && { scene: layer.dataset.scene, sceneT: Number(layer.dataset.sceneT) }),
    };
  });
  const scenes = [...root.querySelectorAll<HTMLElement>('[data-scene]')].map((layer) => layer.dataset.scene!);
  return { frame, marks, takeFitStrains: drainTakeFitStrains().map((strain) => ({ ...strain, scenes })) };
}

// ---------- motion ----------

/** False where a transform turns or flips, so a box in it no longer maps onto a box on screen by scale and offset. */
function axisAligned(el: Element) {
  const style = getComputedStyle(el);
  if (style.transform !== 'none') {
    const m = /^matrix\(([^)]+)\)$/.exec(style.transform);
    if (!m) return false;
    const [a, b, c, d] = m[1].split(',').map(Number);
    if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6 || a <= 0 || d <= 0) return false;
  }
  if (style.rotate !== 'none' && !/^0(deg)?$/.test(style.rotate)) return false;
  return style.scale === 'none' || style.scale.split(' ').every((v) => Number(v) > 0);
}

/**
 * `r` (client pixels) in `owner`'s own frame, its transforms undone: an HTML element's CSS pixels, an SVG element's
 * user units. Null where that isn't a scale and an offset: a zero-size owner, or a turn or flip anywhere from `el` up.
 */
function inOwnerFrame(r: DOMRect, el: Element, owner: Element, layer: Element): Rect | null {
  for (let a = el.parentElement; a && a !== layer.parentElement; a = a.parentElement) if (!axisAligned(a)) return null;
  let sx: number, sy: number, ox: number, oy: number;
  if (owner instanceof HTMLElement) {
    const b = owner.getBoundingClientRect();
    if (!owner.offsetWidth || !owner.offsetHeight) return null;
    [sx, sy, ox, oy] = [b.width / owner.offsetWidth, b.height / owner.offsetHeight, b.left, b.top];
  } else if (owner instanceof SVGGraphicsElement) {
    const m = owner.getScreenCTM();
    if (!m || Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6 || m.a <= 0 || m.d <= 0) return null;
    [sx, sy, ox, oy] = [m.a, m.d, m.e, m.f];
  } else return null;
  return { x: (r.left - ox) / sx, y: (r.top - oy) / sy, w: r.width / sx, h: r.height / sy };
}

function parseAttr<T>(el: Element, attr: string, problems: FrameMotion['problems'], id: string): T | undefined {
  const raw = el.getAttribute(attr);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    problems.push({ id, problem: `its ${attr} isn't JSON: ${raw}` });
    return undefined;
  }
}

function measureMotion(root: HTMLElement, frame: number): FrameMotion {
  const toFrame = frameMapper(root);
  const layers = [...root.querySelectorAll<HTMLElement>('[data-scene]')];
  const report: FrameMotion = { frame, scenes: layers.map((l) => l.dataset.scene!), samples: [], unmeasured: [], problems: [] };
  layers.forEach((layer, i) => {
    const scene = layer.dataset.scene!;
    // Scene layers are in scene order, and at most two are painted: the outgoing one under the incoming one.
    const phase: ScenePhase = layers.length === 1 ? 'solo' : i === 0 ? 'out' : 'in';
    for (const el of layer.querySelectorAll('[data-motion-unmeasured]')) {
      if (el.getClientRects().length) report.unmeasured.push({ scene, what: el.getAttribute('data-motion-unmeasured')! });
    }

    // Each tagged element's id and owner first: an element aimed through a camera needs the camera's.
    const tagged = [...layer.querySelectorAll('[data-motion]')].filter((el) => el.getClientRects().length);
    const ids = new Map<Element, string>();
    const idOf = (el: Element): string | null => {
      if (ids.has(el)) return ids.get(el)!;
      const name = el.getAttribute('data-motion')!;
      const owner = el.parentElement?.closest('[data-motion]');
      const ownerId = owner && layer.contains(owner) ? idOf(owner) : scene;
      if (ownerId === null || !name || name.includes('/')) return null;
      const id = `${ownerId}/${name}`;
      ids.set(el, id);
      return id;
    };
    const cameras = new Map<string, { id: string; mark: CameraMark }>();
    for (const el of tagged) {
      const id = idOf(el);
      if (id === null) {
        const name = el.getAttribute('data-motion');
        if (!name || name.includes('/')) report.problems.push({ id: `${scene}/${name}`, problem: 'a data-motion name must be non-empty, with no "/"' });
        continue;
      }
      const mark = parseAttr<CameraMark>(el, 'data-motion-camera', report.problems, id);
      if (mark) cameras.set(mark.key, { id, mark });
    }

    for (const el of tagged) {
      const id = ids.get(el);
      if (!id) continue;
      const r = el.getBoundingClientRect(), rect = toFrame(r);
      const through = el.getAttribute('data-motion-through');
      const owner = el.parentElement?.closest('[data-motion]');
      const group = owner && layer.contains(owner) ? owner : null;
      let parent: string | null = group ? ids.get(group) ?? null : null;
      let attribution: MotionSample['attribution'], local: Rect | null;
      if (through !== null) {
        const camera = cameras.get(through);
        if (camera) {
          const { cx, cy, k, box } = camera.mark;
          parent = camera.id;
          attribution = 'camera';
          local = { x: (rect.x - box.x - box.w / 2) / k + cx, y: (rect.y - box.y - box.h / 2) / k + cy, w: rect.w / k, h: rect.h / k };
        } else [attribution, local] = ['unknown', null];
      } else if (group) {
        local = inOwnerFrame(r, el, group, layer);
        attribution = local ? 'group' : 'unknown';
      } else [attribution, local] = ['scene', rect];
      const kind = el.getAttribute('data-motion-kind');
      const mark = parseAttr<CameraMark>(el, 'data-motion-camera', [], id);
      const stagger = parseAttr<StaggerMembership>(el, 'data-motion-stagger', report.problems, id);
      report.samples.push({
        id, scene, name: el.getAttribute('data-motion')!, ...(kind && { kind }), ...(el.hasAttribute('data-motion-implicit') && { implicit: true as const }),
        phase, parent, attribution, rect, local,
        opacity: effectiveOpacity(el, root),
        values: parseAttr<Record<string, number>>(el, 'data-motion-values', report.problems, id) ?? {},
        ...(stagger && { stagger }),
        ...(mark && { camera: mark.key }),
      });
    }
  });
  return report;
}

// ---------- the probe ----------

export function FrameProbe({ root }: { root: RefObject<HTMLDivElement | null> }) {
  const frame = useCurrentFrame();
  const { delayRender, continueRender } = useDelayRender();
  const [report, setReport] = useState<{ frame: number; framing: string; motion: string } | null>(null);
  const pending = useRef<number | null>(null);

  useLayoutEffect(() => {
    const handle = delayRender(`measuring frame ${frame}`);
    pending.current = handle;
    let live = true;
    // A task past whenLaidOut, so every re-measure it triggers (useScreenRect's) has committed first, whichever order
    // their callbacks were queued in. Deferred a microtask because on mount the parent's ref attaches after this runs.
    Promise.resolve().then(() => whenLaidOut(root.current!)).then(() => setTimeout(() => {
      if (live) {
        setReport({ frame, framing: JSON.stringify(measureFraming(root.current!, frame)), motion: JSON.stringify(measureMotion(root.current!, frame)) });
      }
    }));
    return () => {
      live = false;
      if (pending.current === handle) {
        continueRender(handle);
        pending.current = null;
      }
    };
  }, [frame, root, delayRender, continueRender]);

  useEffect(() => {
    if (report?.frame !== frame || pending.current === null) return;
    continueRender(pending.current);
    pending.current = null;
  }, [report, frame, continueRender]);

  return report?.frame === frame ? (
    <>
      <Artifact filename={framingArtifactName(frame)} content={report.framing} />
      <Artifact filename={motionArtifactName(frame)} content={report.motion} />
    </>
  ) : null;
}
