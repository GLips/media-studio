// storyboard-speech-edit.ts: review's restore and cut-again on a recorded line, written into the moments its
// `recording.speech(from, to, { keep, cut })` call names in storyboard.ts. Only that call's edits object changes, every
// other byte kept.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync, type Expression, type ObjectExpression } from 'oxc-parser';
import { propertyKeyName, stepInto, storyboardDeclarationIn, type StoryboardTextEditResult } from './storyboard-source-edit.ts';

/**
 * A moment (item seconds) added to a line's `keep` or `cut`, or every one of them between `within`'s seconds taken
 * out of it: what restores a removal, takes it out again, or forces one the cleanup left in.
 */
export type StoryboardSpeechEdit = { scene: string; line: string; list: 'keep' | 'cut' } & StoryboardSpeechChange;
export type StoryboardSpeechChange = { add: number } | { within: readonly [number, number] };

/** The new source; or why the edit can't be written. */
export type StoryboardSpeechEditResult = Extract<StoryboardTextEditResult, { source: string } | { refused: string }>;

const listItems = (node: Expression): number[] | undefined => {
  if (node.type !== 'ArrayExpression') return undefined;
  const values = node.elements.map((e) => (e?.type === 'Literal' && typeof e.value === 'number' ? e.value : undefined));
  return values.every((v) => v !== undefined) ? values : undefined;
};

/** `source` with the moments `edit` names in the line's speech call, every other byte kept. */
export function applyStoryboardSpeechEdit(source: string, edit: StoryboardSpeechEdit): StoryboardSpeechEditResult {
  const parsed = parseSync('storyboard.ts', source);
  if (parsed.errors.length) return { refused: `storyboard.ts doesn't parse: ${parsed.errors[0].message}` };
  const storyboard = storyboardDeclarationIn(parsed.program);
  if (!storyboard) return { refused: 'storyboard.ts has no defineStoryboard({...}) call with an object literal' };
  let node: Expression = storyboard;
  let at = '';
  for (const step of ['scenes', edit.scene, 'lines', edit.line, 'speech']) {
    const next = stepInto(node, step, at.slice(1) || 'the storyboard');
    if (typeof next === 'string') return { refused: next };
    node = next;
    at += `.${step}`;
  }
  const where = at.slice(1);
  if (node.type !== 'CallExpression' || node.arguments.length < 2 || node.arguments.length > 3) {
    return { refused: `${where} isn't written as a recording's speech(from, to, edits?) call: edit it in storyboard.ts` };
  }
  const edits = node.arguments[2];
  if (edits && edits.type !== 'ObjectExpression') return { refused: `${where}'s edits are computed: edit them in storyboard.ts` };
  const index = edits ? edits.properties.findLastIndex((p) => propertyKeyName(p) === edit.list) : -1;
  const property = edits?.properties[index];
  if (property && property.type !== 'Property') return { refused: `${where}'s ${edit.list} is spread in: edit it in storyboard.ts` };
  const items = property ? listItems(property.value) : [];
  if (!items) return { refused: `${where}'s ${edit.list} isn't an array of numbers: edit it in storyboard.ts` };

  const next = 'add' in edit ? [...items, edit.add].toSorted((a, b) => a - b) : items.filter((t) => t < edit.within[0] || t > edit.within[1]);
  if ('within' in edit && next.length === items.length) {
    return { refused: `${where}'s ${edit.list} names no moment from ${edit.within[0]} to ${edit.within[1]} s` };
  }
  const array = `[${next.join(', ')}]`;
  if (property) {
    if (next.length) return { source: source.slice(0, property.value.start) + array + source.slice(property.value.end) };
    return { source: dropProperty(source, edits!, index, node.arguments[1].end) };
  }
  const written = `${edit.list}: ${array}`;
  if (!edits) return { source: `${source.slice(0, node.arguments[1].end)}, { ${written} }${source.slice(node.arguments[1].end)}` };
  if (!edits.properties.length) return { source: `${source.slice(0, edits.start)}{ ${written} }${source.slice(edits.end)}` };
  return { source: `${source.slice(0, edits.properties[0].start)}${written}, ${source.slice(edits.properties[0].start)}` };
}

/** `source` without `property` and the comma after it; without the whole edits argument once it's left empty. */
function dropProperty(source: string, edits: ObjectExpression, k: number, afterTo: number): string {
  const { properties } = edits;
  if (properties.length === 1) return source.slice(0, afterTo) + source.slice(edits.end);
  // Written last, it takes the comma before it; else the comma and space after it.
  if (k === properties.length - 1) return source.slice(0, properties[k - 1].end) + source.slice(properties[k].end);
  return source.slice(0, properties[k].start) + source.slice(properties[k + 1].start);
}

/** Applies the edit to the project folder's storyboard.ts, writing the file only when the edit lands. */
export function editProjectStoryboardSpeech(project: string, edit: StoryboardSpeechEdit): { refused: string } | { edited: true } {
  const file = join(project, 'storyboard.ts');
  const result = applyStoryboardSpeechEdit(readFileSync(file, 'utf8'), edit);
  if (!('source' in result)) return result;
  writeFileSync(file, result.source);
  return { edited: true };
}
