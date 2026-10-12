import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Circle, Delete, MoveUpRight, Pencil } from 'lucide-react';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewDrawTool } from './use-review-stage-hotkeys.ts';
import type { ReviewStageRect } from './use-review-stage-zoom.ts';

/** The strip's depth across its buttons: a 28px icon button, 2px padding each side and a 1px border. */
const REVIEW_DRAW_STRIP_PX = 34;
/** Its inset from the frame's edge when it has to sit on the picture. */
const REVIEW_DRAW_STRIP_INSET_PX = 8;

const styles = stylex.create({
  strip: {
    position: 'absolute', zIndex: 1, display: 'flex', padding: spacing.hairline,
    backgroundColor: colors.panel, borderRadius: radius.control,
    borderWidth: '1px', borderStyle: 'solid', borderColor: colors.cobalt,
  },
  vertical: { flexDirection: 'column' },
  at: (left: number, top: number) => ({ left: `${left}px`, top: `${top}px` }),
});

type ReviewDrawStripPlace = { vertical: boolean; left: number; top: number };

/**
 * Down the left letterbox, or across the top one, when either has room, so it covers none of the picture; else on
 * the picture, inset from its top-left corner.
 */
function reviewDrawStripPlaceOf(frame: ReviewStageRect | undefined): ReviewDrawStripPlace {
  const inset = REVIEW_DRAW_STRIP_INSET_PX, band = REVIEW_DRAW_STRIP_PX + 4;
  const left = Math.max(inset, (frame?.left ?? 0) + inset), top = Math.max(inset, (frame?.top ?? 0) + inset);
  if (frame && frame.left >= band) return { vertical: true, left: (frame.left - REVIEW_DRAW_STRIP_PX) / 2, top };
  if (frame && frame.top >= band) return { vertical: false, left, top: (frame.top - REVIEW_DRAW_STRIP_PX) / 2 };
  return { vertical: false, left, top };
}

type ReviewDrawStripProps = {
  readonly tool: ReviewDrawTool;
  readonly onTool: (tool: ReviewDrawTool) => void;
  /** Takes the last stroke back; off when there's none. */
  readonly onPopMark?: () => void;
  /** The frame's box on the stage, so the strip can sit beside the picture rather than on it. */
  readonly frame: ReviewStageRect | undefined;
};

/** `↗ ○ ✎ ⌫` by the frame's top-left while drawing: the tool a drag draws with, and the last stroke back. */
export function ReviewDrawStrip({ tool, onTool, onPopMark, frame }: ReviewDrawStripProps) {
  const { vertical, left, top } = reviewDrawStripPlaceOf(frame);
  return (
    <Box {...stylex.props(styles.strip, vertical && styles.vertical, styles.at(left, top))}>
      <IconButton name="Arrow" active={tool === 'arrow'} onClick={() => onTool('arrow')}><MoveUpRight size={14} /></IconButton>
      <IconButton name="Circle" active={tool === 'ellipse'} onClick={() => onTool('ellipse')}><Circle size={14} /></IconButton>
      <IconButton name="Pen" active={tool === 'path'} onClick={() => onTool('path')}><Pencil size={14} /></IconButton>
      <IconButton name="Undo stroke" onClick={onPopMark} disabled={!onPopMark}><Delete size={14} /></IconButton>
    </Box>
  );
}
