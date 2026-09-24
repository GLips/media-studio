// Video.tsx: a project's video as a composition: its scenes (crossfading where they meet), its voice lines, the
// caption, and the reports scripts/render.ts reads back.
//
// Painting is decided from composition time alone (scenesAt), exactly as the timeline lays it out. The Sequences
// around each scene and voice line are for the Studio's timeline, where they show up by name, and for mounting.

import { Audio } from '@remotion/media';
import { useMemo, useRef } from 'react';
import { AbsoluteFill, Artifact, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { Caption } from './captions.tsx';
import { duckSpans, levelGain, musicGainAt, musicLevels, VOICE_LUFS } from './mix.ts';
import { FramingProbe } from './probe.tsx';
import { SceneContext } from './scene.tsx';
import { layoutVideo, sceneClock, sceneTimes, scenesAt, visibleSpan, type LaidScene, type Timeline, type VideoDef } from './timeline.ts';

export type VideoProps = {
  /** Burn captions in. */
  captions: boolean;
  /** Measure every frame for the framing check (see probe.tsx). */
  probe: boolean;
};

/** What scripts/render.ts needs about the timeline (for the .srt and reports), emitted once as an artifact. */
export type TimelineReport = {
  title: string;
  fps: number;
  duration: number;
  scenes: { id: string; start: number; dur: number }[];
  cues: { id: string; start: number; end: number; text: string; voiced: boolean }[];
  /** Each scene's `expect`, in video seconds. */
  expectations: { scene: string; see: string; start: number; end: number }[];
};
export const TIMELINE_ARTIFACT = 'timeline.json';

function timelineReport(video: VideoDef, tl: Timeline, fps: number): string {
  const report: TimelineReport = {
    title: video.title,
    fps,
    duration: tl.duration,
    scenes: tl.scenes.map(({ id, start, dur }) => ({ id, start, dur })),
    cues: tl.cues.map(({ id, start, end, text, src }) => ({ id, start, end, text, voiced: src !== null })),
    expectations: tl.scenes.flatMap((scene) => (scene.expect?.(sceneTimes(scene)) ?? []).map(({ see, during }) => ({
      scene: scene.id, see, start: scene.start + during.start, end: scene.start + during.end,
    }))),
  };
  return JSON.stringify(report);
}

export function Video({ video, captions, probe }: VideoProps & { video: VideoDef }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tl = useMemo(() => layoutVideo(video), [video]);
  const root = useRef<HTMLDivElement>(null);
  const t = frame / fps;
  const painted = scenesAt(tl, t);

  return (
    <AbsoluteFill ref={root} style={{ background: '#fff', overflow: 'hidden' }}>
      {tl.scenes.map((scene, i) => {
        const span = visibleSpan(tl, i);
        const from = Math.floor(span.start * fps);
        const paint = painted.find((p) => p.scene === scene);
        return (
          <Sequence key={scene.id} name={scene.id} from={from} durationInFrames={Math.max(1, Math.ceil(span.end * fps) - from)} layout="none">
            {paint && <SceneLayer scene={scene} t={t} alpha={paint.alpha} />}
          </Sequence>
        );
      })}
      {tl.cues.map((cue) =>
        cue.src ? (
          // One frame of slack past the line's end, so rounding the start to a frame never clips its last samples.
          <Sequence key={cue.id} name={`voice: ${cue.id}`} from={Math.round(cue.start * fps)} durationInFrames={Math.ceil((cue.end - cue.start) * fps) + 1} layout="none">
            <Audio src={cue.src} volume={levelGain(cue.lufs!, VOICE_LUFS, `line ${cue.id}`)} />
          </Sequence>
        ) : null,
      )}
      {video.music && <MusicBedAudio video={video} tl={tl} fps={fps} />}
      <Caption cues={tl.cues} t={t} visible={captions} />
      {frame === 0 && <Artifact filename={TIMELINE_ARTIFACT} content={timelineReport(video, tl, fps)} />}
      {probe && <FramingProbe root={root} />}
    </AbsoluteFill>
  );
}

function MusicBedAudio({ video, tl, fps }: { video: VideoDef; tl: Timeline; fps: number }) {
  const bed = video.music!;
  const { durationInFrames } = useVideoConfig();
  // Duck around where the voice plays (its starts are rounded to frames), estimated lines included, so the Studio
  // previews the final mix.
  const { spans, levels } = useMemo(() => ({
    spans: duckSpans(tl.cues.map((c) => ({ start: Math.round(c.start * fps) / fps, end: Math.round(c.start * fps) / fps + (c.end - c.start) }))),
    levels: musicLevels(bed),
  }), [tl, fps, bed]);
  // Not in a Sequence, so the volume callback's frame is the video's frame.
  return (
    <Audio src={bed.track.src} name="music" loop loopVolumeCurveBehavior="extend" trimBefore={Math.round((bed.sourceStartSeconds ?? 0) * fps)}
      volume={(f) => musicGainAt(f / fps, spans, levels, durationInFrames / fps)} />
  );
}

function SceneLayer({ scene, t, alpha }: { scene: LaidScene; t: number; alpha: number }) {
  const clock = sceneClock(scene, t);
  return (
    <AbsoluteFill data-scene={scene.id} data-scene-t={clock.t} style={{ background: '#fff', opacity: alpha }}>
      <SceneContext.Provider value={clock}>
        <SceneBody scene={scene} clock={clock} />
      </SceneContext.Provider>
    </AbsoluteFill>
  );
}

// A component of its own so a scene's render can call hooks.
const SceneBody = ({ scene, clock }: { scene: LaidScene; clock: ReturnType<typeof sceneClock> }) => <>{scene.render(clock)}</>;
