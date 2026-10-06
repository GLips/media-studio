import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { PHOTOSHOP_FIXTURE_ERODIBLE_HEIGHTS, photoshopAbrFixture } from '#lib/paint/photoshop-brushes/engine/photoshop-abr-fixture.ts';
import { writePhotoshopAbr } from '#lib/paint/photoshop-brushes/engine/photoshop-abr.ts';
import { readStampPaintPack, readStampPaintPackBrushSources, resolveStampPaintPackBrushes, stampPaintPackDiameter } from '../models/stamp-paint-pack.ts';
import { stampBrushEdgeReach, stampBrushMeasuredProfile } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { STAMP_BRUSH_PROBE_BARE_MEDIUM, stampBrushProbeMediumKey, type StampBrushProbeMedium } from '../models/stamp-brush-profile-probes.ts';
import { importStampPaintPack, measureStampPaintPackProfiles, type StampPaintPackMeasuring } from './import-stamp-paint-pack.ts';
import { readProfiledStampPaintPack, STAMP_PACK_PROFILES } from './stamp-brush-profile-store.ts';
import { readStampPaintPackGeneration } from './stamp-paint-pack-files.ts';

/** An edge `left` px to its left and `right` to its right at every heading. */
const sides = (left: number, right: number) => ({ left: Array.from({ length: 8 }, () => left), right: Array.from({ length: 8 }, () => right) });

/**
 * The browser's measuring stood in for, in `medium`: each brush measured alike but Pencil, refused, the names asked
 * for kept in `asked`.
 */
function standInMeasuring(asked: string[], medium: StampBrushProbeMedium = STAMP_BRUSH_PROBE_BARE_MEDIUM): StampPaintPackMeasuring {
  const provenance = { adapter: 'stand-in', browser: 'stand-in', renderer: 'stand-in', seeds: ['a'], measuredAt: '2026-10-01T00:00:00Z' };
  const support = { main: { width: 64, height: 64, span: 1, roundness: 1, reach: [0.5, 0.52] }, dual: null };
  return {
    medium,
    measure: async ({ brushes, onMeasured }) => {
      for (const { name } of brushes) {
        asked.push(name);
        if (name === 'Pencil') onMeasured(name, { kind: 'refused', why: 'its stroke lays nothing along its centre' });
        else onMeasured(name, { kind: 'measured', provenance, samples: [{ diameter: 8, edge: sides(3.25, 3.25), edgeNoise: 0, support }, { diameter: 128, edge: sides(50, 54), edgeNoise: 0, support }] });
      }
    },
  };
}

test('importing an .abr writes the same pack layout a Procreate pack imports to, its generation replacing only what an import writes', () => {
  return withStudioTemp('abr-import', async (dir) => {
    writeFileSync(join(dir, 'chalk.abr'), writePhotoshopAbr(photoshopAbrFixture()));
    const packDir = join(dir, 'styles/sketch/brushes/chalk');
    // Photoshop's captures, a drawn sheet and the profiles sit beside the generations, so they stay.
    for (const kept of ['reference', 'fidelity']) mkdirSync(join(packDir, kept), { recursive: true });
    writeFileSync(join(packDir, 'reference/manifest.json'), '{}');
    writeFileSync(join(packDir, 'fidelity/report.json'), '{}');
    const { manifest } = await importStampPaintPack({ archive: join(dir, 'chalk.abr'), stylesDir: join(dir, 'styles'), style: 'sketch', pack: 'chalk' }, standInMeasuring([]));
    assert.equal(manifest.app, 'photoshop');
    assert.deepEqual(readdirSync(packDir).toSorted(), ['current', 'fidelity', 'generations', 'profiles', 'reference']);
    assert.equal(readFileSync(join(packDir, 'reference/manifest.json'), 'utf8'), '{}');
    const generation = readStampPaintPackGeneration(packDir);
    assert.deepEqual(readStampPaintPack(JSON.parse(readFileSync(join(generation.dir, 'manifest.json'), 'utf8'))), manifest);
    assert.deepEqual(generation.manifest, manifest);
    assert.deepEqual(Object.keys(manifest.brushes), ['Chalk', 'Chalk (Wet)', 'Pencil']);
    assert.deepEqual(manifest.files, ['grains/stripes.png', 'tips/chalk.png', 'tips/pencil.contact.png', 'tips/pencil.heights.f32', 'tips/pencil.png', 'tips/round-0-30.png']);
    for (const file of manifest.files) assert.ok(existsSync(join(generation.dir, file)), file);
    assert.deepEqual(manifest.previews, {});
    assert.deepEqual([stampPaintPackDiameter(manifest, 'Chalk'), stampPaintPackDiameter(manifest, 'Chalk (Wet)')], [48, 30]);
    const brushes = readStampPaintPackBrushSources(manifest), chalk = brushes.Chalk;
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
  return withStudioTemp('abr-manifest', async (dir) => {
    writeFileSync(join(dir, 'chalk.abr'), writePhotoshopAbr(photoshopAbrFixture()));
    await importStampPaintPack({ archive: join(dir, 'chalk.abr'), stylesDir: join(dir, 'styles'), style: 'sketch', pack: 'chalk' }, standInMeasuring([]));
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

test("each brush's profile is stored by its key beside the pack, and measuring again measures only the brushes whose key has none, leaving the pack be", () => {
  return withStudioTemp('abr-profiles', async (dir) => {
    const archive = join(dir, 'chalk.abr');
    writeFileSync(archive, writePhotoshopAbr(photoshopAbrFixture()));
    const place = { stylesDir: join(dir, 'styles'), style: 'sketch', pack: 'chalk' }, asked: string[] = [];
    const first = await importStampPaintPack({ ...place, archive }, standInMeasuring(asked));
    assert.deepEqual(asked, ['Chalk', 'Chalk (Wet)', 'Pencil']);
    // A pack is painted from with the profiles stored at its brushes' keys in the medium its style probes in now.
    const generation = readStampPaintPackGeneration(first.dir);
    const brushes = resolveStampPaintPackBrushes(readProfiledStampPaintPack(place, generation, stampBrushProbeMediumKey(STAMP_BRUSH_PROBE_BARE_MEDIUM, {})));
    // Heading down, its right side faces way 16 of 32, to the left.
    assert.equal(stampBrushEdgeReach(stampBrushMeasuredProfile(brushes.Chalk), 128, 'Chalk').right[16], 54);
    assert.deepEqual(brushes.Pencil.profile, { kind: 'refused', why: 'its stroke lays nothing along its centre' });
    assert.throws(() => stampBrushMeasuredProfile(brushes.Pencil), /its stroke lays nothing along its centre/);
    const elsewhere = resolveStampPaintPackBrushes(readProfiledStampPaintPack(place, generation, 'another paper')).Chalk.profile;
    assert.equal(elsewhere.kind === 'refused' && elsewhere.why, "none is measured for it as it is now, on sketch's paper and paint; measure it: studio brushes import --style sketch --pack chalk");

    // Without an archive: nothing to measure, and the pack's generation and manifest stay as they were.
    const manifest = readFileSync(join(generation.dir, 'manifest.json'));
    const again = await measureStampPaintPackProfiles(place, standInMeasuring(asked));
    assert.equal(asked.length, 3);
    assert.deepEqual(again.profiles, first.profiles);
    assert.equal(readStampPaintPackGeneration(first.dir).dir, generation.dir);
    assert.deepEqual(readFileSync(join(generation.dir, 'manifest.json')), manifest);
    // The archive again: a new generation of the same images, whose profiles are stored already.
    await importStampPaintPack({ ...place, archive }, standInMeasuring(asked));
    assert.equal(asked.length, 3);

    // On another paper every key is new: each brush is measured, its file added beside the first's.
    const stored = readdirSync(join(first.dir, STAMP_PACK_PROFILES));
    await measureStampPaintPackProfiles(place, standInMeasuring(asked, { ...STAMP_BRUSH_PROBE_BARE_MEDIUM, paper: { color: '#e8e0d0' } }));
    assert.deepEqual(asked.slice(3), ['Chalk', 'Chalk (Wet)', 'Pencil']);
    const now = readdirSync(join(first.dir, STAMP_PACK_PROFILES));
    assert.equal(now.length, 6);
    assert.ok(stored.every((file) => now.includes(file)));
  });
});
