// remote-render-call.ts: a remote render's or look's connection to the deployed app (lib/platform/remote): its project's
// files uploaded, its jobs run on render servers at once with their log lines on stderr, and what the calls billed at
// the render server's size. Node only.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RemoteBilledCall, RemoteCallReport } from '#lib/platform/remote/models/remote-cost.ts';
import type { RemoteSettings } from '#lib/platform/remote/models/remote-settings.ts';
import { openRemoteConnection, printRemoteBilling } from '#lib/platform/remote/engine/remote-call.ts';
import { remoteProjectUpload } from '#lib/platform/remote/engine/remote-upload.ts';
import type { RemoteRenderJob } from '../models/remote-render-job.ts';

/** A job, and what its log lines and its bill are marked with (`remote 1/2`). */
export type RemoteLabelledJob = { readonly job: RemoteRenderJob; readonly label: string };
/** What a job's call answered: the files it made by name, and its container's report. */
export type RemoteJobAnswer = { readonly files: ReadonlyMap<string, Uint8Array>; readonly report: RemoteCallReport };

export type RemoteRenderCall = {
  readonly settings: RemoteSettings;
  /**
   * Runs each of `jobs` on a render server, all at once, its log lines on stderr marked with its label. When one fails,
   * the others still running are cancelled, their containers ended, before its error is thrown.
   */
  readonly runJobs: (jobs: readonly RemoteLabelledJob[]) => Promise<RemoteJobAnswer[]>;
  /** Prints what each call that answered billed, its job failed or not, on stderr; nothing when none has. */
  readonly printBilling: () => void;
  readonly close: () => void;
};

/** Opens a remote call for `project` (its folder): its files uploaded to this checkout's version of the app. */
export async function openRemoteRenderCall(project: string): Promise<RemoteRenderCall> {
  const { app, settings, layout, close } = await openRemoteConnection(() => remoteProjectUpload(project));
  const answered: RemoteBilledCall[] = [];

  async function runJob({ job, label }: RemoteLabelledJob): Promise<RemoteJobAnswer> {
    const answer = await app.render({ ...layout, job: JSON.stringify(job) }, (line) => process.stderr.write(`  [${label}] ${line}\n`));
    answered.push({ label, size: settings.render, report: answer.report });
    if (!answer.ok) throw new Error(`the remote render (${label}) failed: ${answer.error ?? 'no reason given'}`);
    return { files: answer.files, report: answer.report };
  }

  return {
    settings,
    async runJobs(jobs) {
      const ended = new Set<string>();
      try {
        return await Promise.all(jobs.map(async (job) => {
          try {
            return await runJob(job);
          } finally {
            ended.add(job.label);
          }
        }));
      } catch (error) {
        const cancelled = jobs.flatMap(({ label }) => (ended.has(label) ? [] : [label]));
        await app.cancelRunningCalls();
        if (cancelled.length) {
          const many = cancelled.length > 1;
          process.stderr.write(`remote: cancelled ${cancelled.join(', ')}, ending ${many ? 'their containers' : 'its container'}; the bill leaves out what ${many ? 'they' : 'it'} ran\n`);
        }
        throw error;
      }
    },
    printBilling() {
      if (answered.length) printRemoteBilling(answered, settings.warmSeconds);
    },
    close,
  };
}

/** Writes each of `files` into `dir` by name. */
export function writeRemoteFiles(files: ReadonlyMap<string, Uint8Array>, dir: string): void {
  for (const [name, bytes] of files) writeFileSync(join(dir, name), bytes);
}
