import { Box, Image, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { shadows } from '#web/shared/ui/shadows.ts';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { reviewProofGroundStyles, type ReviewProofGround } from './use-review-proof-ground.ts';

/** The shape a tile holds before its picture says otherwise: the common video frame. */
const REVIEW_TILE_GUESSED_ASPECT = 16 / 9;

/** How tall a column's tile stands: the stills grid sizes each section's columns to this height at its aspect. */
export const REVIEW_TILE_COLUMN_HEIGHT = '128px';

const styles = stylex.create({
  button: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: radius.control, cursor: 'pointer',
    outlineColor: colors.cream, outlineOffset: '1px', outlineStyle: 'solid', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  // A row's tile is as tall as the row and as wide as its picture; a cell's fits inside the cell.
  // Scrolled into view clear of the edges' fades, and in a cell with the name line under it too.
  row: { height: '100%', flexShrink: 0, scrollMarginInline: '16px' },
  cell: { width: '100%', height: '100%', scrollMarginTop: '16px', scrollMarginBottom: '40px' },
  // A column's tile is as wide as its column, held to a height, on the column's left edge and bottom-aligned: a still
  // in a column cut for another shape lines up with its neighbours, and its caption sits right under it.
  column: { width: '100%', alignItems: 'flex-end', justifyContent: 'flex-start', scrollMarginTop: '16px', scrollMarginBottom: '40px' },
  picture: { position: 'relative', overflow: 'hidden', borderRadius: radius.control, backgroundColor: colors.skeleton },
  // The edge hugs the picture, not the cell it sits in. Its own layer over the image, which an outline would sit under;
  // being on top, it's also what the pointer hovers.
  edge: {
    position: 'absolute', inset: 0, borderRadius: radius.control,
    borderWidth: spacing.hairline, borderStyle: 'solid', borderColor: { default: 'transparent', ':hover': colors.dim },
  },
  inRow: (aspect: number) => ({ height: '100%', aspectRatio: aspect }),
  inColumn: (aspect: number) => ({ aspectRatio: aspect, width: `min(100%, calc(${REVIEW_TILE_COLUMN_HEIGHT} * ${aspect}))` }),
  inCell: (aspect: number) => ({ aspectRatio: aspect, maxWidth: '100%', maxHeight: '100%', width: `min(100%, 100cqh * ${aspect})` }),
  cellBox: { containerType: 'size' },
  corner: { position: 'absolute', top: spacing.tight, right: spacing.tight, pointerEvents: 'none' },
  image: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
  waiting: { opacity: 0 },
});

type ReviewStillTileProps = {
  readonly src: string;
  readonly label: string;
  /** The picture's width over height when known (a render's frame size); otherwise it's learnt as the picture loads. */
  readonly aspect: number | null;
  readonly fill: 'row' | 'cell' | 'column';
  /** The ground a transparent picture shows over; null for one that isn't. */
  readonly ground: ReviewProofGround | null;
  readonly selected: boolean;
  readonly onClick: () => void;
  /** The grid's way to show a still on the stage, a click there only selecting it. */
  readonly onDoubleClick?: () => void;
  /** Drawn over the picture's top-right corner: the notes' dots. */
  readonly corner?: ReactNode;
};

/**
 * A still that opens something: a Board frame, a still in the grid or the filmstrip. Its box has the picture's shape
 * from the start, a skeleton until the picture lands, never a black box; a selected tile scrolls itself into view.
 */
export function ReviewStillTile({ src, label, aspect, fill, ground, selected, onClick, onDoubleClick, corner }: ReviewStillTileProps) {
  const [loaded, setLoaded] = useState<number | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) button.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);
  const shape = aspect ?? loaded ?? REVIEW_TILE_GUESSED_ASPECT;
  return (
    <UnstyledButton ref={button} aria-label={label} aria-current={selected || undefined} onClick={onClick} onDoubleClick={onDoubleClick}
      {...stylex.props(styles.button, styles[fill], fill === 'cell' && styles.cellBox)}>
      <Box {...stylex.props(
        styles.picture, { row: styles.inRow, cell: styles.inCell, column: styles.inColumn }[fill](shape),
        loaded !== null && ground && reviewProofGroundStyles[ground], selected && shadows.tileSelectedRing,
      )}>
        <Image src={src} alt="" loading="lazy" draggable={false}
          // A picture the browser had before the page hydrated has loaded already, and fires no load event.
          ref={(img: HTMLImageElement | null) => { if (img?.complete && img.naturalWidth) setLoaded(img.naturalWidth / img.naturalHeight); }}
          onLoad={(e) => setLoaded(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
          {...stylex.props(styles.image, loaded === null && styles.waiting)} />
        <Box {...stylex.props(styles.edge)} />
        {corner !== undefined && <Box {...stylex.props(styles.corner)}>{corner}</Box>}
      </Box>
    </UnstyledButton>
  );
}
