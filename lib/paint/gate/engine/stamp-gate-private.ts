// stamp-gate-private.ts: the gate's private run: pack brushes painted in each private case (stamp-gate-private-cases.ts)
// and held to baselines in the workspace's ignored work/validation/stamp-paint/, as the public gate holds its own. It
// needs the workspace's imported packs, so pre-commit never runs it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withBrowserModulePage } from '#lib/platform/browser/engine/browser-module-page.ts';
import { readServedStampPaintPack } from '#lib/paint/brush-packs/engine/stamp-paint-pack-files.ts';
import { stampBrushImages } from '#lib/paint/brush/models/stamp-brush.ts';
import { resolveStampPaintPackBrushes } from '#lib/paint/brush-packs/models/stamp-paint-pack.ts';
import { stampGatePaintingInputs } from '../models/stamp-gate-paintings.ts';
import { STAMP_GATE_PRIVATE_CASES, STAMP_GATE_PRIVATE_SIZE, stampGatePrivatePainting, type StampGatePrivateCase } from '../models/stamp-gate-private-cases.ts';
import { checkStampGateSubject, compareStampGateOutputs, STAMP_GATE_PAGE, STAMP_GATE_PAGES, type StampGateCheck, type StampGateSubject } from './stamp-gate.ts';
import { readStampGateBaseline, stampGateFrame, stampGateInputsHash, writeStampGateCandidate } from './stamp-gate-store.ts';

/** A pack's brush by its name in the pack. */
export type StampGatePrivateBrush = { style: string; pack: string; name: string };

/** A private subject's ID: its brush and case, as a path. */
const privateId = ({ style, pack, name }: StampGatePrivateBrush, privateCase: StampGatePrivateCase) => `painting/${style}/${pack}/${name.replace(/[^\w-]+/g, '-')}/${privateCase}`;

/** Each brush of `brushes` in every private case, from `stylesDir`'s imported packs, painted on the GPU. */
async function paintPrivate(stylesDir: string, brushes: readonly StampGatePrivateBrush[]) {
  const loaded = brushes.map((brush) => {
    const { dir, manifest, url } = readServedStampPaintPack(stylesDir, brush.style, brush.pack);
    const resolved = resolveStampPaintPackBrushes(manifest)[brush.name];
    if (!resolved) throw new Error(`stamp gate: ${brush.style}/${brush.pack} has no brush ${JSON.stringify(brush.name)}`);
    // Its images' bytes, as the painting names each only by its file.
    const images = stampBrushImages(resolved).map(({ image }) => stampGateInputsHash(readFileSync(join(dir, image.file))));
    return { brush, resolved, images, url };
  });
  const paintings = loaded.flatMap((brush) => STAMP_GATE_PRIVATE_CASES.map((privateCase) => ({
    loaded: brush, privateCase, inputs: stampGateInputsHash(`${stampGatePaintingInputs(stampGatePrivatePainting(brush.resolved, privateCase))}|${brush.images.join(',')}`),
  })));
  // All at once, on the gate's pages: each painting asks for a device of its own. Promise.all keeps the order.
  return withBrowserModulePage({ entry: STAMP_GATE_PAGE, filesDir: stylesDir, pages: STAMP_GATE_PAGES }, async (call) => {
    const [adapter, subjects] = await Promise.all([
      call<string>('stampGateAdapter'),
      Promise.all(paintings.map(async ({ loaded: { brush, resolved, url }, privateCase, inputs }): Promise<StampGateSubject> => {
        const rgb = Buffer.from(await call<string>('paintStampGatePrivate', resolved, url, privateCase), 'base64');
        return { id: privateId(brush, privateCase), inputs, output: stampGateFrame(new Uint8Array(rgb), STAMP_GATE_PRIVATE_SIZE.width, STAMP_GATE_PRIVATE_SIZE.height) };
      })),
    ]);
    return { adapter, subjects };
  });
}

/** Every private subject held to its baseline in `store`. */
export async function runStampGatePrivate(store: string, stylesDir: string, brushes: readonly StampGatePrivateBrush[]): Promise<StampGateCheck[]> {
  const { adapter, subjects } = await paintPrivate(stylesDir, brushes);
  return subjects.map((subject) => checkStampGateSubject(store, subject, adapter));
}

/** Candidates for every private subject, each with `reason`; the IDs to accept them by, and the files written. */
export async function updateStampGatePrivate(store: string, stylesDir: string, brushes: readonly StampGatePrivateBrush[], reason: string) {
  const { adapter, subjects } = await paintPrivate(stylesDir, brushes);
  return subjects.map((subject) => {
    const accepted = readStampGateBaseline(store, subject.id, subject.output);
    const comparison = accepted ? compareStampGateOutputs(subject.id, subject.output, accepted.output).detail : 'no baseline before';
    return { id: subject.id, comparison, files: writeStampGateCandidate(store, subject.id, subject.output, { inputs: subject.inputs, reason, comparison, adapter }) };
  });
}
