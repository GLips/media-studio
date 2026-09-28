import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('a contained SDK reached outside its owner is caught, however it is spelled', () => {
  const findings = runCheckOnFiles('sdk-containment', {
    // Obvious: a project's capture importing playwright, and the CLI spawning ffmpeg.
    'work/projects/p/capture.ts': "import { chromium } from 'playwright';\n",
    'cli/commands/cut.ts': "import { execFileSync } from 'node:child_process';\nexecFileSync('ffmpeg', ['-i', 'a.mp4']);\n",
    // Adversarial: a type-only import, a dynamic import, a subpath, a binary behind a variable, a path to it, and a
    // shell line through a member call.
    'cli/commands/types.ts': "import type { Page } from 'playwright';\n",
    'cli/commands/serve.ts': "const { renderMedia } = await import('@remotion/renderer');\nimport { transform } from 'esbuild/lib/main.js';\nconst { createServer } = await import('vite');\n",
    'work/projects/p/tools/probe.ts': "const BIN = `ffprobe`;\nconst other = '/opt/homebrew/bin/ffmpeg';\ncp.execSync(`ffmpeg -i ${file} out.wav`);\n",
    // Adversarial: a command line through a promisified exec, a shell: true spawn and sh -c.
    'work/projects/p/tools/shell.ts': [
      "run('ffprobe -v error a.mp4');",
      "spawn('ffmpeg -i a.mp4 b.wav', { shell: true });",
      "execFileSync('sh', ['-c', `${dir}/ffmpeg -y -i ${x} out.wav`]);",
    ].join('\n'),
    // Legal neighbours: each owner, and prose that merely mentions ffmpeg.
    'lib/engine/capture/capture.ts': "import { chromium } from 'playwright';\n",
    'lib/engine/ffmpeg/ffmpeg.ts': "import { spawn } from 'node:child_process';\nspawn('ffmpeg', []);\n",
    'lib/engine/bundle/bundle.ts': "import { build } from 'esbuild';\nimport { bundle } from '@remotion/bundler';\n",
    'lib/engine/web/studio-app-server.ts': "import { createServer } from 'vite';\n",
    'web/vite.config.ts': "import { defineConfig } from 'vite';\n",
    'lib/engine/render/render.ts': "import { renderMedia } from '@remotion/renderer';\n",
    'lib/engine/look/look.ts': "throw new Error('ffmpeg failed');\n// runs ffmpeg\n",
  });
  assert.deepEqual(caught(findings), [
    'cli/commands/cut.ts:ffmpeg',
    'cli/commands/serve.ts:@remotion/renderer',
    'cli/commands/serve.ts:esbuild',
    'cli/commands/serve.ts:vite',
    'cli/commands/types.ts:playwright',
    'work/projects/p/capture.ts:playwright',
    'work/projects/p/tools/probe.ts:/opt/homebrew/bin/ffmpeg',
    'work/projects/p/tools/probe.ts:ffmpeg',
    'work/projects/p/tools/probe.ts:ffprobe',
    'work/projects/p/tools/shell.ts:ffmpeg',
    'work/projects/p/tools/shell.ts:ffprobe',
  ]);
});
