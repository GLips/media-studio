import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test('a temp folder made anywhere but the studio-temp module is caught, however it is spelled', () => {
  const findings = runCheckOnFiles('studio-temp', {
    // Obvious: an engine step making its own.
    'lib/output/render/engine/mix.ts': "import { mkdtempSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nconst dir = mkdtempSync(join(tmpdir(), 'mix-'));\n",
    // Adversarial: a namespace, the promise API, a dynamic import, and places the governed tree doesn't parse.
    'kit/server.ts': "import os from 'node:os';\nconst dir = join(os.tmpdir(), 'kit');\n",
    'web/server/stills.ts': "const dir = await fs.promises.mkdtemp('x');\n",
    'cli/commands/still.ts': "const { tmpdir: t } = await import('node:os');\n",
    'lint/structural/spec-tree.ts': "const root = mkdtempSync('arch-spec-');\n",
    'bin/clean.mjs': "rmSync(require('os').tmpdir());\n",
    // Legal neighbours: the owner, prose, and code that merely looks alike.
    'lib/platform/temp/engine/studio-temp.ts': "import { tmpdir } from 'node:os';\nmkdtempSync(join(tmpdir(), 'x'));\n",
    'docs/temp.md': 'Never call mkdtempSync(join(tmpdir(), …)) directly.\n',
    'lib/timing/voice/engine/say.ts': "const tmpdirs = 2, env = process.env.TMPDIR;\nwithStudioTemp('say', (tmp) => tmp);\n",
  });
  assert.deepEqual(caught(findings), [
    "bin/clean.mjs:rmSync(require('os').tmpdir());",
    "cli/commands/still.ts:const { tmpdir: t } = await import('node:os');",
    "kit/server.ts:const dir = join(os.tmpdir(), 'kit');",
    "lib/output/render/engine/mix.ts:const dir = mkdtempSync(join(tmpdir(), 'mix-'));",
    "lib/output/render/engine/mix.ts:import { mkdtempSync } from 'node:fs';",
    "lib/output/render/engine/mix.ts:import { tmpdir } from 'node:os';",
    "lint/structural/spec-tree.ts:const root = mkdtempSync('arch-spec-');",
    "web/server/stills.ts:const dir = await fs.promises.mkdtemp('x');",
  ]);
});
