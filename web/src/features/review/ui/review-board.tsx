import { Box, Stack } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { reviewBoardOf } from '#lib/output/review/models/review-storyboard.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ReviewBoardRow } from './review-board-row.tsx';
import { useReviewFrame, useReviewScreen } from './review-screen-context.tsx';
import { reviewBoardCursorStep, useReviewBoardCursor } from './use-review-board-cursor.ts';
import { reviewTileArrowKeys, useReviewBoardHotkeys } from './use-review-board-hotkeys.ts';
import { useReviewProofGround } from './use-review-proof-ground.ts';

const styles = stylex.create({
  board: { height: '100%', backgroundColor: colors.ground },
  rows: { paddingInline: spacing.gap, paddingBlockEnd: spacing.gap },
});

/**
 * `B`: the render's scenes as rows of stills at its true aspect, in the stage's place, the dock still under it. The
 * arrows walk the stills, `Enter` or a click seeks there and returns to the stage, `Escape` returns without seeking.
 * A transparent render's grounds stay on the transport below.
 */
export function ReviewBoard() {
  const { artifact, timing, playback, setMode, setSearch } = useReviewScreen();
  const frame = useReviewFrame();
  const [ground] = useReviewProofGround();
  const { aspect, rows } = reviewBoardOf({ storyboard: artifact.storyboard, frameSize: artifact.frameSize, durationInFrames: timing.durationInFrames });
  const columns = Math.max(1, ...rows.map((r) => r.stills.length));
  const { cursor, setCursor, viewport } = useReviewBoardCursor(rows, frame);
  // Going to a tile lets go of the note in focus: it's somewhere else on the render.
  const open = (to: number) => {
    playback.seek(to);
    setSearch({ note: undefined });
    setMode('stage');
  };
  useReviewBoardHotkeys(rows.length ? [
    ...reviewTileArrowKeys((step) => setCursor((at) => reviewBoardCursorStep(rows, at, step))),
    { hotkey: 'Enter', name: 'Open', run: () => open(rows[cursor.row].stills[cursor.still].frame) },
    { hotkey: 'Escape', name: 'Stage', run: () => setMode('stage') },
  ] : [{ hotkey: 'Escape', name: 'Stage', run: () => setMode('stage') }], 'board');
  return (
    <Box {...stylex.props(styles.board)}>
      <FadeScroll viewportRef={viewport}>
        <Stack gap={0} {...stylex.props(styles.rows)}>
          {rows.map((row, i) => (
            <ReviewBoardRow key={row.scene?.id ?? 'untimed'} row={row} aspect={aspect} columns={columns} ground={artifact.transparent ? ground : null}
              cursor={cursor.row === i ? cursor.still : null} onOpen={open} />
          ))}
        </Stack>
      </FadeScroll>
    </Box>
  );
}
