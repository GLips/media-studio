// storyboard-lines-edit.ts: the plan page's structural line edits (split a spoken line in two, add one) written back
// into a project's storyboard.ts. Only the scene's lines object changes: the split line's text literal and cues are
// rewritten and the new line is inserted after it, every other byte kept.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync, type Expression, type ObjectExpression, type ObjectProperty } from 'oxc-parser';
import { findScriptPhrase, scriptWords, spokenText } from '#lib/timing/voice/models/voice-words.ts';
import {
  propertyKeyName, readStringLiteral, stepInto, storyboardDeclarationIn, writeStoryboardStringLiteral, type StoryboardTextEditResult,
} from './storyboard-source-edit.ts';

/**
 * A line split at the cursor (`first` stays under its id, `second` becomes a new line after it), or a new line after
 * `after`, or at the end of the scene's lines when `after` is null. `was` is the text the page showed.
 */
export type StoryboardLinesEdit =
  | { op: 'splitLine'; scene: string; line: string; was: string; first: string; second: string }
  | { op: 'addLine'; scene: string; after: string | null; text: string };

/** The new source and the new line's id; or the file's text when it isn't `was`; or why it can't be written. */
export type StoryboardLinesEditResult = { source: string; line: string } | Exclude<StoryboardTextEditResult, { source: string }>;

type LineCue = { name: string; raw: string; at: { phrase: string; nth: number } | 'start' | 'computed' };

/** The property written under `key`, the last when it's written twice, as in JS. */
function storyboardPropertyNamed(node: ObjectExpression, key: string): ObjectProperty | undefined {
  const found = node.properties.findLast((p) => propertyKeyName(p) === key);
  return found?.type === 'Property' ? found : undefined;
}

function numberLiteral(node: Expression | undefined): number | undefined {
  return node?.type === 'Literal' && typeof node.value === 'number' ? node.value : undefined;
}

function lineCuesOf(source: string, cues: ObjectExpression | undefined): LineCue[] | string {
  const out: LineCue[] = [];
  for (const property of cues?.properties ?? []) {
    const name = propertyKeyName(property);
    if (property.type !== 'Property' || name === undefined) return 'its cues are computed: split it in storyboard.ts';
    const raw = source.slice(property.value.start, property.value.end);
    const literal = readStringLiteral(property.value);
    if (literal) { out.push({ name, raw, at: { phrase: literal.value, nth: 1 } }); continue; }
    if (property.value.type !== 'ObjectExpression') { out.push({ name, raw, at: 'computed' }); continue; }
    if (storyboardPropertyNamed(property.value, 'at')) { out.push({ name, raw, at: 'start' }); continue; }
    const phrase = storyboardPropertyNamed(property.value, 'phrase');
    const phraseText = phrase && readStringLiteral(phrase.value);
    const nth = numberLiteral(storyboardPropertyNamed(property.value, 'nth')?.value) ?? 1;
    out.push({ name, raw, at: phraseText ? { phrase: phraseText.value, nth } : 'computed' });
  }
  return out;
}

const wordsOf = (text: string) => scriptWords(spokenText(text));

/** How many times `phrase` is said in `words`, so a moved cue's `nth` counts from its new line's start. */
function occurrences(words: readonly string[], phrase: string): number {
  let n = 0;
  while (findScriptPhrase(words, phrase, n + 1)) n++;
  return n;
}

const cueSource = (phrase: string, nth: number) =>
  nth === 1 ? writeStoryboardStringLiteral(phrase, "'") : `{ phrase: ${writeStoryboardStringLiteral(phrase, "'")}, nth: ${nth} }`;

const cuesSource = (entries: readonly [string, string][]) => `{ ${entries.map(([name, value]) => `${name}: ${value}`).join(', ')} }`;

/** Every line id the storyboard declares: ids are one namespace across scenes, as the voice manifest keys them. */
function lineIdsIn(scenes: Expression): Set<string> {
  const ids = new Set<string>();
  if (scenes.type !== 'ObjectExpression') return ids;
  for (const scene of scenes.properties) {
    if (scene.type !== 'Property' || scene.value.type !== 'ObjectExpression') continue;
    const lines = storyboardPropertyNamed(scene.value, 'lines')?.value;
    if (lines?.type !== 'ObjectExpression') continue;
    for (const line of lines.properties) {
      const id = propertyKeyName(line);
      if (id !== undefined) ids.add(id);
    }
  }
  return ids;
}

// Words that make a poor id on their own ("and", "then"): an id starts at the line's first word that isn't one.
const STORYBOARD_LINE_ID_FILLER = new Set(['a', 'an', 'and', 'the', 'then', 'so', 'but', 'or', 'to', 'of', 'in', 'on', 'it', 'its', 'is', 'we', 'you']);

/** A readable id from the line's first telling words (`leaveNotes`), unique across the storyboard. */
export function freshStoryboardLineId(text: string, taken: ReadonlySet<string>, fallback: string): string {
  const all = wordsOf(text).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
  const telling = all.findIndex((w) => !STORYBOARD_LINE_ID_FILLER.has(w));
  const words = telling === -1 ? all : all.slice(telling);
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    const id = words.slice(0, n).map((w, k) => (k === 0 ? w : w[0].toUpperCase() + w.slice(1))).join('');
    if (/^[a-z]/.test(id) && !taken.has(id)) return id;
  }
  for (let n = 2; ; n++) if (!taken.has(`${fallback}${n}`)) return `${fallback}${n}`;
}

/**
 * What goes between a line and a sibling inserted after it: a new line at its indent, or `, ` when the lines object
 * is written on one line with it (`lines: { intro: {...} }`).
 */
function siblingSeparator(source: string, lines: ObjectExpression, line: ObjectProperty): string {
  if (!source.slice(lines.start, line.start).includes('\n')) return ', ';
  const lineStart = source.lastIndexOf('\n', line.start - 1) + 1;
  return `,\n${/^[ \t]*/.exec(source.slice(lineStart, line.start))?.[0] ?? ''}`;
}

type Patch = { start: number; end: number; text: string };

function patched(source: string, patches: Patch[]): string {
  return patches.toSorted((a, b) => b.start - a.start).reduce((out, p) => out.slice(0, p.start) + p.text + out.slice(p.end), source);
}

export function applyStoryboardLinesEdit(source: string, edit: StoryboardLinesEdit): StoryboardLinesEditResult {
  const parsed = parseSync('storyboard.ts', source);
  if (parsed.errors.length) return { refused: `storyboard.ts doesn't parse: ${parsed.errors[0].message}` };
  const storyboard = storyboardDeclarationIn(parsed.program);
  if (!storyboard) return { refused: 'storyboard.ts has no defineStoryboard({...}) call with an object literal' };
  const scenes = stepInto(storyboard, 'scenes', 'the storyboard');
  if (typeof scenes === 'string') return { refused: scenes };
  const scene = stepInto(scenes, edit.scene, 'scenes');
  if (typeof scene === 'string') return { refused: scene };
  const lines = stepInto(scene, 'lines', `scenes.${edit.scene}`);
  if (typeof lines === 'string') return { refused: lines };
  if (lines.type !== 'ObjectExpression') return { refused: `scenes.${edit.scene}.lines isn't written as an object literal` };
  const taken = lineIdsIn(scenes);
  // The line the new one goes after: the split line, the one named, or the scene's last (none when it has no lines).
  const last = lines.properties.at(-1);
  const after = edit.op === 'splitLine' ? edit.line : edit.after ?? (last && propertyKeyName(last));
  const anchor = after === undefined ? undefined : storyboardPropertyNamed(lines, after);
  if (after !== undefined && !anchor) return { refused: `scenes.${edit.scene}.lines has no \`${after}\` written in it` };

  if (edit.op === 'addLine') {
    const id = freshStoryboardLineId(edit.text, taken, 'line');
    const entry = `${id}: { text: ${writeStoryboardStringLiteral(edit.text, "'")} }`;
    if (!anchor) {
      // An empty lines object: open it onto a line of its own.
      return { source: patched(source, [{ start: lines.start, end: lines.end, text: `{ ${entry} }` }]), line: id };
    }
    return { source: patched(source, [{ start: anchor.end, end: anchor.end, text: `${siblingSeparator(source, lines, anchor)}${entry}` }]), line: id };
  }

  // SAFETY: a split names its line, and the lookup above refused when it isn't there.
  const line = anchor!;
  if (line.value.type !== 'ObjectExpression') return { refused: `scenes.${edit.scene}.lines.${edit.line} isn't written as an object literal` };
  const textProperty = storyboardPropertyNamed(line.value, 'text');
  const literal = textProperty && readStringLiteral(textProperty.value);
  if (!textProperty || !literal) return { refused: `scenes.${edit.scene}.lines.${edit.line}.text isn't a string literal: split it in storyboard.ts` };
  if (literal.value !== edit.was) return { conflict: { current: literal.value } };
  const cuesProperty = storyboardPropertyNamed(line.value, 'cues');
  const cuesNode = cuesProperty?.value.type === 'ObjectExpression' ? cuesProperty.value : undefined;
  if (cuesProperty && !cuesNode) return { refused: `scenes.${edit.scene}.lines.${edit.line}.cues isn't written as an object literal` };
  const cues = lineCuesOf(source, cuesNode);
  if (typeof cues === 'string') return { refused: `scenes.${edit.scene}.lines.${edit.line}: ${cues}` };

  // A cue goes with the half its phrase is said in; one that straddles the split, or isn't said at all, stays with
  // the first, where the plan's diagnostics name it.
  const firstWords = wordsOf(edit.first), all = wordsOf(`${edit.first} ${edit.second}`);
  const stays: [string, string][] = [], moves: [string, string][] = [];
  for (const cue of cues) {
    const run = typeof cue.at === 'object' ? findScriptPhrase(all, cue.at.phrase, cue.at.nth) : null;
    if (typeof cue.at !== 'object' || !run || run[0] < firstWords.length) stays.push([cue.name, cue.raw]);
    else moves.push([cue.name, cueSource(cue.at.phrase, cue.at.nth - occurrences(firstWords, cue.at.phrase))]);
  }

  const id = freshStoryboardLineId(edit.second, taken, edit.line);
  const entry = `${id}: { text: ${writeStoryboardStringLiteral(edit.second, literal.quote)}${moves.length ? `, cues: ${cuesSource(moves)}` : ''} }`;
  const patches: Patch[] = [
    { start: textProperty.value.start, end: textProperty.value.end, text: writeStoryboardStringLiteral(edit.first, literal.quote) },
    { start: line.end, end: line.end, text: `${siblingSeparator(source, lines, line)}${entry}` },
  ];
  if (cuesNode && moves.length) patches.push({ start: cuesNode.start, end: cuesNode.end, text: stays.length ? cuesSource(stays) : '{}' });
  return { source: patched(source, patches), line: id };
}

/** Applies the edit to the project folder's storyboard.ts, writing the file only when the edit lands. */
export function editProjectStoryboardLines(project: string, edit: StoryboardLinesEdit): Exclude<StoryboardLinesEditResult, { source: string }> | { edited: true; line: string } {
  const file = join(project, 'storyboard.ts');
  const result = applyStoryboardLinesEdit(readFileSync(file, 'utf8'), edit);
  if (!('source' in result)) return result;
  writeFileSync(file, result.source);
  return { edited: true, line: result.line };
}
