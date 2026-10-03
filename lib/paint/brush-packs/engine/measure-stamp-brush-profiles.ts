// measure-stamp-brush-profiles.ts: the profile step of `studio brushes import` (vid-119): what a brush's profile is
// keyed by, and its measurement in the render browser by studio/stamp-brush-profile-page.ts, through the production
// GPU renderer. The import (import-stamp-paint-pack.ts) keeps a previous profile whose key still matches.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampBrushImages, type StampBrush, type StampBrushMeasuredProfile, type StampBrushProfileKey } from '#lib/paint/brush/models/stamp-brush.ts';
import { STAMP_BRUSH_PROFILE_PROTOCOL, stampBrushProfileSettingsHash } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { withBrowserModulePage, type BrowserModuleCall } from '#lib/platform/browser/engine/browser-module-page.ts';
import { STAMP_BRUSH_PROFILE_SEEDS, stampBrushProbeMediumKey, type StampBrushProbeMedium, type StampBrushProfileMeasured } from '../models/stamp-brush-profile-probes.ts';
import { stampPaintPackKey, type StampPaintPackUrls } from '../models/stamp-paint-pack-urls.ts';
import { readServedStampPaintPack, type StampPaintPackPlace } from './stamp-paint-pack-files.ts';

const PROFILE_PAGE = fileURLToPath(new URL('../studio/stamp-brush-profile-page.ts', import.meta.url));

/**
 * How each brush's profile came to be: measured now, kept from the previous import, or refused; or that its measuring
 * failed and starts again in a fresh browser, heard before its outcome.
 */
export type StampBrushProfileOutcome = 'measured' | 'kept' | 'refused' | 'retrying';

/**
 * The brushes to measure, by name, read from their sources, the generation whose images they paint with, and the
 * medium their style paints in.
 */
export type MeasureStampBrushProfilesRequest = StampPaintPackPlace & {
  generation: string;
  medium: StampBrushProbeMedium;
  brushes: readonly { name: string; brush: StampBrush }[];
  onBrush?: (name: string, outcome: StampBrushProfileOutcome, why?: string) => void;
};

/** A brush measured, with where; or refused, saying why: its profile before it is keyed. */
export type StampBrushProfileMeasurement = Omit<StampBrushMeasuredProfile, 'key'> | { kind: 'refused'; why: string };

/** The profile step itself: the browser's, or a test's stand-in for it. */
export type MeasureStampBrushProfiles = (request: MeasureStampBrushProfilesRequest) => Promise<Record<string, StampBrushProfileMeasurement>>;

/**
 * `medium`'s key (stampBrushProbeMediumKey) as `pack` is imported from the archive `sha256`, its paper read from its
 * style's packs as they're served now, or from `pack` itself: what resolveStampPaintStyle computes once it's published.
 */
export function stampPackProbeMediumKey({ stylesDir, style, pack }: StampPaintPackPlace, sha256: string, medium: StampBrushProbeMedium): string {
  const others = paperPacksOf(medium).filter((other) => other !== pack);
  const archives = Object.fromEntries(others.map((other) => [other, readServedStampPaintPack(stylesDir, style, other).manifest.source.sha256]));
  return stampBrushProbeMediumKey(medium, { ...archives, [pack]: sha256 });
}

/** `brush`'s key: the protocol, its settings, its images' bytes as `generation` holds them, and its medium's key. */
export function stampBrushProfileKey(brush: StampBrush, generation: string, medium: string): StampBrushProfileKey {
  const assets = createHash('sha256');
  for (const { image } of stampBrushImages(brush)) assets.update(`${image.file}\n`).update(readFileSync(join(generation, image.file)));
  return { protocol: STAMP_BRUSH_PROFILE_PROTOCOL, settings: stampBrushProfileSettingsHash(brush), assets: assets.digest('hex'), medium };
}

/** The packs `medium`'s paper takes its images from. */
const paperPacksOf = ({ paper }: StampBrushProbeMedium) => [paper.image, paper.grain?.image].flatMap((asset) => (asset ? [asset.pack] : []));

/**
 * The URLs a measurement fetches images by: `pack`'s from `generation`, and its style's other packs' its paper
 * comes from, as they're served now.
 */
function probeUrls({ stylesDir, style, pack }: StampPaintPackPlace, generation: string, medium: StampBrushProbeMedium): StampPaintPackUrls {
  const others = paperPacksOf(medium).filter((other) => other !== pack);
  const urls: [string, string][] = [
    ...others.map((other): [string, string] => [stampPaintPackKey(style, other), readServedStampPaintPack(stylesDir, style, other).url]),
    [stampPaintPackKey(style, pack), `/files/${relative(stylesDir, generation).split(sep).join('/')}`],
  ];
  return Object.fromEntries(urls);
}

/**
 * Measures each brush in the render browser, one at a time, the generation's images served to it. A brush whose
 * measuring fails (its browser killed, its GPU device lost) is measured again once in a fresh browser, as measuring
 * repeats exactly; failing twice, the import fails.
 */
export const measureStampBrushProfiles: MeasureStampBrushProfiles = async ({ stylesDir, style, pack, generation, medium, brushes, onBrush }) => {
  const urls = probeUrls({ stylesDir, style, pack }, generation, medium);
  const measured: Record<string, StampBrushProfileMeasurement> = {}, waiting = [...brushes], failedOnce = new Set<string>();
  // One brush a call, in turn: each holds the GPU for its probes.
  const measureWaiting = (call: BrowserModuleCall, gpu: string, bundle: string, browser: string): Promise<void> => {
    const next = waiting[0];
    if (!next) return Promise.resolve();
    return call<StampBrushProfileMeasured>('measureStampBrushProfile', next.brush, urls, medium).then((read) => {
      const provenance = { adapter: gpu, browser, renderer: bundle.slice(0, 16), seeds: [...STAMP_BRUSH_PROFILE_SEEDS], measuredAt: new Date().toISOString() };
      measured[next.name] = 'refused' in read ? { kind: 'refused', why: read.refused } : { kind: 'measured', provenance, samples: read.samples };
      waiting.shift();
      onBrush?.(next.name, 'refused' in read ? 'refused' : 'measured');
      return measureWaiting(call, gpu, bundle, browser);
    });
  };
  const inBrowser = (): Promise<void> => withBrowserModulePage({ entry: PROFILE_PAGE, filesDir: stylesDir }, async (call, { gpu, bundle }) => {
    await measureWaiting(call, gpu, bundle, await call<string>('stampProfileBrowser'));
  }).catch((error: Error) => {
    // Past the last brush, it's the browser's closing checks that failed: nothing to measure again.
    const failed = waiting[0]?.name;
    if (failed === undefined || failedOnce.has(failed)) throw error;
    failedOnce.add(failed);
    onBrush?.(failed, 'retrying', error.message);
    return inBrowser();
  });
  await inBrowser();
  return measured;
};
