// measure-stamp-brush-profiles.ts: the profile step of `studio brushes import` (vid-119): each brush's profile
// measured in the render browser by studio/stamp-brush-profile-page.ts, through the production GPU renderer. The
// import (import-stamp-paint-pack.ts) asks only for brushes whose key has no profile stored
// (stamp-brush-profile-store.ts), and stores each as it's heard.

import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StampBrush, StampBrushMeasuredProfile } from '#lib/paint/brush/models/stamp-brush.ts';
import { withBrowserModulePage, type BrowserModuleCall } from '#lib/platform/browser/engine/browser-module-page.ts';
import { STAMP_BRUSH_PROFILE_SEEDS, type StampBrushProbeMedium, type StampBrushProfileMeasured } from '../models/stamp-brush-profile-probes.ts';
import { stampPaintPackKey, type StampPaintPackUrls } from '../models/stamp-paint-pack-urls.ts';
import { stampProbePaperPacks } from './stamp-brush-profile-store.ts';
import { readServedStampPaintPack, type StampPaintPackPlace } from './stamp-paint-pack-files.ts';

const PROFILE_PAGE = fileURLToPath(new URL('../studio/stamp-brush-profile-page.ts', import.meta.url));

/** A brush measured, with where; or refused, saying why: its profile before it is keyed. */
export type StampBrushProfileMeasurement = Omit<StampBrushMeasuredProfile, 'key'> | { kind: 'refused'; why: string };

/**
 * The brushes to measure, by name, read from their sources, the generation whose images they paint with, and the
 * medium their style paints in. `onMeasured` hears each brush as it's done, before the next is begun; `onRetrying` a
 * brush whose measuring failed, measured again in a fresh browser.
 */
export type MeasureStampBrushProfilesRequest = StampPaintPackPlace & {
  generation: string;
  medium: StampBrushProbeMedium;
  brushes: readonly { name: string; brush: StampBrush }[];
  onMeasured: (name: string, measurement: StampBrushProfileMeasurement) => void;
  onRetrying?: (name: string, why: string) => void;
};

/** The profile step itself: the browser's, or a test's stand-in for it. */
export type MeasureStampBrushProfiles = (request: MeasureStampBrushProfilesRequest) => Promise<void>;

/**
 * The URLs a measurement fetches images by: `pack`'s from `generation`, and its style's other packs' its paper
 * comes from, as they're served now.
 */
function probeUrls({ stylesDir, style, pack }: StampPaintPackPlace, generation: string, medium: StampBrushProbeMedium): StampPaintPackUrls {
  const others = stampProbePaperPacks(medium).filter((other) => other !== pack);
  const urls: [string, string][] = [
    ...others.map((other): [string, string] => [stampPaintPackKey(style, other), readServedStampPaintPack(stylesDir, style, other).url]),
    [stampPaintPackKey(style, pack), `/files/${relative(stylesDir, generation).split(sep).join('/')}`],
  ];
  return Object.fromEntries(urls);
}

/**
 * Measures each brush in the render browser, one at a time, the generation's images served to it. A brush whose
 * measuring fails (its browser killed, its GPU device lost) is measured again once in a fresh browser, as measuring
 * repeats exactly; failing twice, the import fails, keeping what was heard before.
 */
export const measureStampBrushProfiles: MeasureStampBrushProfiles = async ({ stylesDir, style, pack, generation, medium, brushes, onMeasured, onRetrying }) => {
  const urls = probeUrls({ stylesDir, style, pack }, generation, medium);
  const waiting = [...brushes], failedOnce = new Set<string>();
  // One brush a call, in turn: each holds the GPU for its probes.
  const measureWaiting = (call: BrowserModuleCall, gpu: string, bundle: string, browser: string): Promise<void> => {
    const next = waiting[0];
    if (!next) return Promise.resolve();
    return call<StampBrushProfileMeasured>('measureStampBrushProfile', next.brush, urls, medium).then((read) => {
      const provenance = { adapter: gpu, browser, renderer: bundle.slice(0, 16), seeds: [...STAMP_BRUSH_PROFILE_SEEDS], measuredAt: new Date().toISOString() };
      onMeasured(next.name, 'refused' in read ? { kind: 'refused', why: read.refused } : { kind: 'measured', provenance, samples: read.samples });
      waiting.shift();
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
    onRetrying?.(failed, error.message);
    return inBrowser();
  });
  await inBrowser();
};
