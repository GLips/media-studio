// The real oxlint CLI, run once with .oxlintrc.json over a small tree in the studio's layout. RuleTester
// proves a rule in isolation; this proves the config enables it, the plugin registers it, and it reaches
// a lib model and a Remotion scene, files only their position tells apart from the web app's.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';

const studioRoot = fileURLToPath(new URL('..', import.meta.url));
const MODEL = 'lib/timing/beat/models/beat-grid.ts';
const MODEL_SPEC = 'lib/timing/beat/models/beat-grid.test.ts';
const SCENE = 'work/projects/p/scenes/intro.tsx';
const WEB_UI = 'web/src/features/f/ui/panel.tsx';

const LONG_COMMENT = `// ${Array.from({ length: 70 }, (_, i) => `word${i}`).join(' ')}`;
const FIXTURES: Record<string, string> = {
  [MODEL]: `export const first = 1;
export interface BeatShape { at: number }
export const beat = JSON.parse("1") as unknown as number;
export const read = (target: object, key: string): unknown => Reflect.get(target, key);
export const load = (response: { json<T>(): T }): number => response.json<number>();
${LONG_COMMENT}
export const last = 2;
`,
  [MODEL_SPEC]: `import { vi } from "vitest";\nvi.mock("./beat-grid.ts");\n`,
  [SCENE]: `import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type Context } from "react";
type IntroProps = { a: string; b: string; c: string; d: string; e: string; f: string; g: string; h: string; i: string };
export const Intro = ({ a, b, c, d, e, f, g, h, i }: IntroProps) => {
  const [x] = useState(0);
  const y = useRef(0);
  const z = useMemo(() => 1, []);
  const w = useCallback(() => 1, []);
  const [v] = useReducer((s: number) => s, 0);
  const u = useContext(null as unknown as Context<number>);
  const [t] = useState(1);
  useEffect(() => { void (async () => { await Promise.resolve(); })(); }, []);
  return <div style={{ color: "#ff0000", fontSize: 12 }}>{[a, b, c, d, e, f, g, h, i, x, y, z, w, v, u, t].join()}</div>;
};
export const Outro = () => <div />;
`,
  [WEB_UI]: `export const Panel = () => <div style={{ color: "#ff0000" }}>hi</div>;\n`,
};

/** Every rule the studio applies to all TypeScript, and the fixture file that must trip it. */
const EXTENDED: Record<string, string> = {
  'require-safety-comment': MODEL,
  'no-chained-type-assertions': MODEL,
  'no-type-argument-assertion': MODEL,
  'no-reflect-access': MODEL,
  'no-long-comments': MODEL,
  'no-vacant-symbol-names': MODEL,
  'no-module-mocking': MODEL_SPEC,
  'hook-count': SCENE,
  'prop-count': SCENE,
  'single-component-export': SCENE,
  'no-async-effect': SCENE,
};
const STYLE_RULES = ['no-inline-color', 'no-inline-font-size', 'no-inline-style-prop', 'no-raw-primitives'];

type OxlintConfig = { jsPlugins: string[]; options: Record<string, unknown> };
type OxlintReport = { diagnostics: { code: string; filename: string }[] };

/** The `arch/` findings as `<rule> <path>` strings, from one oxlint run over the fixture tree. */
function lintFixtureTree(fixtureRoot: string): Set<string> {
  // oxlint reads the file as JSONC; this config writes its comments on lines of their own.
  const config = JSON.parse(
    readFileSync(join(studioRoot, '.oxlintrc.json'), 'utf8').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n'),
  ) as OxlintConfig;
  // The copy sits in the fixture tree so oxlint measures paths from there, but it can't resolve
  // plugins or tsgolint from a tree with no node_modules: plugins go absolute, and type-aware goes
  // off, since it feeds built-in rules only.
  const require = createRequire(join(studioRoot, 'package.json'));
  config.jsPlugins = config.jsPlugins.map((plugin) => (plugin.startsWith('.') ? join(studioRoot, plugin) : require.resolve(plugin)));
  config.options = { ...config.options, typeAware: false };
  writeFileSync(join(fixtureRoot, '.oxlintrc.json'), JSON.stringify(config));
  for (const [path, source] of Object.entries(FIXTURES)) {
    mkdirSync(join(fixtureRoot, dirname(path)), { recursive: true });
    writeFileSync(join(fixtureRoot, path), source);
  }

  let output: string;
  try {
    output = execFileSync(join(studioRoot, 'node_modules/.bin/oxlint'), ['-c', '.oxlintrc.json', '-f', 'json', '.'], { cwd: fixtureRoot, encoding: 'utf8' });
  } catch (failure) {
    // Findings exit non-zero; the report is still on stdout.
    output = (failure as { stdout: string }).stdout;
  }
  const report = JSON.parse(output) as OxlintReport;
  return new Set(
    report.diagnostics
      .filter((diagnostic) => diagnostic.code.startsWith('arch('))
      .map((diagnostic) => `${diagnostic.code.slice('arch('.length, -1)} ${diagnostic.filename}`),
  );
}

const findings = withStudioTemp('oxlint-spec', lintFixtureTree);

test('every rule extended to all TypeScript fires on a lib model, its spec or a Remotion scene', () => {
  const missing = Object.entries(EXTENDED).filter(([rule, path]) => !findings.has(`${rule} ${path}`));
  assert.deepEqual(missing, [], `found instead:\n${[...findings].join('\n')}`);
});

test('the web design-system rules fire in the web app and stay silent on a Remotion scene', () => {
  for (const rule of STYLE_RULES) assert.ok(!findings.has(`${rule} ${SCENE}`), `${rule} read a Remotion scene`);
  for (const rule of ['no-inline-color', 'no-inline-style-prop', 'no-raw-primitives']) {
    assert.ok(findings.has(`${rule} ${WEB_UI}`), `${rule} missed the web app`);
  }
});
