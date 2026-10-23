// command-flags.ts: what every command may do with its flags beyond what citty does: refuse one it doesn't define, and
// check an --out before the command does any work.
import type { ArgsDef } from 'citty';
import { existsSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Throws on an option `args` doesn't define: citty would drop it, and a misspelt one would run on its defaults. A
 * single-dash option must be a defined alias, so `-dry` for `--dry` fails rather than run without it.
 */
export function refuseUnknownCommandFlags(rawArgs: readonly string[], args: ArgsDef) {
  const flags = Object.entries(args).flatMap(([name, def]) => (def.type === 'positional' ? [] : [name]));
  const aliases = new Set(Object.values(args).flatMap((def) => (def.type === 'positional' || !('alias' in def) ? [] : [def.alias ?? []].flat())));
  const takes = () => `it takes ${flags.map((flag) => `--${flag}`).join(', ') || 'no options'}`;
  for (const arg of rawArgs) {
    if (arg === '--') return;
    if (arg.startsWith('--')) {
      const name = arg.slice(2).split('=')[0];
      if (!flags.includes(name)) throw new Error(`--${name} isn't a flag of this command; ${takes()}`);
    } else if (/^-[^\d.]/.test(arg) && !aliases.has(arg.slice(1).split('=')[0])) {
      throw new Error(`${arg} isn't an option of this command (flags take two dashes); ${takes()}`);
    }
  }
}

/**
 * A command's `setup` for one with subcommands: refuses an option before the subcommand's name, which citty would
 * drop, so `studio voice --dry sync` fails rather than run a sync for real.
 */
export function refuseOptionsBeforeSubcommand({ rawArgs }: { rawArgs: readonly string[] }) {
  const named = rawArgs.findIndex((arg) => !arg.startsWith('-'));
  const before = rawArgs.slice(0, named < 0 ? rawArgs.length : named).filter((arg) => arg !== '--');
  if (before.length) throw new Error(`${before.join(' ')} goes after the command it's for: put it after the last command word`);
}

/**
 * The absolute path an --out names, resolved against `base`: a file with one of `writes`' extensions (lower case, with
 * the dot), or a folder, in a folder that exists or inside `madeIn` (a project's out/, which the studio makes). Checked
 * before the GPU queue, so a folder, misspelt or doubled --out fails in seconds, not after the work.
 */
export function checkedCommandOutFlag(out: string, { base, writes, madeIn }: { base: string; writes: readonly string[] | 'folder'; madeIn?: string }): string {
  const path = resolve(base, out);
  if (writes === 'folder') {
    if (existsSync(path) && !isFolder(path)) throw new Error(`--out is the folder to write into, and ${out} is a file`);
  } else {
    const kinds = writes.length > 1 ? `${writes.slice(0, -1).join(', ')} or ${writes.at(-1)}` : writes[0];
    if (isFolder(path)) throw new Error(`--out is the ${kinds} file to write, and ${out} is a folder: name a file in it`);
    if (!writes.includes(extname(path).toLowerCase())) throw new Error(`--out is the ${kinds} file to write, not ${out}`);
  }
  const folder = dirname(path);
  if (!isFolder(folder) && !(madeIn !== undefined && isWithin(madeIn, folder))) {
    const from = isAbsolute(out) ? '' : ` (a relative --out starts at ${base})`;
    throw new Error(`--out's folder ${folder} doesn't exist${from}: make it, or write into one that does`);
  }
  return path;
}

const isFolder = (path: string) => existsSync(path) && statSync(path).isDirectory();

/** Whether `path` is `root` or lies inside it. */
function isWithin(root: string, path: string) {
  const climb = relative(root, path);
  return climb.split(sep)[0] !== '..' && !isAbsolute(climb);
}
