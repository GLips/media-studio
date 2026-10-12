import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { reviewGuidesFor, type ReviewGuideRect, type ReviewGuideSet } from '#lib/output/review/models/review-guides.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';

type ReviewGuideCorner = 'topLeft' | 'bottomRight' | 'topRight' | 'bottomLeft';

/** Nested frames take the corners in turn, so their names don't land on one another. */
const REVIEW_GUIDE_CORNERS: readonly ReviewGuideCorner[] = ['topLeft', 'bottomRight', 'topRight', 'bottomLeft'];

const styles = stylex.create({
  overlay: { position: 'absolute', inset: 0, pointerEvents: 'none' },
  shape: { position: 'absolute', boxSizing: 'border-box' },
  at: (x: number, y: number, w: number, h: number) => ({ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }),
  across: (y: number) => ({ left: 0, top: `${y * 100}%`, width: '100%', height: '1px' }),
  down: (x: number) => ({ left: `${x * 100}%`, top: 0, width: '1px', height: '100%' }),
  frame: { borderWidth: '1px', borderStyle: 'solid', borderColor: colors.cream },
  zone: { backgroundColor: colors.rangeWash, borderWidth: '1px', borderStyle: 'solid', borderColor: colors.mark },
  line: { position: 'absolute', backgroundColor: colors.cream, opacity: 0.5 },
  // A solid chip, legible over any picture, just inside its shape's corner and never nearer than 2px to the frame's
  // edge, where the stage would cut it. A name longer than its shape is cut short inside it.
  chip: (w: number) => ({
    position: 'absolute', maxWidth: `min(calc(${w * 100}% - 2px), calc(100% - 4px))`,
    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
    paddingInline: spacing.tight, borderRadius: radius.control, backgroundColor: colors.panel,
  }),
  left: (x: number) => ({ left: `max(2px, calc(${x * 100}% + 1px))` }),
  right: (x: number) => ({ right: `max(2px, calc(${x * 100}% + 1px))` }),
  top: (y: number) => ({ top: `max(2px, calc(${y * 100}% + 1px))` }),
  bottom: (y: number) => ({ bottom: `max(2px, calc(${y * 100}% + 1px))` }),
});

/** A name's chip in its shape's corner, placed in from the frame's edges that corner faces. */
function reviewGuideChipStyles({ x, y, w, h }: ReviewGuideRect, corner: ReviewGuideCorner) {
  const horizontal = corner === 'topLeft' || corner === 'bottomLeft' ? styles.left(x) : styles.right(1 - x - w);
  const vertical = corner === 'topLeft' || corner === 'topRight' ? styles.top(y) : styles.bottom(1 - y - h);
  return [styles.chip(w), horizontal, vertical];
}

/**
 * `H`'s guides over the frame, in 0–1 frame coordinates so they ride the frame's box at any zoom: safe areas and the
 * caption band, the platform's chrome and other feeds' crops, or the thirds. The names are a layer over every shape,
 * so no line crosses one. Decoration: the pointer passes through.
 */
export function ReviewGuidesOverlay({ set, frame }: { readonly set: ReviewGuideSet; readonly frame: { w: number; h: number } }) {
  const guides = reviewGuidesFor(set, frame);
  const shapes = guides.flatMap((g) => (g.kind === 'line' ? [] : [g]));
  const frames = shapes.filter((g) => g.kind === 'frame');
  return (
    <Box {...stylex.props(styles.overlay)}>
      {guides.map((guide) => {
        // The guides draw lines only upright or level, the thirds, so each is a hairline across or down the frame.
        if (guide.kind === 'line') {
          const place = guide.from.x === guide.to.x ? styles.down(guide.from.x) : styles.across(guide.from.y);
          return <Box key={`line:${guide.from.x}:${guide.from.y}`} {...stylex.props(styles.line, place)} />;
        }
        const { x, y, w, h } = guide.rect;
        return <Box key={`${guide.kind}:${guide.name}`} {...stylex.props(styles.shape, styles.at(x, y, w, h), guide.kind === 'zone' ? styles.zone : styles.frame)} />;
      })}
      {shapes.map((guide) => {
        // A zone is a band the platform draws over: its name goes inside it, top right, clear of the frames' first corners.
        const corner = guide.kind === 'zone' ? 'topRight' : REVIEW_GUIDE_CORNERS[frames.indexOf(guide) % REVIEW_GUIDE_CORNERS.length];
        return (
          <Box key={`name:${guide.name}`} {...stylex.props(...reviewGuideChipStyles(guide.rect, corner))}>
            <Readout bright>{guide.name}</Readout>
          </Box>
        );
      })}
    </Box>
  );
}
