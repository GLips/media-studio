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
/** The project's video.tsx, or null when it has only stills (lib/output/render/engine/project-bundle.ts). */
declare module '@video' {
  const video: import('#lib/picture/composition/studio/timeline.ts').VideoDef | null;
  export default video;
}
/** The project's stills.tsx, or null when it has only a video. */
declare module '@stills' {
  const stills: import('#lib/output/stills/studio/stills.tsx').StillsDef | null;
  export default stills;
}
/** The brand kit the project's brand.ts names, with its overrides, loaded (lib/picture/brand/engine/project-brand.ts). Importing it without one throws. */
declare module '@brand' {
  const brand: import('#lib/picture/brand/studio/brand.tsx').StudioBrand;
  export default brand;
}
declare module '*.mp4' {
  const src: string;
  export default src;
}
/** The project's generated/footage.ts, rewritten from footage.json on every bundle (lib/footage/previs/engine/previs-footage.ts). */
declare module '@footage' {
  export const footage: Readonly<Record<string, import('#lib/footage/previs/studio/previs.ts').PrevisFootage>>;
}
/** The project's generated/sfx-cues.ts, rendered from sfx/cues.json on every bundle, or null without one (lib/timing/sound/engine/cue-module.ts). */
declare module '@sfx-cues' {
  const cues: readonly import('#lib/timing/sound/studio/sfx.tsx').SfxCueSound[] | null;
  export default cues;
}
/** The project's generated/stamp-paint-styles.ts: each style its project.ts names, with its manifests and image URLs (lib/picture/stamp-paint/engine/project-styles.ts). */
declare module '@stamp-paint-styles' {
  const styles: import('#lib/picture/stamp-paint/models/style.ts').BundledStampPaintStyles;
  export default styles;
}
/** The project folder's name, defined at bundle time by lib/output/render/engine/project-bundle.ts. */
declare const PROJECT_SLUG: string;
/** Its replay composition's id, likewise. */
declare const REPLAY_SLUG: string;
/** Its solo-blockout composition's id, likewise. */
declare const BLOCKOUT_SLUG: string;
// WebGPU's flag constants, which TypeScript's DOM lib types the interfaces of but doesn't declare.
declare const GPUBufferUsage: { readonly MAP_READ: 1; readonly MAP_WRITE: 2; readonly COPY_SRC: 4; readonly COPY_DST: 8; readonly INDEX: 16; readonly VERTEX: 32; readonly UNIFORM: 64; readonly STORAGE: 128; readonly INDIRECT: 256; readonly QUERY_RESOLVE: 512 };
declare const GPUTextureUsage: { readonly COPY_SRC: 1; readonly COPY_DST: 2; readonly TEXTURE_BINDING: 4; readonly STORAGE_BINDING: 8; readonly RENDER_ATTACHMENT: 16 };
declare const GPUMapMode: { readonly READ: 1; readonly WRITE: 2 };
declare const GPUColorWrite: { readonly RED: 1; readonly GREEN: 2; readonly BLUE: 4; readonly ALPHA: 8; readonly ALL: 15 };
