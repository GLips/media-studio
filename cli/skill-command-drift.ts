// skill-command-drift.ts: the `studio …` commands a skill writes in code, held to the command tree, so a renamed verb
// or flag fails a spec instead of an agent's run. citty ignores a flag it doesn't know, so a stale one in a skill would
// otherwise do nothing, silently. Only code is read (inline spans and fenced blocks), never executed.
//
// Placeholders (`<project>`, `[flags]`, `…`) stand for a word; one where a subverb goes leaves the rest unresolvable,
// which is reported as unsupported rather than guessed at. Shell around a command (`|`, `&&`, `;`, `)`, `>`, `#`)
// ends it.
import type { ArgDef } from 'citty';
import type { StudioCommandNode } from './command-help.ts';

export type StudioInvocation = { line: number; text: string; words: readonly string[] };
export type StudioInvocationVerdict = { kind: 'ok' } | { kind: 'drift' | 'unsupported'; reason: string };

const UNIVERSAL_FLAGS = new Set(['--help', '-h']);
/** `studio` as a command word: at the start, or after whitespace, `(`, or a shell operator. */
const STUDIO_WORD = /(?:^|[\s(;&|])studio(?=\s|$)/g;
const SHELL_STOP = /^(?:\||\|\||&&|;|\)|>|>>|2>|2>&1|<|#.*)$/;

/** Each code region of a Markdown file: a fenced block's logical lines (`\` continuations joined), or an inline span. */
function markdownCodeRegions(markdown: string): { line: number; text: string }[] {
  const regions: { line: number; text: string }[] = [];
  let fenced = false, pending: { line: number; text: string } | undefined;
  markdown.split('\n').forEach((raw, index) => {
    if (/^\s*(?:```|~~~)/.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (fenced) {
      const continued = raw.endsWith('\\');
      const text = continued ? raw.slice(0, -1) : raw;
      pending = pending ? { line: pending.line, text: `${pending.text} ${text}` } : { line: index + 1, text };
      if (!continued) {
        regions.push(pending);
        pending = undefined;
      }
      return;
    }
    for (const [, , span] of raw.matchAll(/(`+)(.+?)\1/g)) regions.push({ line: index + 1, text: span });
  });
  return regions;
}

/** A command's words, shell-style: quotes group, and the first shell operator ends it. */
function shellWords(text: string): string[] {
  const words: string[] = [];
  for (const [token] of text.matchAll(/"[^"]*"|'[^']*'|<[^<>]*>\S*|\S+/g)) {
    if (SHELL_STOP.test(token)) break;
    const stop = /[|;)]|&&|\$\(/.exec(token);
    if (stop && !/^["']/.test(token)) {
      if (stop.index > 0) words.push(token.slice(0, stop.index));
      break;
    }
    words.push(token.replace(/^(["'])(.*)\1$/, '$2'));
  }
  return words;
}

/** Every `studio …` command a skill's code writes. */
export function studioInvocationsIn(markdown: string): StudioInvocation[] {
  return markdownCodeRegions(markdown).flatMap(({ line, text }) =>
    [...text.matchAll(STUDIO_WORD)].map((match) => {
      const rest = text.slice(match.index + match[0].length);
      return { line, text: `studio${rest}`.trim(), words: shellWords(rest) };
    }));
}

/** A word standing for one the reader fills in. */
const isPlaceholder = (word: string) => /^<.*>$|^\[.*\]$|…|\.\.\.|^\$|^\{.*\}$/.test(word);

/** citty reads `--dry-run` and `--dryRun` as one flag. */
const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** The arg a flag word names, by its name, an alias, or `--no-<name>` for a boolean; undefined for none. */
function flagArg(node: StudioCommandNode, flag: string): ArgDef | undefined {
  const bare = flag.replace(/^--?/, '').split('=')[0];
  for (const [name, arg] of Object.entries(node.args)) {
    if (arg.type === 'positional') continue;
    const aliases = [('alias' in arg ? arg.alias : undefined) ?? []].flat();
    if ([name, ...aliases].some((candidate) => camel(candidate) === camel(bare))) return arg;
    if (arg.type === 'boolean' && bare === `no-${name}`) return arg;
  }
  return undefined;
}

/** Whether `invocation` names a verb, subverbs and flags the tree has: the tree as `walkStudioCommands` gives it. */
export function judgeStudioInvocation(tree: readonly StudioCommandNode[], invocation: StudioInvocation): StudioInvocationVerdict {
  const at = (path: readonly string[]) => tree.find((node) => node.path.join(' ') === path.join(' '));
  let node = at([])!, resolved = true;
  const words = invocation.words.map((word) => word.replace(/^\[|\]$/g, '')).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const path = `studio ${node.path.join(' ')}`.replace(/ $/, '');
    if (word.startsWith('-') && word !== '-') {
      if (UNIVERSAL_FLAGS.has(word)) continue;
      if (!resolved) return { kind: 'unsupported', reason: `${word} after a placeholder subverb` };
      const arg = flagArg(node, word);
      if (!arg) return { kind: 'drift', reason: `${path} has no flag ${word.split('=')[0]}` };
      if (arg.type === 'boolean' || word.includes('=')) continue;
      const value = words[i + 1];
      if (value === undefined || value.startsWith('--')) continue;
      i++;
      const options = arg.type === 'enum' ? arg.options ?? [] : [];
      if (options.length && !isPlaceholder(value) && !options.includes(value)) return { kind: 'drift', reason: `${path} ${word} takes ${options.join('|')}, not ${value}` };
      continue;
    }
    if (!resolved || !node.subCommands.length) continue;
    const child = at([...node.path, word]);
    if (child) {
      node = child;
    } else if (isPlaceholder(word)) {
      // A placeholder stands for a positional where the command runs, for an unknown subverb where it only groups.
      resolved = node.runs;
    } else if (!node.runs) {
      return { kind: 'drift', reason: `${path} has no subverb ${word} (it has ${node.subCommands.join(', ')})` };
    }
  }
  return { kind: 'ok' };
}
