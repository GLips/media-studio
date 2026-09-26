import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyStudioPath, expandStudioAlias } from './studio-tree.ts';

test('each path lands in its §4 position', () => {
  const shared = { p: ['look.ts'] };
  const cases: Record<string, string> = {
    'lib/models/timeline/clock.ts': 'models',
    'lib/studio/api.ts': 'studio barrel',
    'lib/studio/reel/hud.tsx': 'studio',
    'lib/engine/render/run.ts': 'engine',
    'lib/sfx/cues.ts': 'lib-unsplit',
    // Adversarial: lib/, lib/models/ and lib/studio/ (but for its barrel) hold subfolders only, so a module directly
    // in one is placed nowhere.
    'lib/music-fit.ts': 'undeclared',
    'lib/models/music-fit.ts': 'undeclared',
    'lib/studio/kit.tsx': 'undeclared',
    'web/src/infrastructure/studio-engine.server.ts': 'web-server',
    'web/src/routes/lab.tsx': 'web-client',
    'web/vite.config.ts': 'root-config',
    // Adversarial: `.server` names a server module only in infrastructure/, the app's one door into lib/engine.
    'web/src/features/review/controllers/review-queries.server.ts': 'web-client',
    'brands/kit/brand.ts': 'brand-kit',
    'brands/kit/extra.ts': 'undeclared',
    'projects/p/timeline.ts': 'timeline',
    'projects/p/timeline.test.ts': 'spec',
    // Adversarial: a test named for no root module is just another project file.
    'projects/p/parts.test.ts': 'unclassified',
    'projects/p/brand.ts': 'brand',
    'projects/p/look.ts': 'shared',
    'projects/p/bars/01-ink.tsx': 'scene 01-ink',
    'projects/p/bars/01-ink/needle.ts': 'scene-helper 01-ink',
    'projects/p/bars/01-ink/needle-model.ts': 'model 01-ink',
    // Adversarial: a model beside its scene file, not in the folder, still belongs to that scene.
    'projects/p/bars/01-ink-model.ts': 'model 01-ink',
    'projects/p/scenes/intro.tsx': 'scene intro',
    'projects/p/generated/brand.ts': 'generated',
    'projects/p/out/ab/video.tsx': 'generated',
    'projects/p/parts.tsx': 'unclassified',
    'remotion.config.ts': 'root-config',
    'skills/x/tool.ts': 'ungoverned',
    'odd.ts': 'undeclared',
  };
  for (const [path, expected] of Object.entries(cases)) {
    const position = classifyStudioPath(path, shared);
    const label = position.kind === 'project'
      ? [position.role, 'scene' in position ? position.scene : undefined].filter(Boolean).join(' ')
      : position.kind === 'studio' && position.barrel ? 'studio barrel' : position.kind;
    assert.equal(label, expected, path);
  }
});

test('an alias expands to the same normalized path its relative spelling names', () => {
  const imports = { '#studio': './lib/studio/api.ts', '#models/*': './lib/models/*', '#models/timeline/*': './lib/models/timeline/v2/*' };
  assert.equal(expandStudioAlias('#studio', imports), 'lib/studio/api.ts');
  assert.equal(expandStudioAlias('#models/reel/../motion/ease.ts', imports), 'lib/models/motion/ease.ts');
  // The longest matching prefix wins, as in Node.
  assert.equal(expandStudioAlias('#models/timeline/clock.ts', imports), 'lib/models/timeline/v2/clock.ts');
  assert.equal(expandStudioAlias('#engine/render.ts', imports), undefined);
});
