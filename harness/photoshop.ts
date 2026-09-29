// node harness/photoshop.ts <check|probes|references|restore> (npm run photoshop -- <verb>): Photoshop 2026's own
// renders of brushes, captured by script as ground truth for the stamp renderer
// (lib/picture/photoshop-capture/engine/photoshop-capture.ts; docs/photoshop-capture.md).
import { defineCommand } from 'citty';
import { join, relative, resolve } from 'node:path';
import { capturePhotoshopProbes, capturePhotoshopReferences } from '#lib/picture/photoshop-capture/engine/photoshop-capture.ts';
import { PHOTOSHOP_REPEAT_SAMPLE } from '#lib/picture/photoshop-capture/models/photoshop-probes.ts';
import { checkPhotoshop, restorePendingPhotoshopSettings } from '#lib/platform/photoshop/engine/photoshop-app.ts';
import { STUDIO_ROOT, STUDIO_STYLES_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { runHarnessCommand } from './run-harness-command.ts';

const listArg = (value: string | undefined) => value?.split(',').map((s) => s.trim()).filter(Boolean);

const checkCommand = defineCommand({
  meta: { name: 'check', description: "Say whether a capture could start now: Photoshop installed, not open (it's Graham's), and no settings snapshot waiting to be restored. Changes nothing." },
  run() {
    const { ok, lines } = checkPhotoshop();
    for (const line of lines) console.log(line);
    if (!ok) process.exitCode = 1;
  },
});

const probesCommand = defineCommand({
  meta: {
    name: 'probes',
    description: "Have Photoshop paint the probe set (lib/picture/photoshop-capture/models/photoshop-probes.ts): a plain round brush varied one setting at a time, on 16-bit transparent sheets saved as PNG, into work/styles/<style>/brushes/photoshop-probes/<run>/ with manifest.json (each probe's settings as read back, every cell's geometry, Photoshop's version and colour settings). Launches its own Photoshop in the background, and quits it and puts its settings back byte for byte after. Prints the run time and the repeat check.",
  },
  args: {
    style: { type: 'string', default: 'watercolor', description: 'The style whose brushes/photoshop-probes/ holds the runs' },
    only: { type: 'string', valueHint: 'tip computed h50,wet edges h50', description: 'Capture only these probes (comma-separated)' },
    repeat: { type: 'string', valueHint: 'tip computed h50', description: 'Probes painted twice more, to measure repeatability; "none" for no repeat check. Defaults to one probe of each kind' },
  },
  async run({ args }) {
    const only = listArg(args.only);
    const repeat = args.repeat === 'none' ? [] : listArg(args.repeat) ?? PHOTOSHOP_REPEAT_SAMPLE.filter((name) => !only || only.includes(name));
    const { dir, manifest } = await capturePhotoshopProbes({ dir: join(STUDIO_STYLES_DIR, args.style, 'brushes', 'photoshop-probes'), only, repeat, log: (line) => console.error(line) });
    for (const [key, d] of Object.entries(manifest.repeatability ?? {})) {
      console.log(`repeat ${key}: ${d.identical ? 'identical' : `${d.differing} px differ, alpha max ${d.maxAlpha}/65535, mean ${d.meanAlpha.toFixed(2)}; premultiplied colour max ${d.maxPremultiplied}`}`);
    }
    const untrue = Object.entries(manifest.items).filter(([, item]) => item.mismatches).map(([key]) => key);
    if (untrue.length) console.log(`photoshop probes: ${untrue.length} probes didn't take as asked (their mismatches are in the manifest): ${untrue.join(', ')}`);
    const cells = manifest.sheets.reduce((n, s) => n + s.cells.length, 0);
    console.log(`photoshop probes: ${relative(STUDIO_ROOT, dir)}: ${Object.keys(manifest.items).length} probes, ${cells} cells on ${manifest.sheets.length} sheets in ${manifest.seconds.total.toFixed(1)} s (${manifest.seconds.perCapture.toFixed(2)} s a cell, Photoshop's launch and quit included); Photoshop ${manifest.photoshop.version}, blending ${manifest.photoshop.blending}`);
  },
});

const referencesCommand = defineCommand({
  meta: {
    name: 'references',
    description: "Load a Photoshop .abr into Photoshop and capture every brush in it as the pack's reference: a single stamp, a straight stroke at pen pressures 0.25, 0.5 and 1, the standard S-curve under simulated pressure, and two overlapping strokes, black on 16-bit transparent sheets. Writes work/styles/<style>/brushes/<pack>/reference/ (replacing it) with manifest.json. Launches its own Photoshop, and quits it and puts its settings back byte for byte after, so the .abr's presets don't stay in Graham's list.",
  },
  args: {
    abr: { type: 'positional', required: true, description: 'The .abr file' },
    style: { type: 'string', required: true, description: 'The style, work/styles/<style>/' },
    pack: { type: 'string', required: true, description: "The pack's folder in the style's brushes/" },
    brush: { type: 'string', valueHint: 'Watercolor Wash', description: 'Only these brushes, by their names in the .abr (comma-separated)' },
  },
  async run({ args }) {
    const { dir, manifest } = await capturePhotoshopReferences({ abr: resolve(args.abr), stylesDir: STUDIO_STYLES_DIR, style: args.style, pack: args.pack, only: listArg(args.brush), log: (line) => console.error(line) });
    for (const [key, { preset }] of Object.entries(manifest.items)) {
      const size = { own: `${preset!.diameter} px`, capped: `${preset!.nativeDiameter} px, painted at ${preset!.diameter}`, unsized: `no size of its own, painted at ${preset!.diameter} px` }[preset!.sizing];
      console.log(`${key}: ${size}`);
    }
    if (manifest.repeatedNames) console.log(`photoshop references: not captured, repeating an earlier preset's name: ${manifest.repeatedNames.join(', ')}`);
    const cells = manifest.sheets.reduce((n, s) => n + s.cells.length, 0);
    console.log(`photoshop references: ${relative(STUDIO_ROOT, dir)}: ${Object.keys(manifest.items).length} brushes, ${cells} cells on ${manifest.sheets.length} sheets in ${manifest.seconds.total.toFixed(1)} s (${manifest.seconds.perCapture.toFixed(2)} s a cell, Photoshop's launch and quit included)`);
  },
});

const restoreCommand = defineCommand({
  meta: {
    name: 'restore',
    description: "Put back Photoshop's settings files a run changed, from its snapshot that was never restored (a run that crashed, was killed, or whose Photoshop someone was using). Only files still as the run's Photoshop left them are put back; files a later session changed are kept. Every file replaced is set aside first in the snapshot's replaced-<time>/. Without a record of the run's Photoshop exiting, it refuses unless --force. Photoshop must be quit.",
  },
  args: { force: { type: 'boolean', description: "Restore a snapshot whose run never saw its Photoshop exit: only when no one has used Photoshop since that run" } },
  run({ args }) {
    const restored = restorePendingPhotoshopSettings({ force: args.force });
    if (!restored.length) console.log('photoshop restore: no snapshot is waiting');
    for (const r of restored) {
      console.log(`photoshop restore: ${r.backup}: ${r.files} files checked, rewritten ${r.rewritten.join(', ') || 'none'}, removed ${r.removed.join(', ') || 'none'}${r.kept.length ? `, kept (changed by a later session) ${r.kept.join(', ')}` : ''}`);
      if (r.setAside) console.log(`photoshop restore: what they were before is set aside in ${r.setAside}`);
    }
  },
});

await runHarnessCommand(defineCommand({
  meta: { name: 'photoshop', description: "Photoshop 2026's own renders of probes and pack brushes, captured by script, leaving Graham's Photoshop as it was" },
  subCommands: { check: checkCommand, probes: probesCommand, references: referencesCommand, restore: restoreCommand },
}));
