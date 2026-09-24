// studio.ts: opens the Remotion Studio on one project, to scrub it, toggle captions and see scenes and voice lines on
// the timeline.
//   npm run studio -- projects/<name>
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const project = process.argv[2];
if (!project || !existsSync(join(project, 'video.tsx'))) {
  console.error('usage: npm run studio -- projects/<name>   (a folder with a video.tsx)');
  process.exit(1);
}
spawn('npx', ['remotion', 'studio', ...process.argv.slice(3)], { stdio: 'inherit', env: { ...process.env, PROJECT: project } })
  .on('exit', (code) => process.exit(code ?? 0));
