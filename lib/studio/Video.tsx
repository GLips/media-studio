// Video.tsx: a project's video as a composition: its scenes (crossfading where they meet), its voice lines, the
// caption, and the reports lib/render-pipeline.ts reads back.
//
// Painting is decided from composition time alone (scenesAt), exactly as the timeline lays it out. The Sequences
// around each scene and voice line are for the Studio's timeline, where they show up by name, and for mounting.

import { Audio } from '@remotion/media';
import { useMemo, useRef } from 'react';
import { AbsoluteFill, Artifact, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { footage } from '@footage';
import { Caption } from './captions.tsx';
import { duckSpans, levelGain, musicGainAt, musicLevels, VOICE_LUFS } from './mix.ts';
import { previsSpan, PrevisFootagePlayer, type PrevisFootage } from './previs.tsx';
import { FramingProbe } from './probe.tsx';
import { SceneContext } from './scene.tsx';
import { layoutVideo, sceneClock, sceneTimes, scenesAt, visibleSpan, type LaidScene, type Timeline, type VideoDef } from './timeline.ts';

export type VideoProps = {
  /** Burn captions in. */
  captions: boolean;
  /** Measure every frame for the framing check (see probe.tsx). */
  probe: boolean;
  /** Previs scenes show their blockouts, even where generated footage exists (see previs.tsx). */
  blockouts: boolean;
};

/** What lib/render-pipeline.ts needs about the timeline (for the .srt and reports), emitted once as an artifact. */
export type TimelineReport = {
  title: string;
  fps: number;
  duration: number;
  scenes: { id: string; start: number; dur: number; note?: string; lines: readonly string[]; previs?: PrevisRequest }[];
  cues: { id: string; start: number; end: number; captionEnd: number; text: string; voiced: boolean }[];
  /** Each scene's `expect`, in video seconds. */
  expectations: { scene: string; see: string; start: number; end: number }[];
};
export const TIMELINE_ARTIFACT = 'timeline.json';

/** What `studio gen video` asks for a previs scene: its ScenePrevis as data, and its blockout's span (previsSpan). */
export type PrevisRequest = { prompt: string; references: readonly string[]; audio: boolean; from: number; duration: number };

function timelineReport(video: VideoDef, tl: Timeline, fps: number): string {
  const report: TimelineReport = {
    title: video.title,
    fps,
    duration: tl.duration,
    scenes: tl.scenes.map(({ id, start, dur, note, lines, previs }) => ({
      id, start, dur, note, lines,
      previs: previs && { prompt: previs.prompt, references: previs.references ?? [], audio: previs.audio ?? false, ...previsSpan(tl, id) },
    })),
    cues: tl.cues.map(({ id, start, end, captionEnd, text, src }) => ({ id, start, end, captionEnd, text, voiced: src !== null })),
    expectations: tl.scenes.flatMap((scene) => (scene.expect?.(sceneTimes(scene)) ?? []).map(({ see, during }) => ({
      scene: scene.id, see, start: scene.start + during.start, end: scene.start + during.end,
    }))),
  };
  return JSON.stringify(report);
}

// `reportTimeline` is off in the replay composition: its Freeze can land on frame 0 more than once, and Remotion
// refuses a second artifact with the same name.
export function Video({ video, captions, probe, blockouts, reportTimeline = true }: VideoProps & { video: VideoDef; reportTimeline?: boolean }) {
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
            {paint && <SceneLayer scene={scene} t={t} alpha={paint.alpha} clip={blockouts ? undefined : footageFor(scene)} />}
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
      {captions && <Caption cues={tl.cues} t={t} />}
      {reportTimeline && frame === 0 && <Artifact filename={TIMELINE_ARTIFACT} content={timelineReport(video, tl, fps)} />}
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

// Footage listed for a scene that no longer asks for previs is left unplayed, and kept, since it was paid for.
const footageFor = (scene: LaidScene): PrevisFootage | undefined => (scene.previs ? footage[scene.id] : undefined);

function SceneLayer({ scene, t, alpha, clip }: { scene: LaidScene; t: number; alpha: number; clip?: PrevisFootage }) {
  const clock = sceneClock(scene, t);
  return (
    <AbsoluteFill data-scene={scene.id} data-scene-t={clock.t} style={{ background: '#fff', opacity: alpha }}>
      <SceneContext.Provider value={clock}>
        {clip ? <PrevisFootagePlayer clip={clip} previs={scene.previs!} clock={clock} /> : <SceneBody scene={scene} clock={clock} />}
      </SceneContext.Provider>
    </AbsoluteFill>
  );
}

export type BlockoutSoloProps = { scene: string };

/** One previs scene's blockout alone over its previsSpan, silent: the reference video `studio gen video` sends. */
export function BlockoutSolo({ video, scene: sceneId }: BlockoutSoloProps & { video: VideoDef }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tl = useMemo(() => layoutVideo(video), [video]);
  const scene = tl.scenes.find((s) => s.id === sceneId)!;
  const { from } = previsSpan(tl, sceneId);
  return <SceneLayer scene={scene} t={scene.start + from + frame / fps} alpha={1} />;
}

// A component of its own so a scene's render can call hooks.
const SceneBody = ({ scene, clock }: { scene: LaidScene; clock: ReturnType<typeof sceneClock> }) => <>{scene.render(clock)}</>;
