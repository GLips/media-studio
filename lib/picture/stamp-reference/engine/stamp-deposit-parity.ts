// stamp-deposit-parity.ts: runs the deposit cases (models/stamp-deposit-parity.ts) for each brush on the GPU and the
// CPU reference in the render browser. `node harness/stamp-reference.ts deposits` runs it; it needs WebGPU and the
// workspace's imported packs, so it isn't among the tests.

import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowserModulePage } from '#lib/output/render/engine/browser-module-page.ts';
import { readStampPaintPackGeneration } from '#lib/picture/stamp-styles/engine/stamp-paint-pack-files.ts';
import { resolveStampPaintPackBrushes } from '#lib/picture/stamp-styles/models/stamp-paint-pack.ts';
import { STAMP_DEPOSIT_PARITY_CASES, type StampDepositParityCase } from '../models/stamp-deposit-parity.ts';

const PARITY_PAGE = fileURLToPath(new URL('../studio/stamp-deposit-parity-page.ts', import.meta.url));

/** A pack's brush by its name in the pack. */
export type StampDepositParityBrush = { style: string; pack: string; name: string };

export type StampDepositParityResult = { brush: StampDepositParityBrush; parityCase: StampDepositParityCase; rms: number; max: number; png?: string };

/** Each case of each brush, from `stylesDir`'s imported packs, GPU against CPU, with a sheet each when asked for. */
export async function checkStampDepositParity(stylesDir: string, brushes: readonly StampDepositParityBrush[], withSheets: boolean): Promise<StampDepositParityResult[]> {
  const loaded = brushes.map((brush) => {
    const { dir, manifest } = readStampPaintPackGeneration(join(stylesDir, brush.style, 'brushes', brush.pack));
    const resolved = resolveStampPaintPackBrushes(manifest)[brush.name];
    if (!resolved) throw new Error(`stamp deposit parity: ${brush.style}/${brush.pack} has no brush ${JSON.stringify(brush.name)}`);
    return { brush, resolved, url: `/files/${relative(stylesDir, dir).split(sep).join('/')}` };
  });
  // One brush at a time: each holds the GPU for its cases.
  return withBrowserModulePage({ entry: PARITY_PAGE, filesDir: stylesDir }, (call) => loaded.reduce<Promise<StampDepositParityResult[]>>(async (done, { brush, resolved, url }) => {
    const cases = await call<Omit<StampDepositParityResult, 'brush'>[]>('runStampDepositParity', resolved, url, STAMP_DEPOSIT_PARITY_CASES, withSheets);
    return [...(await done), ...cases.map((result): StampDepositParityResult => Object.assign(result, { brush }))];
  }, Promise.resolve([])));
}
