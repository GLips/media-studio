import { Box, Group, ScrollArea } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewStillSibling } from './review-still-siblings.ts';
import { ReviewStillTile } from './review-still-tile.tsx';
import { ReviewThreadDots } from './review-thread-dots.tsx';
import { useReviewBoardHotkeys } from './use-review-board-hotkeys.ts';
import { useReviewProofGround } from './use-review-proof-ground.ts';

const REVIEW_FILMSTRIP_FADE = '12px';

const styles = stylex.create({
  strip: {
    height: '56px', backgroundColor: colors.panel,
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line,
    // The ends fade over the inset, so a tile scrolled past an edge trails off rather than being cut.
    maskImage: `linear-gradient(to right, transparent, black ${REVIEW_FILMSTRIP_FADE}, black calc(100% - ${REVIEW_FILMSTRIP_FADE}), transparent)`,
  },
  // As wide as its tiles, so the end's inset scrolls with them instead of the last tile running to the edge.
  tiles: { width: 'max-content', height: '56px', paddingInline: spacing.inset, paddingBlock: spacing.tight },
  tile: { height: '100%' },
});

type ReviewFilmstripProps = {
  /** The folder's stills, in order. */
  readonly stills: readonly ReviewStillSibling[];
  readonly openPath: string;
  /** The stills the ground shows through. */
  readonly clear: ReadonlySet<string>;
  readonly onOpen: (path: string) => void;
};

/**
 * The folder's stills in a row under a single one, in the dock's place: the open one edged, any other a click away,
 * the arrows stepping through them. The arrows are bound here, not in the view above, so they go with the strip: the
 * grid's own arrows register before a parent's effect could let these go, and collide.
 */
export function ReviewFilmstrip({ stills, openPath, clear, onOpen }: ReviewFilmstripProps) {
  const [ground] = useReviewProofGround();
  const here = stills.findIndex((s) => s.path === openPath);
  const step = (by: -1 | 1) => () => {
    const to = stills[here + by];
    if (to) onOpen(to.path);
  };
  useReviewBoardHotkeys([
    { hotkey: 'ArrowLeft', name: 'Previous still', run: step(-1) },
    { hotkey: 'ArrowRight', name: 'Next still', run: step(1) },
  ], 'still');
  return (
    <ScrollArea type="hover" scrollbars="x" scrollbarSize={4} {...stylex.props(styles.strip)}>
      <Group gap="tight" wrap="nowrap" {...stylex.props(styles.tiles)}>
        {stills.map(({ path, name, src }) => (
          <HotkeyTooltip key={path} name={name}>
            <Box {...stylex.props(styles.tile)}>
              <ReviewStillTile src={src} label={name} aspect={null} fill="row" ground={clear.has(path) ? ground : null}
                selected={path === openPath} onClick={() => onOpen(path)} corner={<ReviewThreadDots path={path} />} />
            </Box>
          </HotkeyTooltip>
        ))}
      </Group>
    </ScrollArea>
  );
}
