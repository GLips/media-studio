// node harness/brush-fidelity.ts <sheet|fit|diagnose|hand> (npm run brushes:sheet / brushes:fit / brushes:diagnose /
// brushes:hand): how close an imported pack's brushes paint to their targets, fitting the importer's Procreate reading
// to close the gap, the per-brush diagnostic of its Photoshop reading, and how a brush answers each stroke hand
// (lib/picture/stamp-paint/engine/stamp-brush-sheet.ts, stamp-brush-fit.ts, photoshop-reading-diagnostic.ts,
// stamp-stroke-hand-sheet.ts; docs/private-styles.md).
import { defineCommand } from 'citty';
import { relative, resolve } from 'node:path';
import { diagnosePhotoshopReading } from '#lib/picture/stamp-paint/engine/photoshop-reading-diagnostic.ts';
import { fitStampBrushReading } from '#lib/picture/stamp-paint/engine/stamp-brush-fit.ts';
import type { PhotoshopReading } from '#lib/picture/stamp-paint/models/photoshop-brush.ts';
import { writeStampBrushSheet } from '#lib/picture/stamp-paint/engine/stamp-brush-sheet.ts';
import { writeStampStrokeHandSheet } from '#lib/picture/stamp-paint/engine/stamp-stroke-hand-sheet.ts';
import { STUDIO_ROOT, STUDIO_STYLES_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { runHarnessCommand } from './run-harness-command.ts';

const packsOf = (verb: string, list: string) => list.split(',').map((entry) => {
  const [style, pack] = entry.trim().split('/');
  if (!style || !pack) throw new Error(`brushes ${verb}: ${JSON.stringify(entry)} isn't <style>/<pack>`);
  return { style, pack };
});

const sheetCommand = defineCommand({
  meta: {
    name: 'sheet',
    description: "Draw the brush fidelity sheet for an imported pack: each brush painted on the GPU beside its target: along the stroke its Procreate preview was drawn with, at the diameter that matches the preview's thickness; or, for a Photoshop brush, as the rig painted its reference S-curve, at its diameter under simulated pressure; with both measured (coverage map, length, thickness profile, where each end reaches 80% of its peak, density, rim, grain size, edge width, mottle, fill) into one score per brush and its grade (close, rough, off), and the note from the style's fidelity.ts. Writes rows/<brush>.png, sheet.jpg (the rows at half size; sheet-1.jpg on past 120 brushes) and report.json into work/styles/<style>/brushes/<pack>/fidelity/ (git ignores it: it holds the pack's previews), or --out; a whole pack drawn there also writes the grades into work/styles/<style>/fidelity-grades.json. Prints a line per brush.",
  },
  args: {
    style: { type: 'string', required: true, description: 'The style, work/styles/<style>/' },
    pack: { type: 'string', required: true, description: "The pack's folder in the style's brushes/" },
    brush: { type: 'string', valueHint: 'Dry Brush', description: 'Only these brushes, by their names in the pack (comma-separated)' },
    out: { type: 'string', description: 'Write here instead, to keep a sheet from before a change' },
  },
  async run({ args }) {
    const only = args.brush?.split(',').map((name) => name.trim()).filter(Boolean);
    const { dir, sheets, entries, scores } = await writeStampBrushSheet({ stylesDir: STUDIO_STYLES_DIR, style: args.style, pack: args.pack, out: args.out && resolve(args.out), only });
    for (const { brush, diameter, comparison, grade, target } of entries) {
      const measured = comparison ? `score ${comparison.score.toFixed(3)}, map off ${Math.round(comparison.mapError * 100)}%, density ${comparison.density.toFixed(2)}` : 'nothing to measure against';
      console.log(`${brush}: ${grade ?? 'ungraded'} (d ${diameter}, ${target ? `against its ${target}, ` : ''}${measured})`);
    }
    const scored = entries.filter((e) => e.comparison);
    console.error(`brushes sheet: ${sheets.map((sheet) => relative(STUDIO_ROOT, sheet)).join(', ')}, with a row per brush in ${relative(STUDIO_ROOT, dir)}/rows/ and report.json; total score ${scored.reduce((sum, e) => sum + e.comparison!.score, 0).toFixed(3)} over ${scored.length} brushes`);
    if (scores) console.error(`brushes sheet: grades written to ${relative(STUDIO_ROOT, scores)}`);
  },
});

const fitCommand = defineCommand({
  meta: {
    name: 'fit',
    description: "Fit the importer's Procreate reading (lib/picture/stamp-paint/models/procreate-brush.ts: grain tile, brightness and contrast, rim width, sharpness and darkness, taper share, flow and depth curves, dual size) against every previewed brush of the packs given at once, by the brush fidelity sheet's summed score, and write it into models/procreate-reading.ts. Deterministic: the same packs and starting reading take the same steps. Prints each step, each brush's score before and after and which constants moved. Re-import the packs afterwards, so their manifests read the brushes by it.",
  },
  args: {
    packs: { type: 'string', required: true, valueHint: 'watercolor/vvds', description: 'The packs to fit against, each <style>/<pack>, comma-separated' },
    only: { type: 'string', valueHint: 'grainTile,edgeWidth', description: 'Search only these constants, by name (comma-separated)' },
    'dry-run': { type: 'boolean', description: "Report the fit without writing procreate-reading.ts" },
  },
  async run({ args }) {
    const packs = packsOf('fit', args.packs);
    const keys = args.only?.split(',').map((key) => key.trim()) as Parameters<typeof fitStampBrushReading>[0]['keys'];
    const fit = await fitStampBrushReading({ stylesDir: STUDIO_STYLES_DIR, packs, keys, write: !args['dry-run'], log: (line) => console.error(line) });
    for (const { pack, brush, before, after } of fit.brushes) console.log(`${pack} ${brush}: ${before.toFixed(3)} → ${after.toFixed(3)}`);
    for (const key of Object.keys(fit.before) as (keyof typeof fit.before)[]) {
      if (fit.before[key] !== fit.after[key]) console.log(`moved ${key}: ${fit.before[key]} → ${fit.after[key]}`);
    }
    console.error(`brushes fit: total ${fit.total.before.toFixed(3)} → ${fit.total.after.toFixed(3)}${fit.written ? `; wrote ${relative(STUDIO_ROOT, fit.written)}, so re-import the packs` : ''}`);
  },
});

const diagnoseCommand = defineCommand({
  meta: {
    name: 'diagnose',
    description: "The per-brush diagnostic of the importer's Photoshop reading (lib/picture/stamp-paint/models/photoshop-reading.ts): each constant tried at multiples of its value on every brush that uses it, painted against its Photoshop reference, each brush's best printed with whether the training brushes cluster (tight, bimodal, scattered), and the training and held-out totals by candidate. Writes nothing.",
  },
  args: {
    packs: { type: 'string', required: true, valueHint: 'watercolor/photoshop-legacy,watercolor/kyle-gouache', description: 'Packs with Photoshop references, each <style>/<pack>, comma-separated' },
    keys: { type: 'string', default: 'scatterSpan,angleJitterSpan,dualScale', description: 'The reading constants to diagnose (comma-separated)' },
  },
  async run({ args }) {
    const keys = args.keys.split(',').map((key) => key.trim()) as (keyof PhotoshopReading)[];
    const diagnoses = await diagnosePhotoshopReading({ stylesDir: STUDIO_STYLES_DIR, packs: packsOf('diagnose', args.packs), keys, log: (line) => console.error(line) });
    for (const { key, values, brushes, spread, training, heldOut } of diagnoses) {
      const at = (list: number[]) => list.map((total, i) => `${+values[i].toFixed(4)}: ${total.toFixed(3)}`).join(', ');
      console.log(`${key}: training brushes ${spread}`);
      for (const b of brushes) console.log(`  ${b.heldOut ? 'held out ' : ''}${b.pack} ${b.brush}: best ${+values[b.best].toFixed(4)}${b.sensitive ? '' : ' (insensitive)'} [${b.scores.map((score) => score.toFixed(3)).join(' ')}]`);
      console.log(`  training total by value: ${at(training)}`);
      console.log(`  held-out total by value: ${at(heldOut)}`);
    }
  },
});

const handCommand = defineCommand({
  meta: {
    name: 'hand',
    description: "The stroke hand sheet: one path painted with each brush under each pressure profile, with and without curvature and wobble, beside constant pressure, a PNG per brush, to see how a brush answers a hand before choosing.",
  },
  args: {
    style: { type: 'string', required: true, description: 'The style, work/styles/<style>/' },
    pack: { type: 'string', required: true, description: "The pack's folder in the style's brushes/" },
    brush: { type: 'string', required: true, valueHint: 'Dry Brush', description: 'The brushes, by their names in the pack (comma-separated)' },
    diameter: { type: 'string', default: '36', description: 'The stamp diameter, in pixels' },
    out: { type: 'string', required: true, description: 'The folder to write the PNGs into' },
  },
  async run({ args }) {
    const brushes = args.brush.split(',').map((name) => name.trim()).filter(Boolean);
    const written = await writeStampStrokeHandSheet({ stylesDir: STUDIO_STYLES_DIR, style: args.style, pack: args.pack, brushes, diameter: Number(args.diameter), out: resolve(args.out) });
    for (const file of written) console.log(relative(STUDIO_ROOT, file));
  },
});

await runHarnessCommand(defineCommand({
  meta: { name: 'brush-fidelity', description: "How close an imported pack's brushes paint to their targets, and fitting the importer to them" },
  subCommands: { sheet: sheetCommand, fit: fitCommand, diagnose: diagnoseCommand, hand: handCommand },
}));
