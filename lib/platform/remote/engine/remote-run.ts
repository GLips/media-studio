// remote-run.ts: `studio remote run`, from this machine: package.json's scripts run in CPU-only containers on the
// deployed app (modal_remote_app.py's StudioCheckServer), each in its own, all at once, against this checkout as it
// is on disk: both repositories, uncommitted and untracked files included, as remote-upload.ts's checkout upload
// gathers them. Each script's output streams here as it comes, marked with its name when there are several. Node only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import type { RemoteBilledCall } from '../models/remote-cost.ts';
import { remoteRunRefusal, remoteRunSizeOf } from '../models/remote-run.ts';
import { openRemoteConnection, printRemoteBilling } from './remote-call.ts';
import { remoteOutputLines } from './remote-modal.ts';
import { remoteCheckoutUpload } from './remote-upload.ts';

/** How a script ran: its exit code (null when its call failed, `error` saying why), and where the time went. */
export type RemoteScriptOutcome = {
  readonly script: string; readonly exitCode: number | null; readonly error?: string;
  /** Seconds the script ran, and the call took from here; what the container did before it ran. */
  readonly seconds?: number; readonly callSeconds: number; readonly setup?: string; readonly cold?: boolean;
};

const isScriptCommand = (value: unknown): value is string => typeof value === 'string';

function hasPackageScripts(value: unknown): value is { readonly scripts: Readonly<Record<string, string>> } {
  return typeof value === 'object' && value !== null && 'scripts' in value && typeof value.scripts === 'object' && value.scripts !== null &&
    Object.values(value.scripts).every(isScriptCommand);
}

/** package.json's scripts, by name. */
function packageScripts(): Readonly<Record<string, string>> {
  const read: unknown = JSON.parse(readFileSync(join(STUDIO_ROOT, 'package.json'), 'utf8'));
  if (!hasPackageScripts(read)) throw new Error('package.json has no scripts for studio remote run to run');
  return read.scripts;
}

/**
 * Runs each of `scripts` remotely, at once, its output streamed to stdout, and prints what each container billed on
 * stderr. Refuses up front, before anything uploads, a script package.json lacks or one that must run here. Returns how
 * each ran; formatRemoteRunOutcomes says it.
 */
export async function runRemoteScripts(scripts: readonly string[]): Promise<RemoteScriptOutcome[]> {
  const commands = packageScripts(), asked = [...new Set(scripts)];
  if (!asked.length) throw new Error('name the scripts to run, as npm run names them: studio remote run typecheck lint test:gate');
  const refusals = asked.flatMap((script) => remoteRunRefusal(script, commands[script]) ?? []);
  if (refusals.length) throw new Error(refusals.join('\n'));
  const connection = await openRemoteConnection(remoteCheckoutUpload);
  try {
    process.stderr.write(`remote: running ${asked.join(', ')}, each in a container of its own\n`);
    const width = Math.max(...asked.map((script) => script.length));
    const billed: RemoteBilledCall[] = [];
    const outcomes = await Promise.all(asked.map(async (script): Promise<RemoteScriptOutcome> => {
      const size = remoteRunSizeOf(commands[script]), mark = asked.length > 1 ? `[${script.padEnd(width)}] ` : '', started = performance.now();
      let streamed = 0;
      const print = (line: string) => process.stdout.write(`${mark}${line}\n`);
      try {
        const answer = await connection.app.check({ ...connection.layout, repos: connection.upload.repos, script, cores: size.cpu.request }, size, connection.settings.checkWarmSeconds, (line) => {
          streamed += 1;
          print(line);
        });
        const lines = remoteOutputLines(answer.output);
        if (streamed < lines) {
          print(`(the live stream lost ${lines - streamed} of ${lines} lines: ${script}'s whole output follows)`);
          for (const line of answer.output.replace(/\n$/, '').split('\n')) print(line);
        }
        billed.push({ label: script, size, report: answer.report });
        return {
          script, exitCode: answer.exitCode, seconds: answer.seconds, callSeconds: (performance.now() - started) / 1000,
          setup: answer.setup, cold: answer.report.previousCallEnded === null,
        };
      } catch (error) {
        return { script, exitCode: null, error: error instanceof Error ? error.message : String(error), callSeconds: (performance.now() - started) / 1000 };
      }
    }));
    if (billed.length) printRemoteBilling(billed, connection.settings.checkWarmSeconds);
    return outcomes;
  } finally {
    connection.close();
  }
}

function remoteRunVerdict({ exitCode, error }: RemoteScriptOutcome): string {
  if (exitCode === null) return `didn't run: ${error}`;
  return exitCode === 0 ? 'passed' : `failed (exit ${exitCode})`;
}

/** The summary `studio remote run` ends with: each script, whether it passed, and where its time went. */
export function formatRemoteRunOutcomes(outcomes: readonly RemoteScriptOutcome[]): string[] {
  const width = Math.max(...outcomes.map((outcome) => outcome.script.length));
  return ['remote run:', ...outcomes.map((outcome) => {
    const verdict = remoteRunVerdict(outcome);
    const time = outcome.seconds === undefined
      ? `${outcome.callSeconds.toFixed(1)} s`
      : `${outcome.seconds.toFixed(1)} s, ${outcome.callSeconds.toFixed(1)} s with the call (${outcome.cold ? 'cold' : 'warm'}: ${outcome.setup})`;
    return `  ${outcome.script.padEnd(width)}  ${verdict}  ${time}`;
  })];
}
