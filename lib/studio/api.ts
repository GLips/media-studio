// api.ts: everything a project's video.tsx builds from, in one import.

export * from './camera.ts';
export * from './capture.tsx';
export * from './frame.ts';
export * from './kit.tsx';
export * from './motion.ts';
export * from './overlays.tsx';
export { useScene } from './scene.tsx';
export { useScreenRect } from './screen-rect.ts';
export { defineScene, defineVideo, type LineSpan, type SceneClock } from './timeline.ts';
export * from './sfx.tsx';
export * from './take.ts';
