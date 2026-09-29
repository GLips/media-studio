// node harness/procreate.ts <probes|capture> (npm run procreate -- <verb>): the parked Procreate capture rig, which
// reads Procreate's renderer out one setting at a time on a USB iPad (docs/procreate-probes.md).
import { defineCommand } from 'citty';
import { join, relative } from 'node:path';
import { buildWebDriverAgent, connectedIpad } from '#lib/platform/ios-device/engine/ios-device-usb.ts';
import { STUDIO_ROOT, STUDIO_STYLES_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { captureProcreateProbes, measureProcreateCaptureRepeats } from '#lib/picture/stamp-paint/engine/procreate-capture.ts';
import { writeProcreateProbeBrushset } from '#lib/picture/stamp-paint/engine/procreate-probe-brushset.ts';
import { procreateProbes } from '#lib/picture/stamp-paint/models/procreate-probes.ts';
import { runHarnessCommand } from './run-harness-command.ts';

/** The VVDS brushes painted along the preview's stroke as bridges to their thumbnails: a clean wash and a Dry brush. */
const DEFAULT_BRIDGES = 'Main Watercolor Brush,Dry Brush';
const listArg = (value: string | undefined) => value?.split(',').map((s) => s.trim()).filter(Boolean);

const probesCommand = defineCommand({
  meta: {
    name: 'probes',
    description: "Write the probe brushes, a .brushset that reads Procreate's renderer out one setting at a time (lib/picture/stamp-paint/models/procreate-probes.ts), each written over a single brush from a pack you own, plus that pack's bridge brushes. `capture` writes and imports it itself; this is for looking at it. Prints each probe and what its capture reads out.",
  },
  args: {
    archive: { type: 'string', required: true, description: 'A pack holding the template brush: a .brushset, or the zip holding one' },
    brush: { type: 'string', required: true, valueHint: 'Smooth Ink Pen', description: 'The template brush, by its name in the pack: a single brush, not a dual' },
    bridges: { type: 'string', default: DEFAULT_BRIDGES, description: "The pack's own brushes to paint along the preview's stroke, comma-separated" },
    out: { type: 'string', required: true, valueHint: 'studio-probes.brushset', description: 'Where to write the .brushset' },
  },
  run({ args }) {
    const probes = procreateProbes({ bridges: listArg(args.bridges) });
    const set = writeProcreateProbeBrushset({ archive: args.archive, brush: args.brush, out: args.out, probes });
    for (const probe of probes) console.log(`${probe.name}: ${probe.reads}`);
    console.error(`procreate probes: ${probes.length} probes in ${args.out}, as the set ${set}`);
  },
});

const captureCommand = defineCommand({
  meta: {
    name: 'capture',
    description: "Have Procreate on the iPad paint every probe (`probes`) on a canvas of its own layers, and bring each layer back full size, over USB, with a manifest (docs/procreate-probes.md). Unattended once the one-time setup is done: --setup builds and signs the WebDriverAgent runner. --repeats paints some probes again to measure Procreate's own variation; --measure reports it for runs already taken.",
  },
  args: {
    style: { type: 'string', default: 'watercolor', description: 'The private style whose brushes/procreate-captures/ holds the runs' },
    archive: { type: 'string', description: 'The pack the probes are written over (a .brushset or its zip)' },
    brush: { type: 'string', default: 'Smooth Ink Pen', description: 'The template brush in that pack' },
    bridges: { type: 'string', default: DEFAULT_BRIDGES, description: "The pack's brushes painted along the preview's stroke, comma-separated" },
    only: { type: 'string', valueHint: 'Probe 05,Probe 36', description: 'Paint only these probes (a pilot); "none" for a run of repeats alone' },
    repeats: { type: 'string', valueHint: 'Probe 05,Probe 36', description: 'Probes to paint again, on a canvas of their own' },
    times: { type: 'string', default: '4', description: 'How many copies of each repeated probe' },
    measure: { type: 'string', valueHint: '20260929-210000,20260929-213000', description: "Don't capture: report the variation between repeated probes across these runs" },
    setup: { type: 'boolean', description: 'Build and sign the WebDriverAgent runner for the plugged-in iPad (needs --team)' },
    team: { type: 'string', description: 'The Apple development team to sign the runner with (a Personal Team does)' },
  },
  async run({ args }) {
    const capturesDir = join(STUDIO_STYLES_DIR, args.style, 'brushes', 'procreate-captures');
    if (args.setup) {
      if (!args.team) throw new Error('procreate capture --setup: name the signing team with --team');
      buildWebDriverAgent({ udid: connectedIpad().udid, team: args.team, bundleId: `studio.${args.team.toLowerCase()}.WebDriverAgentRunner` });
      return;
    }
    if (args.measure) {
      const variation = measureProcreateCaptureRepeats(listArg(args.measure)!.map((run) => join(capturesDir, run)));
      for (const [key, v] of Object.entries(variation)) {
        console.log(`${key}: ${v.copies} copies, mean |Δα| ${v.meanAbsDiff.toFixed(4)}, p99 ${v.p99AbsDiff.toFixed(3)}, max ${v.maxAbsDiff.toFixed(3)}, centroid ${v.centroidShift.toFixed(2)} px, paint ${(v.paintDiff * 100).toFixed(2)}%`);
      }
      return;
    }
    if (!args.archive) throw new Error('procreate capture: name the pack the probes are written over with --archive');
    const only = args.only === 'none' ? [] : listArg(args.only);
    const repeats = args.repeats ? { probes: listArg(args.repeats)!, times: Number(args.times) } : undefined;
    const { dir, manifest } = await captureProcreateProbes({ capturesDir, archive: args.archive, brush: args.brush, bridges: listArg(args.bridges) ?? [], only, repeats, log: (line) => console.error(line) });
    const seconds = (Date.parse(manifest.finishedAt) - Date.parse(manifest.startedAt)) / 1000;
    const layers = manifest.canvases.reduce((n, c) => n + c.layers.length, 0);
    console.log(`procreate capture: ${relative(STUDIO_ROOT, dir)}: ${manifest.canvases.length} canvases, ${layers} probe layers in ${(seconds / 60).toFixed(1)} min (${(seconds / Math.max(1, layers)).toFixed(1)} s a probe, export included)`);
  },
});

await runHarnessCommand(defineCommand({
  meta: { name: 'procreate', description: "Procreate's own renders of the probe brushes, painted on a USB iPad (parked: docs/procreate-probes.md)" },
  subCommands: { probes: probesCommand, capture: captureCommand },
}));
