// remote-render-call.ts: a remote render's or look's connection to the deployed app (lib/platform/remote): its project's
// files uploaded, each job run on a render server with its log lines on stderr, and what the calls billed at the render
// server's size. Node only.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RemoteCallReport } from '#lib/platform/remote/models/remote-cost.ts';
import type { RemoteSettings } from '#lib/platform/remote/models/remote-settings.ts';
import { openRemoteConnection, printRemoteBilling } from '#lib/platform/remote/engine/remote-call.ts';
import { remoteProjectUpload } from '#lib/platform/remote/engine/remote-upload.ts';
import type { RemoteRenderJob } from '../models/remote-render-job.ts';

export type RemoteRenderCall = {
  readonly settings: RemoteSettings;
  /** Runs `job` on a render server, its log lines on stderr marked `label`; returns the files it made and its report. */
  readonly runJob: (job: RemoteRenderJob, label: string) => Promise<{ files: ReadonlyMap<string, Uint8Array>; report: RemoteCallReport }>;
  /** Prints what each labelled call billed, on stderr. */
  readonly printBilling: (calls: readonly { label: string; report: RemoteCallReport }[]) => void;
  readonly close: () => void;
};

/** Opens a remote call for `project` (its folder): its files uploaded, the deployment checked. */
export async function openRemoteRenderCall(project: string): Promise<RemoteRenderCall> {
  const { app, settings, layout, close } = await openRemoteConnection(() => remoteProjectUpload(project));
  return {
    settings,
    async runJob(job, label) {
      const answer = await app.render({ ...layout, job: JSON.stringify(job) }, (line) => process.stderr.write(`  [${label}] ${line}\n`));
      if (!answer.ok) throw new Error(`the remote render (${label}) failed: ${answer.error ?? 'no reason given'}`);
      return { files: answer.files, report: answer.report };
    },
    printBilling: (calls) => printRemoteBilling(calls.map((call) => ({ ...call, size: settings.render })), settings.warmSeconds),
    close,
  };
}

/** Writes each of `files` into `dir` by name. */
export function writeRemoteFiles(files: ReadonlyMap<string, Uint8Array>, dir: string): void {
  for (const [name, bytes] of files) writeFileSync(join(dir, name), bytes);
}
