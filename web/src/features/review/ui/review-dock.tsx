import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState, type PointerEvent, type ReactNode } from 'react';
import {
  formatReviewTimecode, reviewTimelineCenteredOn, reviewTimelineVisibleFrames, type ReviewTimelineView,
} from '#lib/output/review/models/review-timeline-geometry.ts';
import { colors, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { ReviewHoverPreview, type ReviewDockHover } from './review-hover-preview.tsx';
import { ReviewLaneGutter } from './review-lane-gutter.tsx';
import { ReviewLaneMarks } from './review-lane-marks.tsx';
import { ReviewLaneNotes } from './review-lane-notes.tsx';
import { ReviewLanePlayhead } from './review-lane-playhead.tsx';
import { ReviewLaneRuler } from './review-lane-ruler.tsx';
import { ReviewLaneScenes } from './review-lane-scenes.tsx';
import { ReviewLaneSound } from './review-lane-sound.tsx';
import { ReviewLaneVoice } from './review-lane-voice.tsx';
import { useReviewFrame, useReviewScreen } from './review-screen-context.tsx';
import { useReviewDockLanes, type ReviewDockLanes } from './use-review-dock-lanes.ts';
import { useReviewDockScrub } from './use-review-dock-scrub.ts';
import { useReviewTimelineViewport } from './use-review-timeline-view.ts';

/** The dock's lanes, top to bottom; a lane with no data isn't drawn. */
export type ReviewLaneId = 'ruler' | 'scenes' | 'marks' | 'notes' | 'voice' | 'sound';

const styles = stylex.create({
  dock: {
    display: 'grid', gridTemplateColumns: `${spacing.laneGutter} minmax(0, 1fr)`, userSelect: 'none', touchAction: 'none',
    backgroundColor: colors.panel, borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line,
    outlineColor: colors.cream, outlineWidth: { default: 0, ':focus-visible': '1px' }, outlineStyle: 'solid', outlineOffset: '-1px',
  },
  gutter: { display: 'flex', flexDirection: 'column', borderRightWidth: '1px', borderRightStyle: 'solid', borderRightColor: colors.line },
  // Not clipped: the hover preview rises out of it over the stage. Each lane and the playhead's layer clip themselves.
  lanes: { position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0, cursor: 'pointer' },
  // Every lane's height, so a gutter glyph lines up with the lane it names.
  ruler: { height: typography.lineHeight, flexShrink: 0 },
  scenes: { height: spacing.rowDense, flexShrink: 0 },
  marks: { height: typography.lineHeight, flexShrink: 0 },
  notes: { height: typography.lineHeight, flexShrink: 0 },
  voice: { height: typography.lineHeight, flexShrink: 0 },
  sound: { height: '32px', flexShrink: 0 },
  // Under the script, where the dock is the only picture of the take, the waveform gets room to read its shape.
  soundTall: { height: '64px', flexShrink: 0 },
  folded: { height: spacing.tight, flexShrink: 0 },
  overview: { position: 'relative', height: spacing.tight, flexShrink: 0, backgroundColor: { default: colors.laneA, ':hover': colors.raised } },
  overviewSpacer: { height: spacing.tight, flexShrink: 0 },
  overviewWindow: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.dim, pointerEvents: 'none' },
  span: (left: string, width: string) => ({ left, width }),
});

const REVIEW_DOCK_LANES: Readonly<Record<ReviewLaneId, (view: ReviewTimelineView, data: ReviewDockLanes, hover: ReviewDockHover) => ReactNode>> = {
  ruler: (view, _data, hover) => <ReviewLaneRuler view={view} hover={hover} />,
  scenes: (view) => <ReviewLaneScenes view={view} />,
  marks: (view) => <ReviewLaneMarks view={view} />,
  notes: (view, data) => <ReviewLaneNotes view={view} notes={data.notes} />,
  voice: (view, data) => <ReviewLaneVoice view={view} lines={data.lines} />,
  sound: (view, data) => <ReviewLaneSound view={view} peaks={data.peaks} />,
};

/** Zoomed in, the whole render as a 4px strip under the lanes, the part in view lit; a press or drag there pans. */
function reviewDockOverviewOf(view: ReviewTimelineView, pan: (view: ReviewTimelineView) => void): ReactNode {
  const panTo = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    pan(reviewTimelineCenteredOn(view, ((event.clientX - box.left) / box.width) * view.durationInFrames));
  };
  const left = (view.start / view.durationInFrames) * 100, width = (reviewTimelineVisibleFrames(view) / view.durationInFrames) * 100;
  return (
    <Box data-review-overview aria-hidden {...stylex.props(styles.overview)} onPointerMove={(event) => event.buttons === 1 && panTo(event)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        panTo(event);
      }}>
      <Box {...stylex.props(styles.overviewWindow, styles.span(`${left}%`, `${width}%`))} />
    </Box>
  );
}

const toggled = (lanes: ReadonlySet<ReviewLaneId>, lane: ReviewLaneId) =>
  new Set(lanes.has(lane) ? [...lanes].filter((l) => l !== lane) : [...lanes, lane]);

/**
 * The timeline under the stage, the whole of it a scrubber: ruler, scenes, marks, notes, voice and sound, each with
 * its glyph in the gutter. `tall` gives the sound lane twice the height, for a screen with no stage above it. The playhead is CSS on the clock's `--review-frame`, so playing renders nothing here.
 */
export function ReviewDock({ lanes: wanted, tall = false }: { readonly lanes?: readonly ReviewLaneId[]; readonly tall?: boolean }) {
  const { timing, playback } = useReviewScreen();
  const data = useReviewDockLanes(wanted);
  const [folded, setFolded] = useState<ReadonlySet<ReviewLaneId>>(new Set());
  const { view, attachLanes, lanes, setView, hover } = useReviewTimelineViewport(playback);
  const scrub = useReviewDockScrub(view, lanes);
  const frame = useReviewFrame();
  const heightOf = (lane: ReviewLaneId) => {
    if (folded.has(lane)) return styles.folded;
    return tall && lane === 'sound' ? styles.soundTall : styles[lane];
  };
  return (
    <Box role="slider" tabIndex={0} aria-label="Timeline" aria-valuemin={0} aria-valuemax={timing.durationInFrames - 1} aria-valuenow={frame}
      aria-valuetext={`${formatReviewTimecode(frame, timing.fps)}, frame ${frame}`} onPointerDown={scrub.onPointerDown}
      onPointerMove={scrub.onPointerMove} onPointerUp={scrub.onPointerUp} onPointerCancel={scrub.onPointerCancel} {...stylex.props(styles.dock)}>
      <Box {...stylex.props(styles.gutter)}>
        {data.lanes.map((lane) => (
          <Box key={lane} {...stylex.props(heightOf(lane))}>
            {lane !== 'ruler' && <ReviewLaneGutter lane={lane} hidden={folded.has(lane)} onToggle={() => setFolded((was) => toggled(was, lane))} />}
          </Box>
        ))}
        <Box {...stylex.props(styles.overviewSpacer)} />
      </Box>
      <Box ref={attachLanes} {...stylex.props(styles.lanes)}>
        {data.lanes.map((lane) => <Box key={lane} {...stylex.props(heightOf(lane))}>{folded.has(lane) || REVIEW_DOCK_LANES[lane](view, data, hover)}</Box>)}
        {/* Its row is kept at fit too, so zooming doesn't grow the dock and nudge the stage. */}
        {view.zoom > 1 ? reviewDockOverviewOf(view, (next) => setView(() => next)) : <Box {...stylex.props(styles.overviewSpacer)} />}
        <ReviewLanePlayhead view={view} sketch={scrub.sketch} />
        <ReviewHoverPreview view={view} hover={hover} />
      </Box>
    </Box>
  );
}
