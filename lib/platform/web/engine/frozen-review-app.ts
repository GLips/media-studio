import { fork } from 'node:child_process';
import { join } from 'node:path';
import { withFrozenEngine } from '#lib/platform/project/engine/frozen-engine-checkout.ts';
import { readFrozenProjectRecord } from '#lib/platform/project/engine/frozen-project-record.ts';
import { listStudioProjects, STUDIO_PROJECTS_DIR } from '#lib/platform/project/engine/studio-project.ts';

const serving = new Map<string, Promise<string>>();

// Start Vite in the pinned process: it resolves the Player, its plugins and the app itself relative to that checkout.
function serve(root: string): Promise<string> {
  const existing = serving.get(root);
  if (existing) return existing;
  const program = `
    import { startStudioAppViteServer } from './lib/platform/web/engine/studio-app-server.ts';
    process.on('disconnect', () => process.exit(0));
    const server = await startStudioAppViteServer({ port: 0, instanceId: null });
    process.send(server.httpServer.address().port);
  `;
  const child = fork('', [], { cwd: root, execArgv: ['--input-type=module', '-e', program], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const ready = new Promise<string>((resolve, reject) => {
    child.once('message', (port) => {
      if (typeof port === 'number') resolve(`http://localhost:${port}`);
      else reject(new Error('Frozen review server returned no port'));
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      serving.delete(root);
      reject(new Error(`Frozen review server exited (${code})`));
    });
  });
  serving.set(root, ready);
  return ready;
}

/** The app that can execute this project's live plan and replay, or the current app for an active project. */
export async function frozenReviewOrigin(name: string): Promise<string | null> {
  if (!listStudioProjects().includes(name)) return null;
  const project = join(STUDIO_PROJECTS_DIR, name);
  const record = readFrozenProjectRecord(project);
  return record ? withFrozenEngine({ project, record, mode: 'review' }, serve) : null;
}
