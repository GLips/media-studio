// Every `studio … --help` as an agent in another project reads it: run from a folder outside any checkout, piped, it
// exits 0 and prints the whole page, every flag included. The root index is short enough to read whole, each summary
// is a line, and no page points at a path that resolves only inside this checkout.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { walkStudioCommands } from './command-help.ts';
import { STUDIO_VERB_GROUPS, studioCommand } from './studio-command.ts';

const run = promisify(execFile);
const STUDIO_ENTRY = fileURLToPath(new URL('./studio.ts', import.meta.url));
const STUDIO_ROOT_HELP_MAX_LINES = 60;
const STUDIO_SUMMARY_MAX_WORDS = 20;
const CHECKOUT_ONLY_PATH = /\b(?:docs|skills|harness)\/|npm run |node cli\//;

test('every command\'s --help, run piped from outside a checkout, exits 0 and prints its whole page', async () => {
  const commands = await walkStudioCommands(studioCommand);
  const pages = await withStudioTemp('studio-help', (cwd) => Promise.all(commands.map(async (command) => {
    // execFile rejects on a non-zero exit, so a page that comes back is one that exited 0.
    const { stdout } = await run(process.execPath, [STUDIO_ENTRY, ...command.path, '--help'], { cwd });
    return { command, page: stdout };
  })));
  for (const { command: { path, args }, page } of pages) {
    const name = `studio ${path.join(' ')}`.trim();
    assert.ok(page.endsWith('\n'), `${name} --help stops mid-line`);
    assert.doesNotMatch(page, CHECKOUT_ONLY_PATH, `${name} --help names a path only this checkout has`);
    if (path.length === 0) {
      assert.ok(page.split('\n').length <= STUDIO_ROOT_HELP_MAX_LINES, `studio --help runs to ${page.split('\n').length} lines`);
      for (const verb of Object.values(STUDIO_VERB_GROUPS).flat()) assert.match(page, new RegExp(`^ {2}${verb} `, 'm'), `studio --help leaves out ${verb}`);
      continue;
    }
    const summary = page.split('\n\n')[1] ?? '';
    assert.ok(summary.split(/\s+/).length <= STUDIO_SUMMARY_MAX_WORDS, `${name}'s summary runs past ${STUDIO_SUMMARY_MAX_WORDS} words: ${summary}`);
    // The last flag is the tail a truncated pipe loses first; every one is checked.
    for (const [flag, arg] of Object.entries(args)) {
      if (arg.type !== 'positional') assert.match(page, new RegExp(`--(?:\\[no-\\])?${flag}\\b`), `${name} --help leaves out --${flag}`);
    }
  }
});

test('a word naming no command, or a verb and subverb quoted as one word, is refused with the commands it could be', async () => {
  const cases = [[['music gen', '--help'], /^studio: no command "music gen"; one of .*\bmusic\b/], [['review', 'bogus'], /^studio review: no command "bogus"; one of open, notes/]] as const;
  const refusals = await Promise.all(cases.map(([args]) => run(process.execPath, [STUDIO_ENTRY, ...args]).then(() => null, (error: { code: number; stderr: string }) => error)));
  for (const [i, [args, said]] of cases.entries()) {
    const refused = refusals[i];
    assert.ok(refused !== null && refused.code === 1, `studio ${args.join(' ')} exits 1`);
    assert.match(refused.stderr, said);
  }
});
