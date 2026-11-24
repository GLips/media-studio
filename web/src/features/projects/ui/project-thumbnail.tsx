import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import type { ReviewProjectThumbnail } from '#lib/output/review/models/review-dashboard.ts';
import { projectFileUrl, reviewStillUrl } from '#web/shared/media-urls.ts';
import { colors, radius } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  // 16:9, the shape most renders are; a tall or square one letterboxes inside it on the screen ground.
  frame: {
    position: 'relative', flexShrink: 0, width: '64px', height: '36px', overflow: 'hidden', borderRadius: radius.control,
    backgroundColor: colors.screen, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.dim,
  },
  // A tile's cell: as wide as its column, at the shape its grid shares (ProjectTileGrid), so its pictures fill it.
  tile: (aspect: number) => ({ width: '100%', height: 'auto', aspectRatio: aspect }),
  pending: { backgroundColor: colors.skeleton },
  // A kind's glyph sits on the ground, with no tile: one on every decision and plan row reads as a wall of grey boxes.
  glyph: { backgroundColor: 'transparent' },
  video: { width: '100%', height: '100%', objectFit: 'contain' },
  // A still keeps its own box, so portrait, square and story read apart, and a checker shows through its transparency.
  still: {
    width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%',
    backgroundColor: colors.raised,
    backgroundImage: `conic-gradient(${colors.line} 25%, transparent 0 50%, ${colors.line} 0 75%, transparent 0)`,
    backgroundSize: '8px 8px',
  },
  hidden: { opacity: 0 },
});

/** A still's own bytes, or a video's frame cut by the review server and pinned to the bytes it was summarized from. */
function thumbnailUrl(project: string, thumbnail: ReviewProjectThumbnail): string {
  if (thumbnail.kind === 'still') return projectFileUrl(project, thumbnail.path);
  const { path, hash, frame, fps } = thumbnail;
  return reviewStillUrl({ project, path, render: { hash } }, frame, fps);
}

/** What a row's picture shows: a file's own picture, or for a row with none, its kind's glyph. */
export type ProjectThumbnailSource =
  | { readonly project: string; readonly thumbnail: ReviewProjectThumbnail; readonly glyph?: never }
  /** Always dim: the status words alone carry a row's state in colour. */
  | { readonly glyph: ReactNode; readonly project?: never; readonly thumbnail?: never };

/** A tile's cell: the shape its grid shares, and where the picture says its own shape once it loads. */
export type ProjectTileCell = { readonly aspect: number; readonly onAspect: (aspect: number) => void };

/** A tile's picture fills its cell; a row's is the 64px box. */
type ProjectThumbnailProps = ProjectThumbnailSource & { readonly tile?: ProjectTileCell };

/** What a picture shows, for keying it and remembering its shape: a still by path, a render's frame by its bytes. */
export const projectThumbnailKeyOf = (thumbnail: ReviewProjectThumbnail) => (thumbnail.kind === 'video' ? thumbnail.hash : thumbnail.path);

/**
 * A row's 64px picture or a tile's cell: the file's frame, a skeleton until it's cut, the bare ground when it can't be
 * (a slice too short for its guessed frame). A decision or the plan shows its glyph in the same box, so rows line up.
 */
export function ProjectThumbnail({ project, thumbnail, glyph, tile }: ProjectThumbnailProps) {
  if (!thumbnail) return <Box aria-hidden {...stylex.props(styles.frame, styles.glyph)}>{glyph}</Box>;
  // Keyed by what it shows, so a new render's frame starts from its skeleton rather than the last one's state.
  return <ProjectPicture key={projectThumbnailKeyOf(thumbnail)} project={project} thumbnail={thumbnail} tile={tile} />;
}

type ProjectPictureProps = { readonly project: string; readonly thumbnail: ReviewProjectThumbnail; readonly tile: ProjectTileCell | undefined };

function ProjectPicture({ project, thumbnail, tile }: ProjectPictureProps) {
  const [state, setState] = useState<'pending' | 'shown' | 'failed'>('pending');
  return (
    <Box aria-hidden {...stylex.props(styles.frame, tile && styles.tile(tile.aspect), state === 'pending' && styles.pending)}>
      {state !== 'failed' && (
        <Box component="img" src={thumbnailUrl(project, thumbnail)} alt="" loading="lazy" onError={() => setState('failed')}
          onLoad={(event: SyntheticEvent<HTMLImageElement>) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalHeight > 0) tile?.onAspect(naturalWidth / naturalHeight);
            setState('shown');
          }}
          {...stylex.props(thumbnail.kind === 'still' ? styles.still : styles.video, state === 'pending' && styles.hidden)} />
      )}
    </Box>
  );
}
