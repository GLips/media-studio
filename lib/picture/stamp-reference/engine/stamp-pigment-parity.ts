// stamp-pigment-parity.ts: the pigment fixture painted on the GPU (twice, to see it repeat) and by the CPU reference
// (stamp-pigment-reference.ts), and how far they sit apart. `node harness/stamp-reference.ts pigment` runs it; it needs
// WebGPU, so it isn't among the tests.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowserModulePage } from '#lib/output/render/engine/browser-module-page.ts';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { renderStampPigmentReference, STAMP_PIGMENT_FIXTURE_MEDIA, stampPigmentFixture, stampPigmentFixtureMips } from '../models/stamp-pigment-reference.ts';

/**
 * How far the GPU may sit from the CPU in levels of a byte, and the share of channels past 2. Their coverage differs
 * by a few percent at single edge pixels (`deposits`), and a covering medium turns that steeply (gouache: max 6).
 */
export const STAMP_PIGMENT_TOLERANCE = { mean: 0.25, max: 8, overTwo: 0.005 };

const PIGMENT_PAGE = fileURLToPath(new URL('../studio/stamp-pigment-page.ts', import.meta.url));

/** How two frames of RGB bytes differ: the largest channel difference, the mean, and the share of channels off by more than 2. */
export type StampPigmentDifference = { max: number; mean: number; overTwo: number };

function difference(a: ArrayLike<number>, b: ArrayLike<number>): StampPigmentDifference {
  let max = 0, sum = 0, over = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    max = Math.max(max, d);
    sum += d;
    if (d > 2) over++;
  }
  return { max, mean: sum / a.length, overTwo: over / a.length };
}

/**
 * The fixture in each of its media on the GPU twice and on the CPU: each frame, and how the GPU's repeat and the CPU
 * differ from its first.
 */
export async function checkStampPigmentParity() {
  // The page loads no files; it's served its own folder only because the page server serves one.
  // One painting at a time: each asks for a device of its own.
  const gpu = await withBrowserModulePage({ entry: PIGMENT_PAGE, filesDir: dirname(PIGMENT_PAGE) }, (call) => STAMP_PIGMENT_FIXTURE_MEDIA.reduce(
    async (done, medium) => [...await done, [await call<number[]>('paintStampPigment', medium), await call<number[]>('paintStampPigment', medium)] as const],
    Promise.resolve<(readonly [number[], number[]])[]>([]),
  ));
  return STAMP_PIGMENT_FIXTURE_MEDIA.map((mediumName, m) => {
    const fixture = stampPigmentFixture(mediumName);
    const { painting, mixing, paper, width, height } = fixture;
    const [first, second] = gpu[m];
    const cpu = renderStampPigmentReference({ painting, mixing, paper, width, height, mips: stampPigmentFixtureMips(fixture) });
    return { medium: mediumName, width, height, gpu: Uint8Array.from(first), cpu: Uint8Array.from(cpu), repeat: difference(first, second), reference: difference(first, cpu) };
  });
}

export type StampPigmentParity = Awaited<ReturnType<typeof checkStampPigmentParity>>[number];

/** Writes RGB bytes `width` × `height` as a PNG at `file`. */
function writeRgbPng(file: string, rgb: Uint8Array, width: number, height: number) {
  runFfmpeg(['-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-i', 'pipe:0', '-frames:v', '1', file], { input: rgb });
}

/** Writes the GPU's and the CPU's frames into `dir` as <medium>-gpu.png and <medium>-cpu.png; returns their paths. */
export function writeStampPigmentFrames(dir: string, { medium, gpu, cpu, width, height }: StampPigmentParity): string[] {
  mkdirSync(dir, { recursive: true });
  const files = [join(dir, `${medium}-gpu.png`), join(dir, `${medium}-cpu.png`)];
  writeRgbPng(files[0], gpu, width, height);
  writeRgbPng(files[1], cpu, width, height);
  return files;
}
