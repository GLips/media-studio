// voice-words.ts: when each word of a voiced line is spoken. Pure, and shared: scripts/tts.ts aligns what whisper heard
// to the script and stores the result in the manifest, and scenes look words up through `s.line(id).word(…)`.
//
// The script is the truth for *what* was said; whisper is only trusted for *when*. So there's always exactly one
// timing per script word, even where whisper misheard ("seventeen" as "17") or dropped a word.

/** A script word and when it's spoken, in seconds from the start of its line. */
export type SpokenWord = { text: string; start: number; end: number };

export const scriptWords = (text: string) => text.split(/\s+/).filter(Boolean);

// Case and punctuation don't decide a match: whisper writes "what's" where a script has "what’s", or "Show all," as "show all".
const normalWord = (word: string) => word.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Times each script word from whisper's words. An edit-distance alignment pairs them in order; a substitution still
 * lends its timing, and a script word with no partner shares the gap between its neighbours by length.
 */
export function alignSpokenWords(text: string, heard: readonly SpokenWord[], duration: number): SpokenWord[] {
  const script = scriptWords(text);
  const a = script.map(normalWord), b = heard.map((w) => normalWord(w.text));
  const n = a.length, m = b.length;
  const cost = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cost[i][j] = Math.min(cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }
  const partner: (SpokenWord | null)[] = new Array(n).fill(null);
  for (let i = n, j = m; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) partner[--i] = heard[--j];
    else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) i--;
    else j--;
  }
  return fillUnheard(script, partner, duration);
}

/** Words for a line with no audio yet, spread over its estimated duration by length. */
export const estimateSpokenWords = (text: string, duration: number) =>
  fillUnheard(scriptWords(text), scriptWords(text).map(() => null), duration);

function fillUnheard(script: string[], partner: (SpokenWord | null)[], duration: number): SpokenWord[] {
  const out: SpokenWord[] = [];
  for (let i = 0; i < script.length;) {
    const known = partner[i];
    if (known) {
      const start = Math.max(known.start, out.at(-1)?.end ?? 0);
      out.push({ text: script[i], start, end: Math.max(start, Math.min(known.end, duration)) });
      i++;
      continue;
    }
    let j = i;
    while (j < script.length && !partner[j]) j++;
    const from = out.at(-1)?.end ?? 0, to = Math.max(from, partner[j]?.start ?? duration);
    const lengths = script.slice(i, j).map((w) => w.length + 1), total = lengths.reduce((s, l) => s + l, 0);
    let at = from;
    for (let k = i; k < j; k++) {
      const end = at + ((to - from) * lengths[k - i]) / total;
      out.push({ text: script[k], start: at, end });
      at = end;
    }
    i = j;
  }
  return out;
}

/**
 * Where a word or phrase is spoken: from its first word's start to its last word's end. `nth` picks a later
 * occurrence, counting from 1. Throws with the line's words when there's no match, so a typo shows what's there.
 */
export function findSpokenPhrase(words: readonly SpokenWord[], phrase: string, nth = 1): { start: number; end: number } {
  const want = scriptWords(phrase).map(normalWord), have = words.map((w) => normalWord(w.text));
  let seen = 0;
  for (let i = 0; i + want.length <= have.length; i++) {
    if (want.every((w, k) => have[i + k] === w) && ++seen === nth) return { start: words[i].start, end: words[i + want.length - 1].end };
  }
  throw new Error(`"${phrase}"${nth > 1 ? ` (#${nth})` : ''} isn't in "${words.map((w) => w.text).join(' ')}"`);
}
