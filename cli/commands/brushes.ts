// studio brushes: a private style's brush assets, imported from packs you bought (lib/paint/brush-packs/engine/import-stamp-paint-pack.ts).
import { defineCommand } from 'citty';

const importBrushesCommand = defineCommand({
  meta: {
    name: 'import',
    description: "Import a Procreate or Photoshop pack into work/styles/<style>/brushes/<pack>/, replacing what's there: a .brushset, or the zip it came in, whose palettes (.swatches) and paper canvases (.procreate) come too; or a Photoshop .abr or .tpl, or a zip holding them. Writes each brush's tip, grain and dual turned to dark-is-paint, its Procreate preview (Photoshop files carry none), the papers, and manifest.json with each brush's own settings and the palettes; then measures each brush's profile (its footprint, by painting probes on the GPU, which takes a few seconds a brush) that isn't stored for what it is now, into the pack's profiles/, a file a brush and key. Without an archive, measures those of the pack already there, leaving the pack itself as it is: run it when a fill is refused for want of a profile. Prints what of each brush's settings didn't carry over.",
  },
  args: {
    archive: { type: 'positional', required: false, description: 'The .brushset, .abr or .tpl, or the pack zip holding them; left out, the pack already imported' },
    style: { type: 'string', required: true, description: 'The style it belongs to, work/styles/<style>/' },
    pack: { type: 'string', required: true, description: "The pack's folder in the style's brushes/, as style.ts names it" },
  },
  async run({ args }) {
    const { existsSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const { STUDIO_ROOT, STUDIO_STYLES_DIR } = await import('#lib/platform/project/engine/studio-project.ts');
    const { importStampPaintPack, measureStampPaintPackProfiles } = await import('#lib/paint/brush-packs/engine/import-stamp-paint-pack.ts');
    const { readStampPaintPackBrushSources, stampPaintPackSupport } = await import('#lib/paint/brush-packs/models/stamp-paint-pack.ts');
    const place = { stylesDir: STUDIO_STYLES_DIR, style: args.style, pack: args.pack }, started = Date.now();
    const outcomes = { measured: 0, kept: 0, refused: 0 };
    const onBrush = (name: string, outcome: keyof typeof outcomes | 'retrying', why?: string) => {
      if (outcome === 'retrying') return console.error(`brushes: measuring ${name} again in a fresh browser, its first try having failed: ${why}`);
      outcomes[outcome]++;
      if (outcome !== 'kept') console.error(`brushes: ${outcome === 'measured' ? 'measured' : 'couldn\'t measure'} ${name} (${outcomes.measured + outcomes.refused} so far, ${Math.round((Date.now() - started) / 1000)} s)`);
    };
    const { readStampPaintStyleProbeMedium } = await import('#lib/paint/style/engine/style-probe-medium.ts');
    const measuring = { medium: (await readStampPaintStyleProbeMedium(STUDIO_STYLES_DIR, args.style)).medium, onBrush };
    const { dir, manifest, profiles } = args.archive ? await importStampPaintPack({ ...place, archive: args.archive }, measuring) : await measureStampPaintPackProfiles(place, measuring);
    if (args.archive) {
      const brushes = readStampPaintPackBrushSources(manifest);
      for (const [name, notes] of Object.entries(stampPaintPackSupport(manifest))) {
        const count = (level: string) => notes.filter((note) => note.level === level).length;
        const unsupported = notes.filter((note) => note.level === 'unsupported');
        const dual = brushes[name]?.dual ? ', dual' : '';
        console.log(`${name}${dual}: ${count('approximated')} approximated, ${count('inapplicable')} not applicable, ${count('unprobed')} past the probes, ${unsupported.length} unsupported${unsupported.length ? ` (${unsupported.map((note) => note.setting).join('; ')})` : ''}`);
      }
      const counts = [`${Object.keys(manifest.brushes).length} brushes`, `${Object.keys(manifest.palettes).length} palettes`, `${Object.keys(manifest.papers).length} papers`];
      console.error(`brushes: imported ${counts.join(', ')} into ${relative(STUDIO_ROOT, dir)}/`);
      const skipped = Object.keys(manifest.skipped);
      if (skipped.length) console.error(`brushes: not imported, their tips not being in the pack: ${skipped.join(', ')}`);
      if (manifest.app === 'photoshop') console.error('brushes: a Photoshop pack carries no previews; the sheet scores its brushes against its reference/ captures (npm run photoshop -- references), where it has them');
    }
    const refused = Object.entries(profiles).flatMap(([name, profile]) => (profile.kind === 'refused' ? [`${name} (${profile.why})`] : []));
    console.error(`brushes: profiles in ${relative(STUDIO_ROOT, dir)}/profiles/: ${outcomes.measured} measured, ${outcomes.kept} already stored, ${outcomes.refused} refused, in ${Math.round((Date.now() - started) / 1000)} s`);
    if (refused.length) console.error(`brushes: their probes read no profile, so no fill can plan with them: ${refused.join('; ')}`);
    if (!existsSync(join(STUDIO_STYLES_DIR, args.style, 'style.ts'))) console.error(`brushes: work/styles/${args.style}/ has no style.ts yet; docs/private-styles.md says what goes in it`);
  },
});

const describeBrushesCommand = defineCommand({
  meta: {
    name: 'describe',
    description: "Print each of a style's brushes as numbers to plan by, read from the packs imported here (they're private, so no doc holds them): the share of its size, opacity and flow (and anything else pressure moves, grain depth only where the brush rather than the paper's tooth answers it) kept at pressure 0.3, 0.6 and 1, outside a taper; its flow before pressure, and whether its tip parts as pressure falls; its visible width over its diameter at a few diameters, and the smallest diameter its profile holds, so the finest it plans; and whether it catches the paper's peaks.",
  },
  args: {
    style: { type: 'string', required: true, description: 'The style, work/styles/<style>/' },
  },
  async run({ args }) {
    const { STUDIO_STYLES_DIR } = await import('#lib/platform/project/engine/studio-project.ts');
    const { readWorkspaceStyleBrushNumbers } = await import('#lib/paint/style/engine/workspace-style-brush-numbers.ts');
    const { stampStyleBrushNumbersText } = await import('#lib/paint/style/models/style-brush-numbers.ts');
    console.log(stampStyleBrushNumbersText(await readWorkspaceStyleBrushNumbers(STUDIO_STYLES_DIR, args.style)).join('\n'));
  },
});

export default defineCommand({
  meta: { name: 'brushes', description: "A private style's brush assets, imported from packs you bought, and the numbers to plan by that they paint with" },
  subCommands: { import: importBrushesCommand, describe: describeBrushesCommand },
});
