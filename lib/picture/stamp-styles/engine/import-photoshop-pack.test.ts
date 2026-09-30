import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { photoshopAbrFixture } from '#lib/picture/photoshop-brushes/engine/photoshop-abr-fixture.ts';
import { writePhotoshopAbr } from '#lib/picture/photoshop-brushes/engine/photoshop-abr.ts';
import { readStampPaintPack, resolveStampPaintPackBrushes, stampPaintPackDiameter } from '../models/stamp-paint-pack.ts';
import { importStampPaintPack } from './import-stamp-paint-pack.ts';

test('importing an .abr writes the same pack layout a Procreate pack imports to, replacing only what an import writes', () => {
  withStudioTemp('abr-import', (dir) => {
    writeFileSync(join(dir, 'chalk.abr'), writePhotoshopAbr(photoshopAbrFixture()));
    const packDir = join(dir, 'styles/sketch/brushes/chalk');
    // Photoshop's captures and a drawn sheet stay; a Procreate import's previews go with the rest of what it wrote.
    for (const kept of ['reference', 'fidelity', 'previews']) mkdirSync(join(packDir, kept), { recursive: true });
    writeFileSync(join(packDir, 'reference/manifest.json'), '{}');
    writeFileSync(join(packDir, 'fidelity/report.json'), '{}');
    writeFileSync(join(packDir, 'previews/old.png'), '');
    const { manifest } = importStampPaintPack({ archive: join(dir, 'chalk.abr'), stylesDir: join(dir, 'styles'), style: 'sketch', pack: 'chalk' });
    assert.equal(manifest.app, 'photoshop');
    assert.deepEqual(readdirSync(packDir).sort(), ['fidelity', 'grains', 'manifest.json', 'reference', 'tips']);
    assert.equal(readFileSync(join(packDir, 'reference/manifest.json'), 'utf8'), '{}');
    assert.deepEqual(readStampPaintPack(JSON.parse(readFileSync(join(packDir, 'manifest.json'), 'utf8'))), manifest);
    assert.deepEqual(Object.keys(manifest.brushes), ['Chalk', 'Chalk (Wet)']);
    assert.deepEqual(manifest.files, ['grains/stripes.png', 'tips/chalk.png', 'tips/round-0-30.png']);
    for (const file of manifest.files) assert.ok(existsSync(join(packDir, file)), file);
    assert.deepEqual(manifest.previews, {});
    assert.deepEqual([stampPaintPackDiameter(manifest, 'Chalk'), stampPaintPackDiameter(manifest, 'Chalk (Wet)')], [48, 30]);
    const brushes = resolveStampPaintPackBrushes(manifest), chalk = brushes.Chalk;
    assert.equal(chalk.grain?.kind, 'canvas');
    assert.deepEqual(chalk.grain?.blend, { family: 'texture', mode: 'height' });
    assert.equal(chalk.grain?.scale, 4 / 48);
    assert.equal(brushes['Chalk (Wet)'].wetMix?.load, 1);
  });
});
