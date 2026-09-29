import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyStudioPath, expandStudioAlias, libFeatureCrossedTo } from './studio-tree.ts';

test('each path lands in its §4 position', () => {
  const shared = { p: ['look.ts'] };
  const cases: Record<string, string> = {
    'lib/timing/timeline/models/clock.ts': 'models',
    'lib/api.ts': 'studio barrel',
    'lib/picture/reel/studio/hud.tsx': 'studio',
    'lib/output/render/engine/run.ts': 'engine',
    // A file deeper in a role folder is still that role.
    'lib/output/render/engine/motion-calibration/video.tsx': 'engine',
    // Adversarial: lib/ holds areas, an area features and a feature role folders, so a module directly in one, in a
    // folder that names no role, or in an area LIB_AREAS doesn't declare is placed nowhere.
    'lib/music-fit.ts': 'undeclared',
    'lib/timing/music-fit.ts': 'undeclared',
    'lib/picture/kit/kit.tsx': 'undeclared',
    'lib/picture/kit/helpers/x.ts': 'undeclared',
    'lib/helpers/strings/models/x.ts': 'undeclared',
    'cli/commands/brushes.ts': 'cli',
    'harness/photoshop.ts': 'harness',
    'web/src/infrastructure/studio-engine.server.ts': 'web-server',
    'web/src/routes/api.studio.ts': 'web-client',
    'web/vite.config.ts': 'root-config',
    // Adversarial: `.server` names a server module only in infrastructure/, the app's one door into lib's engine code.
    'web/src/features/review/controllers/review-queries.server.ts': 'web-client',
    'work/brands/kit/brand.ts': 'brand-kit',
    'work/brands/kit/extra.ts': 'undeclared',
    'work/styles/wash/style.ts': 'style',
    'work/styles/wash/recipes/tree.ts': 'style',
    // Adversarial: brushes/ is what the importer writes, never source.
    'work/styles/wash/brushes/loader.ts': 'undeclared',
    'work/projects/p/timeline.ts': 'timeline',
    'work/projects/p/timeline.test.ts': 'spec',
    // Adversarial: a test named for no root module is just another project file.
    'work/projects/p/parts.test.ts': 'unclassified',
    'work/projects/p/brand.ts': 'brand',
    'work/projects/p/look.ts': 'shared',
    'work/projects/p/bars/01-ink.tsx': 'scene 01-ink',
    'work/projects/p/bars/01-ink/needle.ts': 'scene-helper 01-ink',
    'work/projects/p/bars/01-ink/needle-model.ts': 'model 01-ink',
    // Adversarial: a model beside its scene file, not in the folder, still belongs to that scene.
    'work/projects/p/bars/01-ink-model.ts': 'model 01-ink',
    'work/projects/p/scenes/intro.tsx': 'scene intro',
    'work/projects/p/generated/brand.ts': 'generated',
    'work/projects/p/out/ab/video.tsx': 'generated',
    'work/projects/p/parts.tsx': 'unclassified',
    'remotion.config.ts': 'root-config',
    'skills/x/tool.ts': 'ungoverned',
    // Adversarial: the workspace's own positions are its projects and brand kits; `work/` isn't stripped to find
    // another, and the old top-level folders place nothing.
    'work/lib/timing/timeline/models/clock.ts': 'undeclared',
    'work/stray.ts': 'undeclared',
    'projects/p/timeline.ts': 'undeclared',
    'brands/kit/brand.ts': 'undeclared',
    'odd.ts': 'undeclared',
  };
  for (const [path, expected] of Object.entries(cases)) {
    const position = classifyStudioPath(path, shared);
    const label = position.kind === 'project'
      ? [position.role, 'scene' in position ? position.scene : undefined].filter(Boolean).join(' ')
      : 'barrel' in position ? 'studio barrel' : position.kind;
    assert.equal(label, expected, path);
  }
});

test('an alias expands to the same normalized path its relative spelling names', () => {
  const imports = { '#studio': './lib/api.ts', '#lib/*': './lib/*', '#lib/timing/timeline/*': './lib/timing/timeline/v2/*' };
  assert.equal(expandStudioAlias('#studio', imports), 'lib/api.ts');
  assert.equal(expandStudioAlias('#lib/picture/reel/../motion/models/ease.ts', imports), 'lib/picture/motion/models/ease.ts');
  // The longest matching prefix wins, as in Node.
  assert.equal(expandStudioAlias('#lib/timing/timeline/models/clock.ts', imports), 'lib/timing/timeline/v2/models/clock.ts');
  assert.equal(expandStudioAlias('#engine/render.ts', imports), undefined);
});

test('a relative import crosses into another feature, not between role folders of its own', () => {
  assert.equal(libFeatureCrossedTo('lib/picture/kit/studio/kit.tsx', 'lib/picture/kit/models/layout.ts'), undefined);
  assert.equal(libFeatureCrossedTo('lib/picture/kit/studio/kit.tsx', 'lib/picture/motion/models/ease.ts'), 'lib/picture/motion');
  // Adversarial: the barrel is in no feature, so every feature it reaches is crossed into.
  assert.equal(libFeatureCrossedTo('lib/api.ts', 'lib/picture/kit/studio/kit.tsx'), 'lib/picture/kit');
});
