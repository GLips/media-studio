import { Center, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { libraryMediaTimeOf } from '#lib/footage/library/models/library-item.ts';
import type { LinkedMediaClock } from '#web/shared/ui/linked-media-clock.ts';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { libraryItemViewQueryOptions } from '../controllers/library-queries.ts';
import { libraryHeardTrackOf } from './library-item-playback.ts';
import { LibraryRecordingMedia } from './library-recording-media.tsx';

const styles = stylex.create({
  fill: { width: '100%', height: '100%', padding: spacing.gap, textAlign: 'center' },
  gone: { color: colors.dim },
});

/** Where the heard track's sound sits for a range: `mediaStart` seconds into its file, for `length`. */
export type LibraryRangeSound = { mediaStart: number; length: number };

type LibraryRangeMediaProps = {
  readonly range: { readonly item: string; readonly from: number; readonly to: number };
  /** The clock its pictures follow, its frame 0 at the range's start. */
  readonly clock: Pick<LinkedMediaClock, 'addFollower'>;
  readonly fps: number;
  /** The ref callback the range's sound mounts with, the clock's leader while it's heard. */
  readonly attachSound: (sound: LibraryRangeSound) => (media: HTMLMediaElement | null) => (() => void) | undefined;
  /** Shown for a range with no picture (a voice take): what's said in it. */
  readonly children?: ReactNode;
};

/**
 * A range of a library item, played from the library on another screen's clock: its screen with the camera inset,
 * held on its last picture past the range's end, and its speech track heard. Says so when the item or its media is gone.
 */
export function LibraryRangeMedia({ range, clock, fps, attachSound, children }: LibraryRangeMediaProps) {
  const { data: view, isPending } = useQuery(libraryItemViewQueryOptions(range.item));
  if (isPending) return null;
  const gone = !view ? `${range.item} isn't in the library` : !view.media.online && `Media offline: ${view.media.path} isn't there`;
  if (!view || gone) return <Center {...stylex.props(styles.fill)}><Text component="span" size="sm" {...stylex.props(styles.gone)}>{gone}</Text></Center>;
  const { item } = view;
  const track = libraryHeardTrackOf(item);
  const attach = attachSound({ mediaStart: libraryMediaTimeOf(item.tracks[track], range.from), length: range.to - range.from });
  return (
    <LibraryRecordingMedia item={item} clock={clock} placement={{ offsetSeconds: range.from, fps, untilSeconds: range.to }} heard={{ track, attach }}>
      {children}
    </LibraryRecordingMedia>
  );
}
