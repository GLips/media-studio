// resolve-storyboard.ts: a storyboard timed into its Timeline, the one resolution the plan page, `studio clock`, the
// render and the retime test all read. A line spoken in a recording is timed by its stretch; a read line by its clip
// while the clip still says it, else estimated from its word count here, never stored, so a reworded line re-times
// the plan at once.
//
// It never throws: what's wrong comes back as diagnostics, each on the scene, line or cue it's about, so the page can
// show a half-broken plan. A cue whose word has gone falls to its line's start so the rest still times; its
// diagnostic is what stops a render (defineVideo throws on any).

import { defineTimeline, recordedGrid, tempoGrid, type FittedTrack, type SceneMoment, type SceneSpan, type TimelineGrid, type TimelineSpec } from '#lib/timing/timeline/models/timeline.ts';
import type { RenderVoice } from '#lib/timing/voice/models/render-voice.ts';
import type { RecordedVoice, RecordedVoiceLine, Voice, VoiceLine } from '#lib/timing/voice/models/voice-manifest.ts';
import { alignSpokenWords, captionMarkup, estimateSpokenLine, findSpokenPhrase, spokenText } from '#lib/timing/voice/models/voice-words.ts';
import type { Storyboard, StoryboardBeatLine, StoryboardBeatScene, StoryboardFixedScene, StoryboardLine, StoryboardReadLine, StoryboardScene, StoryboardSpokenLine, StoryboardWordCue, TimelineOfStoryboard } from './storyboard.ts';

/** music/index.ts's tracks, as far as a grid reads them: a `{ music }` grid needs its track fitted (`studio music fit --bars`). */
export type StoryboardMusic = Readonly<Record<string, Omit<FittedTrack, 'fit'> & { fit?: FittedTrack['fit'] }>>;

/**
 * How a line is timed: by a real take's clip, by a `--read=draft` take's (fine for timing, never for delivery), by its
 * stretch of a library recording (`spoken`), or by its word count.
 */
export type StoryboardLineRead = 'recorded' | 'draft' | 'spoken' | 'estimated';

/** Something wrong with the plan, on the scene (and line, and cue) it's about where it's about one. */
export type StoryboardDiagnostic = { scene?: string; line?: string; cue?: string; message: string };

export type ResolveStoryboardInputs = {
  /** audio/manifest.ts's `voice`: the recorded clips, matched to lines by id and text. */
  voice?: RecordedVoice;
  /** Whose read the manifest's clips are (`renderVoiceOf`): `draft` marks matched lines draft. Default `final`. */
  voiceRead?: Exclude<RenderVoice, null>;
  music?: StoryboardMusic;
};

export type ResolvedStoryboard<S> = {
  /** Null when the plan can't be timed at all: its diagnostics say why. */
  timeline: TimelineOfStoryboard<S> | null;
  /** Every line in plan order, as a manifest has it: an estimated line's `src`, `lufs` and `pauseBefore` are null. */
  voice: Voice;
  /** Each line's scene and how it was timed, in plan order. */
  lines: readonly { scene: string; line: string; read: StoryboardLineRead }[];
  diagnostics: readonly StoryboardDiagnostic[];
};

type AnyStoryboard = Storyboard;

export function resolveStoryboard<const S extends AnyStoryboard>(storyboard: S, inputs: ResolveStoryboardInputs = {}): ResolvedStoryboard<S> {
  const diagnostics: StoryboardDiagnostic[] = [];
  const voice: Record<string, VoiceLine> = {};
  const lines: { scene: string; line: string; read: StoryboardLineRead }[] = [];
  const sceneEntries = Object.entries(storyboard.scenes);

  for (const [scene, row] of sceneEntries) {
    for (const [id, line] of linesOf(row)) {
      const { line: voiced, read } = line.speech ? spokenLine(scene, id, line, diagnostics) : voicedLine(line, inputs.voice?.[id], inputs.voiceRead ?? 'final');
      voice[id] = voiced;
      lines.push({ scene, line: id, read });
    }
  }
  const readLines = sceneEntries.some(([, row]) => linesOf(row).some(([, line]) => !line.speech));
  if (readLines && storyboard.voice === undefined) diagnostics.push({ message: 'it has lines to read but names no voice: add `voice` for studio voice to read them in' });
  const scenes = Object.fromEntries(sceneEntries.map(([scene, row]) => [scene, sceneSpan(scene, row, voice, diagnostics)]));

  const grid = gridOf(storyboard, inputs.music, diagnostics);
  if (grid === null) return { timeline: null, voice, lines, diagnostics };
  const spec: TimelineSpec = {
    fps: storyboard.fps, grid, pictureLeadFrames: storyboard.pictureLeadFrames, soundLagSeconds: storyboard.soundLagSeconds,
    fade: storyboard.fade, voice, scenes, replays: storyboard.replays, landmarks: storyboard.landmarks,
  };
  let timeline: TimelineOfStoryboard<S> | null = null;
  try {
    // SAFETY: `spec` is built from the storyboard scene by scene, so its scenes, lines, cues and moves are the names
    // StoryboardTimelineScenes derives from the storyboard's type.
    timeline = defineTimeline(spec) as TimelineOfStoryboard<S>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.push({ ...sceneNamedIn(message, Object.keys(storyboard.scenes)), message });
  }
  if (timeline && storyboard.target?.max !== undefined) {
    const seconds = timeline.end / timeline.fps;
    if (seconds > storyboard.target.max) diagnostics.push({ message: `it runs ${seconds.toFixed(1)} s, past its ${storyboard.target.max} s most` });
  }
  return { timeline, voice, lines, diagnostics };
}

const where = ({ scene, line, cue }: StoryboardDiagnostic) => [scene && `scene ${scene}`, line && `line ${line}`, cue && `cue ${cue}`].filter(Boolean).join(', ');

/** The diagnostics as one error message, a line each, led by the scene (and line, and cue) each is on. */
export function storyboardDiagnosticsMessage(what: string, diagnostics: readonly StoryboardDiagnostic[]): string {
  return `${what} doesn't resolve:\n${diagnostics.map((d) => `  ${where(d) ? `${where(d)}: ` : ''}${d.message}`).join('\n')}`;
}

function linesOf(row: StoryboardBeatScene): [string, StoryboardBeatLine][];
function linesOf(row: StoryboardScene): [string, StoryboardLine][];
function linesOf(row: StoryboardScene): [string, StoryboardLine][] {
  return Object.entries(row.lines ?? {});
}

/**
 * A line spoken in a recording, timed by its stretch: its words are what the transcript heard there, or its `text`'s
 * words placed on them. Until the item's speech is levelled it can't play, which stops a render.
 */
function spokenLine(scene: string, id: string, line: StoryboardSpokenLine, diagnostics: StoryboardDiagnostic[]): { line: VoiceLine; read: StoryboardLineRead } {
  const { speech } = line, duration = speech.to - speech.from;
  const said = line.text ?? speech.heard.map((w) => w.text).join(' ');
  const text = spokenText(said), caption = captionMarkup(said), paragraph = line.paragraph ?? false;
  if (!(duration > 0)) diagnostics.push({ scene, line: id, message: `its speech runs ${speech.from} to ${speech.to} s of ${speech.item}: give it an end after its start` });
  if (!text) diagnostics.push({ scene, line: id, message: `nothing is said in ${speech.item} from ${speech.from} to ${speech.to} s: widen the stretch, or give the line its text` });
  if (!speech.sound) {
    diagnostics.push({ scene, line: id, message: `${speech.item}'s speech isn't levelled for the mix yet: run studio library finish ${speech.item}` });
    return { line: { src: null, duration, words: alignSpokenWords(text, speech.heard, duration).words, text, caption, paragraph, lufs: null, pauseBefore: null }, read: 'estimated' };
  }
  const { lufs, ...src } = speech.sound;
  return { line: { src, lufs, speech: { item: speech.item, from: speech.from, to: speech.to }, duration, words: alignSpokenWords(text, speech.heard, duration).words, text, caption, paragraph, pauseBefore: null }, read: 'spoken' };
}

/** A line's clip while it still says the line, its caption and paragraph always the storyboard's; else an estimate. */
function voicedLine(line: StoryboardReadLine, clip: RecordedVoiceLine | undefined, voiceRead: Exclude<RenderVoice, null>): { line: VoiceLine; read: StoryboardLineRead } {
  const text = spokenText(line.text), caption = captionMarkup(line.text), paragraph = line.paragraph ?? false;
  if (clip && clip.text === text) return { line: { ...clip, caption, paragraph }, read: voiceRead === 'draft' ? 'draft' : 'recorded' };
  return { line: { src: null, ...estimateSpokenLine(text), text, caption, paragraph, lufs: null, pauseBefore: null }, read: 'estimated' };
}

/** A storyboard scene as the timeline's span: its driver, its timing, and its word cues as speech cues on its lines. */
function sceneSpan(scene: string, row: StoryboardScene, voice: Readonly<Record<string, VoiceLine>>, diagnostics: StoryboardDiagnostic[]): SceneSpan {
  const cues: Record<string, SceneMoment> = { ...row.cues };
  const nudge: Readonly<Record<string, number>> = (isFixedScene(row) ? undefined : row.timing?.nudge) ?? {};
  const wordCues = new Set<string>();
  for (const [id, line] of linesOf(row)) {
    for (const [cue, at] of Object.entries(line.cues ?? {})) {
      if (cue in cues) {
        diagnostics.push({ scene, line: id, cue, message: `scene ${scene} has two cues named ${cue}: rename one` });
        continue;
      }
      wordCues.add(cue);
      cues[cue] = { line: id, ...spokenPhrase(scene, id, cue, at, voice[id], diagnostics), frames: nudge[cue] ?? 0 };
    }
  }
  for (const cue of Object.keys(nudge)) {
    if (!wordCues.has(cue)) diagnostics.push({ scene, cue, message: `scene ${scene} nudges ${cue}, which isn't a word cue of its lines` });
  }
  const shared = { cues, moves: row.moves, crossfade: row.timing?.crossfade };
  if (isBeatScene(row)) {
    return { driver: 'beat', beats: row.beats, cutIn: row.timing?.cutIn, lines: Object.fromEntries(linesOf(row).map(([id, line]) => [id, line.at])), ...shared };
  }
  if (isFixedScene(row)) return { driver: 'fixed', seconds: row.seconds, ...shared };
  const { lead, gap, tail, min } = row.timing ?? {};
  return { driver: 'voice', lines: Object.keys(row.lines), lead, gap, tail, min, ...shared };
}

const isBeatScene = (row: StoryboardScene): row is StoryboardBeatScene => row.beats !== undefined;
const isFixedScene = (row: StoryboardScene): row is StoryboardFixedScene => row.seconds !== undefined;

/** A word cue as a speech cue's phrase; a phrase its line no longer says is a diagnostic, and the cue sits on the line's start. */
function spokenPhrase(scene: string, line: string, cue: string, at: StoryboardWordCue, voiced: VoiceLine, diagnostics: StoryboardDiagnostic[]) {
  if (typeof at === 'object' && 'at' in at) return {};
  const { phrase, nth = 1 } = typeof at === 'string' ? { phrase: at } : at;
  try {
    findSpokenPhrase(voiced.words, phrase, nth);
    return { phrase, nth };
  } catch (error) {
    diagnostics.push({ scene, line, cue, message: `cue ${cue}: ${error instanceof Error ? error.message : String(error)}` });
    return {};
  }
}

function gridOf(storyboard: AnyStoryboard, music: StoryboardMusic | undefined, diagnostics: StoryboardDiagnostic[]): TimelineGrid | undefined | null {
  const grid = storyboard.grid;
  if (!grid) return undefined;
  if ('tempo' in grid) return tempoGrid(grid.tempo, { firstBeat: grid.firstBeat });
  const track = music?.[grid.music];
  if (!track) {
    diagnostics.push({ message: `the grid's music ${grid.music} isn't in music/index.ts: ${Object.keys(music ?? {}).join(', ') || 'it has no tracks'}` });
    return null;
  }
  if (!track.fit) {
    diagnostics.push({ message: `the grid's music ${grid.music} isn't fitted to the video: run studio music fit --bars` });
    return null;
  }
  return recordedGrid({ ...track, fit: track.fit }, { steady: grid.steady });
}

const escaped = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The scene a timeline error is about: the first it names as `scene <id>`, or by a `<id>.<cue>` it names. */
function sceneNamedIn(message: string, scenes: readonly string[]): { scene?: string } {
  const scene = scenes.find((id) => new RegExp(`\\bscene ${escaped(id)}(?![\\w-])`).test(message))
    ?? scenes.find((id) => new RegExp(`(?<![\\w-])${escaped(id)}\\.[\\w-]`).test(message));
  return scene === undefined ? {} : { scene };
}
