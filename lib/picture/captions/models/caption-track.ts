// caption-track.ts: what a video's captions say and when, before any style pages it: every word in video seconds,
// in phrases. A voiced video's track is its timeline's lines as spoken, word for word; a silent one's is a caption
// table in its timeline.ts, each row shown from its moment until the next.
//
// Caption markup: `*word*` (or `*a few words*`) is emphasis and `` `key` `` a keycap, each a whole word. Negative
// space: nothing else is markup, so a row's text is never HTML.

import type { CueNamesOf, SceneSpan, Timeline } from '#lib/timing/timeline/models/timeline.ts';
import type { Voice } from '#lib/timing/voice/models/voice-manifest.ts';
import { CLOSES_EMPHASIS, estimateSpokenWords, KEYCAP_WORD, OPENS_EMPHASIS, scriptWords, spokenText } from '#lib/timing/voice/models/voice-words.ts';

/** One captioned word, spoken (or shown, from a table) from `start` to `end` in video seconds. */
export type CaptionWord = {
  text: string;
  start: number;
  end: number;
  emphasis: boolean;
  /** Drawn as a keycap; `text` is the key and `trail` any punctuation after it, outside the cap. */
  key: boolean;
  trail: string;
};

/** A voiced line, or a table row: its words in order. `paragraph` starts a new thought, which no page runs across. */
export type CaptionPhrase = { id: string; paragraph: boolean; words: readonly CaptionWord[] };

/** Every phrase a video captions, in order. */
export type CaptionTrack = readonly CaptionPhrase[];

type CaptionToken = Pick<CaptionWord, 'text' | 'emphasis' | 'key' | 'trail'>;

/** A line of caption markup as words: `*…*` spans marked, `` `key` `` words (with any punctuation after) as keys. */
export function captionTokens(markup: string): CaptionToken[] {
  let open = false;
  return scriptWords(markup).map((word) => {
    const key = KEYCAP_WORD.exec(word);
    if (key) return { text: key[1], emphasis: open, key: true, trail: key[2] };
    const opens = OPENS_EMPHASIS.test(word), closes = CLOSES_EMPHASIS.test(word);
    const emphasis = open || opens;
    if (opens) open = true;
    if (closes) open = false;
    return { text: word.replace(OPENS_EMPHASIS, '$1').replace(CLOSES_EMPHASIS, '$1'), emphasis, key: false, trail: '' };
  });
}

/** The track a voiced video's captions come from: each line the timeline places, its words where they're spoken. */
export function captionTrackOfVoice(timeline: Timeline, voice: Voice): CaptionTrack {
  return timeline.scenes.flatMap((scene) => scene.lines.map(({ id, frame }): CaptionPhrase => {
    const line = voice[id];
    if (!line) throw new Error(`scene ${scene.id} speaks line ${id}, which the video's voice doesn't have: pass defineVideo the manifest its timeline reads`);
    const tokens = captionTokens(line.caption), at = frame / timeline.fps;
    if (tokens.length !== line.words.length) throw new Error(`line ${id}'s caption has ${tokens.length} words and its take ${line.words.length}: run studio voice again`);
    return { id, paragraph: line.paragraph, words: tokens.map((token, k) => ({ ...token, start: at + line.words[k].start, end: at + line.words[k].end })) };
  }));
}

/** When a table row starts: seconds from its scene's cut, one of the scene's cues, or seconds after one. */
export type CaptionRowMoment<Cue extends string> = number | Cue | { cue: Cue; seconds: number };
/** A row of a caption table: from its moment to the next row's (or its scene's end), `text` in caption markup. */
export type CaptionTableRow<Cue extends string> = readonly [from: CaptionRowMoment<Cue>, text: string];

/**
 * A silent video's captions, stated in its timeline.ts: rows per scene, each a phrase of its own. A row's words share
 * its time by length, so a style that times words (pops) still steps through them.
 */
export function captionTable<const Scenes extends Readonly<Record<string, SceneSpan>>>(
  timeline: Timeline<Scenes>,
  rows: { readonly [K in keyof Scenes & string]?: readonly CaptionTableRow<CueNamesOf<Scenes[K]>>[] },
): CaptionTrack {
  const { fps } = timeline;
  return timeline.keys.flatMap((key) => {
    const scene = timeline.scene(key), sceneRows = rows[key] ?? [];
    const secondsOf = (moment: CaptionRowMoment<string>) => {
      if (typeof moment === 'number') return scene.from / fps + moment;
      const name = typeof moment === 'string' ? moment : moment.cue;
      const frame = (scene.cues as Readonly<Record<string, number>>)[name];
      if (frame === undefined) throw new Error(`a caption in scene ${key} starts at cue ${name}, which the scene doesn't have`);
      return frame / fps + (typeof moment === 'string' ? 0 : moment.seconds);
    };
    const starts = sceneRows.map(([from]) => secondsOf(from));
    return sceneRows.map(([, text], k): CaptionPhrase => {
      const start = starts[k], end = starts[k + 1] ?? scene.to / fps;
      if (!(end > start)) throw new Error(`the caption "${text}" in scene ${key} starts at ${start.toFixed(2)}s, not before the next at ${end.toFixed(2)}s`);
      const tokens = captionTokens(text), timed = estimateSpokenWords(spokenText(text), end - start);
      return { id: `${key}.${k}`, paragraph: true, words: tokens.map((token, j) => ({ ...token, start: start + timed[j].start, end: start + timed[j].end })) };
    });
  });
}
