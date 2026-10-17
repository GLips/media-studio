// storyboard.ts: a timed video's plan, its project's storyboard.ts: the brief, then a row per scene (on screen, motion,
// reads, and what drives its length: lines, beats or seconds), the replays, landmarks and left-out list. It is the one
// place a line is written, and a word cue sits on the line beside its word, so a reworded line changes one place.
//
// `defineStoryboard` only types it: nothing here checks or resolves, so a plan with a cue whose word has gone still
// loads, and the plan page shows it. `resolveStoryboard` (resolve-storyboard.ts) times it into the scenes' Timeline.
//
// Negative space: the grid is data (`{ music: 'drive-fit' }`), never an imported track, so a plan loads with no audio.

import type { TimelineSceneClock } from '#lib/timing/timeline/models/bind-timeline.ts';
import type { CueName, Landmark, MomentRef, MoveSpan, ReplayTable, SceneMoment, SpeechCue, Timeline } from '#lib/timing/timeline/models/timeline.ts';

// ---------- lines and cues ----------

/**
 * A moment on a line: where `phrase` (its `nth` occurrence, from 1) starts, written as the phrase alone when it's the
 * first, or `{ at: 'start' }` for the line's first word. Case and punctuation don't matter.
 */
export type StoryboardWordCue = string | { phrase: string; nth?: number } | { at: 'start' };

export type StoryboardLine = {
  /** What's read: the voice's inline tags (`<short pause>`) are performed, `*emphasis*` and `` `key` `` captioned. */
  text: string;
  /** Moments on its words, each a cue of its scene. */
  cues?: Readonly<Record<string, StoryboardWordCue>>;
  /** It starts a new paragraph of the read, so no caption page runs into it. */
  paragraph?: boolean;
};

/** A line voiced over a beat scene, from beat `at` of its own beat 0. It must end by the scene's last beat. */
export type StoryboardBeatLine = StoryboardLine & { at: number };

/**
 * A scene's own moment: seconds (beats, in a beat scene) from its origin, `'end'`, or `{ after }` another of its cues,
 * word cues included; then `frames` more.
 */
export type StoryboardSceneCue = Exclude<SceneMoment, SpeechCue>;

/** A move's end: a moment of its own scene, or `{ cue: '<scene>.<cue>' }` of another. */
export type StoryboardMove = { from: Exclude<MomentRef, SpeechCue>; to: Exclude<MomentRef, SpeechCue> };

// ---------- scenes ----------

type StoryboardRow = {
  /** What the viewer sees. */
  onScreen: string;
  /** What moves, and on what. */
  motion: string;
  /** What a viewer should take from it, each a sentence. */
  reads?: readonly string[];
  cues?: Readonly<Record<string, StoryboardSceneCue>>;
  moves?: Readonly<Record<string, StoryboardMove>>;
};

type SharedTiming = {
  /** Seconds the cut into the scene crossfades over, centred on the cut. Default 0: a hard cut. */
  crossfade?: number;
  /** Frames a word cue moves off its word: `{ shutter: 4 }` fires four frames after "photo" starts. */
  nudge?: Readonly<Record<string, number>>;
};

/** A voiced scene: as long as its lines take to read, with a lead before, gaps between and a tail after. */
export type StoryboardVoicedScene = StoryboardRow & {
  lines: Readonly<Record<string, StoryboardLine>>;
  beats?: never;
  seconds?: never;
  timing?: SharedTiming & {
    /** Seconds before the first line. Default 0.5. */
    lead?: number;
    /** Seconds between lines: the read's own pause by default, a number for every gap, or `{ <line>: seconds }` before one. */
    gap?: number | Readonly<Record<string, number>>;
    /** Seconds after the last line. Default 0.6. */
    tail?: number;
    /** The scene lasts at least this long. */
    min?: number;
  };
};

/** A bar of a beat sheet: `beats` long on the storyboard's grid, its cues in beats, any lines on their beats. */
export type StoryboardBeatScene = StoryboardRow & {
  beats: number;
  lines?: Readonly<Record<string, StoryboardBeatLine>>;
  seconds?: never;
  timing?: SharedTiming & {
    /** For a bar that cuts in after its first beat, by how much: its picture takes over there. */
    cutIn?: number;
  };
};

/** A scene of fixed length, cut to neither voice nor beat. */
export type StoryboardFixedScene = StoryboardRow & { seconds: number; lines?: never; beats?: never; timing?: Omit<SharedTiming, 'nudge'> };

export type StoryboardScene = StoryboardVoicedScene | StoryboardBeatScene | StoryboardFixedScene;
export type StoryboardScenes = Readonly<Record<string, StoryboardScene>>;

// ---------- names, as types ----------

type KeysOf<T> = [T] extends [never] ? never : keyof T & string;
type LinesOfScene<S> = S extends { lines?: infer L } ? NonNullable<L> : never;
/** The ids of the lines scene `S` speaks. */
export type StoryboardLineIdsOf<S> = KeysOf<LinesOfScene<S>>;
type WordCueNamesOf<S> = { [L in StoryboardLineIdsOf<S>]: LinesOfScene<S>[L] extends { cues?: infer C } ? KeysOf<NonNullable<C>> : never }[StoryboardLineIdsOf<S>];
/** Every cue scene `S` declares: its lines' word cues and its own. */
export type StoryboardCueNamesOf<S> = WordCueNamesOf<S> | (S extends { cues?: infer C } ? KeysOf<NonNullable<C>> : never);
type MoveNamesOfScene<S> = S extends { moves?: infer M } ? KeysOf<NonNullable<M>> : never;

type SpanFacts<S> = {
  cues?: Readonly<Record<StoryboardCueNamesOf<S>, SceneMoment>>;
  moves?: Readonly<Record<MoveNamesOfScene<S>, MoveSpan>>;
  crossfade?: number;
};

/** The `SceneSpan` a storyboard scene resolves to, as far as its names go: what `defineTimeline` types a clock from. */
export type StoryboardSceneSpan<S> = S extends { beats: number }
  ? { driver: 'beat'; beats: number; cutIn?: number; lines?: Readonly<Record<StoryboardLineIdsOf<S>, number>> } & SpanFacts<S>
  : S extends { seconds: number }
    ? { driver: 'fixed'; seconds: number } & SpanFacts<S>
    : { driver: 'voice'; lines: readonly StoryboardLineIdsOf<S>[] } & SpanFacts<S>;

export type StoryboardTimelineScenes<Scenes> = { readonly [K in keyof Scenes]: StoryboardSceneSpan<Scenes[K]> };

// ---------- the storyboard ----------

/** The musical section's beats: a fixed tempo (beat 0 `firstBeat` seconds in), or a track of music/index.ts by name. */
export type StoryboardGrid = { tempo: number; firstBeat?: number } | { music: string; steady?: boolean };

export type StoryboardReplays<Scenes> = ReplayTable<StoryboardTimelineScenes<Scenes>>;

export type Storyboard<Scenes extends StoryboardScenes = StoryboardScenes, Replays extends StoryboardReplays<Scenes> = StoryboardReplays<Scenes>> = {
  title: string;
  /** The length it's planned to, and the most it may run (a store's cap, say): a plan past `max` is a diagnostic. */
  target: { seconds: number; max?: number };
  /** The TTS voice `studio voice` reads its lines in; a storyboard with no lines names none. It makes the project voiced. */
  voice?: string;
  /** The frame rate every instant rounds to. Default 30. */
  fps?: number;
  /** The beat scenes' grid. A storyboard with no beat scene needs none. */
  grid?: StoryboardGrid;
  /** Frames a beat's cut or hit comes before the grid's beat. Default 0. */
  pictureLeadFrames?: number;
  /** Seconds a placed sound trails the picture's event it marks. Default 0. */
  soundLagSeconds?: number;
  /** The fade to black, in frames from the video's end (negative): e.g. `{ from: -9, to: -5 }`. */
  fade?: { from: number; to: number };
  /** The plan's prose, heading by heading in order: who it's for, the takeaway, the angle, the checks. Markdown. */
  brief?: Readonly<Record<string, string>>;
  scenes: Scenes;
  /** Replays, keyed by the replaying scene and the replay's name. */
  replays?: Replays;
  /** Cues that must fall on the fitted music's downbeats. */
  landmarks?: readonly Landmark<CueName<StoryboardTimelineScenes<Scenes>>>[];
  /** What the video deliberately doesn't show, and why. */
  leftOut?: readonly string[];
};

/** A project's plan, typed so its scene, line, cue and move names are literals its scenes' clocks are checked against. */
export function defineStoryboard<const Scenes extends StoryboardScenes, const Replays extends StoryboardReplays<Scenes> = {}>(
  storyboard: Storyboard<Scenes, Replays> & { landmarks?: NoInfer<Storyboard<Scenes>['landmarks']> },
): Storyboard<Scenes, Replays> {
  return storyboard;
}

type ScenesOfStoryboard<S> = S extends Storyboard<infer Scenes, infer _Replays> ? Scenes : never;
type ReplaysOfStoryboard<S> = S extends Storyboard<infer _Scenes, infer Replays> ? Replays : never;

/** The Timeline `resolveStoryboard` resolves storyboard `S` to. */
export type TimelineOfStoryboard<S> = Timeline<
  StoryboardTimelineScenes<ScenesOfStoryboard<S>>,
  Extract<ReplaysOfStoryboard<S>, StoryboardReplays<ScenesOfStoryboard<S>>>
>;

/** The clock scene `K` of storyboard `S` draws on: its word and scene cues, its moves, and every cue by name. */
export type StoryboardSceneClock<S, K extends keyof ScenesOfStoryboard<S> & string> = TimelineSceneClock<TimelineOfStoryboard<S>, K>;
