// studio brushes: a private style's brush assets, imported from packs you bought (lib/paint/brush-packs/engine/import-stamp-paint-pack.ts).
import { defineCommand } from 'citty';

const importBrushesCommand = defineCommand({
  meta: {
    name: 'import',
    description: "Import a Procreate or Photoshop pack into work/styles/<style>/brushes/<pack>/, replacing what's there: a .brushset, or the zip it came in, whose palettes (.swatches) and paper canvases (.procreate) come too; or a Photoshop .abr or .tpl, or a zip holding them. Writes each brush's tip, grain and dual turned to dark-is-paint, its Procreate preview (Photoshop files carry none), the papers, and manifest.json with each brush's own settings, its profile (its footprint, measured by painting probes on the GPU, which takes a while) and the palettes. Without an archive, imports the pack already there again from its own manifest and images, measuring each profile whose brush, images or measurement have changed. Prints what of each brush's settings didn't carry over.",
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
    const { importStampPaintPack, reimportStampPaintPack } = await import('#lib/paint/brush-packs/engine/import-stamp-paint-pack.ts');
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
    const { dir, manifest } = args.archive ? await importStampPaintPack({ ...place, archive: args.archive }, measuring) : await reimportStampPaintPack(place, measuring);
    const brushes = readStampPaintPackBrushSources(manifest);
    for (const [name, notes] of Object.entries(stampPaintPackSupport(manifest))) {
      const count = (level: string) => notes.filter((note) => note.level === level).length;
      const unsupported = notes.filter((note) => note.level === 'unsupported');
      const dual = brushes[name]?.dual ? ', dual' : '';
      console.log(`${name}${dual}: ${count('approximated')} approximated, ${count('inapplicable')} not applicable, ${count('unprobed')} past the probes, ${unsupported.length} unsupported${unsupported.length ? ` (${unsupported.map((note) => note.setting).join('; ')})` : ''}`);
    }
    const counts = [`${Object.keys(manifest.brushes).length} brushes`, `${Object.keys(manifest.palettes).length} palettes`, `${Object.keys(manifest.papers).length} papers`];
    console.error(`brushes: imported ${counts.join(', ')} into ${relative(STUDIO_ROOT, dir)}/`);
    const refused = Object.entries(manifest.profiles).flatMap(([name, profile]) => (profile.kind === 'refused' ? [`${name} (${profile.why})`] : []));
    console.error(`brushes: profiles ${outcomes.measured} measured, ${outcomes.kept} kept, ${outcomes.refused} refused, in ${Math.round((Date.now() - started) / 1000)} s`);
    if (refused.length) console.error(`brushes: no profile, so no fill can plan with them: ${refused.join('; ')}`);
    const skipped = Object.keys(manifest.skipped);
    if (skipped.length) console.error(`brushes: not imported, their tips not being in the pack: ${skipped.join(', ')}`);
    if (manifest.app === 'photoshop') console.error('brushes: a Photoshop pack carries no previews; the sheet scores its brushes against its reference/ captures (npm run photoshop -- references), where it has them');
    if (!existsSync(join(STUDIO_STYLES_DIR, args.style, 'style.ts'))) console.error(`brushes: work/styles/${args.style}/ has no style.ts yet; docs/private-styles.md says what goes in it`);
  },
});

export default defineCommand({
  meta: { name: 'brushes', description: "A private style's brush assets, imported from packs you bought" },
  subCommands: { import: importBrushesCommand },
});
