// node harness/stamp-reference.ts probes <run> (npm run stamp:reference -- probes <run>): the reference renderer
// (lib/picture/stamp-reference) against a Photoshop probe run, cell by cell, each cell's error split among the stages
// that own it (vid-97).
import { defineCommand } from 'citty';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PhotoshopCaptureManifest } from '#lib/picture/photoshop-capture/models/photoshop-capture-plan.ts';
import { scorePhotoshopProbeRun } from '#lib/picture/stamp-reference/engine/photoshop-probe-reference.ts';
import type { StampResolveStage } from '#lib/picture/stamp-paint/models/stamp-deposit-stages.ts';
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
    const probes = Object.entries(manifest.items).filter(([, item]) => item.settings).map(([name, item]) => ({ name, reads: item.reads ?? '', settings: item.settings!, marks: [] }));
    const arrangement = { order: listArg(args.order) as StampResolveStage[] | undefined, opacity: args.opacity as 'last' | 'inBuild' | undefined };
    const { scores, skipped } = scorePhotoshopProbeRun({ dir, sheets: manifest.sheets, probes, only, arrangement });
    if (args.json) {
      console.log(JSON.stringify({ arrangement, scores, skipped }, null, 2));
      return;
    }
    for (const { probe, cell, score } of [...scores].sort((a, b) => b.score.rms - a.score.rms)) {
      const owners = score.owners.map((o) => `${o.owner} ${o.rms.toFixed(4)} (${o.pixels} px)`).join(', ');
      console.log(`${score.rms.toFixed(4)} max ${score.max.toFixed(3)}  ${probe} / ${cell}: ${owners}`);
    }
    const all = scores.map((s) => s.score.rms).sort((a, b) => a - b);
    console.log(`stamp reference: ${scores.length} cells, median rms ${(all[Math.floor(all.length / 2)] ?? 0).toFixed(4)}, worst ${(all.at(-1) ?? 0).toFixed(4)}; skipped ${Object.entries(skipped).map(([why, n]) => `${n} ${why}`).join(', ') || 'none'}`);
  },
});

await runHarnessCommand(defineCommand({
  meta: { name: 'stamp-reference', description: 'The slow CPU reference renderer, held against Photoshop captures stage by stage' },
  subCommands: { probes: probesCommand },
}));
