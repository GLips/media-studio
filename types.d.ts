// Modules the Remotion bundler provides and TypeScript can't see.

declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.jpg' {
  const src: string;
  export default src;
}
declare module '*.webp' {
  const src: string;
  export default src;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
declare module '*.wav' {
  const src: string;
  export default src;
}
declare module '*.mp3' {
  const src: string;
  export default src;
}
declare module '*.m4a' {
  const src: string;
  export default src;
}
declare module '*.ttf' {
  const src: string;
  export default src;
}
declare module '*.otf' {
  const src: string;
  export default src;
}
declare module '*.woff2' {
  const src: string;
  export default src;
}
/** The project's video.tsx, or null when it has only stills (lib/project-bundle.ts). */
declare module '@video' {
  const video: import('./lib/studio/timeline.ts').VideoDef | null;
  export default video;
}
/** The project's stills.tsx, or null when it has only a video. */
declare module '@stills' {
  const stills: import('./lib/studio/stills.tsx').StillsDef | null;
  export default stills;
}
/** The brand kit the project's brand.json names, loaded (lib/project-brand.ts). Importing it without one throws. */
declare module '@brand' {
  const brand: import('./lib/studio/brand.tsx').StudioBrand;
  export default brand;
}
declare module '*.mp4' {
  const src: string;
  export default src;
}
/** The project's generated/footage.ts, rewritten from footage.json on every bundle (lib/previs-footage.ts). */
declare module '@footage' {
  export const footage: Readonly<Record<string, import('./lib/studio/previs.ts').PrevisFootage>>;
}
/** The project's generated/sfx-cues.ts, rendered from sfx/cues.json on every bundle, or null without one (lib/sfx/cue-module.ts). */
declare module '@sfx-cues' {
  const cues: readonly import('./lib/studio/sfx.tsx').SfxCueSound[] | null;
  export default cues;
}
/** The project folder's name, defined at bundle time by lib/project-bundle.ts. */
declare const PROJECT_SLUG: string;
/** Its replay composition's id, likewise. */
declare const REPLAY_SLUG: string;
/** Its solo-blockout composition's id, likewise. */
declare const BLOCKOUT_SLUG: string;
