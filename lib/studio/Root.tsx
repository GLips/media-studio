// Root.tsx: registers the one project this bundle was built for (see lib/project-bundle.ts). Its video is a composition
// named after its folder, plus a replay of it for `studio repeatable` and a previs scene's blockout alone for
// `studio gen video`. Its stills are one one-frame composition each, `still-<design>-<preset>-<variant>`, in a
// folder per design.

import { Composition, Folder, Freeze, useCurrentFrame } from 'remotion';
import stills from '@stills';
import video from '@video';
import { FPS, H, W } from './frame.ts';
import { assertPrevisSpanFits, previsSpan } from './previs.ts';
import { STILL_PRESETS, stillName, type StillProps } from './still-presets.ts';
import type { StillsDef } from './stills.tsx';
import { layoutVideo, totalFrames, type VideoDef } from './timeline.ts';
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
if (video?.clock !== undefined) pinBrowserDate(video.clock);

// The components below render only when Root registered them, which it does only with a video.
const projectVideo = video as VideoDef;
const ProjectVideo = (props: VideoProps) => <Video video={projectVideo} {...props} />;

export type ReplayProps = VideoProps & { order: number[] };

/**
 * Frame i shows the video's frame order[i] (the last one past the end). Rendered in one tab, that gives each frame a
 * chosen history, which renderFrames can't (it sorts the frames it's asked for).
 */
const ReplayVideo = ({ order, ...props }: ReplayProps) => (
  <Freeze frame={order[Math.min(useCurrentFrame(), order.length - 1)]}>
    <Video video={projectVideo} {...props} reportTimeline={false} />
  </Freeze>
);

const ProjectBlockout = (props: BlockoutSoloProps) => <BlockoutSolo video={projectVideo} {...props} />;

export function Root() {
  return (
    <>
      {video && <VideoCompositions video={video} />}
      {stills && <StillCompositions stills={stills} />}
    </>
  );
}

function StillCompositions({ stills }: { stills: StillsDef }) {
  const ProjectStill = ({ design, variant }: StillProps) => {
    const { component: Design, variants } = stills.designs[design];
    return <Design {...variants[variant]} />;
  };
  return Object.entries(stills.designs).map(([design, { presets, variants }]) => (
    <Folder key={design} name={`stills-${design}`}>
      {presets.flatMap((preset) => Object.keys(variants).map((variant) => {
        const props: StillProps = { design, preset, variant };
        return <Composition key={stillName(props)} id={`still-${stillName(props)}`} component={ProjectStill} {...STILL_PRESETS[preset]} fps={FPS} durationInFrames={1} defaultProps={props} />;
      }))}
    </Folder>
  ));
}

function VideoCompositions({ video }: { video: VideoDef }) {
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
      {tl.scenes.some((scene) => scene.previs) && (
        <Composition
          id={BLOCKOUT_SLUG}
          component={ProjectBlockout}
          width={W}
          height={H}
          fps={FPS}
          durationInFrames={FPS * 4}
          calculateMetadata={({ props }) => {
            const span = previsSpan(tl, props.scene);
            assertPrevisSpanFits(props.scene, span);
            return { durationInFrames: span.duration * FPS };
          }}
          defaultProps={{ scene: tl.scenes.find((scene) => scene.previs)!.id } satisfies BlockoutSoloProps}
        />
      )}
    </>
  );
}
