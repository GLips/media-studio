import { Box, Group, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { studioSiblingNameOf } from '#web/shared/studio-sibling-names.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { reviewSectionedGridStep, reviewStillAspectSectionsOf, reviewStillRatioName, type ReviewStillOrientation } from './review-still-aspects.ts';
import { useReviewStillPixels, type ReviewStillSibling } from './review-still-siblings.ts';
import { REVIEW_TILE_COLUMN_HEIGHT, ReviewStillTile } from './review-still-tile.tsx';
import { ReviewThreadDots } from './review-thread-dots.tsx';
import { reviewTileArrowKeys, useReviewBoardHotkeys } from './use-review-board-hotkeys.ts';
import { useReviewProofGround } from './use-review-proof-ground.ts';

/** The narrowest a column gets, so a portrait still's caption has room: its picture sits left, the spare width right. */
const REVIEW_GRID_MIN_COLUMN = '120px';

const styles = stylex.create({
  sections: { padding: spacing.inset },
  // A contact sheet: every section's columns cut to its own aspect at one height, from the same left edge, so each row
  // is a strip of pictures the same height whatever their shape. Top-aligned: a caption run to two lines hangs lower.
  grid: (aspect: number) => ({
    display: 'grid', columnGap: spacing.gap, rowGap: spacing.inset, alignItems: 'start', justifyContent: 'start',
    gridTemplateColumns: `repeat(auto-fill, min(100%, max(${REVIEW_GRID_MIN_COLUMN}, calc(${REVIEW_TILE_COLUMN_HEIGHT} * ${aspect}))))`,
  }),
  subhead: { color: colors.dim },
  shape: { color: colors.cream, fontWeight: 600 },
  // Cream and on the cell's left edge, so a caption reads as the still's name, not a dim footnote under it. Held to the
  // column's width and wrapped at its dashes onto a second line before it's cut: a portrait column is narrow.
  name: { width: 0, minWidth: '100%', color: colors.cream, overflowWrap: 'anywhere' },
  current: { fontWeight: 600 },
});

/** The grid's `Enter`, by the name the rail's Open button reads its key from. */
export const REVIEW_OPEN_STILL_HOTKEY = 'Open still';

/** Marks a section's grid, each laid out at its own column count. */
const REVIEW_STILL_SECTION_ATTRIBUTE = 'data-review-still-section';

/** The column a section's tracks are cut to before its stills' pixels are read: the common video frame. */
const REVIEW_GRID_GUESSED_ASPECT = 16 / 9;

/**
 * How many columns each section lays out at its width now, in order: what the arrows' up and down move by. Read from
 * the page, as the arrow keys' handlers are built while rendering, where a ref may not be read.
 */
function reviewGridColumnsNow(): number[] {
  return [...document.querySelectorAll(`[${REVIEW_STILL_SECTION_ATTRIBUTE}]`)].map((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
}

/**
 * A section's heading: `Wide · 1200 × 630 · 4 stills`, its orientation, its size when every still shares one, its
 * count; `Wide · 16:9 · 1280 × 720` when another section is wide too.
 */
const REVIEW_STILL_ORIENTATION_TITLES: Readonly<Record<ReviewStillOrientation, string>> = { wide: 'Wide', square: 'Square', tall: 'Tall' };

type ReviewStillGridProps = {
  readonly stills: readonly ReviewStillSibling[];
  /** The still the rail describes: the open file, which choosing a tile changes. */
  readonly selectedPath: string;
  /** The stills the ground shows through. */
  readonly clear: ReadonlySet<string>;
  readonly onSelect: (path: string) => void;
  /** Shows the selected still on the stage. */
  readonly onOpen: () => void;
};

/**
 * The folder's stills in a section per aspect, widest first, so each section's rows are even; each with its notes'
 * dots in the corner, labelled by the part of its name that sets it apart. A click or the arrows (across sections too)
 * select a still, which the rail then describes; `Enter` or a double-click shows it on the stage.
 */
export function ReviewStillGrid({ stills, selectedPath, clear, onSelect, onOpen }: ReviewStillGridProps) {
  const [ground] = useReviewProofGround();
  const pixels = useReviewStillPixels(stills);
  const sizeByPath = new Map(stills.map((s, i) => [s.path, pixels[i]]));
  const { groups, unread } = reviewStillAspectSectionsOf(stills, (s) => sizeByPath.get(s.path));
  const sections = [...groups, ...(unread.length ? [{ word: null, aspect: REVIEW_GRID_GUESSED_ASPECT, size: null, items: unread }] : [])];
  const shown = sections.flatMap((g) => g.items);
  const orientations = groups.map((g) => g.word);
  const sharedOrientations = new Set(orientations.filter((word, i) => orientations.indexOf(word) !== i));
  const at = Math.max(0, shown.findIndex((s) => s.path === selectedPath));
  const allNames = stills.map((s) => s.name);
  useReviewBoardHotkeys([
    ...reviewTileArrowKeys((step) => {
      const columns = reviewGridColumnsNow();
      const to = shown[reviewSectionedGridStep(at, step, sections.map((g, i) => ({ count: g.items.length, columns: columns[i] ?? 1 })))].path;
      if (to !== selectedPath) onSelect(to);
    }),
    { hotkey: 'Enter', name: REVIEW_OPEN_STILL_HOTKEY, run: onOpen },
  ], 'still');
  return (
    <FadeScroll>
      <Stack gap="inset" {...stylex.props(styles.sections)}>
        {sections.map((section) => (
          <Stack key={section.word === null ? 'unread' : `${section.word}-${section.items[0].path}`} gap="gap">
            {section.word !== null && (
              <Group gap="tight" wrap="nowrap" {...stylex.props(styles.subhead)}>
                <Text component="span" size="sm" {...stylex.props(styles.shape)}>{REVIEW_STILL_ORIENTATION_TITLES[section.word]}</Text>
                {sharedOrientations.has(section.word) && <Readout>· {reviewStillRatioName(section.aspect)}</Readout>}
                {section.size && <Readout>· {section.size.w} × {section.size.h}</Readout>}
                <Text component="span" size="sm">· {section.items.length} {section.items.length === 1 ? 'still' : 'stills'}</Text>
              </Group>
            )}
            <Box {...{ [REVIEW_STILL_SECTION_ATTRIBUTE]: true }} {...stylex.props(styles.grid(section.aspect))}>
              {section.items.map(({ path, name, src }, _i, items) => {
                // A section's stills drop the start they share (`buy-box-og-`): its heading says what they have in
                // common. A still alone in its section is named among the whole folder.
                const siblings = items.length > 1 ? items.map((s) => s.name) : allNames;
                return (
                  <Stack key={path} gap="tight">
                    <ReviewStillTile src={src} label={name} aspect={section.word === null ? null : section.aspect} fill="column" ground={clear.has(path) ? ground : null}
                      selected={path === selectedPath} onClick={() => onSelect(path)} onDoubleClick={onOpen} corner={<ReviewThreadDots path={path} />} />
                    <HotkeyTooltip name={name}>
                      <Text size="sm" lineClamp={2} {...stylex.props(styles.name, path === selectedPath && styles.current)}>
                        {studioSiblingNameOf(name, siblings).shown}
                      </Text>
                    </HotkeyTooltip>
                  </Stack>
                );
              })}
            </Box>
          </Stack>
        ))}
      </Stack>
    </FadeScroll>
  );
}
