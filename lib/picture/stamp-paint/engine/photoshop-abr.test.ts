import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import type { PhotoshopDescriptor } from '../models/photoshop-descriptor.ts';
import type { StampPaintPackManifest } from '../models/style.ts';
import { importStampPaintPack } from './import-stamp-paint-pack.ts';
import { readPhotoshopAbr, writePhotoshopAbr, type PhotoshopBrushFile } from './photoshop-abr.ts';

const pct = (value: number) => ({ _unit: '#Prc', value });
const px = (value: number) => ({ _unit: '#Pxl', value });

/** A licence-free pack: a drawn gradient tip, a drawn stripe pattern, a textured sampled brush and a soft round Mixer Brush. */
function fixture(): Omit<PhotoshopBrushFile, 'kind'> {
  const tip = { width: 24, height: 16, pixels: Uint8Array.from({ length: 24 * 16 }, (_, i) => (i % 24) * 10) };
  const stripes = { width: 8, height: 8, pixels: Uint8Array.from({ length: 64 }, (_, i) => (i % 8 < 4 ? 40 : 220)) };
  const textured: PhotoshopDescriptor = {
    _class: 'brushPreset', 'Nm  ': '$$$/Presets/Brushes/Chalk=Chalk',
    Brsh: { _class: 'sampledBrush', Dmtr: px(48), Angl: { _unit: '#Ang', value: 30 }, Rndn: pct(80), Spcn: pct(15), Intr: true, flipX: false, flipY: true, sampledData: 'tip-1' },
    useTexture: true, Txtr: { _class: 'Ptrn', 'Nm  ': 'Stripes', Idnt: 'pattern-1' }, textureScale: pct(50), textureBlendMode: { _enum: 'BlnM', value: 'Hght' },
    textureDepth: pct(60), TxtC: false, InvT: true, textureBrightness: { _long: -10 },
  };
  const mixer: PhotoshopDescriptor = {
    _class: 'brushPreset', 'Nm  ': 'Chalk',
    Brsh: { _class: 'computedBrush', Dmtr: px(30), Hrdn: pct(0), Angl: { _unit: '#Ang', value: 0 }, Rndn: pct(100), Spcn: pct(25), Intr: true },
    toolOptions: { _class: 'MixB', flow: { _long: 80 }, wetness: 50, dryness: 100, mix: 50, sampleAllLayers: false },
  };
  return {
    presets: [{ descriptor: textured, group: 'Dry' }, { descriptor: mixer, group: 'Wet' }],
    tips: new Map([['tip-1', tip]]),
    patterns: new Map([['pattern-1', { name: 'Stripes', image: stripes }]]),
  };
}

test('an .abr written as Photoshop lays one out reads back as it was: presets, groups, tips and patterns', () => {
  const written = fixture(), bytes = writePhotoshopAbr(written), read = readPhotoshopAbr(bytes);
  assert.deepEqual(read.presets, written.presets);
  assert.deepEqual(read.tips, written.tips);
  assert.deepEqual(read.patterns, written.patterns);
  // `flow` is a stringID four letters long: written as a charID, Photoshop would read it as another key.
  assert.ok(Buffer.from(bytes).includes(Buffer.from('\0\0\0\x04flowlong', 'latin1')));
});

test('importing an .abr writes the same pack layout a Procreate pack imports to, replacing only what an import writes', () => {
  withStudioTemp('abr-import', (dir) => {
    writeFileSync(join(dir, 'chalk.abr'), writePhotoshopAbr(fixture()));
    const packDir = join(dir, 'styles/sketch/brushes/chalk');
    // Photoshop's captures and a drawn sheet stay; a Procreate import's previews go with the rest of what it wrote.
    for (const kept of ['reference', 'fidelity', 'previews']) mkdirSync(join(packDir, kept), { recursive: true });
    writeFileSync(join(packDir, 'reference/manifest.json'), '{}');
    writeFileSync(join(packDir, 'fidelity/report.json'), '{}');
    writeFileSync(join(packDir, 'previews/old.png'), '');
    const { app, manifest } = importStampPaintPack({ archive: join(dir, 'chalk.abr'), stylesDir: join(dir, 'styles'), style: 'sketch', pack: 'chalk' });
    assert.equal(app, 'photoshop');
    assert.deepEqual(readdirSync(packDir).sort(), ['fidelity', 'grains', 'manifest.json', 'photoshop-sources.json', 'reference', 'tips']);
    assert.equal(readFileSync(join(packDir, 'reference/manifest.json'), 'utf8'), '{}');
    assert.deepEqual(JSON.parse(readFileSync(join(packDir, 'manifest.json'), 'utf8')), JSON.parse(JSON.stringify(manifest)) as StampPaintPackManifest);
    assert.deepEqual(Object.keys(manifest.brushes), ['Chalk', 'Chalk (Wet)']);
    assert.deepEqual(manifest.files, ['grains/stripes.png', 'tips/chalk.png', 'tips/round-0.png']);
    for (const file of manifest.files) assert.ok(existsSync(join(packDir, file)), file);
    assert.deepEqual(manifest.previews, {});
    assert.deepEqual(manifest.diameters, { Chalk: 48, 'Chalk (Wet)': 30 });
    const chalk = manifest.brushes.Chalk;
    assert.equal(chalk.grain?.mode, 'texturized');
    assert.equal(chalk.grain?.blend, 'height');
    assert.equal(chalk.grain?.scale, 4 / 48);
    assert.equal(manifest.brushes['Chalk (Wet)'].wetMix?.load, 1);
  });
});
