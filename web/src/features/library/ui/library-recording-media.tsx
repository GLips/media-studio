import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { libraryMediaTimeOf, type LibraryItem, type LibraryTrack } from '#lib/footage/library/models/library-item.ts';
import { libraryMediaUrl } from '#lib/footage/library/studio/library-media.ts';
import { linkedMediaFrameAt } from '#lib/platform/web/models/linked-media-window.ts';
import { useLinkedMediaFollower, type LinkedMediaClock } from '#web/shared/ui/linked-media-clock.ts';
import { colors, radius } from '#web/shared/ui/theme.stylex.ts';
import { libraryTrackReach } from './library-item-playback.ts';

const styles = stylex.create({
  // A size container, so the picture fits it whole at its own shape and the inset sits on the picture, not the bars.
  stage: { position: 'relative', width: '100%', height: '100%', containerType: 'size', display: 'grid', placeItems: 'center', backgroundColor: colors.screen },
  picture: (ratio: number) => ({
    position: 'relative', width: `min(100cqw, calc(100cqh * ${ratio}))`, height: `min(100cqh, calc(100cqw / ${ratio}))`,
  }),
  video: { display: 'block', width: '100%', height: '100%', objectFit: 'contain' },
  inset: {
    position: 'absolute', right: '2.5%', bottom: '3.5%', width: '24%', aspectRatio: '16 / 9', overflow: 'hidden',
    borderRadius: radius.control, backgroundColor: colors.screen,
  },
  insetVideo: { display: 'block', width: '100%', height: '100%', objectFit: 'cover' },
  hidden: { display: 'none' },
});

/** Where a clock's frames sit on an item: the item second at frame 0, and how many frames a second. */
export type LibraryClockPlacement = { offsetSeconds: number; fps: number };

type LibraryTrackFollowerProps = {
  readonly item: LibraryItem;
  readonly track: LibraryTrack;
  readonly clock: Pick<LinkedMediaClock, 'addFollower'>;
  readonly placement: LibraryClockPlacement;
  readonly inset?: boolean;
};

/**
 * One picture track, kept on the clock by its sync corrections and shown only over the item time it spans. Its
 * editing proxy plays where it has one: constant-rate and HD, it lands seeks frame-exact; an original is variable-rate.
 */
function LibraryTrackFollower({ item, track, clock, placement, inset }: LibraryTrackFollowerProps) {
  const [element, setElement] = useState<HTMLVideoElement | null>(null);
  const { proxy, video } = track;
  const fps = proxy?.fps ?? video?.fps ?? 30;
  const reach = libraryTrackReach(track);
  const frameAt = (seconds: number) => (seconds - placement.offsetSeconds) * placement.fps;
  useLinkedMediaFollower(clock, element, {
    fps,
    span: { from: Math.ceil(frameAt(reach.start)), end: Math.floor(frameAt(reach.end)) },
    frameOf: (frame) => linkedMediaFrameAt(libraryMediaTimeOf(track, placement.offsetSeconds + frame / placement.fps), fps),
    offGrid: !proxy && (video?.variableRate ?? true),
  });
  return (
    <Box component="video" ref={setElement} src={libraryMediaUrl(item.id, proxy?.file ?? track.file)} preload="auto" playsInline muted
      {...stylex.props(inset ? styles.insetVideo : styles.video)} />
  );
}

/** The picture an item leads with (its screen, else its first track with picture), and the rest inset over it. */
export function libraryPictureTracksOf(item: LibraryItem): { main?: string; insets: string[] } {
  const pictures = Object.entries(item.tracks).filter(([, t]) => t.video).map(([name]) => name);
  const main = pictures.includes('screen') ? 'screen' : pictures[0];
  return { main, insets: pictures.filter((name) => name !== main).slice(0, 1) };
}

/** The clock's leader: the track heard, and the ref callback its element mounts with. */
export type LibraryHeardMedia = { track: string; attach: (media: HTMLMediaElement | null) => (() => void) | undefined };

/**
 * The heard track's element: its picture in its slot when it has one, else a hidden `<audio>` of its levelled sound
 * (on the track's own media time), or of the track itself before it's levelled.
 */
function LibraryHeardElement({ item, heard: { track: name, attach }, inset }: { readonly item: LibraryItem; readonly heard: LibraryHeardMedia; readonly inset?: boolean }) {
  const track = item.tracks[name];
  if (track.video) {
    return <Box component="video" ref={attach} src={libraryMediaUrl(item.id, track.proxy?.file ?? track.file)} preload="auto" playsInline {...stylex.props(inset ? styles.insetVideo : styles.video)} />;
  }
  return <Box component="audio" ref={attach} src={libraryMediaUrl(item.id, track.levelled?.file ?? track.file)} preload="auto" {...stylex.props(styles.hidden)} />;
}

type LibraryRecordingMediaProps = {
  readonly item: LibraryItem;
  readonly clock: Pick<LinkedMediaClock, 'addFollower'>;
  readonly placement: LibraryClockPlacement;
  readonly heard: LibraryHeardMedia;
};

/**
 * A recording on a linked media clock: its screen with the camera inset, each track lined up by its sync corrections,
 * and the heard track as the clock's leader. An item with no picture is its sound alone.
 */
export function LibraryRecordingMedia({ item, clock, placement, heard }: LibraryRecordingMediaProps) {
  const { main, insets } = libraryPictureTracksOf(item);
  const video = main ? item.tracks[main].video : undefined;
  const slot = (name: string, inset?: boolean) => (name === heard.track
    ? <LibraryHeardElement item={item} heard={heard} inset={inset} />
    : <LibraryTrackFollower item={item} track={item.tracks[name]} clock={clock} placement={placement} inset={inset} />);
  return (
    <Box {...stylex.props(styles.stage)}>
      {!item.tracks[heard.track].video && <LibraryHeardElement item={item} heard={heard} />}
      {main && video && (
        <Box {...stylex.props(styles.picture(video.width / video.height))}>
          {slot(main)}
          {insets.map((name) => <Box key={name} {...stylex.props(styles.inset)}>{slot(name, true)}</Box>)}
        </Box>
      )}
    </Box>
  );
}
