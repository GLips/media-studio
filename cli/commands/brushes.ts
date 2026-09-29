// studio brushes: a private style's brush assets, imported from packs you bought (lib/picture/stamp-paint/engine/import-stamp-paint-pack.ts).
import { defineCommand } from 'citty';

const importBrushesCommand = defineCommand({
  meta: {
    name: 'import',
    description: "Import a Procreate or Photoshop pack into work/styles/<style>/brushes/<pack>/, replacing what's there: a .brushset, or the zip it came in, whose palettes (.swatches) and paper canvases (.procreate) come too; or a Photoshop .abr or .tpl, or a zip holding them. Writes each brush's tip, grain and dual turned to dark-is-paint, its Procreate preview (Photoshop files carry none), the papers, and manifest.json with the normalized brushes, the palettes and each brush's settings that didn't carry over. Prints that support report.",
  },
  args: {
    archive: { type: 'positional', required: true, description: 'The .brushset, .abr or .tpl, or the pack zip holding them' },
    style: { type: 'string', required: true, description: 'The style it belongs to, work/styles/<style>/' },
    pack: { type: 'string', required: true, description: "The pack's folder in the style's brushes/, as style.ts names it" },
  },
  async run({ args }) {
    const { existsSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const { STUDIO_ROOT, STUDIO_STYLES_DIR } = await import('#lib/platform/project/engine/studio-project.ts');
    const { importStampPaintPack } = await import('#lib/picture/stamp-paint/engine/import-stamp-paint-pack.ts');
    const { app, dir, manifest, skipped } = importStampPaintPack({ archive: args.archive, stylesDir: STUDIO_STYLES_DIR, style: args.style, pack: args.pack });
    for (const [name, notes] of Object.entries(manifest.support)) {
      const count = (level: string) => notes.filter((note) => note.level === level).length;
      const unsupported = notes.filter((note) => note.level === 'unsupported');
      const dual = manifest.brushes[name]?.dual ? ', dual' : '';
      console.log(`${name}${dual}: ${count('approximated')} approximated, ${count('inapplicable')} not applicable, ${unsupported.length} unsupported${unsupported.length ? ` (${unsupported.map((note) => note.setting).join('; ')})` : ''}`);
    }
    const counts = [`${Object.keys(manifest.brushes).length} brushes`, `${Object.keys(manifest.palettes).length} palettes`, `${Object.keys(manifest.papers).length} papers`];
    console.error(`brushes: imported ${counts.join(', ')} into ${relative(STUDIO_ROOT, dir)}/; every note is in its manifest.json`);
    if (skipped.length) console.error(`brushes: not imported, their tips not being in the pack: ${skipped.join(', ')}`);
    if (app === 'photoshop') console.error("brushes: a Photoshop pack carries no previews; the sheet paints its brushes without one to score against");
    if (!existsSync(join(STUDIO_STYLES_DIR, args.style, 'style.ts'))) console.error(`brushes: work/styles/${args.style}/ has no style.ts yet; docs/private-styles.md says what goes in it`);
  },
});

const sheetBrushesCommand = defineCommand({
  meta: {
    name: 'sheet',
    description: "Draw the brush fidelity sheet for an imported pack: each brush painted on the GPU along the stroke its Procreate preview was drawn with, at the diameter that matches the preview's thickness, beside that preview, with both measured (coverage map, length, thickness profile, where each end reaches 80% of its peak, density, rim, grain size, edge width, mottle, fill) into one score per brush and its grade (close, rough, off), and the note from the style's fidelity.ts. Writes rows/<brush>.png, sheet.jpg (the rows at half size) and report.json into work/styles/<style>/brushes/<pack>/fidelity/ (git ignores it: it holds the pack's previews), or --out; a whole pack drawn there also writes the grades into work/styles/<style>/fidelity-grades.json. Prints a line per brush.",
  },
  args: {
    style: { type: 'string', required: true, description: 'The style, work/styles/<style>/' },
    pack: { type: 'string', required: true, description: "The pack's folder in the style's brushes/" },
    brush: { type: 'string', valueHint: 'Dry Brush', description: 'Only these brushes, by their names in the pack (comma-separated)' },
    out: { type: 'string', description: 'Write here instead, to keep a sheet from before a change' },
    compositing: { type: 'string', valueHint: 'linear', description: "Mix paint in 'srgb' (the renderer's default) or 'linear' light, to set a capture of Procreate against both; a sheet under anything but the default needs --out" },
    'texturized-grain': { type: 'string', valueHint: 'perStamp', description: "Cut a texturized grain into the stroke 'afterBuild' (the renderer's default) or into each stamp 'perStamp', before the stamps build; a sheet under anything but the default needs --out" },
  },
  async run({ args }) {
    const { relative, resolve } = await import('node:path');
    const { STUDIO_ROOT, STUDIO_STYLES_DIR } = await import('#lib/platform/project/engine/studio-project.ts');
    const { writeStampBrushSheet } = await import('#lib/picture/stamp-paint/engine/stamp-brush-sheet.ts');
    const { STAMP_PAINT_RENDERER_MODEL } = await import('#lib/picture/stamp-paint/models/stamp-paint-renderer-model.ts');
    type StampPaintRendererModel = typeof STAMP_PAINT_RENDERER_MODEL;
    const only = args.brush?.split(',').map((name) => name.trim()).filter(Boolean);
    const compositing = args.compositing ?? STAMP_PAINT_RENDERER_MODEL.compositing;
    if (compositing !== 'srgb' && compositing !== 'linear') throw new Error(`brushes sheet: --compositing is srgb or linear, not ${JSON.stringify(compositing)}`);
    const texturizedGrain = args['texturized-grain'] ?? STAMP_PAINT_RENDERER_MODEL.texturizedGrain;
    if (texturizedGrain !== 'afterBuild' && texturizedGrain !== 'perStamp') throw new Error(`brushes sheet: --texturized-grain is afterBuild or perStamp, not ${JSON.stringify(texturizedGrain)}`);
    const model: StampPaintRendererModel = { ...STAMP_PAINT_RENDERER_MODEL, compositing, texturizedGrain };
    // The pack's own fidelity/ and the style's grades hold the default model's sheet: a trial goes elsewhere.
    if (!args.out && JSON.stringify(model) !== JSON.stringify(STAMP_PAINT_RENDERER_MODEL)) throw new Error('brushes sheet: a sheet under a model other than the default needs --out');
    const { dir, sheet, entries, scores } = await writeStampBrushSheet({ stylesDir: STUDIO_STYLES_DIR, style: args.style, pack: args.pack, out: args.out && resolve(args.out), only, model });
    for (const { brush, diameter, comparison, grade } of entries) {
      const measured = comparison ? `score ${comparison.score.toFixed(3)}, map off ${Math.round(comparison.mapError * 100)}%, density ${comparison.density.toFixed(2)}` : 'no preview';
      console.log(`${brush}: ${grade ?? 'ungraded'} (d ${diameter}, ${measured})`);
    }
    const scored = entries.filter((e) => e.comparison);
    console.error(`brushes sheet: ${relative(STUDIO_ROOT, sheet)}, with a row per brush in ${relative(STUDIO_ROOT, dir)}/rows/ and report.json; total score ${scored.reduce((sum, e) => sum + e.comparison!.score, 0).toFixed(3)} over ${scored.length} brushes`);
    if (scores) console.error(`brushes sheet: grades written to ${relative(STUDIO_ROOT, scores)}`);
  },
});

/** The VVDS brushes painted along the preview's stroke as bridges to their thumbnails: a clean wash and a Dry brush. */
const DEFAULT_BRIDGES = 'Main Watercolor Brush,Dry Brush';
const listArg = (value: string | undefined) => value?.split(',').map((s) => s.trim()).filter(Boolean);

const probesBrushesCommand = defineCommand({
  meta: {
    name: 'probes',
    description: "Write the probe brushes, a .brushset that reads Procreate's renderer out one setting at a time (lib/picture/stamp-paint/models/procreate-probes.ts), each written over a single brush from a pack you own, plus that pack's bridge brushes. `studio brushes capture` writes and imports it itself; this is for looking at it. Prints each probe and what its capture reads out.",
  },
  args: {
    archive: { type: 'string', required: true, description: 'A pack holding the template brush: a .brushset, or the zip holding one' },
    brush: { type: 'string', required: true, valueHint: 'Smooth Ink Pen', description: 'The template brush, by its name in the pack: a single brush, not a dual' },
    bridges: { type: 'string', default: DEFAULT_BRIDGES, description: "The pack's own brushes to paint along the preview's stroke, comma-separated" },
    out: { type: 'string', required: true, valueHint: 'studio-probes.brushset', description: 'Where to write the .brushset' },
  },
  async run({ args }) {
    const { procreateProbes } = await import('#lib/picture/stamp-paint/models/procreate-probes.ts');
    const { writeProcreateProbeBrushset } = await import('#lib/picture/stamp-paint/engine/procreate-probe-brushset.ts');
    const probes = procreateProbes({ bridges: listArg(args.bridges) });
    const set = writeProcreateProbeBrushset({ archive: args.archive, brush: args.brush, out: args.out, probes });
    for (const probe of probes) console.log(`${probe.name}: ${probe.reads}`);
    console.error(`brushes probes: ${probes.length} probes in ${args.out}, as the set ${set}`);
  },
});

const captureBrushesCommand = defineCommand({
  meta: {
    name: 'capture',
    description: "Have Procreate on the iPad paint every probe (studio brushes probes) on a canvas of its own layers, and bring each layer back full size, over USB, with a manifest (docs/procreate-probes.md). Unattended once the one-time setup is done: --setup builds and signs the WebDriverAgent runner. --repeats paints some probes again to measure Procreate's own variation; --measure reports it for runs already taken.",
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
    const { join, relative } = await import('node:path');
    const { STUDIO_ROOT, STUDIO_STYLES_DIR } = await import('#lib/platform/project/engine/studio-project.ts');
    const capturesDir = join(STUDIO_STYLES_DIR, args.style, 'brushes', 'procreate-captures');
    if (args.setup) {
      const { buildWebDriverAgent, connectedIpad } = await import('#lib/platform/ios-device/engine/ios-device-usb.ts');
      if (!args.team) throw new Error('brushes capture --setup: name the signing team with --team');
      buildWebDriverAgent({ udid: connectedIpad().udid, team: args.team, bundleId: `studio.${args.team.toLowerCase()}.WebDriverAgentRunner` });
      return;
    }
    const { captureProcreateProbes, measureProcreateCaptureRepeats } = await import('#lib/picture/stamp-paint/engine/procreate-capture.ts');
    if (args.measure) {
      const variation = measureProcreateCaptureRepeats(listArg(args.measure)!.map((run) => join(capturesDir, run)));
      for (const [key, v] of Object.entries(variation)) {
        console.log(`${key}: ${v.copies} copies, mean |Δα| ${v.meanAbsDiff.toFixed(4)}, p99 ${v.p99AbsDiff.toFixed(3)}, max ${v.maxAbsDiff.toFixed(3)}, centroid ${v.centroidShift.toFixed(2)} px, paint ${(v.paintDiff * 100).toFixed(2)}%`);
      }
      return;
    }
    if (!args.archive) throw new Error('brushes capture: name the pack the probes are written over with --archive');
    const only = args.only === 'none' ? [] : listArg(args.only);
    const repeats = args.repeats ? { probes: listArg(args.repeats)!, times: Number(args.times) } : undefined;
    const { dir, manifest } = await captureProcreateProbes({ capturesDir, archive: args.archive, brush: args.brush, bridges: listArg(args.bridges) ?? [], only, repeats, log: (line) => console.error(line) });
    const seconds = (Date.parse(manifest.finishedAt) - Date.parse(manifest.startedAt)) / 1000;
    const layers = manifest.canvases.reduce((n, c) => n + c.layers.length, 0);
    console.log(`brushes capture: ${relative(STUDIO_ROOT, dir)}: ${manifest.canvases.length} canvases, ${layers} probe layers in ${(seconds / 60).toFixed(1)} min (${(seconds / Math.max(1, layers)).toFixed(1)} s a probe, export included)`);
  },
});

const fitBrushesCommand = defineCommand({
  meta: {
    name: 'fit',
    description: "Fit the importer's Procreate reading (lib/picture/stamp-paint/models/procreate-brush.ts: grain tile, brightness and contrast, rim width, sharpness and darkness, taper share, flow and depth curves, dual size) against every previewed brush of the packs given at once, by the brush fidelity sheet's summed score, and write it into models/procreate-reading.ts. Deterministic: the same packs and starting reading take the same steps. Prints each step, each brush's score before and after and which constants moved. Re-import the packs afterwards, so their manifests read the brushes by it.",
  },
  args: {
    packs: { type: 'string', required: true, valueHint: 'watercolor/vvds,procreate-probes/probes', description: 'The packs to fit against, each <style>/<pack>, comma-separated' },
    only: { type: 'string', valueHint: 'grainTile,edgeWidth', description: 'Search only these constants, by name (comma-separated)' },
    'dry-run': { type: 'boolean', description: "Report the fit without writing procreate-reading.ts" },
  },
  async run({ args }) {
    const { relative } = await import('node:path');
    const { STUDIO_ROOT, STUDIO_STYLES_DIR } = await import('#lib/platform/project/engine/studio-project.ts');
    const { fitStampBrushReading } = await import('#lib/picture/stamp-paint/engine/stamp-brush-fit.ts');
    const packs = args.packs.split(',').map((entry) => {
      const [style, pack] = entry.trim().split('/');
      if (!style || !pack) throw new Error(`brushes fit: ${JSON.stringify(entry)} isn't <style>/<pack>`);
      return { style, pack };
    });
    const keys = args.only?.split(',').map((key) => key.trim()) as Parameters<typeof fitStampBrushReading>[0]['keys'];
    const fit = await fitStampBrushReading({ stylesDir: STUDIO_STYLES_DIR, packs, keys, write: !args['dry-run'], log: (line) => console.error(line) });
    for (const { pack, brush, before, after } of fit.brushes) console.log(`${pack} ${brush}: ${before.toFixed(3)} → ${after.toFixed(3)}`);
    for (const key of Object.keys(fit.before) as (keyof typeof fit.before)[]) {
      if (fit.before[key] !== fit.after[key]) console.log(`moved ${key}: ${fit.before[key]} → ${fit.after[key]}`);
    }
    console.error(`brushes fit: total ${fit.total.before.toFixed(3)} → ${fit.total.after.toFixed(3)}${fit.written ? `; wrote ${relative(STUDIO_ROOT, fit.written)}, so re-import the packs` : ''}`);
  },
});

export default defineCommand({
  meta: { name: 'brushes', description: "A private style's brush assets, imported from packs you bought" },
  subCommands: { import: importBrushesCommand, sheet: sheetBrushesCommand, probes: probesBrushesCommand, capture: captureBrushesCommand, fit: fitBrushesCommand },
});
