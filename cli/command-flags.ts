// command-flags.ts: what every command may do with its flags beyond what citty does: refuse one it doesn't define, and
// check an --out before the command does any work.
import type { ArgsDef } from 'citty';
import { existsSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Throws on a flag `args` doesn't define: citty would drop it, and a misspelt flag would run on its defaults. */
export function refuseUnknownCommandFlags(rawArgs: readonly string[], args: ArgsDef) {
  const flags = Object.entries(args).flatMap(([name, def]) => (def.type === 'positional' ? [] : [name]));
  for (const arg of rawArgs) {
    const name = arg.startsWith('--') ? arg.slice(2).split('=')[0] : null;
    if (name !== null && !flags.includes(name)) throw new Error(`--${name} isn't a flag of this command; it takes ${flags.map((flag) => `--${flag}`).join(', ')}`);
  }
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
