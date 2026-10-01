// Root.tsx: registers the one project this bundle was built for (see lib/output/render/engine/project-bundle.ts). Its video is a composition
// named after its folder, plus a replay of it for `studio repeatable` and a previs scene's blockout alone for
// `studio gen video`. Its stills are one one-frame composition each, `still-<design>-<preset>-<variant>`, in a
// folder per design.

import { Composition, Folder, Freeze, useCurrentFrame } from 'remotion';
import stills from '@stills';
import video from '@video';
import { DEFAULT_VIDEO_FORMAT } from '#lib/picture/frame/models/frame.ts';
import { previsSpan } from '#lib/footage/previs/studio/previs.ts';
import { StillProbe } from '#lib/picture/stills/studio/still-probe.tsx';
import { STILL_PRESETS, stillName, type StillProps, type StillRenderProps } from '#lib/picture/stills/models/still-presets.ts';
import { StillPresetContext, type StillsDef } from '#lib/picture/stills/studio/stills.tsx';
import { laidVideoOf, videoFormatOf, type VideoDef } from '#lib/picture/video/studio/video.ts';
import { BlockoutSolo, Video } from './Video.tsx';
import type { BlockoutSoloProps, CompositionRenderSettings, ReplayProps, VideoProps } from '#lib/picture/video/models/composition-props.ts';

/**
 * Stops `Date` at `clock` for the whole tab. Timers, animation frames and performance.now keep real time, and
 * Remotion's timeouts are timers. The cost: Remotion's few Date.now readings (delayRender timings, media cache ages)
 * stop too. Stopped, not ticking with the frame: that would need a global frame counter. Modules reading the clock
 * as they load, before this runs, see real time.
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
const ProjectVideo = (props: VideoProps & CompositionRenderSettings) => <Video video={projectVideo} {...props} />;

/**
 * Frame i shows the video's frame order[i] (the last one past the end). Rendered in one tab, that gives each frame a
 * chosen history, which renderFrames can't (it sorts the frames it's asked for).
 */
const ReplayVideo = ({ order, ...props }: ReplayProps & CompositionRenderSettings) => (
  <Freeze frame={order[Math.min(useCurrentFrame(), order.length - 1)]}>
    <Video video={projectVideo} {...props} reportTimeline={false} />
  </Freeze>
);

const ProjectBlockout = (props: BlockoutSoloProps & CompositionRenderSettings) => <BlockoutSolo video={projectVideo} {...props} />;

export function Root() {
  return (
    <>
      {video && <VideoCompositions video={video} />}
      {stills && <StillCompositions stills={stills} />}
    </>
  );
}

function StillCompositions({ stills }: { stills: StillsDef }) {
  const ProjectStill = ({ design, preset, variant, ground }: StillRenderProps) => {
    const { component: Design, variants } = stills.designs[design];
    return <StillPresetContext value={preset}><StillProbe ground={ground}><Design {...variants[variant].props} /></StillProbe></StillPresetContext>;
  };
  return Object.entries(stills.designs).map(([design, { presets, variants }]) => (
    <Folder key={design} name={`stills-${design}`}>
      {presets.flatMap((preset) => Object.entries(variants).map(([variant, { axes }]) => {
        const props: StillProps = { design, preset, variant, axes };
        return <Composition key={stillName(props)} id={`still-${stillName(props)}`} component={ProjectStill} {...STILL_PRESETS[preset]} fps={DEFAULT_VIDEO_FORMAT.fps} durationInFrames={1} defaultProps={props} />;
      }))}
    </Folder>
  ));
}

function VideoCompositions({ video }: { video: VideoDef }) {
  const tl = laidVideoOf(video);
  const { fps, width, height } = videoFormatOf(video);
  const { frames } = tl;
  const settings: CompositionRenderSettings = video.renderWorkers === undefined ? {} : { renderWorkers: video.renderWorkers };
  const firstPrevis = tl.scenes.find((scene) => scene.previs)?.id;
  return (
    <>
      <Composition
        id={PROJECT_SLUG}
        component={ProjectVideo}
        width={width}
        height={height}
        fps={fps}
        durationInFrames={frames}
        defaultProps={{ captions: false, probe: false, blockouts: false, ...settings } satisfies VideoProps & CompositionRenderSettings}
      />
      <Composition
        id={REPLAY_SLUG}
        component={ReplayVideo}
        width={width}
        height={height}
        fps={fps}
        durationInFrames={frames}
        // Never shorter than the video: a frozen frame is clamped to the composition's length.
        calculateMetadata={({ props }) => ({ durationInFrames: Math.max(frames, props.order.length) })}
        defaultProps={{ captions: false, probe: false, blockouts: false, order: [0], ...settings } satisfies ReplayProps & CompositionRenderSettings}
      />
      {firstPrevis && (
        <Composition
          id={BLOCKOUT_SLUG}
          component={ProjectBlockout}
          width={width}
          height={height}
          fps={fps}
          durationInFrames={fps * 4}
          calculateMetadata={({ props }) => ({ durationInFrames: props.seconds * fps })}
          defaultProps={{ scene: firstPrevis, seconds: previsSpan(tl, firstPrevis).duration, ...settings } satisfies BlockoutSoloProps & CompositionRenderSettings}
        />
      )}
    </>
  );
}
