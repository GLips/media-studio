// Video.tsx: a project's video as a composition: its scenes (crossfading where they meet), its voice lines, the
// captions in its style, and the reports lib/output/render/engine/render-pipeline.ts reads back.
//
// Painting is decided from the composition's frame alone (scenesAtFrame), exactly as the timeline lays it out. The Sequences
// around each scene and voice line are for the Studio's timeline, where they show up by name, and for mounting.

import { Audio } from '@remotion/media';
import { useMemo, useRef, type ReactNode } from 'react';
import { AbsoluteFill, Artifact, Sequence, useCurrentFrame, useVideoConfig, type VideoConfig } from 'remotion';
import { footage as footageList } from '@footage';
import sfxCues from '@sfx-cues';
import { levelGain, musicBedGainAt, VOICE_LUFS } from '#lib/timing/sound/models/mix.ts';
import { previsRequestFor, previsSpan, type PrevisFootage } from '#lib/footage/previs/studio/previs.ts';
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
import type { BlockoutSoloProps, VideoProps } from '#lib/picture/video/models/composition-props.ts';
import { PrevisFootagePlayer } from '#lib/footage/previs/studio/previs.tsx';
import { unmeasuredAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';
import { FrameProbe } from '#lib/picture/measurement/studio/probe.tsx';
import { FrameProfiler } from '#lib/picture/profiling/studio/frame-profiler.tsx';
import { SceneContext } from '#lib/picture/video/studio/scene.tsx';
import { randomSeedFromKey } from '#lib/picture/motion/models/random.ts';
import { SFX, Sfx, SfxCueListAudio, SfxCueListPlaying } from '#lib/timing/sound/studio/sfx.tsx';
import { sceneClockAt, sceneTimes, scenesAtFrame } from '#lib/timing/timeline/models/video-layout.ts';
import { laidVideoOf, videoFormatOf, type LaidScene, type LaidVideo, type VideoDef } from '#lib/picture/video/studio/video.ts';
import { BurnedCaptions, burnedCaptionPages, CaptionBandContext, sidecarCaptionPages } from '#lib/picture/captions/studio/caption-style.tsx';
import { captionsToSrt, captionsToVtt } from '#lib/picture/captions/models/caption-sidecar.ts';
import { captionTrackOfVoice, type CaptionTrack } from '#lib/picture/captions/models/caption-track.ts';
import { pillCaptions } from '#lib/picture/captions/studio/pill-captions.tsx';
import type { CaptionStyle } from '#lib/picture/captions/studio/caption-style.tsx';
import { VideoTransparentContext } from '#lib/picture/frame/studio/video-format.ts';
import { LensModeContext } from '#lib/picture/lens/studio/lens-mode-context.ts';

export const TIMELINE_ARTIFACT = 'timeline.json';

// Here, not in timeline.ts, which plain Node loads: a style is React.
const HOUSE_CAPTIONS = pillCaptions();

/** The video's caption style and what it captions: its table, or its voiced lines. */
export function videoCaptionsOf(video: VideoDef): { style: CaptionStyle; track: CaptionTrack } {
  const { style = HOUSE_CAPTIONS, table } = video.captions ?? {};
  if (table && Object.keys(video.voice).length) throw new Error('the video has a voice and a caption table: a voiced video captions its lines, so drop the table');
  return { style, track: table ?? captionTrackOfVoice(video.timeline, video.voice) };
}


function timelineReport(video: VideoDef, tl: LaidVideo, { fps, width, height, durationInFrames }: VideoConfig, sfxCueList: boolean, captions: { style: CaptionStyle; track: CaptionTrack }): string {
  const sidecar = captions.track.length ? sidecarCaptionPages(captions.style, captions.track, { width, height }) : null;
  const report: TimelineReport = {
    title: video.title,
    fps,
    width,
    height,
    transparent: videoFormatOf(video).transparent,
    duration: video.timeline.end / fps,
    durationInFrames,
    scenes: tl.scenes.map((scene) => ({
      id: scene.id, from: scene.from, to: scene.to, visible: scene.visible, start: scene.start, dur: scene.dur, note: scene.note, rung: scene.rung, lines: Object.keys(scene.spans), previs: previsRequestFor(tl, scene),
    })),
    cues: tl.cues.map(({ id, start, end, text, src }) => {
      const scene = tl.scenes.find((sc) => id in sc.spans)!, span = scene.spans[id];
      const words = span.words.map((w) => ({ text: w.text, start: scene.start + span.start + w.start, end: scene.start + span.start + w.end }));
      return { id, start, end, text, voiced: src !== null, words };
    }),
    captions: sidecar && { srt: captionsToSrt(sidecar), vtt: captionsToVtt(sidecar) },
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
    beatClicks: playsBeatClicks(video),
    sounds: (video.sounds ?? []).map(({ at, sound, id }, i) => {
      const takes = Array.isArray(sound) ? sound : [sound];
      return { id: String(id ?? i), at, sound: takes[randomSeedFromKey(id ?? i) % takes.length].request.sound };
    }),
  };
  return JSON.stringify(report);
}

// `reportTimeline` is off in the replay composition: its Freeze can land on frame 0 more than once, and Remotion
// refuses a second artifact with the same name.
export function Video({ video, captions, probe, blockouts, auditionSfxCueList = false, profile = false, lens = 'fast', reportTimeline = true }: VideoProps & { video: VideoDef; reportTimeline?: boolean }) {
  const frame = useCurrentFrame();
  const config = useVideoConfig(), { fps } = config;
  const tl = useMemo(() => laidVideoOf(video), [video]);
  const { transparent } = useMemo(() => videoFormatOf(video), [video]);
  const captioned = useMemo(() => videoCaptionsOf(video), [video]);
  const pages = useMemo(() => burnedCaptionPages(captioned.style, captioned.track, config), [captioned, config.width, config.height]);
  const root = useRef<HTMLDivElement>(null);
  const t = frame / fps;
  const painted = scenesAtFrame(tl, frame);
  const playsCueList = !!video.sfxCueList || auditionSfxCueList;
  // A check measures the events a draft is made from, so it runs without a list.
  if (playsCueList && !sfxCues && !probe) throw new Error('this project has no sfx/cues.json: run studio sfx draft first');

  return (
    <AbsoluteFill ref={root} style={{ background: transparent ? undefined : '#fff', overflow: 'hidden' }}>
      <LensModeContext value={lens}>
      <CaptionBandContext value={captioned.style.band}>
      <SfxCueListPlaying.Provider value={playsCueList}>
        <ProfiledScenes profile={profile}>{tl.scenes.map((scene, k) => {
          const paint = painted.find((p) => p.k === k);
          return (
            <Sequence key={scene.id} name={scene.id} from={scene.visible.from} durationInFrames={Math.max(1, scene.visible.to - scene.visible.from)} layout="none">
              {paint && <SceneLayer scene={scene} t={t} alpha={paint.alpha} transparent={transparent} footage={blockouts ? undefined : footageFor(scene)} />}
            </Sequence>
          );
        })}</ProfiledScenes>
      </SfxCueListPlaying.Provider>
      </CaptionBandContext>
      </LensModeContext>
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
      {playsBeatClicks(video) && <BeatClickAudio timeline={video.timeline} fps={fps} />}
      {captions && <BurnedCaptions style={captioned.style} pages={pages} t={t} />}
      {reportTimeline && frame === 0 && <Artifact filename={TIMELINE_ARTIFACT} content={timelineReport(video, tl, config, playsCueList, captioned)} />}
      {probe && <FrameProbe root={root} />}
    </AbsoluteFill>
  );
}

const ProfiledScenes = ({ profile, children }: { profile: boolean; children: ReactNode }) => (profile ? <FrameProfiler>{children}</FrameProfiler> : children);

function MusicBedAudio({ video, tl, fps }: { video: VideoDef; tl: LaidVideo; fps: number }) {
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

/**
 * Whether `video` plays a click on each beat: cut to a tempo grid with no `music` yet, so a render has a beat to hear
 * the cuts against rather than refusing a silent mix. A draft. Not on a recorded grid: its track exists, so no
 * `music` there is a video.tsx that forgot it, which clicks would hide.
 */
const playsBeatClicks = (video: VideoDef) => !video.music && video.timeline.spec.grid?.kind === 'tempo' && video.timeline.beatFrames.length > 0;

/**
 * A click on each grid beat, where the music will sound: a beat's hit frame plus the picture's lead over its sound.
 * Plain audio, so `studio check` and a cue list see no event.
 */
function BeatClickAudio({ timeline, fps }: { timeline: VideoDef['timeline']; fps: number }) {
  const cues = useMemo(() => {
    const [{ src, seconds, landsAt }] = SFX.click;
    const lead = timeline.spec.pictureLeadFrames ?? 0;
    return timeline.beatFrames.map((frame) => ({ id: `beat ${frame}`, at: (frame + lead) / fps, src, seconds, landsAt, volume: 1 }));
  }, [timeline, fps]);
  return <SfxCueListAudio cues={cues} />;
}

// Footage listed for a scene that no longer asks for previs is left unplayed, and kept, since it was paid for.
const footageFor = (scene: LaidScene): PrevisFootage | undefined => (scene.previs ? footageList[scene.id] : undefined);

// A transparent video's scene paints only what it draws, so in a crossfade each fades over the page, not over white.
function SceneLayer({ scene, t, alpha, transparent = false, footage }: { scene: LaidScene; t: number; alpha: number; transparent?: boolean; footage?: PrevisFootage }) {
  const clock = sceneClockAt(scene, t);
  return (
    <AbsoluteFill data-scene={scene.id} data-scene-t={clock.t} style={{ background: transparent ? undefined : '#fff', opacity: alpha }}>
      <VideoTransparentContext value={transparent}>
        <SceneContext.Provider value={clock}>
          {footage ? (
            <AbsoluteFill {...unmeasuredAttrs('generated clip')}><PrevisFootagePlayer scene={scene} footage={footage} clock={clock} /></AbsoluteFill>
          ) : <SceneBody scene={scene} clock={clock} />}
        </SceneContext.Provider>
      </VideoTransparentContext>
    </AbsoluteFill>
  );
}

/** One previs scene's blockout alone over its previsSpan, silent: the reference video `studio gen video` sends. */
export function BlockoutSolo({ video, scene: sceneId }: BlockoutSoloProps & { video: VideoDef }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tl = useMemo(() => laidVideoOf(video), [video]);
  const scene = tl.scenes.find((s) => s.id === sceneId)!;
  const { from } = previsSpan(tl, sceneId);
  return <CaptionBandContext value={videoCaptionsOf(video).style.band}><SceneLayer scene={scene} t={scene.start + from + frame / fps} alpha={1} /></CaptionBandContext>;
}

// A component of its own so a scene's render can call hooks.
const SceneBody = ({ scene, clock }: { scene: LaidScene; clock: ReturnType<typeof sceneClockAt> }) => <>{scene.render(clock)}</>;
