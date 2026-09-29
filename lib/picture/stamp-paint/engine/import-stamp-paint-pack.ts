// import-stamp-paint-pack.ts: `studio brushes import`, whichever app the pack is for. A .brushset (or a zip holding
// one) is Procreate's (import-procreate-pack.ts); an .abr or .tpl (or a zip holding them and no .brushset) is
// Photoshop's (import-photoshop-pack.ts). Both write the same pack layout and the same StampBrush.

import { existsSync } from 'node:fs';
import { importPhotoshopPack, isPhotoshopBrushFile } from './import-photoshop-pack.ts';
import { importProcreatePack } from './import-procreate-pack.ts';
import type { ImportStampPaintPackOptions } from './stamp-paint-pack-files.ts';
import { openZipFile } from './zip-archive.ts';

export type StampPaintPackSourceApp = 'procreate' | 'photoshop';

function sourceAppOf(archive: string): StampPaintPackSourceApp {
  if (!existsSync(archive)) throw new Error(`brushes import: ${archive} doesn't exist`);
  if (archive.endsWith('.brushset')) return 'procreate';
  if (isPhotoshopBrushFile(archive)) return 'photoshop';
  const zip = openZipFile(archive);
  try {
    if (zip.names.some((name) => name.endsWith('.brushset'))) return 'procreate';
    if (zip.names.some(isPhotoshopBrushFile)) return 'photoshop';
  } finally {
    zip.close();
  }
  throw new Error(`brushes import: ${archive} holds neither a Procreate .brushset nor a Photoshop .abr or .tpl`);
}

/** Imports `archive` as its app's pack, and says which app that was. */
export function importStampPaintPack(options: ImportStampPaintPackOptions) {
  const app = sourceAppOf(options.archive);
  return { app, ...(app === 'procreate' ? importProcreatePack(options) : importPhotoshopPack(options)) };
}
