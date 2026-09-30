import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caught, runCheckOnFiles } from '../spec-tree.ts';

test("an exported function that only calls the studio's own code with its own parameters is reported", () => {
  const findings = runCheckOnFiles('trampolines', {
    'package.json': JSON.stringify({ imports: { '#lib/*': './lib/*' } }),
    'lib/picture/reel/models/bounce.ts': 'export const bounceAt = (frame: number, height: number) => frame * height;\n',
    'lib/picture/reel/studio/ball.tsx': [
      "import { bounceAt } from '#lib/picture/reel/models/bounce.ts';",
      "import * as bounce from '../models/bounce.ts';",
      "import { readFileSync } from 'node:fs';",
      "import { interpolate } from 'remotion';",
      'const settle = (frame: number) => frame;',
      // Obvious: a declaration forwarding to an import.
      'export function ballAt(frame: number, height: number) { return bounceAt(frame, height); }',
      // Adversarial: an arrow, an async await, spread arguments, a namespace call, an object method, a local function.
      'export const ballHeight = (f: number, h: number) => bounceAt(f, h);',
      'export async function ballLater(...args: [number, number]) { return await bounceAt(...args); }',
      'export const ballNs = (f: number, h: number) => bounce.bounceAt(f, h);',
      'export const ball = { at(f: number, h: number) { return bounceAt(f, h); } };',
      'export const ballSettle = (frame: number) => settle(frame);',
      // Legal: a package's function, a transformed or specialized argument, a second statement, JSX, a destructured parameter.
      'export const readBall = (path: string) => readFileSync(path);',
      'export const ease = (frame: number) => interpolate(frame, [0, 1], [0, 1]);',
      'export const doubled = (f: number, h: number) => bounceAt(f * 2, h);',
      'export const floor = (f: number) => bounceAt(f, 0);',
      'export function logged(f: number, h: number) { const at = bounceAt(f, h); return at; }',
      'export const Ball = (props: { f: number }) => <div>{props.f}</div>;',
      'export const picked = ({ f, h }: { f: number; h: number }) => bounceAt(f, h);',
    ].join('\n'),
    // Legal: a spec's helpers aren't a surface.
    'lib/picture/reel/studio/ball.test.ts': "import { bounceAt } from '../models/bounce.ts';\nexport const at = (f: number, h: number) => bounceAt(f, h);\n",
  });
  assert.deepEqual(caught(findings), [
    'lib/picture/reel/studio/ball.tsx:ball.at',
    'lib/picture/reel/studio/ball.tsx:ballAt',
    'lib/picture/reel/studio/ball.tsx:ballHeight',
    'lib/picture/reel/studio/ball.tsx:ballLater',
    'lib/picture/reel/studio/ball.tsx:ballNs',
    'lib/picture/reel/studio/ball.tsx:ballSettle',
  ]);
});
