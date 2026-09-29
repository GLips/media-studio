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
      const unsupported = notes.filter((note) => note.level === 'unsupported'), approximated = notes.length - unsupported.length;
      const dual = manifest.brushes[name]?.dual ? ', dual' : '';
      console.log(`${name}${dual}: ${approximated} approximated, ${unsupported.length} unsupported${unsupported.length ? ` (${unsupported.map((note) => note.setting).join('; ')})` : ''}`);
    }
    const counts = [`${Object.keys(manifest.brushes).length} brushes`, `${Object.keys(manifest.palettes).length} palettes`, `${Object.keys(manifest.papers).length} papers`];
    console.error(`brushes: imported ${counts.join(', ')} into ${relative(STUDIO_ROOT, dir)}/; every note is in its manifest.json`);
    if (skipped.length) console.error(`brushes: not imported, their tips being Procreate's own: ${skipped.join(', ')}`);
    if (!existsSync(join(STUDIO_STYLES_DIR, args.style, 'style.ts'))) console.error(`brushes: work/styles/${args.style}/ has no style.ts yet; docs/private-styles.md says what goes in it`);
  },
});

export default defineCommand({
  meta: { name: 'brushes', description: "A private style's brush assets, imported from packs you bought" },
  subCommands: { import: importBrushesCommand },
});
