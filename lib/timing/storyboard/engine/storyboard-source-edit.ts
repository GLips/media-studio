// storyboard-source-edit.ts: the plan page's text edits written back into a project's storyboard.ts. Only the edited
// string literal's span is replaced, so comments, formatting and every other byte stay as written.
//
// Parsed with oxc-parser, not the TypeScript compiler API: the installed TypeScript 7 has no in-process parser.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync, Visitor, type Expression, type ObjectExpression, type ObjectPropertyKind, type Program, type PropertyKey, type StringLiteral } from 'oxc-parser';

/** One plan text the page edits, with `was`, the text the page showed, so an edit over a changed file is refused. */
export type StoryboardTextEdit =
  | { field: 'onScreen' | 'motion'; scene: string; was: string; text: string }
  | { field: 'reads'; scene: string; index: number; was: string; text: string }
  | { field: 'line'; scene: string; line: string; was: string; text: string }
  | { field: 'brief'; section: string; was: string; text: string }
  | { field: 'leftOut'; index: number; was: string; text: string };

/** The new source; or the file's value when it isn't `was`; or why the edit can't be written. */
export type StoryboardTextEditResult = { source: string } | { conflict: { current: string } } | { refused: string };

type PathStep = string | number;

/** The storyboard path an edit writes, from the `defineStoryboard({...})` object down. */
function storyboardTextEditPath(edit: StoryboardTextEdit): PathStep[] {
  if (edit.field === 'brief') return ['brief', edit.section];
  if (edit.field === 'leftOut') return ['leftOut', edit.index];
  if (edit.field === 'reads') return ['scenes', edit.scene, 'reads', edit.index];
  if (edit.field === 'line') return ['scenes', edit.scene, 'lines', edit.line, 'text'];
  return ['scenes', edit.scene, edit.field];
}

/** The object literal the storyboard is written as: `defineStoryboard`'s first argument. */
function storyboardDeclarationIn(program: Program): ObjectExpression | undefined {
  let found: ObjectExpression | undefined;
  new Visitor({
    CallExpression(call) {
      const [first] = call.arguments;
      if (!found && call.callee.type === 'Identifier' && call.callee.name === 'defineStoryboard' && first?.type === 'ObjectExpression') found = first;
    },
  }).visit(program);
  return found;
}

function isStringLiteral(node: Expression | PropertyKey): node is StringLiteral {
  return node.type === 'Literal' && typeof node.value === 'string';
}

function propertyKeyName(property: ObjectPropertyKind): string | undefined {
  if (property.type !== 'Property' || property.computed) return undefined;
  if (property.key.type === 'Identifier') return property.key.name;
  return isStringLiteral(property.key) ? property.key.value : undefined;
}

/** The node at `step` under `node`, or a refusal naming where the walk stopped. The last same-named key wins, as in JS. */
function stepInto(node: Expression, step: PathStep, at: string): Expression | string {
  if (typeof step === 'number') {
    if (node.type !== 'ArrayExpression') return `${at} isn't written as an array literal`;
    const element = node.elements[step];
    if (!element) return `${at} has no item ${step}`;
    return element.type === 'SpreadElement' ? `${at}[${step}] is a spread` : element;
  }
  if (node.type !== 'ObjectExpression') return `${at} isn't written as an object literal`;
  const property = node.properties.findLast((p) => propertyKeyName(p) === step);
  return property?.type === 'Property' ? property.value : `${at} has no \`${step}\` written in it`;
}

/** A string literal's value and quote, or undefined for anything computed. */
function readStringLiteral(node: Expression): { value: string; quote: Quote } | undefined {
  // SAFETY: a parsed string literal's raw text starts with its quote.
  if (isStringLiteral(node)) return { value: node.value, quote: node.raw![0] as Quote };
  if (node.type !== 'TemplateLiteral' || node.expressions.length > 0) return undefined;
  // A template's cooked value is null only for an invalid escape, which parses only in a tagged template.
  const cooked = node.quasis[0]?.value.cooked;
  return cooked === undefined || cooked === null ? undefined : { value: cooked, quote: '`' };
}

type Quote = "'" | '"' | '`';

function storyboardQuoteFor(text: string, original: Quote): Quote {
  if (text.includes('\n')) return '`';
  if (original === '`') return original;
  const other = original === "'" ? '"' : "'";
  return text.includes(original) && !text.includes(other) ? other : original;
}

/**
 * `text` as a literal in the original's quote, escaped. Multi-line text goes in a template, as briefs are written; a
 * quoted string whose text holds its own quote mark but not the other flips to the other, so it needs no escape.
 */
function writeStoryboardStringLiteral(text: string, original: Quote): string {
  const quote = storyboardQuoteFor(text, original);
  let body = text.replaceAll('\\', '\\\\').replaceAll('\r', '\\r');
  body = quote === '`'
    ? body.replaceAll('`', '\\`').replaceAll('${', '\\${')
    : body.replaceAll(quote, `\\${quote}`).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return `${quote}${body}${quote}`;
}

/** `source` with the edit's literal rewritten, every other byte kept. */
export function applyStoryboardTextEdit(source: string, edit: StoryboardTextEdit): StoryboardTextEditResult {
  const parsed = parseSync('storyboard.ts', source);
  if (parsed.errors.length) return { refused: `storyboard.ts doesn't parse: ${parsed.errors[0].message}` };
  const storyboard = storyboardDeclarationIn(parsed.program);
  if (!storyboard) return { refused: 'storyboard.ts has no defineStoryboard({...}) call with an object literal' };
  let node: Expression = storyboard;
  // Each step appends `.key` or `[index]`; the path always starts at a key, so `at.slice(1)` drops its leading dot.
  let at = '';
  for (const step of storyboardTextEditPath(edit)) {
    const next = stepInto(node, step, at.slice(1) || 'the storyboard');
    if (typeof next === 'string') return { refused: next };
    node = next;
    at += typeof step === 'number' ? `[${step}]` : `.${step}`;
  }
  const literal = readStringLiteral(node);
  if (!literal) return { refused: `${at.slice(1)} is computed, not a string literal: edit it in storyboard.ts` };
  if (literal.value !== edit.was) return { conflict: { current: literal.value } };
  return { source: source.slice(0, node.start) + writeStoryboardStringLiteral(edit.text, literal.quote) + source.slice(node.end) };
}

/** Applies the edit to the project folder's storyboard.ts, writing the file only when the edit lands. */
export function editProjectStoryboardText(project: string, edit: StoryboardTextEdit): Exclude<StoryboardTextEditResult, { source: string }> | { edited: true } {
  const file = join(project, 'storyboard.ts');
  const result = applyStoryboardTextEdit(readFileSync(file, 'utf8'), edit);
  if (!('source' in result)) return result;
  writeFileSync(file, result.source);
  return { edited: true };
}
