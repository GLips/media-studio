import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { PHOTOSHOP_FIXTURE_ERODIBLE_HEIGHTS, photoshopAbrFixture } from '#lib/picture/photoshop-brushes/engine/photoshop-abr-fixture.ts';
import { writePhotoshopAbr } from '#lib/picture/photoshop-brushes/engine/photoshop-abr.ts';
import { readStampPaintPack, resolveStampPaintPackBrushes, stampPaintPackDiameter } from '../models/stamp-paint-pack.ts';
import { importStampPaintPack } from './import-stamp-paint-pack.ts';
import { readStampPaintPackGeneration } from './stamp-paint-pack-files.ts';

test('importing an .abr writes the same pack layout a Procreate pack imports to, its generation replacing only what an import writes', () => {
  withStudioTemp('abr-import', (dir) => {
    writeFileSync(join(dir, 'chalk.abr'), writePhotoshopAbr(photoshopAbrFixture()));
    const packDir = join(dir, 'styles/sketch/brushes/chalk');
    // Photoshop's captures and a drawn sheet sit beside the generations, so they stay.
    for (const kept of ['reference', 'fidelity']) mkdirSync(join(packDir, kept), { recursive: true });
    writeFileSync(join(packDir, 'reference/manifest.json'), '{}');
    writeFileSync(join(packDir, 'fidelity/report.json'), '{}');
    const { manifest } = importStampPaintPack({ archive: join(dir, 'chalk.abr'), stylesDir: join(dir, 'styles'), style: 'sketch', pack: 'chalk' });
    assert.equal(manifest.app, 'photoshop');
    assert.deepEqual(readdirSync(packDir).toSorted(), ['current', 'fidelity', 'generations', 'reference']);
    assert.equal(readFileSync(join(packDir, 'reference/manifest.json'), 'utf8'), '{}');
    const generation = readStampPaintPackGeneration(packDir);
    assert.deepEqual(readStampPaintPack(JSON.parse(readFileSync(join(generation.dir, 'manifest.json'), 'utf8'))), manifest);
    assert.deepEqual(generation.manifest, manifest);
    assert.deepEqual(Object.keys(manifest.brushes), ['Chalk', 'Chalk (Wet)', 'Pencil']);
    assert.deepEqual(manifest.files, ['grains/stripes.png', 'tips/chalk.png', 'tips/pencil.contact.png', 'tips/pencil.heights.f32', 'tips/pencil.png', 'tips/round-0-30.png']);
    for (const file of manifest.files) assert.ok(existsSync(join(generation.dir, file)), file);
    assert.deepEqual(manifest.previews, {});
    assert.deepEqual([stampPaintPackDiameter(manifest, 'Chalk'), stampPaintPackDiameter(manifest, 'Chalk (Wet)')], [48, 30]);
    const brushes = resolveStampPaintPackBrushes(manifest), chalk = brushes.Chalk;
    assert.equal(chalk.grain?.kind, 'canvas');
    assert.deepEqual(chalk.grain?.blend, { family: 'texture', mode: 'height' });
    assert.equal(chalk.grain?.scale, 4 / 48);
    // A Mixer Brush's wet mixing stays in its source, the preset's tool options, for the wet-paint model (vid-90).
    const mixer = manifest.brushes['Chalk (Wet)'].preset.tool;
    assert.deepEqual(mixer?.kind === 'MixB' && [mixer.wetness, mixer.dryness, mixer.mix], [50, 100, 50]);
    // An erodible tip paints its footprint, pressed by a contact image drawn from its height map, which sits beside it.
    const pencil = manifest.brushes.Pencil.tip;
    assert.ok(pencil.kind === 'erodible');
    assert.deepEqual(readFileSync(join(generation.dir, pencil.heightMap.file)), PHOTOSHOP_FIXTURE_ERODIBLE_HEIGHTS);
    const pencilTip = brushes.Pencil.tip;
    assert.ok(!('bristles' in pencilTip));
    assert.equal(pencilTip.image.file, 'tips/pencil.png');
    assert.equal(pencilTip.pressed?.contact.file, 'tips/pencil.contact.png');
  });
});

test("a manifest is read whole: a field of the wrong shape anywhere, or a tip's image of another kind than its tip, is refused", () => {
  withStudioTemp('abr-manifest', (dir) => {
    writeFileSync(join(dir, 'chalk.abr'), writePhotoshopAbr(photoshopAbrFixture()));
    importStampPaintPack({ archive: join(dir, 'chalk.abr'), stylesDir: join(dir, 'styles'), style: 'sketch', pack: 'chalk' });
    const stored = () => JSON.parse(readFileSync(join(readStampPaintPackGeneration(join(dir, 'styles/sketch/brushes/chalk')).dir, 'manifest.json'), 'utf8'));
    const refused = (change: (m: ReturnType<typeof stored>) => void, problem: RegExp) => {
      const m = stored();
      change(m);
      assert.throws(() => readStampPaintPack(m), problem);
    };
    refused((m) => void (m.previews.bad = 42), /previews\.bad isn't an object/);
    refused((m) => void (m.brushes.Chalk.pattern.width = 'wrong'), /brushes\.Chalk\.pattern\.width/);
    refused((m) => void (m.brushes.Chalk.tip.kind = 'round'), /brushes\.Chalk\.tip\.kind is "round", not one of sampled/);
    refused((m) => void (m.brushes.Pencil.preset.Brsh.Dmtr = { _unit: '#Pxl' }), /brushes\.Pencil\.preset\.Brsh\.Dmtr isn't a descriptor value/);
  });
});
