// remote-call.ts: what every remote command does before its containers run: this checkout's version of the app looked
// up, refused when it isn't deployed, and the files they lay out hashed and what the Volume lacks uploaded. Then the
// command runs its calls on the connection, each with the layout. Node only.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { sha256OfFile } from '#lib/platform/files/engine/file-sha256.ts';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { formatRemoteBilling, type RemoteBilledCall } from '../models/remote-cost.ts';
import { remoteAppOfVersion, type RemoteSettings } from '../models/remote-settings.ts';
import { openRemoteApp, type RemoteApp, type RemoteLayout } from './remote-modal.ts';
import { uploadRemoteMissing, type RemoteUpload } from './remote-upload.ts';

/** The app's Python source, deployed by `studio remote deploy`. */
export const REMOTE_APP_FILE = join(import.meta.dirname, 'modal_remote_app.py');

/**
 * This checkout's version of the app, by name: 8 hex of what a deployment is bound to, the lockfile its image installs
 * from, the Node it installs and the app's code. A checkout differing in any finds or deploys a version of its own.
 */
export function remoteCheckoutApp(): string {
  const bound = [sha256OfFile(join(STUDIO_ROOT, 'package-lock.json')), process.versions.node, sha256OfFile(REMOTE_APP_FILE)].join('\n');
  return remoteAppOfVersion(createHash('sha256').update(bound).digest('hex').slice(0, 8));
}

const megabytes = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MB`;

/** A remote command's connection, what its containers lay out uploaded: run calls on `app` with `layout`, then close it. */
export type RemoteConnection = { readonly app: RemoteApp; readonly settings: RemoteSettings; readonly layout: RemoteLayout; readonly close: () => void };

/** Opens a connection whose containers lay out what `upload` hashes, uploading what the Volume lacks of it. */
export async function openRemoteConnection<U extends RemoteUpload>(upload: () => U | Promise<U>): Promise<RemoteConnection & { readonly upload: U }> {
  const started = performance.now();
  const app = await openRemoteApp(remoteCheckoutApp());
  try {
    const hashedUpload = await upload();
    const hashed = performance.now();
    const prepared = await app.prepare({ files: [...new Set(hashedUpload.files.map((f) => f.hash))], generations: hashedUpload.generations.map((g) => g.key) });
    const sent = await uploadRemoteMissing(app, hashedUpload, prepared);
    process.stderr.write(`remote: ${hashedUpload.files.length} files hashed in ${((hashed - started) / 1000).toFixed(1)} s; ` +
      `${sent.files ? `uploaded ${sent.files} (${megabytes(sent.bytes)})` : 'nothing new to upload'} in ${((performance.now() - hashed) / 1000).toFixed(1)} s\n`);
    const layout = { files: hashedUpload.files.map((f) => [f.path, f.hash] as const), generations: hashedUpload.generations.map((g) => [g.path, g.key] as const) };
    return { app, settings: prepared.settings, layout, upload: hashedUpload, close: () => app.close() };
  } catch (error) {
    app.close();
    throw error;
  }
}

/** Prints what `calls` billed, and what their containers cost warm for `warmSeconds` after, on stderr. */
export function printRemoteBilling(calls: readonly RemoteBilledCall[], warmSeconds: number): void {
  for (const line of formatRemoteBilling(calls, warmSeconds)) process.stderr.write(`${line}\n`);
}
