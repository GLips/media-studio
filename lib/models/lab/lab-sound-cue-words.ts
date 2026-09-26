// lab-sound-cue-words.ts: the cue editor's plain words: an event as a sentence, and the draft's reasons and the
// check's warnings (lib/sfx/cues.ts) for someone who has never read cues.ts.
import type { SfxEvent } from '#sfx/cue-events.ts';
import type { SfxCue } from '#sfx/cues.ts';
import { sfxSoundWords } from './lab-sound-words.ts';

/** Seconds as the editor shows them: "16.2 s". */
export const formatLabCueSeconds = (x: number) => `${x.toFixed(1)} s`;
const sec = formatLabCueSeconds;

const REVEAL_KINDS = new Set(['highlight', 'dialog', 'card']);
/** A reveal's track (`sale/left/highlight`, `title/Simple buy box`) as what appears. */
function revealWords(track: string): string {
  const parts = track.split('/').slice(1), last = (parts.at(-1) ?? track).replace(/\s+/g, ' ').trim();
  const side = parts.length > 1 ? ` on the ${parts[0]}` : '';
  if (REVEAL_KINDS.has(last)) return `a ${last}${side}`;
  return /[A-Z ]/.test(last) ? `the words “${last.replace(/^\d+ /, '')}”` : `the ${last}${side}`;
}

/** An event as a sentence: "a click at 16.2 s in the photos scene". */
export function sfxEventWords(e: SfxEvent): string {
  switch (e.kind) {
    case 'click': return `a click at ${sec(e.at)} in the ${e.scene} scene`;
    case 'key': return `a key press at ${sec(e.at)} in the ${e.scene} scene`;
    case 'placed': return `${sfxSoundWords(e.request)} that the ${e.scene} scene plays itself, at ${sec(e.at)}`;
    case 'scene': return e.dissolve ? `the dissolve into the ${e.scene} scene, at ${sec(e.at)}` : `the cut to the ${e.scene} scene, at ${sec(e.at)}`;
    case 'camera-move': return `a ${e.big ? 'big' : 'small'} camera move in the ${e.scene} scene (${sec(e.from)}–${sec(e.to)}), fastest at ${sec(e.at)}`;
    case 'reveal': return `${revealWords(e.track)} appearing at ${sec(e.at)} in the ${e.scene} scene`;
  }
}

/** A shorter name for an event another cue's reason points at. */
export function sfxEventShortWords(e: SfxEvent | undefined, id: string): string {
  if (!e) return id;
  switch (e.kind) {
    case 'scene': return `the change to ${e.scene} (${sec(e.at)})`;
    case 'reveal': return `${revealWords(e.track)} appearing (${sec(e.at)})`;
    case 'camera-move': return `the camera move at ${sec(e.at)}`;
    default: return `the ${e.kind} at ${sec(e.at)}`;
  }
}

/**
 * A rule from lib/sfx/cues.ts (a draft's `why`, or a warning from sfxCueOverrides) in plain words. Matches the
 * wording cues.ts writes; anything it doesn't know comes through as written.
 */
export function sfxRuleWords(rule: string, events: ReadonlyMap<string, SfxEvent>): string {
  let m: RegExpExecArray | null;
  if ((m = /([\d.]+) s after the click before/.exec(rule))) return `It comes only ${m[1]} s after the click before it. Two clicks that close sound like a stutter, so the second stays quiet.`;
  if ((m = /^an accent on (.+?): accents go on/.exec(rule))) return `${m[1][0].toUpperCase()}${m[1].slice(1)} is too small a moment for a big sound. Those are kept for scene changes, big camera moves and things appearing.`;
  if ((m = /^([\d.]+) s from the accent on (.+): at most one every ([\d.]+) s$/.exec(rule))) {
    return `It's only ${m[1]} s from the big sound on ${sfxEventShortWords(events.get(m[2]), m[2])}. Big sounds are kept at least ${m[3]} s apart, so the video doesn't turn into a pinball machine.`;
  }
  if ((m = /^the scene change beside (.+) has an accent/.exec(rule))) return `The scene change next to it, ${sfxEventShortWords(events.get(m[1]), m[1])}, already has a big sound. A sound on every cut soon wears thin.`;
  if ((m = /^under "(.+)" \(([\d.]+)–([\d.]+) s\)$/.exec(rule))) return `It would land on the spoken word “${m[1]}” (${m[2]}–${m[3]} s), and a loud sound over a word makes the word hard to hear.`;
  if ((m = /^lands (-?[\d.]+) s off its event/.exec(rule))) return `It's nudged ${Math.abs(Number(m[1])).toFixed(2)} s ${Number(m[1]) > 0 ? 'late' : 'early'}, off the moment it marks.`;
  if (/^a whoosh of .* it should last as long$/.test(rule)) return 'The whoosh is a different length from the movement it rides on. It should last as long as the move.';
  if (rule.startsWith('edits do nothing to a placed sound')) return "Edits do nothing to a sound the scene plays itself: change it in the scene's code.";
  return rule;
}

/** Why the draft chose what it did, as a sentence. `clickSound` is the list's click style's sound (`click.soft`). */
export function sfxDraftWords(cue: SfxCue, clickSound: string, events: ReadonlyMap<string, SfxEvent>): string {
  const { why } = cue.draft;
  if (why.startsWith('click style')) return `Every click in this video gets the same click sound (${sfxSoundWords({ sound: clickSound })}), so they all sound like one mouse.`;
  if (why === 'typing') return 'Typing always gets key sounds.';
  if (why.startsWith('plays from its <Sfx>')) return "The scene plays this sound itself: someone placed it by hand in the scene's code. The list only counts it, so other sounds keep clear of it.";
  if (why === 'a scene change') return 'A new scene is the best place for a big sound: it marks a turn in the story.';
  if (why === 'a big camera move') return 'A big, fast camera move gets a whoosh as long as the move.';
  if (why === 'a reveal') return 'Something important appearing gets a small accent, with no big sound or spoken word in the way.';
  return sfxRuleWords(why.replace(/^debounced: /, ''), events);
}

/** What a cue's edits did, in a word or two: "swapped, nudged +0.05 s". */
export function labCueEditWords(c: SfxCue): string {
  const parts: string[] = [];
  if (c.sound === null) parts.push('muted');
  else if (c.sound) parts.push(c.draft.sound ? 'swapped' : 'filled');
  if (c.nudge !== undefined) parts.push(`nudged ${c.nudge > 0 ? '+' : ''}${c.nudge.toFixed(2)} s`);
  if (c.volume !== undefined) parts.push(`volume ${c.volume.toFixed(2)}`);
  return parts.join(', ');
}
