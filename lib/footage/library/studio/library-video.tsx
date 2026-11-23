// library-video.tsx: a library item's video track, at any item time a scene asks for, filling its parent's box.
//
// A render shows each frame as a picture its server decoded for it (library-frame-decoder.ts), holding the frame until
// the <img> has decoded it: a <video>, or an image still decoding when the readback paints, tore and blanked the
// prototype's frames, and a second canvas drew blank. A preview plays the track natively, following the scene's clock.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { getRemotionEnvironment, useCurrentFrame, useDelayRender, useVideoConfig } from 'remotion';
import type { LibraryFootage } from '../models/library-footage.ts';
import { libraryMediaTimeOf } from '../models/library-item.ts';
import { libraryFrameUrl, libraryMediaUrl } from './library-media.ts';

export type LibraryVideoProps = {
  footage: LibraryFootage;
  /** The video track to show, by its name in the item (`screen`, `camera`). */
  track: string;
  /** The item time to show, in seconds: any function of the scene's time, so a cut may jump anywhere in the recording. */
  at: number;
  /** How the picture fills the box: all of it, cropped (`cover`, the default), or all of the picture (`contain`). */
  fit?: 'cover' | 'contain';
  /** Where a cropped picture sits in the box, as CSS object-position: `50% 30%` keeps a face high in frame. */
  focus?: string;
};

/** Widths a render decodes at, so a box that grows or shrinks restarts decoding only when it crosses one. */
const DECODE_WIDTHS = [480, 960, 1440, 1920, 2560, 3840, 5120];

/** `footage`'s `track` at item time `at`, filling its parent's box. */
export function LibraryVideo({ footage, track: name, at, fit = 'cover', focus = '50% 50%' }: LibraryVideoProps) {
  const track = footage.item.tracks[name];
  if (!track?.video) throw new Error(`${footage.item.id} has no video track ${name}: it has ${Object.keys(footage.item.tracks).join(', ')}`);
  // Outside its media the track isn't playing: it holds its first or last picture.
  const mediaTime = Math.min(Math.max(0, libraryMediaTimeOf(track, at)), track.mediaSeconds);
  const style: CSSProperties = { display: 'block', width: '100%', height: '100%', objectFit: fit, objectPosition: focus };
  const { video, proxy } = track;
  const shown: ShownTrack = {
    item: footage.item.id, file: track.file, width: video.width, proxy: proxy?.file ?? null, proxyWidth: proxy?.width ?? 0,
    mediaTime, aspect: video.width / video.height, fit, style,
  };
  return getRemotionEnvironment().isRendering
    ? <RenderedLibraryVideo {...shown} />
    : <PlayedLibraryVideo src={libraryMediaUrl(footage.item.id, track.proxy?.file ?? track.file)} mediaTime={mediaTime} style={style} />;
}

/** A track as a render draws it: its original and its proxy (or none), each with its width. */
type ShownTrack = {
  item: string; file: string; width: number; proxy: string | null; proxyWidth: number;
  mediaTime: number; aspect: number; fit: 'cover' | 'contain'; style: CSSProperties;
};

/** The pixel width of the picture as drawn in `box`: wider than the box when a cover crops its sides. */
function drawnWidth(box: DOMRect, aspect: number, fit: 'cover' | 'contain'): number {
  const fitted = box.height * aspect;
  return (fit === 'cover' ? Math.max(box.width, fitted) : Math.min(box.width, fitted)) * window.devicePixelRatio;
}

function RenderedLibraryVideo({ item, file, width, proxy, proxyWidth, mediaTime, aspect, fit, style }: ShownTrack) {
  const image = useRef<HTMLImageElement>(null);
  const { fps } = useVideoConfig();
  const { delayRender, continueRender, cancelRender } = useDelayRender();

  // A layout effect, so the hold is open before the picture root looks for open holds.
  useLayoutEffect(() => {
    const element = image.current!;
    const needed = drawnWidth(element.getBoundingClientRect(), aspect, fit);
    const wanted = DECODE_WIDTHS.find((w) => w >= needed) ?? Math.ceil(needed);
    // The proxy when it's wide enough for the box, else the original.
    const source = proxy && proxyWidth >= wanted ? { file: proxy, width: proxyWidth } : { file, width };
    const url = libraryFrameUrl({ item, file: source.file, t: mediaTime, width: Math.min(wanted, source.width), fps });
    const what = `${item}'s ${source.file} at ${mediaTime.toFixed(3)} s`;
    const handle = delayRender(what);
    let open = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    void (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${what}: ${await response.text()}`);
      const shown = URL.createObjectURL(await response.blob()), before = element.src;
      element.src = shown;
      await element.decode();
      if (before.startsWith('blob:')) URL.revokeObjectURL(before);
      release();
    })().catch((error: Error) => {
      if (open) cancelRender(error);
    });
    return release;
  }, [item, file, width, proxy, proxyWidth, mediaTime, aspect, fit, fps, delayRender, continueRender, cancelRender]);

  return <img ref={image} alt="" decoding="sync" style={style} />;
}

/** Seconds a playing track may drift from the clock before it's put back. */
const PLAYING_DRIFT_SECONDS = 0.2;
/** With no new frame for this long, the clock has stopped. */
const CLOCK_STOPPED_MS = 250;

function PlayedLibraryVideo({ src, mediaTime, style }: { src: string; mediaTime: number; style: CSSProperties }) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const last = useRef<{ frame: number; mediaTime: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const element = video.current!, previous = last.current;
    last.current = { frame, mediaTime };
    // Playing straight on: a few frames on (a player behind skips some), and the track as far on as the clock.
    const advanced = previous ? frame - previous.frame : 0;
    const playing = advanced >= 1 && advanced <= 3 && Math.abs(mediaTime - previous!.mediaTime - advanced / fps) < 0.5 / fps;
    if (playing) {
      if (Math.abs(element.currentTime - mediaTime) > PLAYING_DRIFT_SECONDS) element.currentTime = mediaTime;
      // oxlint-disable-next-line arch/no-discarding-catch -- play() rejects only when the next frame's pause or seek interrupts it, which is the intent.
      if (element.paused) element.play().catch(() => {});
    } else {
      if (!element.paused) element.pause();
      if (Math.abs(element.currentTime - mediaTime) > 0.5 / fps) element.currentTime = mediaTime;
    }
    const stopped = setTimeout(() => element.pause(), CLOCK_STOPPED_MS);
    return () => clearTimeout(stopped);
  }, [frame, mediaTime, fps]);

  // A failed load says why: the server's reason (media offline, a missing file) is in its answer's body.
  const explain = () => {
    void fetch(src, { headers: { range: 'bytes=0-0' } }).then(async (r) => setFailure(r.ok ? `${src} won't play` : await r.text()), (error: Error) => setFailure(error.message));
  };
  return (
    <>
      <video ref={video} src={src} muted playsInline preload="auto" style={style} onError={explain} />
      {failure && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, color: 'white', background: 'black', font: '24px system-ui' }}>{failure}</div>}
    </>
  );
}
