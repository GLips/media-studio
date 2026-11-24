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
  pending: { backgroundColor: colors.skeleton },
  sound: { backgroundColor: colors.panel },
  picture: { width: '100%', height: '100%', objectFit: 'contain' },
  hidden: { opacity: 0 },
});

type LibraryPosterProps = { readonly item: LibraryItem; readonly online: boolean };

/**
 * An item's 96px poster: its leading picture a third of the way in, a skeleton until it's cut, the bare ground when
 * it can't be (the media offline, a file ffmpeg can't read). An item with no picture shows a sound glyph.
 */
export function LibraryPoster({ item, online }: LibraryPosterProps) {
  const [state, setState] = useState<'pending' | 'shown' | 'failed'>('pending');
  const poster = libraryPosterFrameOf(item);
  if (!poster) return <Box aria-hidden {...stylex.props(styles.frame, styles.sound)}><AudioLines size={16} /></Box>;
  const cut = online && state !== 'failed';
  return (
    <Box aria-hidden {...stylex.props(styles.frame, cut && state === 'pending' && styles.pending)}>
      {cut && (
        <Box component="img" src={libraryPosterUrl(item.id, poster)} alt="" loading="lazy" onLoad={() => setState('shown')} onError={() => setState('failed')}
          {...stylex.props(styles.picture, state === 'pending' && styles.hidden)} />
      )}
    </Box>
  );
}
