import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';
import { STAMP_PAINT_ASSETS_VERSION } from '#lib/paint/brush-packs/models/stamp-paint-pack.ts';
import { writeProjectStylesModule } from './project-styles.ts';
import { replaceStampPaintPack } from '#lib/paint/brush-packs/engine/stamp-paint-pack-files.ts';

let workspaces = 0;
const washBrush = { main: { settings: {}, tip: { style: 'wash', pack: 'vvds', file: 'tips/wash-01.png' } } };
const toothBrush = { main: { settings: {}, tip: { style: 'wash', pack: 'grain', file: 'tips/tooth.png' } } };
/** A Procreate pack's manifest holding `brushes`, listing `files`. */
const packManifest = (files: readonly string[], brushes: object, version = STAMP_PAINT_ASSETS_VERSION) => ({
  version, app: 'procreate', files, brushes, source: { archive: 'pack.zip', sha256: '' }, skipped: {}, previews: {}, palettes: {}, papers: {},
});

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
  const archive = join(root, 'pack.zip');
  writeFileSync(archive, '');
  const importPack = (pack: string, manifest: object, files: readonly string[]) => replaceStampPaintPack({ archive, stylesDir: join(root, 'work', 'styles'), style: 'wash', pack }, (generation) => {
    for (const file of files) {
      mkdirSync(join(generation, file, '..'), { recursive: true });
      writeFileSync(join(generation, file), '');
    }
    writeFileSync(join(generation, 'manifest.json'), JSON.stringify(manifest));
    return {};
  });
  return { project, importPack, writeStyle };
}

test('a named style stops the bundle until each pack is imported, whole, at the version the studio reads, then serves the images it paints with', () => {
  const { project, importPack } = washProject(['wash']);
  importPack('vvds', packManifest(['tips/wash-01.png', 'grains/paper.png'], {}), ['tips/wash-01.png']);
  assert.throws(() => writeProjectStylesModule(project), {
    message: 'styles: wash can\'t paint until its packs are imported in work/styles/wash/ (brushes/ isn\'t in git, so each machine imports its own; docs/private-styles.md):\n'
      + '  brushes/vvds/grains/paper.png: VVDS Watercolor Studio, from Creative Market\n'
      + '  brushes/grain/: not imported: Grain Pack, from the Grain shop\n'
      + '  brushes.wash: vvds has no brush "Wet Wash"; import it again from VVDS Watercolor Studio, from Creative Market',
  });

  importPack('vvds', packManifest(['tips/wash-01.png', 'grains/paper.png'], { 'Wet Wash': washBrush }), ['tips/wash-01.png', 'grains/paper.png']);
  importPack('grain', packManifest([], {}, STAMP_PAINT_ASSETS_VERSION - 1), []);
  assert.throws(() => writeProjectStylesModule(project), {
    message: new RegExp(`  brushes/grain/: .*manifest\\.json: imported as version ${STAMP_PAINT_ASSETS_VERSION - 1}, and the studio reads version ${STAMP_PAINT_ASSETS_VERSION}; import it again with studio brushes import \\(Grain Pack, from the Grain shop\\)$`),
  });

  importPack('grain', packManifest([], { Tooth: toothBrush }), []);
  const module = readFileSync(writeProjectStylesModule(project), 'utf8');
  assert.match(module, /^import image0_0 from "\.\.\/\.\.\/\.\.\/styles\/wash\/brushes\/vvds\/generations\/[^/]+\/tips\/wash-01\.png";$/m);
  assert.match(module, /^      "vvds\/tips\/wash-01\.png": image0_0,$/m);
});

test("a style's paper must be a file its pack's import wrote", () => {
  const { project, importPack, writeStyle } = washProject(['wash']);
  importPack('vvds', packManifest(['papers/cold-press.png'], { 'Wet Wash': washBrush }), ['papers/cold-press.png']);
  importPack('grain', packManifest([], { Tooth: toothBrush }), []);
  writeStyle({ color: '#f4efe4', image: { pack: 'vvds', file: 'papers/hot-press.png' }, grain: { image: { pack: 'paper', file: 'tooth.png' }, scale: 1, depth: 0.3 } });
  assert.throws(() => writeProjectStylesModule(project), {
    message: /  paper\.image: vvds has no file papers\/hot-press\.png; import it again from VVDS Watercolor Studio, from Creative Market\n  paper\.grain: names the pack paper, which isn't in packs$/,
  });
});

test('a project that names no style bundles without one, and a name work/styles/ lacks is refused', () => {
  writeProjectStylesModule(washProject([]).project);
  assert.throws(() => writeProjectStylesModule(washProject(['wahs']).project), {
    message: 'styles: p\'s project.ts names "wahs", which isn\'t a style (work/styles/ has wash)',
  });
});
