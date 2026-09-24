// Root.tsx: registers the one project this bundle was built for (see lib/project-bundle.ts), as a composition named
// after its folder, plus a replay of it for `studio repeatable` and a previs scene's blockout alone for `studio gen video`.

import { Composition, Freeze, useCurrentFrame } from 'remotion';
import video from '@project';
import { FPS, H, W } from './frame.ts';
import { previsSpan } from './previs.tsx';
import { layoutVideo, totalFrames } from './timeline.ts';
import { BlockoutSolo, Video, type BlockoutSoloProps, type VideoProps } from './Video.tsx';

/**
 * Stops `Date` at `clock` for the whole tab. Timers, animation frames and performance.now keep real time, and
 * Remotion's timeouts are timers. The cost: Remotion's few Date.now readings (verbose delayRender timings, media cache
 * ages) stop too. Stopped, not ticking with the frame: that would need a global frame counter. Modules reading the
 * clock as they load, before this runs, see real time.
 */
function pinBrowserDate(clock: string) {
  const RealDate = Date, pinned = new RealDate(clock).getTime();
  if (Number.isNaN(pinned)) throw new Error(`defineVideo: clock "${clock}" isn't a date`);
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [pinned], newTarget),
    // Date() called without `new` is now as a string.
    apply: () => new RealDate(pinned).toString(),
    get: (target, key) => (key === 'now' ? () => pinned : Reflect.get(target, key)),
  });
}
if (video.clock !== undefined) pinBrowserDate(video.clock);

const ProjectVideo =(props: VideoProps) => <Video video={video} {...props} />;

export type ReplayProps = VideoProps & { order: number[] };

/**
 * Frame i shows the video's frame order[i] (the last one past the end). Rendered in one tab, that gives each frame a
 * chosen history, which renderFrames can't (it sorts the frames it's asked for).
 */
const ReplayVideo = ({ order, ...props }: ReplayProps) => (
  <Freeze frame={order[Math.min(useCurrentFrame(), order.length - 1)]}>
    <Video video={video} {...props} reportTimeline={false} />
  </Freeze>
);

const ProjectBlockout = (props: BlockoutSoloProps) => <BlockoutSolo video={video} {...props} />;

export function Root() {
  const tl = layoutVideo(video);
  const frames = totalFrames(tl, FPS);
  return (
    <>
      <Composition
        id={PROJECT_SLUG}
        component={ProjectVideo}
        width={W}
        height={H}
        fps={FPS}
        durationInFrames={frames}
        defaultProps={{ captions: false, probe: false, blockouts: false } satisfies VideoProps}
      />
      <Composition
        id={REPLAY_SLUG}
        component={ReplayVideo}
        width={W}
        height={H}
        fps={FPS}
        durationInFrames={frames}
        // Never shorter than the video: a frozen frame is clamped to the composition's length.
        calculateMetadata={({ props }) => ({ durationInFrames: Math.max(frames, props.order.length) })}
        defaultProps={{ captions: false, probe: false, blockouts: false, order: [0] } satisfies ReplayProps}
      />
      <Composition
        id={BLOCKOUT_SLUG}
        component={ProjectBlockout}
        width={W}
        height={H}
        fps={FPS}
        durationInFrames={FPS * 4}
        calculateMetadata={({ props }) => ({ durationInFrames: previsSpan(tl, props.scene).duration * FPS })}
        defaultProps={{ scene: tl.scenes.find((s) => s.previs)?.id ?? tl.scenes[0].id } satisfies BlockoutSoloProps}
      />
    </>
  );
}
