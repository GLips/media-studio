// api.ts: everything a project's video.tsx or stills.tsx builds from, in one import.

export { BrandLogo, brandLogoFor, type StudioBrand, type StudioBrandLogo } from './brand.tsx';
export * from './blockout.tsx';
export * from './blockout-camera.ts';
export * from '../models/timeline/beat-grid.ts';
export * from './camera.ts';
export * from './capture.tsx';
export * from './fonts.ts';
export * from './frame.ts';
export * from './grade.tsx';
export * from './kit.tsx';
export * from './motion.ts';
export * from './motion-blur.tsx';
export { motionAttrs, motionEchoAttrs, pieceMotionAttrs, unmeasuredAttrs, useMotionTag, type MotionTag } from './motion-tag.ts';
export * from './overlays.tsx';
export * from './random.ts';
// The reel pieces: the high-energy register of music-led videos (skills/video-motion/references/reel-pieces.md).
export * from './reel/bounce.tsx';
export * from './reel/capture-plane.tsx';
export * from './reel/column-field.tsx';
export * from './reel/glyph-field.tsx';
export * from './reel/hud.tsx';
export * from './reel/lens.tsx';
export * from './reel/needle.tsx';
export * from './reel/recap.tsx';
export * from './reel/ticker.tsx';
export * from './reel/ticker-layout.ts';
export * from './reel/type.tsx';
export { useScene } from './scene.tsx';
export { useScreenRect } from './screen-rect.ts';
export { defineScene, defineVideo, type LineSpan, type SceneClock, type ScenePrevis, type VideoSound } from './timeline.ts';
export { sceneCueSeconds, sceneForTimelineClock } from './music-led/timeline-scene.tsx';
export * from './sfx.tsx';
export { STILL_FEED_SIZES, STILL_PRESETS, type StillFitReport, type StillPreset } from './still-presets.ts';
export { CoverImage, defineStills, FitText, STILL_CARD_TILT, StillCard, StillHud, stillDesign, useStillFrame, type StillAxes, type StillCardTilt, type StillDesign, type StillFocus, type StillImage, type StillsDef } from './stills.tsx';
export * from './take.ts';
export * from './three-stage.tsx';
export * from './vec3.ts';
