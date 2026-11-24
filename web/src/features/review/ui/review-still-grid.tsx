import { Box, Group, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { reviewStillShortNames } from './review-still-short-names.ts';
import { reviewSectionedGridStep, reviewStillAspectSectionsOf, reviewStillRatioName, type ReviewStillOrientation } from './review-still-aspects.ts';
import { useReviewStillPixels, type ReviewStillSibling } from './review-still-siblings.ts';
import { ReviewStillTile } from './review-still-tile.tsx';
import { ReviewThreadDots } from './review-thread-dots.tsx';
import { reviewTileArrowKeys, useReviewBoardHotkeys } from './use-review-board-hotkeys.ts';
import { useReviewProofGround } from './use-review-proof-ground.ts';

const styles = stylex.create({
  sections: { padding: spacing.inset },
  // One shape to a section, so every row in it is even; bottom-aligned all the same, for a section of mixed sizes.
  grid: { display: 'grid', columnGap: spacing.gap, rowGap: spacing.inset, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', alignItems: 'end' },
  subhead: { color: colors.dim },
  shape: { color: colors.cream, fontWeight: 600 },
  // Cut in the middle: the head gives way, the tail (where variants differ) and the extension stay. Cream and on the
  // picture's left edge, so a caption reads as the still's name, not a dim footnote under it.
  name: { display: 'flex', width: 0, minWidth: '100%', color: colors.cream, whiteSpace: 'nowrap' },
  head: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  tail: { flexShrink: 0 },
  current: { fontWeight: 600 },
});

/** Characters of the name's stem kept beside its extension when the name is cut. */
const REVIEW_GRID_NAME_TAIL = 4;

/** A file name as the part a narrow cell may cut and the part it always shows: the stem's end and the extension. */
function reviewGridNameParts(name: string): { head: string; tail: string } {
  const dot = name.lastIndexOf('.');
  const cut = Math.max(0, (dot > 0 ? dot : name.length) - REVIEW_GRID_NAME_TAIL);
  return { head: name.slice(0, cut), tail: name.slice(cut) };
}

/** Marks a section's grid, every one laid out at the same column count. */
const REVIEW_STILL_SECTION_ATTRIBUTE = 'data-review-still-section';

/**
 * How many columns the sections lay out at their width now: the arrows' up and down move by that many. Read from the
 * page, as the arrow keys' handlers are built while rendering, where a ref may not be read.
 */
function reviewGridColumnsNow(): number {
  const grid = document.querySelector(`[${REVIEW_STILL_SECTION_ATTRIBUTE}]`);
  return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1;
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
  const sections = [...groups, ...(unread.length ? [{ word: null, size: null, items: unread }] : [])];
  const shown = sections.flatMap((g) => g.items);
  const orientations = groups.map((g) => g.word);
  const sharedOrientations = new Set(orientations.filter((word, i) => orientations.indexOf(word) !== i));
  const at = Math.max(0, shown.findIndex((s) => s.path === selectedPath));
  const short = reviewStillShortNames(stills.map((t) => t.name));
  const shortNames = new Map(stills.map((s, i) => [s.path, short[i]]));
  useReviewBoardHotkeys([
    ...reviewTileArrowKeys((step) => {
      const to = shown[reviewSectionedGridStep(at, step, sections.map((g) => g.items.length), reviewGridColumnsNow())].path;
      if (to !== selectedPath) onSelect(to);
    }),
    { hotkey: 'Enter', name: 'Open', run: onOpen },
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
            <Box {...{ [REVIEW_STILL_SECTION_ATTRIBUTE]: true }} {...stylex.props(styles.grid)}>
              {section.items.map(({ path, name, src }) => {
                const { head, tail } = reviewGridNameParts(shortNames.get(path) ?? name);
                return (
                  <Stack key={path} gap="tight">
                    <ReviewStillTile src={src} label={name} aspect={null} fill="column" ground={clear.has(path) ? ground : null}
                      selected={path === selectedPath} onClick={() => onSelect(path)} onDoubleClick={onOpen} corner={<ReviewThreadDots path={path} />} />
                    <Text component="span" size="sm" title={name} {...stylex.props(styles.name, path === selectedPath && styles.current)}>
                      <Box component="span" {...stylex.props(styles.head)}>{head}</Box>
                      <Box component="span" {...stylex.props(styles.tail)}>{tail}</Box>
                    </Text>
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
