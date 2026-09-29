// studio brushes: a private style's brush assets, imported from packs you bought (lib/picture/stamp-paint/engine/import-procreate-pack.ts).
import { defineCommand } from 'citty';

const importBrushesCommand = defineCommand({
  meta: {
    name: 'import',
    description: "Import a Procreate pack into work/styles/<style>/brushes/<pack>/, replacing what's there: a .brushset, or the zip it came in, whose palettes (.swatches) and paper canvases (.procreate) come too. Writes each brush's tip, grain and dual turned to dark-is-paint, its Procreate preview, the papers, and manifest.json with the normalized brushes, the palettes and each brush's settings that didn't carry over. Prints that support report.",
  },
  args: {
    archive: { type: 'positional', required: true, description: 'The .brushset, or the pack zip holding one' },
    style: { type: 'string', required: true, description: 'The style it belongs to, work/styles/<style>/' },
    pack: { type: 'string', required: true, description: "The pack's folder in the style's brushes/, as style.ts names it" },
  },
  async run({ args }) {
    const { existsSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const { STUDIO_ROOT, STUDIO_STYLES_DIR } = await import('#lib/platform/project/engine/studio-project.ts');
    const { importProcreatePack } = await import('#lib/picture/stamp-paint/engine/import-procreate-pack.ts');
    const { dir, manifest, skipped } = importProcreatePack({ archive: args.archive, stylesDir: STUDIO_STYLES_DIR, style: args.style, pack: args.pack });
    for (const [name, notes] of Object.entries(manifest.support)) {
      const count = (level: string) => notes.filter((note) => note.level === level).length;
      const unsupported = notes.filter((note) => note.level === 'unsupported');
      const dual = manifest.brushes[name]?.dual ? ', dual' : '';
      console.log(`${name}${dual}: ${count('approximated')} approximated, ${count('inapplicable')} not applicable, ${unsupported.length} unsupported${unsupported.length ? ` (${unsupported.map((note) => note.setting).join('; ')})` : ''}`);
    }
    const counts = [`${Object.keys(manifest.brushes).length} brushes`, `${Object.keys(manifest.palettes).length} palettes`, `${Object.keys(manifest.papers).length} papers`];
    console.error(`brushes: imported ${counts.join(', ')} into ${relative(STUDIO_ROOT, dir)}/; every note is in its manifest.json`);
    if (skipped.length) console.error(`brushes: not imported, their tips being Procreate's own: ${skipped.join(', ')}`);
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
  },
  async run({ args }) {
    const { relative, resolve } = await import('node:path');
    const { STUDIO_ROOT, STUDIO_STYLES_DIR } = await import('#lib/platform/project/engine/studio-project.ts');
    const { writeStampBrushSheet } = await import('#lib/picture/stamp-paint/engine/stamp-brush-sheet.ts');
    const only = args.brush?.split(',').map((name) => name.trim()).filter(Boolean);
    const { dir, sheet, entries, scores } = await writeStampBrushSheet({ stylesDir: STUDIO_STYLES_DIR, style: args.style, pack: args.pack, out: args.out && resolve(args.out), only });
    for (const { brush, diameter, comparison, grade } of entries) {
      const measured = comparison ? `score ${comparison.score.toFixed(3)}, map off ${Math.round(comparison.mapError * 100)}%, density ${comparison.density.toFixed(2)}` : 'no preview';
      console.log(`${brush}: ${grade ?? 'ungraded'} (d ${diameter}, ${measured})`);
    }
    const scored = entries.filter((e) => e.comparison);
    console.error(`brushes sheet: ${relative(STUDIO_ROOT, sheet)}, with a row per brush in ${relative(STUDIO_ROOT, dir)}/rows/ and report.json; total score ${scored.reduce((sum, e) => sum + e.comparison!.score, 0).toFixed(3)} over ${scored.length} brushes`);
    if (scores) console.error(`brushes sheet: grades written to ${relative(STUDIO_ROOT, scores)}`);
  },
});

const probesBrushesCommand = defineCommand({
  meta: {
    name: 'probes',
    description: "Write the probe brushes, a .brushset that reads Procreate's renderer out one setting at a time (lib/picture/stamp-paint/models/procreate-probes.ts), each written over a single brush from a pack you own. Round-trip it through Procreate as docs/procreate-probes.md says, then import what comes back as a pack of its own and draw its sheet. Prints each probe and what its preview reads out.",
  },
  args: {
    archive: { type: 'string', required: true, description: 'A pack holding the template brush: a .brushset, or the zip holding one' },
    brush: { type: 'string', required: true, valueHint: 'Smooth Ink Pen', description: 'The template brush, by its name in the pack: a single brush, not a dual' },
    out: { type: 'string', required: true, valueHint: 'studio-probes.brushset', description: 'Where to write the .brushset' },
  },
  async run({ args }) {
    const { writeProcreateProbeBrushset } = await import('#lib/picture/stamp-paint/engine/procreate-probe-brushset.ts');
    const probes = writeProcreateProbeBrushset({ archive: args.archive, brush: args.brush, out: args.out });
    for (const probe of probes) console.log(`${probe.name}: ${probe.reads}`);
    console.error(`brushes probes: ${probes.length} probes in ${args.out}`);
  },
});

export default defineCommand({
  meta: { name: 'brushes', description: "A private style's brush assets, imported from packs you bought" },
  subCommands: { import: importBrushesCommand, sheet: sheetBrushesCommand, probes: probesBrushesCommand },
});
