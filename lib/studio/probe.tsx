// probe.tsx: measures what the framing check needs from a rendered frame and hands it to scripts/render.ts as an
// artifact. It only measures; deciding what's a problem happens in Node, where every frame's report comes together.
//
// Remotion screenshots a frame once no delayRender() is pending, so the probe holds one from the moment the frame
// commits until its report is in the DOM: fonts must be loaded before tags have their real widths.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Artifact, useCurrentFrame, useDelayRender } from 'remotion';
import { W } from './frame.ts';

export type FramingMark = {
  kind: 'subject' | 'tag' | 'caption';
  rect: { x: number; y: number; w: number; h: number };
  strength: number;
  /** The scene it belongs to, and that scene's clock and opacity; none for the caption. */
  scene?: string;
  sceneT?: number;
  sceneAlpha?: number;
};
export type FramingReport = { frame: number; marks: FramingMark[] };

export const framingArtifactName = (frame: number) => `framing-${frame}.json`;

function measureFraming(root: HTMLElement, frame: number): FramingReport {
  const box = root.getBoundingClientRect();
  const scale = box.width / W;
  const marks = [...root.querySelectorAll<HTMLElement | SVGElement>('[data-framing]')].map((el): FramingMark => {
    const r = el.getBoundingClientRect();
    const layer = el.closest<HTMLElement>('[data-scene]');
    return {
      kind: el.dataset.framing as FramingMark['kind'],
      rect: { x: (r.left - box.left) / scale, y: (r.top - box.top) / scale, w: r.width / scale, h: r.height / scale },
      strength: Number(el.dataset.strength),
      ...(layer && { scene: layer.dataset.scene, sceneT: Number(layer.dataset.sceneT), sceneAlpha: Number(layer.dataset.sceneAlpha) }),
    };
  });
  return { frame, marks };
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
    document.fonts.ready.then(() => {
      if (live && root.current) setReport({ frame, json: JSON.stringify(measureFraming(root.current, frame)) });
    });
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
