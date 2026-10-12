import { Box, Text, Tooltip, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef } from 'react';
import {
  formatReviewTimecode, REVIEW_READOUT_CHAR_PX, reviewTimelineVisibleFrames, reviewTimelineXOf, type ReviewPeaks, type ReviewTimelineView,
} from '#lib/output/review/models/review-timeline-geometry.ts';
import { colors, fonts, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { drawReviewPeaks } from './review-peaks-canvas.ts';
import { useReviewScreen } from './review-screen-context.tsx';

/** The lane's top band, where the sounds' names sit above the waveform: their letters' height, not the full line. */
const REVIEW_SOUND_NAME_ROOM = '12px';

const styles = stylex.create({
  lane: { position: 'relative', height: '100%', overflow: 'hidden' },
  // The canvas takes its ink from `color`, so the waveform is drawn in the token. It starts under the names' line, so
  // a name sits on clear ground rather than over the peaks.
  wave: { position: 'absolute', top: REVIEW_SOUND_NAME_ROOM, left: 0, width: '100%', height: `calc(100% - ${REVIEW_SOUND_NAME_ROOM})`, color: colors.mark, pointerEvents: 'none' },
  sound: {
    position: 'absolute', top: 0, bottom: 0, display: 'flex', alignItems: 'flex-start', gap: spacing.tight,
    marginLeft: '-1px', paddingRight: spacing.tight, cursor: 'pointer', whiteSpace: 'nowrap',
    fontFamily: fonts.mono, lineHeight: typography.lineHeight,
    color: { default: colors.dim, ':hover': colors.cream },
    outlineColor: colors.cream, outlineWidth: { default: 0, ':focus-visible': '1px' }, outlineStyle: 'solid',
  },
  tick: {
    width: '3px', height: '100%', borderRadius: radius.control, backgroundColor: colors.mark,
    borderWidth: '1px', borderStyle: 'solid', borderColor: colors.mark,
  },
  // Backed by the dock's panel: drawn straight over the waveform, a name in grey on grey can't be read.
  name: { backgroundColor: colors.panel, paddingInlineEnd: spacing.hairline },
  // A cue-list alternative this render doesn't play: hollow.
  alternative: { backgroundColor: 'transparent' },
  aimed: { backgroundColor: colors.cobalt, borderColor: colors.cobalt },
  at: (left: string) => ({ left }),
});

/**
 * The sound: the render's waveform in structure grey with the cue list's sounds over it, an alternative the render
 * doesn't play hollow. A click on a sound aims the draft at it.
 */
export function ReviewLaneSound({ view, peaks }: { readonly view: ReviewTimelineView; readonly peaks: ReviewPeaks | undefined }) {
  const { artifact, timing, draft, playback } = useReviewScreen();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current && peaks) drawReviewPeaks(canvas.current, peaks, { from: view.start / timing.fps, to: (view.start + reviewTimelineVisibleFrames(view)) / timing.fps });
  }, [view, peaks, timing.fps]);
  const sounds = (artifact.sounds ?? []).toSorted((a, b) => a.frame - b.frame);
  const aimed = draft.anchor.on === 'video' ? draft.anchor.cue : undefined;
  const aim = (id: string, frame: number) => {
    const writtenOn = { path: artifact.path, hash: artifact.render.hash };
    draft.setAnchor((anchor) => ({ ...(anchor.on === 'video' ? anchor : {}), on: 'video', frame, cue: id, writtenOn }));
    playback.seek(frame);
  };
  return (
    <Box {...stylex.props(styles.lane)}>
      {peaks && <canvas ref={canvas} {...stylex.props(styles.wave)} />}
      {sounds.map((sound, i) => {
        const x = reviewTimelineXOf(view, sound.frame + 0.5);
        if (x < 0 || x > view.width) return null;
        const next = sounds[i + 1];
        const room = (next ? reviewTimelineXOf(view, next.frame + 0.5) : view.width) - x;
        const label = `${sound.sound} · ${sound.id} · ${formatReviewTimecode(sound.frame, timing.fps)}${sound.source === 'cue-list' ? ' · cue list' : ''}`;
        return (
          <Tooltip key={`${sound.source}:${sound.id}`} label={label} openDelay={400} withinPortal>
            <UnstyledButton aria-label={`${sound.sound} ${sound.id}`} onClick={() => aim(sound.id, sound.frame)} fz="xs" {...stylex.props(styles.sound, styles.at(`${x}px`))}>
              <Box {...stylex.props(styles.tick, sound.source === 'cue-list' && styles.alternative, aimed === sound.id && styles.aimed)} />
              {room >= (sound.sound.length + 2) * REVIEW_READOUT_CHAR_PX && <Text component="span" inherit {...stylex.props(styles.name)}>{sound.sound}</Text>}
            </UnstyledButton>
          </Tooltip>
        );
      })}
    </Box>
  );
}
