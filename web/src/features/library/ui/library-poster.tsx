import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { AudioLines } from 'lucide-react';
import { useState } from 'react';
import { libraryPosterFrameOf, type LibraryItem } from '#lib/footage/library/models/library-item.ts';
import { libraryPosterUrl } from '#lib/footage/library/studio/library-media.ts';
import { colors, radius } from '#web/shared/ui/theme.stylex.ts';

// The index's ProjectThumbnail box, larger: on the shelf the picture is how a take is told apart.
const styles = stylex.create({
  // 16:9; a screen of another shape letterboxes inside it on the screen ground.
  frame: {
    position: 'relative', flexShrink: 0, width: '96px', height: '54px', overflow: 'hidden', borderRadius: radius.control,
    backgroundColor: colors.screen, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.dim,
  },
  // A grid tile's: the tile's width, at 16:9.
  tile: { width: '100%', height: 'auto', aspectRatio: '16 / 9' },
  pending: { backgroundColor: colors.skeleton },
  sound: { backgroundColor: colors.panel },
  picture: { width: '100%', height: '100%', objectFit: 'contain' },
  hidden: { opacity: 0 },
});

type LibraryPosterProps = {
  readonly item: LibraryItem;
  readonly online: boolean;
  /** A list row's 96px poster, or a grid tile's, as wide as the tile. */
  readonly size?: 'row' | 'tile';
};

/**
 * An item's poster, 96px in a row or a tile's width: its leading picture a third of the way in, a skeleton until it's cut, the bare ground when
 * it can't be (the media offline, a file ffmpeg can't read). An item with no picture shows a sound glyph.
 */
export function LibraryPoster({ item, online, size = 'row' }: LibraryPosterProps) {
  const [state, setState] = useState<'pending' | 'shown' | 'failed'>('pending');
  const poster = libraryPosterFrameOf(item);
  const tile = size === 'tile' && styles.tile;
  if (!poster) return <Box aria-hidden {...stylex.props(styles.frame, tile, styles.sound)}><AudioLines size={16} /></Box>;
  const cut = online && state !== 'failed';
  return (
    <Box aria-hidden {...stylex.props(styles.frame, tile, cut && state === 'pending' && styles.pending)}>
      {cut && (
        <Box component="img" src={libraryPosterUrl(item.id, poster)} alt="" loading="lazy" onLoad={() => setState('shown')} onError={() => setState('failed')}
          {...stylex.props(styles.picture, state === 'pending' && styles.hidden)} />
      )}
    </Box>
  );
}
