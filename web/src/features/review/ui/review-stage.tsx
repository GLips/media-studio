import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { nextReviewGuideSet } from '#lib/output/review/models/review-guides.ts';
import { reviewMarkOf, reviewUnitPoint } from '#lib/output/review/models/review-marks.ts';
import type { ReviewMark, ReviewPoint } from '#lib/output/review/models/review-threads.ts';
import { reviewMediaUrl } from '#web/shared/media-urls.ts';
import { colors } from '#web/shared/ui/theme.stylex.ts';
import { ReviewCompareView, ReviewVersionTag } from './review-compare-view.tsx';
import { pinReviewDraft, toggleReviewDraw } from './review-draft-pin.ts';
import { ReviewDrawStrip } from './review-draw-strip.tsx';
import { ReviewGuidesOverlay } from './review-guides-overlay.tsx';
import { useReviewScreen, type ReviewScreenValue } from './review-screen-context.tsx';
import { ReviewSliceLayer } from './review-slice-layer.tsx';
import { ReviewStageMarks } from './review-stage-marks.tsx';
import { REVIEW_MEDIA_ATTRIBUTE } from './review-mark-paint.ts';
import { reviewIsProofed, reviewProofGroundStyles, useReviewProofGround } from './use-review-proof-ground.ts';
import { reviewVersionLabelOf, useReviewRenderVersions, type ReviewComparedVersion } from './use-review-render-versions.ts';
import { useReviewStageHotkeys, type ReviewDrawTool } from './use-review-stage-hotkeys.ts';
import { useReviewStageZoom, type ReviewStageRect } from './use-review-stage-zoom.ts';
import { useReviewSplices } from './use-review-threads.ts';

/** How far, in CSS pixels, a press may travel and still be a click that pins rather than a drag that pans. */
const REVIEW_PRESS_SLOP = 3;

const styles = stylex.create({
  stage: { position: 'relative', height: '100%', width: '100%', backgroundColor: colors.screen, overflow: 'hidden', touchAction: 'none' },
  frame: { position: 'absolute', overflow: 'hidden' },
  at: (left: number, top: number, width: number, height: number) => ({ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }),
  // Until the stage is measured and the frame's size known, the media fills the stage, letterboxed by the browser.
  unmeasured: { inset: 0 },
  media: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
  hidden: { opacity: 0 },
  pins: { cursor: 'crosshair' },
  // At 1:1 the frame pans: grab says so, though a click without a drag still pins.
  pannable: { cursor: 'grab' },
  grab: { cursor: 'grabbing' },
});

type ReviewStageGesture =
  | { kind: 'press'; x: number; y: number }
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'draw'; start: ReviewPoint; points: ReviewPoint[] };

/** Where a pointer is on the frame box it's over, in 0–1 frame units. */
function reviewStagePointOf(e: PointerEvent<HTMLElement>) {
  const box = e.currentTarget.getBoundingClientRect();
  return reviewUnitPoint((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
}

type ReviewStagePanning = { readonly pannable: boolean; readonly panBy: (dx: number, dy: number) => void };

/**
 * The frame box's pointer: on the stage a click pins the draft and, at 1:1, a drag or the wheel pans; in draw mode a
 * drag strokes with the tool. Answers the stroke being dragged out, for the marks layer to draw.
 */
function useReviewStagePointer(screen: ReviewScreenValue, tool: ReviewDrawTool, zoom: ReviewStagePanning) {
  const [live, setLive] = useState<ReviewMark | null>(null);
  const [panning, setPanning] = useState(false);
  const gesture = useRef<ReviewStageGesture | null>(null);
  const end = () => {
    gesture.current = null;
    setLive(null);
    setPanning(false);
  };
  return {
    live,
    panning,
    handlers: {
      onPointerDown(e: PointerEvent<HTMLElement>) {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        if (screen.mode !== 'draw') {
          gesture.current = { kind: 'press', x: e.clientX, y: e.clientY };
          return;
        }
        if (!screen.draft.isOpen) pinReviewDraft(screen);
        const start = reviewStagePointOf(e);
        gesture.current = { kind: 'draw', start, points: [start] };
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        const g = gesture.current;
        if (!g) return;
        if (g.kind === 'draw') {
          const at = reviewStagePointOf(e);
          g.points.push(at);
          setLive(tool === 'path' ? { kind: 'path', points: [...g.points] } : reviewMarkOf(tool, g.start, at, g.points));
          return;
        }
        if (g.kind === 'press' && (!zoom.pannable || Math.hypot(e.clientX - g.x, e.clientY - g.y) <= REVIEW_PRESS_SLOP)) return;
        zoom.panBy(e.clientX - g.x, e.clientY - g.y);
        gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY };
        setPanning(true);
      },
      onPointerUp(e: PointerEvent<HTMLElement>) {
        const g = gesture.current;
        if (g?.kind === 'press') pinReviewDraft(screen, reviewStagePointOf(e));
        if (g?.kind === 'draw') {
          const mark = reviewMarkOf(tool, g.start, reviewStagePointOf(e), g.points);
          if (mark) screen.draft.addMark(mark);
        }
        end();
      },
      onPointerCancel: end,
      onWheel(e: WheelEvent<HTMLElement>) {
        if (zoom.pannable) zoom.panBy(-e.deltaX, -e.deltaY);
      },
    },
  };
}

/** The stage's own state (the draw tool, the proof ground) and its keys, wired to the screen. Answers whether `\` is held. */
function useReviewStageControls(screen: ReviewScreenValue, other: ReviewComparedVersion | undefined) {
  const { search, setSearch, mode, setMode, draft, setGuides } = screen;
  const [tool, setTool] = useState<ReviewDrawTool>('arrow');
  const compareAs = (cmp: 'wipe' | 'side') => () => setSearch(other && search.cmp !== cmp ? { vs: other.hash, cmp } : { cmp: undefined });
  const { flipped } = useReviewStageHotkeys({
    group: screen.artifact.kind === 'still' ? 'still' : 'playback',
    toggleActualSize: () => setSearch({ z: search.z === 1 ? undefined : 1 }),
    cycleGuides: () => setGuides(nextReviewGuideSet),
    toggleDraw: () => toggleReviewDraw(screen),
    compare: other ? {
      // The first flip loads the other version, and keeps it in the URL so it stays loaded.
      flip: () => search.vs === undefined && setSearch({ vs: other.hash }),
      wipe: compareAs('wipe'),
      side: compareAs('side'),
    } : null,
    draw: mode === 'draw' ? { setTool, popMark: draft.popMark, done: () => setMode('stage') } : null,
  });
  const [proofGround] = useReviewProofGround();
  return { tool, setTool, flipped, ground: reviewIsProofed(screen.artifact) ? reviewProofGroundStyles[proofGround] : null };
}

/** A frame box's place on the stage, or the whole stage before there's one. */
const frameBoxStyle = (rect: ReviewStageRect | undefined) => (rect ? styles.at(rect.left, rect.top, rect.width, rect.height) : styles.unmeasured);

/**
 * The frame, fitted and letterboxed (`Z` for 1:1, panned by drag or wheel), with the reply slices laid into it, `H`'s
 * guides and the notes' pins and strokes on it, and the version compared against flipped in (`\` held), wiped or
 * beside it. A click pins the draft; `D` draws on it.
 */
export function ReviewStage() {
  const screen = useReviewScreen();
  const { artifact, playback, search, mode, draft, guides } = screen;
  const { attachMedia } = playback;
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const { shown, other } = useReviewRenderVersions();
  const compared = search.vs === undefined ? undefined : other;
  const layer = search.cmp ?? 'flip';
  const side = compared !== undefined && layer === 'side';
  const frame = natural ?? artifact.frameSize;
  const { observe, rects, pannable, panBy } = useReviewStageZoom({ frame, panes: side ? 2 : 1, actual: search.z === 1, enlarges: artifact.kind !== 'still' });
  const { tool, setTool, flipped, ground } = useReviewStageControls(screen, other);
  const { live, panning, handlers } = useReviewStagePointer(screen, tool, { pannable, panBy });
  // Side by side, the open render is on the right: older on the left, as the wipe's `r13 | r14` reads.
  const own = rects.at(-1);
  const sliced = useReviewSplices().laid.length > 0;
  const labels = { other: compared ? reviewVersionLabelOf(compared, compared.hash) : '', shown: `${reviewVersionLabelOf(shown, artifact.render.hash)}${sliced ? ' + slices' : ''}` };
  return (
    <Box ref={observe} {...stylex.props(styles.stage)}>
      {side && compared && (
        <Box {...stylex.props(styles.frame, frameBoxStyle(rects[0]), ground)}>
          <ReviewCompareView version={compared} layer="side" held={false} labels={labels} />
        </Box>
      )}
      <Box {...handlers} {...stylex.props(styles.frame, frameBoxStyle(own), ground, styles.pins, pannable && screen.mode !== 'draw' && styles.pannable, panning && styles.grab)}>
        {artifact.kind === 'still' ? (
          <Box component="img" src={reviewMediaUrl(artifact)} alt="" draggable={false} {...{ [REVIEW_MEDIA_ATTRIBUTE]: true }}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            {...stylex.props(styles.media)} />
        ) : (
          <Box component="video" ref={attachMedia} src={reviewMediaUrl(artifact)} preload="auto" playsInline {...{ [REVIEW_MEDIA_ATTRIBUTE]: true }}
            onLoadedMetadata={(e) => setNatural({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
            {...stylex.props(styles.media, flipped && compared && !side && styles.hidden)} />
        )}
        {artifact.kind === 'video' && <ReviewSliceLayer hidden={flipped && compared !== undefined && !side} />}
        {compared && !side && <ReviewCompareView version={compared} layer={layer === 'wipe' ? 'wipe' : 'flip'} held={flipped} labels={labels} />}
        {guides && frame && <ReviewGuidesOverlay set={guides} frame={frame} />}
        {own && <ReviewStageMarks width={own.width} height={own.height} live={live} />}
        {side && compared && <ReviewVersionTag label={labels.shown} />}
      </Box>
      {mode === 'draw' && <ReviewDrawStrip tool={tool} onTool={setTool} frame={rects[0]} {...(draft.marks.length > 0 && { onPopMark: draft.popMark })} />}
    </Box>
  );
}
