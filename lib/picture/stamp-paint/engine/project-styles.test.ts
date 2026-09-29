import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';
import { STAMP_PAINT_ASSETS_VERSION } from '../models/style.ts';
import { assertProjectStylesReady } from './project-styles.ts';

let workspaces = 0;

function washProject(styles: readonly string[]) {
  const root = join(studioTempRoot(), `styles-${++workspaces}`);
  const project = join(root, 'work', 'projects', 'p'), style = join(root, 'work', 'styles', 'wash');
  mkdirSync(project, { recursive: true });
  mkdirSync(style, { recursive: true });
  writeFileSync(join(project, 'project.ts'), `export default ${JSON.stringify({ capability: 'silent', styles })};\n`);
  const packs = { vvds: { source: 'VVDS Watercolor Studio, from Creative Market' }, grain: { source: 'Grain Pack, from the Grain shop' } };
  const brushes = { wash: { pack: 'vvds', brush: 'Wet Wash' }, tooth: { pack: 'grain', brush: 'Tooth' } };
  // style.ts is read with require, which caches it: write it before the first check.
  const writeStyle = (paper: object) => writeFileSync(join(style, 'style.ts'), `export default ${JSON.stringify({ packs, brushes, palette: { sky: '#88aacc' }, paper })};\n`);
  writeStyle({ color: '#f4efe4' });
  const importPack = (pack: string, manifest: object, files: readonly string[]) => {
    mkdirSync(join(style, 'brushes', pack), { recursive: true });
    for (const file of files) {
      mkdirSync(join(style, 'brushes', pack, file, '..'), { recursive: true });
      writeFileSync(join(style, 'brushes', pack, file), '');
    }
    writeFileSync(join(style, 'brushes', pack, 'manifest.json'), JSON.stringify(manifest));
  };
  return { project, importPack, writeStyle };
}

test('a named style stops the bundle until each pack is imported, whole, at the version the studio reads', () => {
  const { project, importPack } = washProject(['wash']);
  importPack('vvds', { version: STAMP_PAINT_ASSETS_VERSION, files: ['tips/wash-01.png', 'grains/paper.png'], brushes: {} }, ['tips/wash-01.png']);
  assert.throws(() => assertProjectStylesReady(project), {
    message: 'styles: wash can\'t paint until its packs are imported in work/styles/wash/ (brushes/ isn\'t in git, so each machine imports its own; docs/private-styles.md):\n'
      + '  brushes/vvds/grains/paper.png: VVDS Watercolor Studio, from Creative Market\n'
      + '  brushes/grain/manifest.json: Grain Pack, from the Grain shop\n'
      + '  brushes.wash: vvds has no brush "Wet Wash"; import it again from VVDS Watercolor Studio, from Creative Market',
  });

  importPack('vvds', { version: STAMP_PAINT_ASSETS_VERSION, files: ['tips/wash-01.png', 'grains/paper.png'], brushes: { 'Wet Wash': {} } }, ['grains/paper.png']);
  importPack('grain', { version: STAMP_PAINT_ASSETS_VERSION - 1, files: [], brushes: {} }, []);
  assert.throws(() => assertProjectStylesReady(project), {
    message: /  brushes\/grain\/: imported as version 0, and the studio reads version 1; import it again from Grain Pack, from the Grain shop$/,
  });

  importPack('grain', { version: STAMP_PAINT_ASSETS_VERSION, files: [], brushes: { Tooth: {} } }, []);
  assertProjectStylesReady(project);
});

test("a style's paper must be a file its pack's import wrote", () => {
  const { project, importPack, writeStyle } = washProject(['wash']);
  importPack('vvds', { version: STAMP_PAINT_ASSETS_VERSION, files: ['papers/cold-press.png'], brushes: { 'Wet Wash': {} } }, ['papers/cold-press.png']);
  importPack('grain', { version: STAMP_PAINT_ASSETS_VERSION, files: [], brushes: { Tooth: {} } }, []);
  writeStyle({ color: '#f4efe4', image: { pack: 'vvds', file: 'papers/hot-press.png' }, grain: { image: { pack: 'paper', file: 'tooth.png' }, scale: 1, depth: 0.3 } });
  assert.throws(() => assertProjectStylesReady(project), {
    message: /  paper\.image: vvds has no file papers\/hot-press\.png; import it again from VVDS Watercolor Studio, from Creative Market\n  paper\.grain: names the pack paper, which isn't in packs$/,
  });
});

test('a project that names no style bundles without one, and a name work/styles/ lacks is refused', () => {
  assertProjectStylesReady(washProject([]).project);
  assert.throws(() => assertProjectStylesReady(washProject(['wahs']).project), {
    message: 'styles: p\'s project.ts names "wahs", which isn\'t a style (work/styles/ has wash)',
  });
});
