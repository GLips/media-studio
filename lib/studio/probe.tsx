// probe.tsx: measures what the framing check needs from a rendered frame and hands it to lib/render-pipeline.ts as an
// artifact. It only measures; deciding what's a problem happens in Node, where every frame's report comes together.
//
// Remotion screenshots a frame once no delayRender() is pending, so the probe holds one from the moment the frame
// commits until its report is in the DOM: layout must be final (see whenLaidOut) before tags have their real widths.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Artifact, useCurrentFrame, useDelayRender } from 'remotion';
import { framingArtifactName, type FramingMark, type FramingReport } from '../framing-check.ts';
import { W } from './frame.ts';
import { whenLaidOut } from './screen-rect.ts';
import { drainTakeFitStrains } from './take-fit-strain.ts';

function measureFraming(root: HTMLElement, frame: number): FramingReport {
  const box = root.getBoundingClientRect();
  const scale = box.width / W;
  const toFrame = (r: { left: number; top: number; right: number; bottom: number }) =>
    ({ x: (r.left - box.left) / scale, y: (r.top - box.top) / scale, w: (r.right - r.left) / scale, h: (r.bottom - r.top) / scale });
  const marks = [...root.querySelectorAll<HTMLElement | SVGElement>('[data-framing]')].map((el): FramingMark => {
    const r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    let opacity = 1;
    for (let a: Element | null = el; a && a !== root.parentElement; a = a.parentElement) {
      const style = getComputedStyle(a);
      opacity *= Number(style.opacity);
      if (a !== el && (style.overflow !== 'visible' || style.clipPath !== 'none')) {
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
      opacity,
      ...(layer && { scene: layer.dataset.scene, sceneT: Number(layer.dataset.sceneT) }),
    };
  });
  const scenes = [...root.querySelectorAll<HTMLElement>('[data-scene]')].map((layer) => layer.dataset.scene!);
  return { frame, marks, takeFitStrains: drainTakeFitStrains().map((strain) => ({ ...strain, scenes })) };
}

export function FramingProbe({ root }: { root: RefObject<HTMLDivElement | null> }) {
  const frame = useCurrentFrame();
  const { delayRender, continueRender } = useDelayRender();
  const [report, setReport] = useState<{ frame: number; json: string } | null>(null);
  const pending = useRef<number | null>(null);

  useLayoutEffect(() => {
    const handle = delayRender(`measuring framing at frame ${frame}`);
    pending.current = handle;
    let live = true;
    // A task past whenLaidOut, so every re-measure it triggers (useScreenRect's) has committed first, whichever order
    // their callbacks were queued in. Deferred a microtask because on mount the parent's ref attaches after this runs.
    Promise.resolve().then(() => whenLaidOut(root.current!)).then(() => setTimeout(() => {
      if (live) setReport({ frame, json: JSON.stringify(measureFraming(root.current!, frame)) });
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

  return report?.frame === frame ? <Artifact filename={framingArtifactName(frame)} content={report.json} /> : null;
}
