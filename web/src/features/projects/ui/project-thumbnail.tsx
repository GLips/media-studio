import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState, type ReactNode } from 'react';
import type { ReviewProjectThumbnail } from '#lib/output/review/models/review-dashboard.ts';
import { projectFileUrl, reviewStillUrl } from '#web/shared/media-urls.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, radius } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  // 16:9, the shape most renders are; a tall or square one letterboxes inside it on the screen ground.
  frame: {
    position: 'relative', flexShrink: 0, width: '64px', height: '36px', overflow: 'hidden', borderRadius: radius.control,
    backgroundColor: colors.screen, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.dim,
  },
  pending: { backgroundColor: colors.skeleton },
  glyph: { backgroundColor: colors.panel },
  waiting: { color: colors.caution },
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

type ProjectThumbnailProps =
  | { readonly project: string; readonly thumbnail: ReviewProjectThumbnail; readonly glyph?: never; readonly waiting?: never }
  /** A row with no picture shows its kind's glyph; `waiting` names what waits on the reviewer and tints it caution. */
  | { readonly glyph: ReactNode; readonly waiting?: string; readonly project?: never; readonly thumbnail?: never };

/**
 * A row's 64px picture: the file's frame, a skeleton until it's cut, the bare ground when it can't be (a slice too short
 * for its guessed frame). A decision or the script shows its glyph in the same box, so rows line up.
 */
export function ProjectThumbnail({ project, thumbnail, glyph, waiting }: ProjectThumbnailProps) {
  const [state, setState] = useState<'pending' | 'shown' | 'failed'>('pending');
  if (!thumbnail) {
    const box = <Box {...stylex.props(styles.frame, styles.glyph, waiting !== undefined && styles.waiting)}>{glyph}</Box>;
    return waiting === undefined ? box : <HotkeyTooltip name={waiting}>{box}</HotkeyTooltip>;
  }
  return (
    <Box aria-hidden {...stylex.props(styles.frame, state === 'pending' && styles.pending)}>
      {state !== 'failed' && (
        <Box component="img" src={thumbnailUrl(project, thumbnail)} alt="" loading="lazy" onLoad={() => setState('shown')} onError={() => setState('failed')}
          {...stylex.props(thumbnail.kind === 'still' ? styles.still : styles.video, state === 'pending' && styles.hidden)} />
      )}
    </Box>
  );
}
