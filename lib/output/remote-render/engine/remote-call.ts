// remote-call.ts: what every remote command does before its job runs: the deployed app looked up, the project's
// files hashed and what the app's Volume lacks uploaded, and the deployment checked against this checkout's
// lockfile and app. Then each job goes to a container with the file list it lays out, its log lines followed here.
// Node only.
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sha256OfFile } from '#lib/platform/files/engine/file-sha256.ts';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { formatRemoteBilling, type RemoteCallReport } from '../models/remote-render-cost.ts';
import type { RemoteRenderJob } from '../models/remote-render-job.ts';
import type { RemoteRenderSettings } from '../models/remote-render-settings.ts';
import { openRemoteRenderApp, type RemoteRenderApp } from './remote-modal.ts';
import { remoteUploadFor, uploadRemoteMissing } from './remote-upload.ts';

/** The app's Python source, deployed by `studio remote deploy`. */
export const REMOTE_RENDER_APP_FILE = join(import.meta.dirname, 'modal_render_app.py');
/** The files a deployment is bound to: the image installs from the lockfile, and the app's code is what runs. */
export const remoteLockHash = () => sha256OfFile(join(STUDIO_ROOT, 'package-lock.json'));
export const remoteAppHash = () => sha256OfFile(REMOTE_RENDER_APP_FILE);

const megabytes = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MB`;

/** A remote command's connection, its project's files uploaded: run jobs on it, then close it. */
export type RemoteCall = {
  readonly settings: RemoteRenderSettings;
  /** Runs `job` on a container, its log lines on stderr marked `label`; returns the files it made and its report. */
  readonly runJob: (job: RemoteRenderJob, label: string) => Promise<{ files: ReadonlyMap<string, Uint8Array>; report: RemoteCallReport }>;
  readonly close: () => void;
};

/** Opens a remote call for `project` (its folder): its files uploaded, the deployment checked. */
export async function openRemoteCall(project: string): Promise<RemoteCall> {
  const started = performance.now();
  const app: RemoteRenderApp = await openRemoteRenderApp();
  try {
    const upload = await remoteUploadFor(project);
    const hashed = performance.now();
    const prepared = await app.prepare({ files: [...new Set(upload.files.map((f) => f.hash))], generations: upload.generations.map((g) => g.key) });
    const { settings } = prepared;
    if (settings.lockHash !== remoteLockHash()) throw new Error('package-lock.json has changed since the remote render app was deployed: run studio remote deploy');
    if (settings.appHash !== remoteAppHash()) throw new Error(`${relative(STUDIO_ROOT, REMOTE_RENDER_APP_FILE)} has changed since it was deployed: run studio remote deploy`);
    const sent = await uploadRemoteMissing(app, upload, prepared);
    process.stderr.write(`remote: ${upload.files.length} files hashed in ${((hashed - started) / 1000).toFixed(1)} s; ` +
      `${sent.files ? `uploaded ${sent.files} (${megabytes(sent.bytes)})` : 'nothing new to upload'} in ${((performance.now() - hashed) / 1000).toFixed(1)} s\n`);
    const layout = { files: upload.files.map((f) => [f.path, f.hash] as const), generations: upload.generations.map((g) => [g.path, g.key] as const) };
    return {
      settings,
      async runJob(job, label) {
        const answer = await app.run({ ...layout, job: JSON.stringify(job) }, (line) => process.stderr.write(`  [${label}] ${line}\n`));
        if (!answer.ok) throw new Error(`the remote render (${label}) failed: ${answer.error ?? 'no reason given'}`);
        return { files: answer.files, report: answer.report };
      },
      close: () => app.close(),
    };
  } catch (error) {
    app.close();
    throw error;
  }
}

/** Writes each of `files` into `dir` by name. */
export function writeRemoteFiles(files: ReadonlyMap<string, Uint8Array>, dir: string): void {
  for (const [name, bytes] of files) writeFileSync(join(dir, name), bytes);
}

/** Prints what `reports` billed, by `settings`' rates, on stderr. */
export function printRemoteBilling(settings: RemoteRenderSettings, reports: readonly RemoteCallReport[]): void {
  for (const line of formatRemoteBilling(settings, reports)) process.stderr.write(`${line}\n`);
}
