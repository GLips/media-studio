// command-help.ts: `studio … --help`, rendered here rather than by citty. A command's meta.description is its summary,
// the one line every index shows; meta.about is the body only its own --help prints. citty pads every index row to
// its longest description and exits before a piped stdout drains, so neither its usage nor its runMain is used.
import type { ArgDef, ArgsDef, CommandDef, CommandMeta, SubCommandsDef } from 'citty';

declare module 'citty' {
  interface CommandMeta {
    /** What its own --help says after the summary: its modes, outputs and failures, in blank-line paragraphs. */
    about?: string;
  }
}

/** The verbs of the root index, under the group headings they're listed by. */
export type StudioVerbGroups = Readonly<Record<string, readonly string[]>>;

const HELP_WIDTH = 120;

/** `text` wrapped to HELP_WIDTH, every line starting with `indent`; its blank-line paragraphs and `- ` items kept. */
function wrapHelpText(text: string, indent: string): string[] {
  const out: string[] = [];
  for (const paragraph of text.trim().split(/\n\s*\n/)) {
    if (out.length) out.push('');
    for (const line of paragraph.split('\n')) out.push(...wrapHelpLine(line.trim(), indent, /^\s*- /.test(line) ? `${indent}  ` : indent));
  }
  return out;
}

/** `line`'s words after the prefix `first`, wrapped to HELP_WIDTH, each later line starting with `rest`. */
function wrapHelpLine(line: string, first: string, rest: string): string[] {
  const out: string[] = [];
  let current = first, words = 0;
  for (const word of line.split(/\s+/).filter(Boolean)) {
    if (words > 0 && current.length + 1 + word.length > HELP_WIDTH) {
      out.push(current);
      current = rest + word;
    } else {
      current = words > 0 ? `${current} ${word}` : current + word;
    }
    words++;
  }
  out.push(current);
  return out;
}

// SAFETY: citty's Resolvable is a value, a promise of one, or a function returning either; no command's meta, args
// or subcommands is itself a function value.
const resolveHelpValue = async <T>(value: T | Promise<T> | (() => T | Promise<T>)): Promise<T> => (typeof value === 'function' ? (value as () => T | Promise<T>)() : value);

async function commandMeta(command: CommandDef): Promise<CommandMeta> {
  return (await resolveHelpValue(command.meta)) ?? {};
}

/** A command's subcommands an index lists, by name, with their meta: those not marked hidden. */
async function visibleSubCommands(command: CommandDef): Promise<{ name: string; meta: CommandMeta }[]> {
  const subs: SubCommandsDef = (await resolveHelpValue(command.subCommands)) ?? {};
  const resolved = await Promise.all(Object.entries(subs).map(async ([name, sub]) => ({ name, meta: await commandMeta(await resolveHelpValue(sub)) })));
  return resolved.filter(({ meta }) => !meta.hidden);
}

function flagUsage(name: string, arg: ArgDef): string {
  // A flag on by default is given as --no-<name> to turn it off.
  if (arg.type === 'boolean') return arg.default === true ? `--[no-]${name}` : `--${name}`;
  if (arg.type === 'enum') return `--${name} <${(arg.options ?? []).join('|')}>`;
  return `--${name} <${arg.valueHint ?? name}>`;
}

function argNotes(arg: ArgDef): string {
  const notes = [arg.required === true && arg.default === undefined && arg.type !== 'positional' ? 'required' : '', arg.default === undefined || arg.default === false ? '' : `default ${String(arg.default)}`];
  const given = notes.filter(Boolean);
  return given.length ? ` (${given.join('; ')})` : '';
}

/** One command's --help: usage, summary, its about, its arguments and flags, and its visible subcommands. */
async function renderStudioCommandHelp(path: readonly string[], command: CommandDef): Promise<string> {
  const meta = await commandMeta(command);
  const args: ArgsDef = (await resolveHelpValue(command.args)) ?? {};
  const subs = await visibleSubCommands(command);
  const positionals = Object.entries(args).filter(([, arg]) => arg.type === 'positional');
  const flags = Object.entries(args).filter(([, arg]) => arg.type !== 'positional');
  const usage = [
    'studio', ...path, ...(subs.length ? [`<${subs.map(({ name }) => name).join('|')}>`] : []),
    ...positionals.map(([name, arg]) => (arg.required === false || arg.default !== undefined ? `[${name}]` : `<${name}>`)),
    ...(flags.length ? ['[flags]'] : []),
  ].join(' ');
  const lines = [usage, '', ...wrapHelpText(meta.description ?? '', '')];
  if (meta.about) lines.push('', ...wrapHelpText(meta.about, ''));
  if (positionals.length) {
    lines.push('', 'Arguments');
    for (const [name, arg] of positionals) lines.push(...wrapHelpLine(`${arg.description ?? ''}${argNotes(arg)}`, `  <${name}>  `, '      '));
  }
  if (flags.length) {
    lines.push('', 'Flags');
    for (const [name, arg] of flags) {
      lines.push(`  ${flagUsage(name, arg)}${argNotes(arg)}`, ...wrapHelpText(arg.description ?? '', '      '));
    }
  }
  if (subs.length) {
    const width = Math.max(...subs.map(({ name }) => name.length)) + 2;
    lines.push('', 'Commands');
    for (const { name, meta: sub } of subs) lines.push(...wrapHelpLine(sub.description ?? '', `  ${name.padEnd(width)}`, ' '.repeat(width + 2)));
    lines.push('', `Run \`studio ${path.join(' ')} <command> --help\` for one.`);
  }
  return `${lines.join('\n')}\n`;
}

/** The root index: each group's verbs, one line each, a verb's subcommands named after its summary. */
async function renderStudioRootHelp(root: CommandDef, groups: StudioVerbGroups): Promise<string> {
  const meta = await commandMeta(root);
  const subs: SubCommandsDef = (await resolveHelpValue(root.subCommands)) ?? {};
  const grouped = Object.values(groups).flat();
  const unlisted = Object.keys(subs).filter((verb) => !grouped.includes(verb));
  if (unlisted.length) throw new Error(`studio's root index has no group for ${unlisted.join(', ')}: add it to STUDIO_VERB_GROUPS`);
  const width = Math.max(...grouped.map((verb) => verb.length)) + 2;
  const rows = new Map(await Promise.all(grouped.map(async (verb) => {
    const command: CommandDef = await resolveHelpValue(subs[verb]);
    const children = (await visibleSubCommands(command)).map(({ name }) => name);
    const summary = `${(await commandMeta(command)).description ?? ''}${children.length ? ` [${children.join(', ')}]` : ''}`;
    return [verb, wrapHelpLine(summary, `  ${verb.padEnd(width)}`, ' '.repeat(width + 2))] as const;
  })));
  const lines = ['studio <verb> [<subverb>] [<project>] [flags]', '', ...wrapHelpText(meta.description ?? '', '')];
  for (const [group, verbs] of Object.entries(groups)) lines.push('', group, ...verbs.flatMap((verb) => rows.get(verb) ?? []));
  if (meta.about) lines.push('', ...wrapHelpText(meta.about, ''));
  return `${lines.join('\n')}\n`;
}

/**
 * Prints the help `rawArgs` asks for: the deepest command its words name, or the root index. Written without exiting,
 * so a piped reader gets all of it.
 */
export async function printStudioHelp(root: CommandDef, groups: StudioVerbGroups, rawArgs: readonly string[]): Promise<void> {
  const { path, command } = await namedStudioCommand(root, rawArgs.filter((arg) => !arg.startsWith('-')), []);
  process.stdout.write(path.length ? await renderStudioCommandHelp(path, command) : await renderStudioRootHelp(root, groups));
}

/** Whether `rawArgs` name only a command with subcommands and nothing to run (`studio review`), so want its help. */
export async function namesStudioCommandGroup(root: CommandDef, rawArgs: readonly string[]): Promise<boolean> {
  const { command } = await namedStudioCommand(root, rawArgs.filter((arg) => !arg.startsWith('-')), []);
  return command.subCommands !== undefined && command.run === undefined;
}

/**
 * The refusal for a word where a command with nothing to run needs one of its subcommands (`studio bogus`, or
 * `studio "music gen"` quoted as one word), or null when `rawArgs` name a command.
 */
export async function strayStudioCommandWord(root: CommandDef, rawArgs: readonly string[]): Promise<string | null> {
  const words = rawArgs.filter((arg) => !arg.startsWith('-'));
  const { path, command } = await namedStudioCommand(root, words, []);
  const stray = words[path.length];
  if (stray === undefined || command.run !== undefined) return null;
  const subs = Object.keys((await resolveHelpValue(command.subCommands)) ?? {});
  return `studio${path.map((word) => ` ${word}`).join('')}: no command "${stray}"; one of ${subs.join(', ')}`;
}

/** One command of the tree, resolved: the words naming it, its meta and args, its subcommands' names, whether it runs. */
export type StudioCommandNode = {
  path: readonly string[];
  meta: CommandMeta;
  args: ArgsDef;
  subCommands: readonly string[];
  runs: boolean;
};

/** Every command under `root`, itself first and hidden ones included, each one's lazy parts resolved. */
export async function walkStudioCommands(root: CommandDef, path: readonly string[] = []): Promise<StudioCommandNode[]> {
  const subs: SubCommandsDef = (await resolveHelpValue(root.subCommands)) ?? {};
  const node: StudioCommandNode = {
    path, meta: await commandMeta(root), args: (await resolveHelpValue(root.args)) ?? {}, subCommands: Object.keys(subs), runs: root.run !== undefined,
  };
  const children = await Promise.all(Object.entries(subs).map(async ([name, sub]) => walkStudioCommands(await resolveHelpValue(sub), [...path, name])));
  return [node, ...children.flat()];
}

/** The deepest command `words` name from `command` down, and the words that named it. */
async function namedStudioCommand(command: CommandDef, words: readonly string[], path: readonly string[]): Promise<{ path: readonly string[]; command: CommandDef }> {
  const subs: SubCommandsDef = (await resolveHelpValue(command.subCommands)) ?? {};
  const [word, ...rest] = words;
  if (word === undefined || !Object.hasOwn(subs, word)) return { path, command };
  return namedStudioCommand(await resolveHelpValue(subs[word]), rest, [...path, word]);
}
