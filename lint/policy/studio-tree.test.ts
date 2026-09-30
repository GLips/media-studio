import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyStudioPath, expandStudioAlias, libFeatureCrossedTo, WEB_ENGINE_DOOR, WEB_SHADOW_MODULE, WEB_THEME_MODULE } from './studio-tree.ts';

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
    'web/src/infrastructure/studio-engine.server.ts': 'web-server infrastructure',
    'web/src/infrastructure/providers/query-client.ts': 'web-client infrastructure',
    'web/src/routes/api.studio.ts': 'web-client route',
    'web/src/start.ts': 'web-client entry',
    'web/src/styles.css': 'web-client shared',
    // Adversarial: a stylesheet beside a feature's barrel sits in no place, so the style checks couldn't read it.
    'web/src/features/review/review.css': 'undeclared',
    'web/src/routeTree.gen.ts': 'web-client generated',
    'web/src/shared/ui/readout.tsx': 'web-client shared-ui',
    'web/src/features/review/index.ts': 'web-client feature review barrel',
    'web/src/features/review/ui/review-stage.tsx': 'web-client feature review ui',
    'web/vite.config.ts': 'root-config',
    // Adversarial: `.server` names a server module only in infrastructure/, the app's one door into lib's engine code.
    'web/src/features/review/controllers/review-queries.server.ts': 'web-client feature review controllers',
    // Adversarial: a feature holds its barrel and layer folders only, and src/ its entries and top-level folders.
    'web/src/features/review/helpers.ts': 'undeclared',
    'web/src/features/review/hooks/use-x.ts': 'undeclared',
    'web/src/helpers.ts': 'undeclared',
    'web/scripts/seed.ts': 'undeclared',
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
      : 'barrel' in position ? 'studio barrel'
      : 'place' in position ? [position.kind, position.place, ...('feature' in position ? [position.feature, position.layer] : [])].join(' ')
      : position.kind;
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

test('the web modules checks single out sit where their role needs them', () => {
  const at = (path: string) => classifyStudioPath(path, {});
  // The door must be server-only, or engine code would reach a browser chunk through it.
  assert.deepEqual(at(WEB_ENGINE_DOOR), { kind: 'web-server', place: 'infrastructure' });
  assert.deepEqual(at(WEB_THEME_MODULE), { kind: 'web-client', place: 'shared-ui' });
  assert.deepEqual(at(WEB_SHADOW_MODULE), { kind: 'web-client', place: 'shared-ui' });
});
