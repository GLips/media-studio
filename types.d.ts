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
declare module '@project' {
  const video: import('./lib/studio/timeline.ts').VideoDef;
  export default video;
}
declare module '*.mp4' {
  const src: string;
  export default src;
}
/** The project's generated/footage.ts, rewritten from footage.json on every bundle (lib/previs-footage.ts). */
declare module '@footage' {
  export const footage: Readonly<Record<string, import('./lib/studio/previs.ts').PrevisFootage>>;
}
/** The project folder's name, defined at bundle time by lib/project-bundle.ts. */
declare const PROJECT_SLUG: string;
/** Its replay composition's id, likewise. */
declare const REPLAY_SLUG: string;
/** Its solo-blockout composition's id, likewise. */
declare const BLOCKOUT_SLUG: string;
