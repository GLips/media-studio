import { spawn } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'citty';
import { studioCommandArguments } from './command-help.ts';
import { studioCommand } from './studio-command.ts';
import { onStudioSignalExit } from '#lib/platform/process/engine/studio-signal-exit.ts';
import { readFrozenProjectRecord } from '#lib/platform/project/engine/frozen-project-record.ts';
import { resolveStudioProject } from '#lib/platform/project/engine/studio-project.ts';

const verbs = new Set(['render', 'still', 'look', 'preview']);

/** Dispatch before loading the render implementation: an old engine may have an entirely different CLI. */
export async function runFrozenRender([verb, ...args]: string[]): Promise<boolean> {
  const command = verb === 'stills' ? 'still' : verb;
  if (!verbs.has(command)) return false;
  const schema = await studioCommandArguments(studioCommand, [command]);
  const parsed = parseArgs(args, schema);
  const project = resolveStudioProject(String(parsed.project));
  const record = readFrozenProjectRecord(project);
  if (!record) return false;
  const { withFrozenEngine } = await import('#lib/platform/project/engine/frozen-engine-checkout.ts');
  await withFrozenEngine({ project, record }, (root, name) => new Promise<void>((done, reject) => {
    const forwarded = args.slice();
    const positional = args.findIndex((arg, index) => arg === parsed.project && parseArgs(args.with(index, name), schema).project === name);
    forwarded[positional] = name;
    if (typeof parsed.out === 'string') {
      const destination = resolve(project, parsed.out);
      if (relative(join(project, 'out'), destination).split(sep)[0] === '..') {
        const flag = forwarded.findIndex((arg) => arg === '--out' || arg.startsWith('--out='));
        if (forwarded[flag] === '--out') forwarded[flag + 1] = destination;
        else forwarded[flag] = `--out=${destination}`;
      }
    }
    const child = spawn(process.execPath, [join(root, 'cli/studio.ts'), command, ...forwarded], { cwd: root, stdio: 'inherit' });
    const remove = onStudioSignalExit(() => new Promise<void>((closed) => {
      child.once('exit', () => closed());
      child.kill('SIGTERM');
    }));
    child.once('error', (error) => { remove(); reject(error); });
    child.once('exit', (code) => { remove(); process.exitCode = code ?? 1; done(); });
  }));
  return true;
}
