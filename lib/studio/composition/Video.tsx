// Video.tsx: a project's video as a composition: its scenes (crossfading where they meet), its voice lines, the
// caption, and the reports lib/engine/render/render-pipeline.ts reads back.
//
// Painting is decided from composition time alone (scenesAt), exactly as the timeline lays it out. The Sequences
// around each scene and voice line are for the Studio's timeline, where they show up by name, and for mounting.

import { Audio } from '@remotion/media';
import { useMemo, useRef } from 'react';
import { AbsoluteFill, Artifact, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { footage as footageList } from '@footage';
import sfxCues from '@sfx-cues';
import { Caption } from './captions.tsx';
import { levelGain, musicBedGainAt, VOICE_LUFS } from '../mix/mix.ts';
import { previsRequestFor, previsSpan, type PrevisFootage, type PrevisRequest } from '../previs/previs.ts';
import { PrevisFootagePlayer } from '../previs/previs.tsx';
import { unmeasuredAttrs } from '../probe/motion-tag.ts';
import { FrameProbe } from '../probe/probe.tsx';
import { SceneContext } from './scene.tsx';
import { sfxSeedFromId } from '../../sfx/dsp.ts';
import { Sfx, SfxCueListAudio, SfxCueListPlaying } from '../sfx/sfx.tsx';
import { layoutVideo, sceneClock, sceneTimes, scenesAt, visibleSpan, type LaidScene, type Timeline, type VideoDef } from './timeline.ts';

export type VideoProps = {
  /** Burn captions in. */
  captions: boolean;
  /** Measure every frame for the framing check and motion tracks (see probe.tsx). */
  probe: boolean;
  /** Previs scenes show their blockouts, even where generated footage exists (see previs.tsx). */
  blockouts: boolean;
  /** Play the project's cue list (sfx/cues.json) whether or not the video does (`sfxCueList`), to audition it. */
  auditionSfxCueList?: boolean;
};

/** What lib/engine/render/render-pipeline.ts needs about the timeline (for the .srt and reports), emitted once as an artifact. */
export type TimelineReport = {
  title: string;
  fps: number;
  duration: number;
  /** The composition's length, which can run a little past `duration` (see totalFrames). */
  durationInFrames: number;
  scenes: { id: string; start: number; dur: number; note?: string; lines: readonly string[]; previs?: PrevisRequest }[];
  /** Each voice line, with every word as it's spoken (spread by length over an estimated line), in video seconds. */
  cues: { id: string; start: number; end: number; captionEnd: number; text: string; voiced: boolean; words: { text: string; start: number; end: number }[] }[];
  /** Where one scene dissolves into the next, in video seconds; a hard cut has none. */
  crossfades: { from: string; to: string; start: number; end: number }[];
  /** Each scene's `expect`, in video seconds. */
  expectations: TimelineExpectation[];
  /** Whether this render plays the project's cue list (see lib/sfx/cues.ts), which plays its clicks, keys and accents. */
  sfxCueList: boolean;
  /** Each of `VideoDef.sounds`, landing `at` video seconds, with the take it plays's recipe (`impact`, `whip`…). */
  sounds: { id: string; at: number; sound: string }[];
};
/** A scene's `expect` (see SceneExpectation), its `during` in video seconds. */
export type TimelineExpectation = { scene: string; start: number; end: number } & ({ see: string } | { hold: string; for: number; within?: number });
export const TIMELINE_ARTIFACT = 'timeline.json';


function timelineReport(video: VideoDef, tl: Timeline, fps: number, durationInFrames: number, sfxCueList: boolean): string {
  const report: TimelineReport = {
    title: video.title,
    fps,
    duration: tl.duration,
    durationInFrames,
    scenes: tl.scenes.map((scene) => ({
      id: scene.id, start: scene.start, dur: scene.dur, note: scene.note, lines: scene.lines, previs: previsRequestFor(tl, scene),
    })),
    cues: tl.cues.map(({ id, start, end, captionEnd, text, src }) => {
      const scene = tl.scenes.find((sc) => id in sc.spans)!, span = scene.spans[id];
      const words = span.words.map((w) => ({ text: w.text, start: scene.start + span.start + w.start, end: scene.start + span.start + w.end }));
      return { id, start, end, captionEnd, text, voiced: src !== null, words };
    }),
    crossfades: tl.scenes.flatMap((scene, i) => (scene.xfade ? [{
      from: tl.scenes[i - 1].id, to: scene.id, start: scene.start - scene.xfade / 2, end: scene.start + scene.xfade / 2,
    }] : [])),
    expectations: tl.scenes.flatMap((scene) => (scene.expect?.(sceneTimes(scene)) ?? []).map(({ during, ...promise }) => {
      // Here rather than in the check, so a bad hold fails on frame 0, not after every frame has rendered.
      if ('hold' in promise && !(promise.for > 0 && (promise.within === undefined || promise.within >= 0))) {
        throw new Error(`scene ${scene.id}: hold "${promise.hold}" needs a \`for\` above 0 and a \`within\` of 0 or more`);
      }
      return { scene: scene.id, ...promise, start: scene.start + during.start, end: scene.start + during.end };
    })),
    sfxCueList,
    sounds: (video.sounds ?? []).map(({ at, sound, id }, i) => {
      const takes = Array.isArray(sound) ? sound : [sound];
      return { id: String(id ?? i), at, sound: takes[sfxSeedFromId(id ?? i) % takes.length].request.sound };
    }),
  };
  return JSON.stringify(report);
}

// `reportTimeline` is off in the replay composition: its Freeze can land on frame 0 more than once, and Remotion
// refuses a second artifact with the same name.
export function Video({ video, captions, probe, blockouts, auditionSfxCueList = false, reportTimeline = true }: VideoProps & { video: VideoDef; reportTimeline?: boolean }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const tl = useMemo(() => layoutVideo(video), [video]);
  const root = useRef<HTMLDivElement>(null);
  const t = frame / fps;
  const painted = scenesAt(tl, t);
  const playsCueList = !!video.sfxCueList || auditionSfxCueList;
  // A check measures the events a draft is made from, so it runs without a list.
  if (playsCueList && !sfxCues && !probe) throw new Error('this project has no sfx/cues.json: run studio sfx draft first');

  return (
    <AbsoluteFill ref={root} style={{ background: '#fff', overflow: 'hidden' }}>
      <SfxCueListPlaying.Provider value={playsCueList}>
        {tl.scenes.map((scene, i) => {
          const span = visibleSpan(tl, i);
          const from = Math.floor(span.start * fps);
          const paint = painted.find((p) => p.scene === scene);
          return (
            <Sequence key={scene.id} name={scene.id} from={from} durationInFrames={Math.max(1, Math.ceil(span.end * fps) - from)} layout="none">
              {paint && <SceneLayer scene={scene} t={t} alpha={paint.alpha} footage={blockouts ? undefined : footageFor(scene)} />}
            </Sequence>
          );
        })}
      </SfxCueListPlaying.Provider>
      {playsCueList && sfxCues && <SfxCueListAudio cues={sfxCues} />}
      {video.sounds?.map((s, i) => <Sfx key={i} sound={s.sound} at={s.at} t={t} id={s.id ?? i} volume={s.volume} />)}
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
      {reportTimeline && frame === 0 && <Artifact filename={TIMELINE_ARTIFACT} content={timelineReport(video, tl, fps, durationInFrames, playsCueList)} />}
      {probe && <FrameProbe root={root} />}
    </AbsoluteFill>
  );
}

function MusicBedAudio({ video, tl, fps }: { video: VideoDef; tl: Timeline; fps: number }) {
  const bed = video.music!;
  const { durationInFrames } = useVideoConfig();
  // Ducked around every line, estimated ones included, so the Studio previews the final mix.
  const gainAt = useMemo(() => musicBedGainAt(bed, tl.cues, fps, durationInFrames / fps), [bed, tl, fps, durationInFrames]);
  // Not in a Sequence, so the volume callback's frame is the video's frame.
  return (
    <Audio src={bed.track.src} name="music" loop loopVolumeCurveBehavior="extend" trimBefore={Math.round((bed.sourceStartSeconds ?? 0) * fps)}
      volume={(f) => gainAt(f / fps)} />
  );
}

// Footage listed for a scene that no longer asks for previs is left unplayed, and kept, since it was paid for.
const footageFor = (scene: LaidScene): PrevisFootage | undefined => (scene.previs ? footageList[scene.id] : undefined);

function SceneLayer({ scene, t, alpha, footage }: { scene: LaidScene; t: number; alpha: number; footage?: PrevisFootage }) {
  const clock = sceneClock(scene, t);
  return (
    <AbsoluteFill data-scene={scene.id} data-scene-t={clock.t} style={{ background: '#fff', opacity: alpha }}>
      <SceneContext.Provider value={clock}>
        {footage ? (
          <AbsoluteFill {...unmeasuredAttrs('generated clip')}><PrevisFootagePlayer scene={scene} footage={footage} clock={clock} /></AbsoluteFill>
        ) : <SceneBody scene={scene} clock={clock} />}
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
