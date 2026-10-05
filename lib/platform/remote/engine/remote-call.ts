// remote-call.ts: what every remote command does before its containers run: the deployed app looked up, the files they
// lay out hashed and what the app's Volume lacks uploaded, and the deployment checked against this checkout's lockfile
// and app. Then the command runs its calls on the connection, each with the layout. Node only.
import { join, relative } from 'node:path';
import { sha256OfFile } from '#lib/platform/files/engine/file-sha256.ts';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { formatRemoteBilling, type RemoteBilledCall } from '../models/remote-cost.ts';
import type { RemoteSettings } from '../models/remote-settings.ts';
import { openRemoteApp, type RemoteApp, type RemoteLayout } from './remote-modal.ts';
import { uploadRemoteMissing, type RemoteUpload } from './remote-upload.ts';

/** The app's Python source, deployed by `studio remote deploy`. */
export const REMOTE_APP_FILE = join(import.meta.dirname, 'modal_remote_app.py');
/** The files a deployment is bound to: the image installs from the lockfile, and the app's code is what runs. */
export const remoteLockHash = () => sha256OfFile(join(STUDIO_ROOT, 'package-lock.json'));
export const remoteAppHash = () => sha256OfFile(REMOTE_APP_FILE);

const megabytes = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MB`;

/** A remote command's connection, what its containers lay out uploaded: run calls on `app` with `layout`, then close it. */
export type RemoteConnection = { readonly app: RemoteApp; readonly settings: RemoteSettings; readonly layout: RemoteLayout; readonly close: () => void };

/** Opens a connection whose containers lay out what `upload` hashes, uploading what the Volume lacks of it. */
export async function openRemoteConnection<U extends RemoteUpload>(upload: () => U | Promise<U>): Promise<RemoteConnection & { readonly upload: U }> {
  const started = performance.now();
  const app = await openRemoteApp();
  try {
    const hashedUpload = await upload();
    const hashed = performance.now();
    const prepared = await app.prepare({ files: [...new Set(hashedUpload.files.map((f) => f.hash))], generations: hashedUpload.generations.map((g) => g.key) });
    const { settings } = prepared;
    if (settings.lockHash !== remoteLockHash()) throw new Error('package-lock.json has changed since the remote app was deployed: run studio remote deploy');
    if (settings.appHash !== remoteAppHash()) throw new Error(`${relative(STUDIO_ROOT, REMOTE_APP_FILE)} has changed since it was deployed: run studio remote deploy`);
    const sent = await uploadRemoteMissing(app, hashedUpload, prepared);
    process.stderr.write(`remote: ${hashedUpload.files.length} files hashed in ${((hashed - started) / 1000).toFixed(1)} s; ` +
      `${sent.files ? `uploaded ${sent.files} (${megabytes(sent.bytes)})` : 'nothing new to upload'} in ${((performance.now() - hashed) / 1000).toFixed(1)} s\n`);
    const layout = { files: hashedUpload.files.map((f) => [f.path, f.hash] as const), generations: hashedUpload.generations.map((g) => [g.path, g.key] as const) };
    return { app, settings, layout, upload: hashedUpload, close: () => app.close() };
  } catch (error) {
    app.close();
    throw error;
  }
}

/** Prints what `calls` billed, and what their containers cost warm for `warmSeconds` after, on stderr. */
export function printRemoteBilling(calls: readonly RemoteBilledCall[], warmSeconds: number): void {
  for (const line of formatRemoteBilling(calls, warmSeconds)) process.stderr.write(`${line}\n`);
}
