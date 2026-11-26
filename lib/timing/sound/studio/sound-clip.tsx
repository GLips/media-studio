// sound-clip.tsx: every sound a video plays, placed on a scene's clock. Rendering, a clip plays nothing: it leaves a
// mark, SoundClipProbe gathers each frame's marks, and the mix (sound-mix.ts) plays them with the gain applied per
// sample. In the Studio and Player it plays through Remotion's <Audio>, whose volume steps once a frame: a preview.
import { Audio } from '@remotion/media';
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Artifact, Sequence, useCurrentFrame, useDelayRender, useRemotionEnvironment, useVideoConfig } from 'remotion';
import { soundClipArtifactName, soundEnvelopeOf, type SoundClipFrameReport, type SoundClipMark } from '../models/sound-clip.ts';

export type SoundClipProps = {
  /** The sound's file, as the page loads it: an imported asset, a library media URL. */
  src: string;
  /** The scene clock now, in seconds, and the scene time the sound starts at. Outside a scene, video seconds. */
  t: number;
  at: number;
  /** Seconds into `src` where it starts playing. Default 0. */
  from?: number;
  /** Seconds to play. Default: to the end of `src`. */
  duration?: number;
  /** Seconds of `src` played a second, its pitch moving with it, as tape does. Default 1. */
  rate?: number;
  /** Plays `src` from `from` to its end over and over, for `duration`. */
  loop?: boolean;
  /** 0 or more, or a function of seconds into the sound (counting on through loops), for fades and ducking. Default 1. */
  volume?: number | ((seconds: number) => number);
  /** Names the sound in messages, and keeps two otherwise identical sounds at one instant apart. Default: its file name. */
  id?: string;
};

/** Plays `src` from `from` as the scene clock `t` reaches `at`, at `volume`. */
export function SoundClip({ src, t, at, from = 0, duration, rate = 1, loop = false, volume = 1, id }: SoundClipProps) {
  const { isRendering } = useRemotionEnvironment();
  const name = id ?? decodeURIComponent(src.split(/[/?#]/).findLast(Boolean) ?? src);
  if (loop && duration === undefined) throw new Error(`${name} loops, so give it a duration`);
  if (duration !== undefined && !(duration > 0)) throw new Error(`${name} plays for ${duration} s: give a duration above 0`);
  if (!(rate > 0)) throw new Error(`${name} plays at rate ${rate}: give a rate above 0`);
  if (typeof volume === 'function' && duration === undefined) throw new Error(`${name}'s volume changes over it, so give it a duration`);
  return isRendering
    ? <SoundClipMarkSpan src={src} fromNow={at - t} from={from} duration={duration} rate={rate} loop={loop} volume={volume} id={name} />
    : <SoundClipPreview src={src} fromNow={at - t} from={from} duration={duration} rate={rate} loop={loop} volume={volume} />;
}

type PlacedProps = { src: string; fromNow: number; from: number; duration: number | undefined; rate: number; loop: boolean; volume: number | ((seconds: number) => number) };

function SoundClipMarkSpan({ src, fromNow, from, duration, rate, loop, volume, id }: PlacedProps & { id: string }) {
  // SAFETY: a volume that's a function comes with a duration (SoundClip).
  const gain = useMemo(() => soundEnvelopeOf(volume, duration!, id), [volume, duration, id]);
  const mark: SoundClipMark = { id, src: new URL(src, document.baseURI).href, from, duration: duration ?? null, ...(rate !== 1 && { rate }), loop, fromNow, gain };
  return <span hidden data-sound-clip={JSON.stringify(mark)} />;
}

function SoundClipPreview({ src, fromNow, from, duration, rate, loop, volume }: PlacedProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // A start between frames plays from the next one, with the fraction trimmed off the sound's front.
  const exact = frame + fromNow * fps, placed = Math.ceil(exact - 1e-6), lead = (placed - exact) / fps;
  return (
    <Sequence from={placed} {...(duration !== undefined && { durationInFrames: Math.max(1, Math.round((duration - lead) * fps)) })} layout="none" name="sound">
      <Audio src={src} trimBefore={(from + lead * rate) * fps} {...(duration !== undefined && !loop && { trimAfter: (from + duration * rate) * fps })}
        playbackRate={rate} loop={loop} loopVolumeCurveBehavior="extend" volume={typeof volume === 'number' ? volume : (f) => volume(f / fps + lead)} />
    </Sequence>
  );
}

/**
 * Reports the clips mounted on each frame as an artifact (soundClipArtifactName), for a render's sound walk. It sits
 * at the composition's root, so its frame is the video's.
 */
export function SoundClipProbe({ root }: { root: RefObject<HTMLDivElement | null> }) {
  const frame = useCurrentFrame();
  const { delayRender, continueRender } = useDelayRender();
  const [report, setReport] = useState<{ frame: number; content: string } | null>(null);
  const pending = useRef<number | null>(null);

  useLayoutEffect(() => {
    const handle = delayRender(`gathering frame ${frame}'s sound`);
    pending.current = handle;
    // A task later, so a mark mounted by an effect of this commit is in the page too.
    const timer = setTimeout(() => {
      const clips = [...root.current!.querySelectorAll<HTMLElement>('[data-sound-clip]')].map((el) => {
        // SAFETY: only SoundClipMarkSpan writes data-sound-clip, from a SoundClipMark.
        const mark = JSON.parse(el.dataset.soundClip!) as SoundClipMark & { scene: string | null };
        mark.scene = el.closest<HTMLElement>('[data-scene]')?.dataset.scene ?? null;
        return mark;
      });
      setReport({ frame, content: JSON.stringify({ frame, clips } satisfies SoundClipFrameReport) });
    });
    return () => {
      clearTimeout(timer);
      if (pending.current === handle) {
        continueRender(handle);
        pending.current = null;
      }
    };
  }, [frame, root, delayRender, continueRender]);

  useLayoutEffect(() => {
    if (report?.frame !== frame || pending.current === null) return;
    continueRender(pending.current);
    pending.current = null;
  }, [report, frame, continueRender]);

  return report?.frame === frame ? <Artifact filename={soundClipArtifactName(frame)} content={report.content} /> : null;
}
