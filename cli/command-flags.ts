// command-flags.ts: what every command may do with its flags beyond what citty does: refuse one it doesn't define.
import type { ArgsDef } from 'citty';

/** Throws on a flag `args` doesn't define: citty would drop it, and a misspelt flag would run on its defaults. */
export function refuseUnknownCommandFlags(rawArgs: readonly string[], args: ArgsDef) {
  const flags = Object.entries(args).flatMap(([name, def]) => (def.type === 'positional' ? [] : [name]));
  for (const arg of rawArgs) {
    const name = arg.startsWith('--') ? arg.slice(2).split('=')[0] : null;
    if (name !== null && !flags.includes(name)) throw new Error(`--${name} isn't a flag of this command; it takes ${flags.map((flag) => `--${flag}`).join(', ')}`);
  }
}
