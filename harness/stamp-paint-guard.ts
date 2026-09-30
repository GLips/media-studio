// node harness/stamp-paint-guard.ts <fingerprint|brushes|reports> (npm run brushes:guard -- …): what holds a
// restructuring of the brush engine to "nothing painted changes", brush by brush
// (lib/picture/stamp-paint/engine/stamp-paint-guard.ts).
import { defineCommand } from 'citty';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  diffStampBrushSheetReports, diffStampPaintBrushSnapshots, diffStampPaintFingerprints, fingerprintStampPaintPacks, snapshotStampPaintBrushes,
  type StampPaintBrushSnapshot, type StampPaintFingerprints,
} from '#lib/picture/stamp-paint/engine/stamp-paint-guard.ts';
import { STUDIO_STYLES_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { runHarnessCommand } from './run-harness-command.ts';

const readJson = <T>(file: string) => JSON.parse(readFileSync(resolve(file), 'utf8')) as T;

/** Prints `lines` and fails when there are any. */
function report(what: string, lines: string[]) {
  for (const line of lines) console.log(line);
  if (lines.length) throw new Error(`brushes guard: ${lines.length} ${what} differ`);
  console.error(`brushes guard: ${what} within drift`);
}

const fingerprintCommand = defineCommand({
  meta: { name: 'fingerprint', description: "Hash the compiled stamps of every brush of every imported pack in work/styles/, as its fidelity sheet paints it and in a fixed probe painting; write them to a file, or check them against one, failing on any brush whose stamps moved past float-order drift." },
  args: {
    write: { type: 'string', description: 'Write the fingerprints here' },
    check: { type: 'string', description: 'Check against the fingerprints written here' },
  },
  run({ args }) {
    if (!args.write === !args.check) throw new Error('brushes guard fingerprint: give --write <file> or --check <file>');
    const fingerprints = fingerprintStampPaintPacks(STUDIO_STYLES_DIR);
    const count = Object.values(fingerprints).reduce((n, pack) => n + Object.keys(pack).length, 0);
    if (args.write) {
      writeFileSync(resolve(args.write), `${JSON.stringify(fingerprints, null, 1)}\n`);
      console.error(`brushes guard: ${count} brushes in ${Object.keys(fingerprints).length} packs fingerprinted into ${args.write}`);
      return;
    }
    const { moved, drifted } = diffStampPaintFingerprints(readJson<StampPaintFingerprints>(args.check!), fingerprints);
    report(`stamps of ${count} brushes (${drifted} paintings drifted by float order)`, moved);
  },
});

const brushesCommand = defineCommand({
  meta: { name: 'brushes', description: "Read every imported pack's brushes from their sources; write them to a file, or check them against one, a JSON path per difference, failing on any." },
  args: {
    write: { type: 'string', description: 'Write the brushes here' },
    check: { type: 'string', description: 'Check against the brushes written here' },
  },
  run({ args }) {
    if (!args.write === !args.check) throw new Error('brushes guard brushes: give --write <file> or --check <file>');
    const snapshot = snapshotStampPaintBrushes(STUDIO_STYLES_DIR);
    if (args.write) {
      writeFileSync(resolve(args.write), `${JSON.stringify(snapshot, null, 1)}\n`);
      console.error(`brushes guard: ${Object.keys(snapshot).length} packs' brushes written into ${args.write}`);
      return;
    }
    report('brush fields', diffStampPaintBrushSnapshots(readJson<StampPaintBrushSnapshot>(args.check!), snapshot));
  },
});

const reportsCommand = defineCommand({
  meta: { name: 'reports', description: "Where two fidelity sheet reports (report.json) differ, brush by brush; fails on a score moved past 0.02, a total past 1%, or a brush scored or unscored." },
  args: {
    before: { type: 'positional', required: true, description: 'A report.json' },
    after: { type: 'positional', required: true, description: 'Another' },
  },
  run({ args }) {
    const { moved, drift } = diffStampBrushSheetReports(readJson(args.before), readJson(args.after));
    report(`sheet scores (largest drift ${drift.toFixed(4)})`, moved);
  },
});

await runHarnessCommand(defineCommand({
  meta: { name: 'stamp-paint-guard', description: 'Hold a restructuring of the brush engine to painting nothing differently' },
  subCommands: { fingerprint: fingerprintCommand, brushes: brushesCommand, reports: reportsCommand },
}));
