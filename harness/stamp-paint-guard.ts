// node harness/stamp-paint-guard.ts <fingerprint|brushes|reports> (npm run brushes:guard -- …): what holds a
// restructuring of the brush engine to "nothing painted changes", brush by brush
// (lib/picture/brush-fidelity/engine/stamp-paint-guard.ts).
import { defineCommand } from 'citty';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readBrushFidelityReport } from '#lib/picture/brush-fidelity/engine/brush-fidelity-targets.ts';
import {
  checkStampPaintFingerprints, diffStampBrushSheetReports, diffStampPaintBrushSnapshots, snapshotStampPaintBrushes, writeStampPaintFingerprints,
  type StampPaintBrushSnapshot,
} from '#lib/picture/brush-fidelity/engine/stamp-paint-guard.ts';
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
  meta: { name: 'fingerprint', description: "Keep the compiled deposits and stamps of every brush of every imported pack in work/styles/, as its fidelity sheet paints it and in a fixed probe painting (a gzipped file of some tens of MB); write them to a file, or check them against one stamp by stamp, failing on any structure, ID or other non-number that differs, or any number past float-order drift, with the first few differing paths of each painting." },
  args: {
    write: { type: 'string', description: 'Write the fingerprints here' },
    check: { type: 'string', description: 'Check against the fingerprints written here' },
  },
  run({ args }) {
    if (args.write && !args.check) {
      const { brushes, packs, bytes } = writeStampPaintFingerprints(STUDIO_STYLES_DIR, resolve(args.write));
      console.error(`brushes guard: ${brushes} brushes in ${packs} packs fingerprinted into ${args.write} (${(bytes / 1e6).toFixed(1)} MB)`);
      return;
    }
    if (!args.check || args.write) throw new Error('brushes guard fingerprint: give --write <file> or --check <file>');
    const { moved, drifted, brushes } = checkStampPaintFingerprints(STUDIO_STYLES_DIR, resolve(args.check));
    report(`stamps of ${brushes} brushes (${drifted} paintings drifted by float order)`, moved);
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
  meta: { name: 'reports', description: "Where two fidelity sheet reports (report.json) differ, brush by brush; fails on a score moved past 0.02, a total past 1%, a brush whose outcome changed (scored, empty render, unmeasurable target, unscored), or reports that scored under another source, reading or scorer." },
  args: {
    before: { type: 'positional', required: true, description: 'A report.json' },
    after: { type: 'positional', required: true, description: 'Another' },
  },
  run({ args }) {
    const { moved, drift } = diffStampBrushSheetReports(readBrushFidelityReport(resolve(args.before)), readBrushFidelityReport(resolve(args.after)));
    report(`sheet scores (largest drift ${drift.toFixed(4)})`, moved);
  },
});

await runHarnessCommand(defineCommand({
  meta: { name: 'stamp-paint-guard', description: 'Hold a restructuring of the brush engine to painting nothing differently' },
  subCommands: { fingerprint: fingerprintCommand, brushes: brushesCommand, reports: reportsCommand },
}));
