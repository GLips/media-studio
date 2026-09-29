// ─── Which module owns each contained SDK (plan D5, §5.1) ─────────────
//
// Each SDK is reached from one feature's engine folder, so a change to how the
// studio drives a browser, a renderer or ffmpeg has one place to land. Packages
// are matched by import; binaries by the string that names them to a spawn.
//
// Negative space: three isn't contained (§5.4), and shell or Python
// tools calling ffmpeg are invisible to the lint tiers (§4).

export type SdkOwner = { sdk: string; owner: string; packages?: readonly string[]; binaries?: readonly string[] };

export const SDK_OWNERS: readonly SdkOwner[] = [
  { sdk: 'playwright', owner: 'lib/footage/capture/engine/', packages: ['playwright', 'playwright-core', '@playwright/test'] },
  { sdk: 'ffmpeg', owner: 'lib/output/ffmpeg/engine/', binaries: ['ffmpeg', 'ffprobe'] },
  { sdk: '@remotion/renderer', owner: 'lib/output/render/engine/', packages: ['@remotion/renderer'] },
  { sdk: '@remotion/bundler', owner: 'lib/output/render/engine/', packages: ['@remotion/bundler'] },
  { sdk: 'esbuild', owner: 'lib/output/render/engine/', packages: ['esbuild'] },
  { sdk: 'vite', owner: 'lib/platform/web/engine/', packages: ['vite'] },
];
