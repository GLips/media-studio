import { useCallback, useState } from 'react';

/** A frame's box on the stage, in CSS pixels from the stage's top-left. */
export type ReviewStageRect = { left: number; top: number; width: number; height: number };

type ReviewStageSize = { w: number; h: number };
type ReviewStagePan = { x: number; y: number };

type ReviewStageLayout = {
  /** The stage's own size; null before it's measured. */
  stage: ReviewStageSize | null;
  /** The frame's pixels: the file's own once its metadata loads, else the snapshot's. Null when neither is known. */
  frame: ReviewStageSize | null;
  /** 2 lays the frames side by side, each fitted to its half. */
  panes: 1 | 2;
  /** 1:1: one frame pixel to one device pixel, panned; otherwise fitted and letterboxed. */
  actual: boolean;
  /** Fit may enlarge past 1:1. A still fits down only, so a small one isn't blurred up; a video fills its stage. */
  enlarges: boolean;
  pan: ReviewStagePan;
};

/** How far a 1:1 frame overhangs its pane each side, the furthest it can be panned. */
function reviewStageOverhangOf({ stage, frame, panes, actual }: ReviewStageLayout): ReviewStagePan {
  if (!stage || !frame || !actual) return { x: 0, y: 0 };
  const scale = 1 / window.devicePixelRatio;
  return { x: Math.max(0, (frame.w * scale - stage.w / panes) / 2), y: Math.max(0, (frame.h * scale - stage.h) / 2) };
}

/** Each pane's frame box: centred in its share of the stage, fitted or at 1:1, moved by the pan. */
function reviewStageRectsOf(layout: ReviewStageLayout): ReviewStageRect[] {
  const { stage, frame, panes, actual, enlarges, pan } = layout;
  if (!stage || !frame) return [];
  const paneW = stage.w / panes, oneToOne = 1 / window.devicePixelRatio;
  const fit = enlarges ? Math.min(paneW / frame.w, stage.h / frame.h) : Math.min(paneW / frame.w, stage.h / frame.h, oneToOne);
  const scale = actual ? oneToOne : fit;
  const width = Math.round(frame.w * scale), height = Math.round(frame.h * scale);
  return Array.from({ length: panes }, (_, i) => ({
    left: Math.round(i * paneW + (paneW - width) / 2 + pan.x), top: Math.round((stage.h - height) / 2 + pan.y), width, height,
  }));
}

const clampToOverhang = (v: number, overhang: number) => Math.max(-overhang, Math.min(overhang, v));

/**
 * The stage's frame boxes for fit and 1:1, measured off the stage element (`observe` is its ref). A pan only moves a
 * 1:1 frame, held so its edge never comes inside the pane, and starts centred each time 1:1 is entered.
 */
export function useReviewStageZoom({ frame, panes, actual, enlarges }: Pick<ReviewStageLayout, 'frame' | 'panes' | 'actual' | 'enlarges'>) {
  const [stage, setStage] = useState<ReviewStageSize | null>(null);
  const [panned, setPanned] = useState<ReviewStagePan & { actual: boolean }>({ x: 0, y: 0, actual });
  const observe = useCallback((element: HTMLElement | null) => {
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setStage({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const overhang = reviewStageOverhangOf({ stage, frame, panes, actual, enlarges, pan: panned });
  const pan = panned.actual === actual ? { x: clampToOverhang(panned.x, overhang.x), y: clampToOverhang(panned.y, overhang.y) } : { x: 0, y: 0 };
  return {
    observe,
    rects: reviewStageRectsOf({ stage, frame, panes, actual, enlarges, pan }),
    /** True when there's frame off the stage to pan to. */
    pannable: overhang.x > 0 || overhang.y > 0,
    panBy: (dx: number, dy: number) => setPanned((last) => {
      const from = last.actual === actual ? last : { x: 0, y: 0 };
      return { x: clampToOverhang(from.x + dx, overhang.x), y: clampToOverhang(from.y + dy, overhang.y), actual };
    }),
  };
}
