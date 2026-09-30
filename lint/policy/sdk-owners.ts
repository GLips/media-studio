// ─── Which module owns each contained SDK (plan D5, §5.1) ─────────────
//
// Each SDK is reached from one feature's engine folder, so a change to how the
// studio drives a browser, a renderer or ffmpeg has one place to land. A second
// owner is a distinct use, named beside it. Packages are matched by import;
// binaries by the string that names them to a spawn.
//
// Negative space: three isn't contained (§5.4), and shell or Python
// tools calling ffmpeg are invisible to the lint tiers (§4).

export type SdkOwner = { sdk: string; owners: readonly string[]; packages?: readonly string[]; binaries?: readonly string[] };

export const SDK_OWNERS: readonly SdkOwner[] = [
  // Driving a product's site to capture it, and rasterizing the studio's own drawings and pages.
  { sdk: 'playwright', owners: ['lib/footage/capture/engine/', 'lib/platform/raster/engine/'], packages: ['playwright', 'playwright-core', '@playwright/test'] },
  { sdk: 'ffmpeg', owners: ['lib/platform/ffmpeg/engine/'], binaries: ['ffmpeg', 'ffprobe'] },
  { sdk: '@remotion/renderer', owners: ['lib/output/render/engine/'], packages: ['@remotion/renderer'] },
  { sdk: '@remotion/bundler', owners: ['lib/output/render/engine/'], packages: ['@remotion/bundler'] },
  { sdk: 'esbuild', owners: ['lib/output/render/engine/'], packages: ['esbuild'] },
  { sdk: 'vite', owners: ['lib/platform/web/engine/'], packages: ['vite'] },
];
