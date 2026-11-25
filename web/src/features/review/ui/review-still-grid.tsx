import { Box, Group, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { studioNameGroupsOf, studioSortedBy } from '#web/shared/studio-collection-arrangement.ts';
import { studioSpatialStepOf } from '#web/shared/studio-spatial-step.ts';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { StudioCollectionArrangementMenu } from '#web/shared/ui/studio-collection-arrangement-menu.tsx';
import { StudioJustifiedRows } from '#web/shared/ui/studio-justified-rows.tsx';
import { StudioNameGroupHead } from '#web/shared/ui/studio-name-group-head.tsx';
import { STUDIO_TILE_CAPTION_MIN_WIDTH, StudioTileCaption } from '#web/shared/ui/studio-tile-caption.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useStudioCollectionArrangement } from '#web/shared/ui/use-studio-collection-arrangement.ts';
import { reviewStillAspectSectionsOf, reviewStillCaptionSiblingsOf, reviewStillRatioName, type ReviewStillOrientation } from './review-still-aspects.ts';
import { useReviewStillPixels, type ReviewStillSibling } from './review-still-siblings.ts';
import { REVIEW_TILE_COLUMN_HEIGHT, ReviewStillTile } from './review-still-tile.tsx';
import { ReviewThreadDots } from './review-thread-dots.tsx';
import { reviewTileArrowKeys, useReviewBoardHotkeys } from './use-review-board-hotkeys.ts';
import { useReviewProofGround } from './use-review-proof-ground.ts';

const styles = stylex.create({
  sections: { padding: spacing.inset },
  // The grid's own controls, at its top right where a page's title row would carry them.
  controls: { justifyContent: 'flex-end', marginBlockEnd: `calc(-1 * ${spacing.gap})` },
  // A contact sheet: every section's columns cut to its own aspect at one height, from the same left edge, so each row
  // is a strip of pictures the same height whatever their shape. Top-aligned: a caption run to two lines hangs lower.
  grid: (aspect: number) => ({
    display: 'grid', columnGap: spacing.gap, rowGap: spacing.inset, alignItems: 'start', justifyContent: 'start',
    gridTemplateColumns: `repeat(auto-fill, min(100%, max(${STUDIO_TILE_CAPTION_MIN_WIDTH}px, calc(${REVIEW_TILE_COLUMN_HEIGHT} * ${aspect}))))`,
  }),
  subhead: { color: colors.dim },
  shape: { color: colors.cream, fontWeight: 600 },
  // Held to the column's width, so a long name gives way in its middle rather than widening the column.
  caption: { display: 'flex', width: 0, minWidth: '100%', color: colors.cream },
  // In a justified row: the tile as wide as its picture, the picture as tall as the row.
  justifiedTile: (width: number) => ({ width: `${width}px`, flexShrink: 0 }),
  justifiedPicture: (height: number) => ({ height: `${height}px` }),
});

/** The grid's `Enter`, by the name the rail's Open button reads its key from. */
export const REVIEW_OPEN_STILL_HOTKEY = 'Open still';

/** Marks each tile, in reading order, for the arrows to read where it sits on screen. */
const REVIEW_STILL_TILE_ATTRIBUTE = 'data-review-still-tile';

/** The column a section's tracks are cut to before its stills' pixels are read: the common video frame. */
const REVIEW_GRID_GUESSED_ASPECT = 16 / 9;

/** A justified row's height before it scales to fill the width, as the shape sections' REVIEW_TILE_COLUMN_HEIGHT. */
const REVIEW_STILL_ROW_HEIGHT = 128;

/** spacing.gap in px, as the justified rows' arithmetic needs it. */
const REVIEW_STILL_ROW_GAP = 8;

/**
 * Every tile's box on screen now, in reading order: what the arrows' up and down step through. Read from the page, as
 * the arrow keys' handlers are built while rendering, where a ref may not be read.
 */
const reviewStillTileBoxesNow = () => [...document.querySelectorAll(`[${REVIEW_STILL_TILE_ATTRIBUTE}]`)].map((tile) => tile.getBoundingClientRect());

/**
 * A section's heading: `Wide · 1200 × 630 · 4 stills`, its orientation, its size when every still shares one, its
 * count; `Wide · 16:9 · 1280 × 720` when another section is wide too.
 */
const REVIEW_STILL_ORIENTATION_TITLES: Readonly<Record<ReviewStillOrientation, string>> = { wide: 'Wide', square: 'Square', tall: 'Tall' };

/** One run of the grid under its heading, in the order the arrows read it. */
type ReviewStillGridSection = { readonly key: string; readonly head: ReactNode; readonly items: readonly ReviewStillSibling[]; readonly body: ReactNode };

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
 * The folder's stills, grouped and ordered as the studio's grids are (useStudioCollectionArrangement): a section per
 * aspect, or justified rows by name or as one run. A click or the arrows (across sections too) select a still, which
 * the rail then describes; `Enter` or a double-click shows it on the stage.
 */
export function ReviewStillGrid({ stills, selectedPath, clear, onSelect, onOpen }: ReviewStillGridProps) {
  const [ground] = useReviewProofGround();
  const { group, sort } = useStudioCollectionArrangement();
  const pixels = useReviewStillPixels(stills);
  const sizeByPath = new Map(stills.map((s, i) => [s.path, pixels[i]]));
  const sorted = studioSortedBy(stills, sort, (s) => s);
  const tileOf = (still: ReviewStillSibling, siblings: readonly string[], aspect: number | null, height?: number) => (
    <Stack key={still.path} gap="tight" {...{ [REVIEW_STILL_TILE_ATTRIBUTE]: true }}
      {...stylex.props(height !== undefined && aspect !== null && styles.justifiedTile(aspect * height))}>
      <Box {...stylex.props(height !== undefined && styles.justifiedPicture(height))}>
        <ReviewStillTile src={still.src} label={still.name} aspect={aspect} fill={height === undefined ? 'column' : 'row'}
          ground={clear.has(still.path) ? ground : null} selected={still.path === selectedPath}
          onClick={() => onSelect(still.path)} onDoubleClick={onOpen} corner={<ReviewThreadDots path={still.path} />} />
      </Box>
      <Box {...stylex.props(styles.caption)}><StudioTileCaption name={still.name} siblings={siblings} /></Box>
    </Stack>
  );
  const sections = group === 'shape'
    ? reviewStillAspectGridSectionsOf(sorted, (s) => sizeByPath.get(s.path), tileOf)
    : reviewStillJustifiedSectionsOf(group === 'name' ? studioNameGroupsOf(sorted, (s) => s.name) : [{ head: '', items: sorted }],
      (s) => { const size = sizeByPath.get(s.path); return size ? size.w / size.h : REVIEW_GRID_GUESSED_ASPECT; }, tileOf);
  const shown = sections.flatMap((section) => section.items);
  const at = Math.max(0, shown.findIndex((s) => s.path === selectedPath));
  useReviewBoardHotkeys([
    ...reviewTileArrowKeys(({ along, rows }) => {
      // Left and right step through the reading order, on into the next row; up and down go where the tiles sit.
      const to = rows === 0
        ? Math.min(Math.max(at + along, 0), shown.length - 1)
        : studioSpatialStepOf(reviewStillTileBoxesNow(), at, rows > 0 ? 'down' : 'up') ?? at;
      if (shown[to].path !== selectedPath) onSelect(shown[to].path);
    }),
    { hotkey: 'Enter', name: REVIEW_OPEN_STILL_HOTKEY, run: onOpen },
  ], 'still');
  return (
    <FadeScroll>
      <Stack gap="inset" {...stylex.props(styles.sections)}>
        <Group {...stylex.props(styles.controls)}><StudioCollectionArrangementMenu /></Group>
        {sections.map((section) => (
          <Stack key={section.key} gap="gap">
            {section.head}
            {section.body}
          </Stack>
        ))}
      </Stack>
    </FadeScroll>
  );
}

type ReviewStillTileOf = (still: ReviewStillSibling, siblings: readonly string[], aspect: number | null, height?: number) => ReactNode;

/** By shape: a section per aspect, each a grid of columns cut to it, headed by its orientation, size and count. */
function reviewStillAspectGridSectionsOf(
  stills: readonly ReviewStillSibling[], sizeOf: (still: ReviewStillSibling) => { readonly w: number; readonly h: number } | undefined, tileOf: ReviewStillTileOf,
): ReviewStillGridSection[] {
  const { groups, unread } = reviewStillAspectSectionsOf(stills, sizeOf);
  const sections = [...groups, ...(unread.length ? [{ word: null, aspect: REVIEW_GRID_GUESSED_ASPECT, size: null, items: unread }] : [])];
  const orientations = groups.map((g) => g.word);
  const sharedOrientations = new Set(orientations.filter((word, i) => orientations.indexOf(word) !== i));
  return sections.map((section) => ({
    key: section.word === null ? 'unread' : `${section.word}-${section.items[0].path}`,
    items: section.items,
    head: section.word !== null && (
      <Group gap="tight" wrap="nowrap" {...stylex.props(styles.subhead)}>
        <Text component="span" size="sm" {...stylex.props(styles.shape)}>{REVIEW_STILL_ORIENTATION_TITLES[section.word]}</Text>
        {sharedOrientations.has(section.word) && <Readout>· {reviewStillRatioName(section.aspect)}</Readout>}
        {section.size && <Readout>· {section.size.w} × {section.size.h}</Readout>}
        <Text component="span" size="sm">· {section.items.length} {section.items.length === 1 ? 'still' : 'stills'}</Text>
      </Group>
    ),
    body: (
      <Box {...stylex.props(styles.grid(section.aspect))}>
        {section.items.map((still, _i, items) => tileOf(still, reviewStillCaptionSiblingsOf(items, stills), section.word === null ? null : section.aspect))}
      </Box>
    ),
  }));
}

/** By name, or as one run: justified rows of stills at their own shapes, a name group headed by the start it shares. */
function reviewStillJustifiedSectionsOf(
  groups: readonly { readonly head: string; readonly items: readonly ReviewStillSibling[] }[], aspectOf: (still: ReviewStillSibling) => number, tileOf: ReviewStillTileOf,
): ReviewStillGridSection[] {
  return groups.map(({ head, items }) => {
    const aspects = items.map(aspectOf);
    const siblings = items.map((s) => s.name);
    return {
      key: head || 'all',
      items,
      head: head && <StudioNameGroupHead head={head} count={items.length} />,
      body: (
        <StudioJustifiedRows aspects={aspects} target={REVIEW_STILL_ROW_HEIGHT} gap={REVIEW_STILL_ROW_GAP}
          tileKeyOf={(i) => items[i].path} renderTile={(i, _width, height) => tileOf(items[i], siblings, aspects[i], height)} />
      ),
    };
  });
}
