// node harness/stamp-reference.ts probes <run> (npm run stamp:reference -- probes <run>): the reference renderer
// (lib/picture/stamp-reference) against a Photoshop probe run, cell by cell, each cell's error split among the stages
// that own it (vid-97). `formulas`: every paired CPU/WGSL formula run on the GPU and held to its CPU side. `deposits`:
// whole deposits (fills, masking fluid, `within`) painted by the GPU renderer and the CPU reference, compared.
// `pigment`: the pigment fixture on the GPU against the CPU reference.
import { defineCommand } from 'citty';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PhotoshopCaptureManifest } from '#lib/picture/photoshop-brushes/models/photoshop-capture-plan.ts';
import { photoshopPresetMismatches } from '#lib/picture/photoshop-brushes/models/photoshop-preset.ts';
import { photoshopProbes } from '#lib/picture/photoshop-brushes/models/photoshop-probes.ts';
import { scorePhotoshopProbeRun } from '#lib/picture/stamp-reference/engine/photoshop-probe-reference.ts';
import { checkStampDepositParity } from '#lib/picture/stamp-reference/engine/stamp-deposit-parity.ts';
import { checkStampFormulaParity } from '#lib/picture/stamp-reference/engine/stamp-formula-parity.ts';
import { checkStampPigmentParity, STAMP_PIGMENT_TOLERANCE, writeStampPigmentFrames, type StampPigmentDifference } from '#lib/picture/stamp-reference/engine/stamp-pigment-parity.ts';
import { STAMP_DEPOSIT_PARITY_RMS } from '#lib/picture/stamp-reference/models/stamp-deposit-parity.ts';
import { STAMP_FORMULA_TOLERANCE } from '#lib/picture/stamp-reference/models/stamp-formula-parity.ts';
import type { StampResolveStage } from '#lib/picture/stamp-paint/models/stamp-deposit-stages.ts';
import { STUDIO_STYLES_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { runHarnessCommand } from './run-harness-command.ts';

const listArg = (value: string | undefined) => value?.split(',').map((s) => s.trim()).filter(Boolean);

const probesCommand = defineCommand({
  meta: { name: 'probes', description: "Render every probe of a Photoshop probe run (its folder, with manifest.json) through the importer and the reference renderer, and score each cell against its capture: rms and max over the painted pixels, and each stage's share. Skipped cells (grounds, poses, simulated pressure, randomness) are counted." },
  args: {
    run: { type: 'positional', required: true, description: 'The run folder, e.g. work/styles/watercolor/brushes/photoshop-probes/<run>' },
    only: { type: 'string', valueHint: 'tip computed h50,wet edges h50', description: 'Score only these probes (comma-separated)' },
    order: { type: 'string', valueHint: 'grain,dual,pooling', description: "The stages after the build, in order (the GPU renderer's by default)" },
    opacity: { type: 'string', valueHint: 'last|inBuild', description: "Where the deposit's opacity applies (last by default)" },
    json: { type: 'boolean', description: 'Print every score as JSON' },
  },
  run({ args }) {
    const dir = resolve(args.run);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as PhotoshopCaptureManifest;
    const only = listArg(args.only);
    if (manifest.kind !== 'probes') throw new Error(`stamp reference: ${dir} is a ${manifest.kind} run, not a probe run`);
    // A run's items are probes by name. One Photoshop didn't set as the probe now asks (its read-back differs) was
    // painted from another preset, so its cells aren't scored.
    const defined = new Map(photoshopProbes().map((p) => [p.name, p]));
    const untaken = new Set<string>();
    const probes = Object.entries(manifest.items).map(([name, item]) => {
      const probe = defined.get(name);
      if (!probe) throw new Error(`stamp reference: ${dir} painted probe ${JSON.stringify(name)}, which photoshopProbes() no longer defines`);
      const differs = photoshopPresetMismatches(probe.preset, item.applied);
      if (differs.length) {
        untaken.add(name);
        console.error(`stamp reference: ${JSON.stringify(name)} was painted from another preset, not scored: ${differs.join('; ')}`);
      }
      return probe;
    });
    const arrangement = { order: listArg(args.order) as StampResolveStage[] | undefined, opacity: args.opacity as 'last' | 'inBuild' | undefined };
    const { scores, skipped } = scorePhotoshopProbeRun({ dir, sheets: manifest.sheets, probes, untaken, only, arrangement });
    if (args.json) {
      console.log(JSON.stringify({ arrangement, scores, skipped }, null, 2));
      return;
    }
    for (const { probe, cell, score } of scores.toSorted((a, b) => b.score.rms - a.score.rms)) {
      const owners = score.owners.map((o) => `${o.owner} ${o.rms.toFixed(4)} (${o.pixels} px)`).join(', ');
      console.log(`${score.rms.toFixed(4)} max ${score.max.toFixed(3)}  ${probe} / ${cell}: ${owners}`);
    }
    const all = scores.map((s) => s.score.rms).toSorted((a, b) => a - b);
    console.log(`stamp reference: ${scores.length} cells, median rms ${(all[Math.floor(all.length / 2)] ?? 0).toFixed(4)}, worst ${(all.at(-1) ?? 0).toFixed(4)}; skipped ${Object.entries(skipped).map(([why, n]) => `${n} ${why}`).join(', ') || 'none'}`);
  },
});

const formulasCommand = defineCommand({
  meta: { name: 'formulas', description: `Run every paired formula's WGSL (accumulation lay, grain cut, dual combine, grain paint, pooling, accumulation resolve, region edges and noise, fill body, paint fields, fill fronts, Kubelka–Munk films, the paper's settle, contact and clumps) on the GPU over a grid of inputs, every mode, and compare it to the CPU's: fails past ${STAMP_FORMULA_TOLERANCE}.` },
  async run() {
    const results = await checkStampFormulaParity();
    for (const r of results) {
      console.log(`${r.formula}: ${r.rows} rows, worst ${r.worst.toExponential(2)} at ${r.worstAt} (gpu ${r.gpu}, cpu ${r.cpu})${r.over ? `, ${r.over} past ${STAMP_FORMULA_TOLERANCE}` : ''}`);
    }
    if (results.some((r) => r.over)) process.exitCode = 1;
  },
});

// Each accumulation the fills lay: Kyle's Photoshop washes build to their opacity, VVDS's Procreate brushes glaze or build.
const DEPOSIT_PARITY_BRUSHES = [
  { style: 'watercolor', pack: 'kyle-watercolor', name: "Kyle's Real Watercolor - Medium Wash Slow" },
  { style: 'watercolor', pack: 'kyle-watercolor', name: "Kyle's Real Watercolor - Opaque Thicker" },
  { style: 'watercolor', pack: 'vvds', name: 'Main Watercolor Brush' },
  { style: 'watercolor', pack: 'vvds', name: 'Super Wet Watercolor Brush' },
];

const depositsCommand = defineCommand({
  meta: { name: 'deposits', description: `Paint a stroke, and a fill under a ragged partly lifted mask (alone, within a region, with a load gradient, and its front halfway), with a stroke under a state of the fluid built on it, by the GPU renderer and the CPU reference, for four brushes: fails past rms ${STAMP_DEPOSIT_PARITY_RMS}.` },
  args: { out: { type: 'string', valueHint: 'dir', description: 'Write each case as a sheet (GPU, CPU, difference × 8) here' } },
  async run({ args }) {
    const out = args.out === undefined ? undefined : resolve(args.out);
    const results = await checkStampDepositParity(STUDIO_STYLES_DIR, DEPOSIT_PARITY_BRUSHES, out !== undefined);
    if (out) mkdirSync(out, { recursive: true });
    for (const { brush, parityCase, rms, max, png } of results) {
      console.log(`${brush.pack}/${brush.name} ${parityCase}: rms ${rms.toFixed(4)}, max ${max.toFixed(3)}${rms > STAMP_DEPOSIT_PARITY_RMS ? ' OVER' : ''}`);
      if (out && png) writeFileSync(join(out, `${brush.pack}-${brush.name.replace(/\W+/g, '-')}-${parityCase}.png`), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
    }
    if (results.some(({ rms }) => rms > STAMP_DEPOSIT_PARITY_RMS)) process.exitCode = 1;
  },
});

const differenceLine = ({ max, mean, overTwo }: StampPigmentDifference) => `max ${max}, mean ${mean.toFixed(3)}, ${(overTwo * 100).toFixed(2)}% past 2 levels`;

const pigmentCommand = defineCommand({
  meta: { name: 'pigment', description: `Paint the pigment fixture (mixtures, a colour, wet mixing, glazes, an opaque group, a graded fill round masking fluid, a pass within a region, a twelve-pigment wash, a granulating paper) in watercolour, gouache and crayon, each on the GPU twice and with the CPU reference: fails if the GPU doesn't repeat exactly, or sits from the CPU past ${STAMP_PIGMENT_TOLERANCE.mean} levels on average, ${STAMP_PIGMENT_TOLERANCE.max} anywhere or 2 in over ${STAMP_PIGMENT_TOLERANCE.overTwo * 100}% of channels.` },
  args: { out: { type: 'string', description: 'Also write gpu.png and cpu.png here' } },
  async run({ args }) {
    for (const result of await checkStampPigmentParity()) {
      console.log(`${result.medium}: GPU against itself: ${differenceLine(result.repeat)}; against the CPU reference: ${differenceLine(result.reference)}`);
      if (args.out) console.log(`  frames: ${writeStampPigmentFrames(resolve(args.out), result).join(', ')}`);
      const { mean, max, overTwo } = result.reference;
      if (result.repeat.max > 0 || mean > STAMP_PIGMENT_TOLERANCE.mean || max > STAMP_PIGMENT_TOLERANCE.max || overTwo > STAMP_PIGMENT_TOLERANCE.overTwo) process.exitCode = 1;
    }
  },
});

await runHarnessCommand(defineCommand({
  meta: { name: 'stamp-reference', description: 'The slow CPU reference renderer, held against Photoshop captures stage by stage, and the GPU formulas held to it' },
  subCommands: { probes: probesCommand, formulas: formulasCommand, deposits: depositsCommand, pigment: pigmentCommand },
}));
