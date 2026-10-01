// api.ts: the studio's conveniences for a project's video.tsx or stills.tsx, in one import: `#studio`. A scene may import
// anything else in a feature's studio/ or models/ folder too, as `#lib/<area>/<feature>/<role>/<file>`.

export { BrandLogo, brandLogoFor, type StudioBrand, type StudioBrandLogo } from '#lib/picture/brand/studio/brand.tsx';
export { Blockout, type BlockoutShape, type BlockoutSubject } from '#lib/footage/previs/studio/blockout.tsx';
export { dollyMove, orbitMove, pushInMove, type BlockoutMove, type BlockoutPose } from '#lib/footage/previs/studio/blockout-camera.ts';
export { FlatBlockout, type FlatPiece, type FlatPieceKind, type FlatViewMoves } from '#lib/footage/previs/studio/flat-blockout.tsx';
export type { FlatKey, FlatPose, FlatView } from '#lib/footage/previs/studio/flat-blockout-pose.ts';
export { beatGrid, steadyBeatGrid, type BeatGrid } from '#lib/timing/timeline/models/beat-grid.ts';
export { assertKeysInOrder, camAt, camFit, camTop, camWhole, clampCam, lerpCam, pagePoint, rectToScreen, scaleFor, screenPoint, screenRect, view, viewOf, viewOfScreenRect, viewScale, type Cam, type Shot, type View } from '#lib/picture/camera/models/camera.ts';
export { applyAffine, centerOf, inflate, multiplyAffine, union, type AffineMatrix, type Point, type Rect } from '#lib/picture/frame/models/geometry.ts';
export { Capture, CaptureMotion, CaptureStates, CaptureSwap } from '#lib/footage/capture/studio/capture.tsx';
export { areStudioFontsLoaded, loadStudioFaces, useStudioFontsReady, whenStudioFontsLoaded, type StudioFontFile } from '#lib/picture/type/studio/fonts.ts';
export { ARCHIVO_FACE, DISPLAY_FONT, MONO_ADVANCE_EM, MONO_CAP_EM, MONO_FONT, type StudioFace } from '#lib/picture/type/models/faces.ts';
export { DEFAULT_VIDEO_FORMAT, fullFrameRect, type FrameSize, type VideoFormat } from '#lib/picture/frame/models/frame.ts';
export { FONT } from '#lib/picture/type/models/faces.ts';
export { captionFreeRect, captionSafeArea, pillCaptionBand, type CaptionBand, type CaptionBandRule } from '#lib/picture/captions/models/caption-band.ts';
export { READABLE_CAPTION_RULE, type CaptionPagingRule } from '#lib/picture/captions/models/caption-pages.ts';
export { useCaptionSafeArea, type CaptionRenderProps, type CaptionStyle } from '#lib/picture/captions/studio/caption-style.tsx';
export { CaptionKeycap, pillCaptions } from '#lib/picture/captions/studio/pill-captions.tsx';
export { wordPopCaptionBand, wordPopCaptions } from '#lib/picture/captions/studio/word-pop-captions.tsx';
export { FilmGrain, Vignette } from '#lib/picture/film/studio/grade.tsx';
export { ClickToBlur, ConfirmDialog, DrawPath, EndCard, GlassCard, MotionTitle, NativeMenu, ODOMETER_DIGIT_EM, Odometer, Phone, SPLIT_LABEL_STRIP, SectionCard, SplitCompare, WordReveal, phoneView, splitLeftRect, splitRightRect, wordRevealFinish, type OdometerMode, type OdometerProps, type SplitSide, type WordRevealTiming } from '#lib/picture/kit/studio/kit.tsx';
export { backOutEase, clamp, lerp, motionCurves, motionDurations, off, on, perceptualSpring, powerOutEase, seg, sineInOutEase, stagger, staggerFinish, type CurveRoles, type EaseFn, type PerceptualSpring, type StaggerFrom, type StaggerTiming } from '#lib/picture/motion/models/motion.ts';
export { ShutterBlur } from '#lib/picture/film/studio/motion-blur.tsx';
export { REEL_SHUTTER, shutterOpensAt, shutterTravel, smearSigma } from '#lib/picture/motion/models/shutter.ts';
export { motionAttrs, motionEchoAttrs, pieceMotionAttrs, unmeasuredAttrs, useMotionTag, type MotionTag } from '#lib/picture/measurement/studio/motion-tag.ts';
export { ClickRipple, ClipToBox, Cursor, CursorPath, Glass, Highlight, Spotlight, Tag, TakeCursor, Text, Wash, cursorAt, offscreen, type CursorKey } from '#lib/picture/kit/studio/overlays.tsx';
export { hashRandom, randomSeedFromKey, seededRandom } from '#lib/picture/motion/models/random.ts';
// The reel pieces: the high-energy register of music-led videos (skills/video-motion/references/reel-pieces.md).
// Each model is re-exported by name: the helpers it exports only for its own drawing stay out of the barrel.
export { BounceBall, FieldSwell, type BounceCallout } from '#lib/picture/reel/studio/bounce.tsx';
export { bouncingBallAt, type BallLaunch, type BallPhase, type BallPose, type BounceParams, type BounceTiming } from '#lib/picture/reel/models/bounce.ts';
export { fieldSwellAt, type FieldSwellOptions, type SwellFrom, type SwellPose } from '#lib/picture/reel/models/bounce-swell.ts';
export { CapturePlane, type CapturePlaneProps } from '#lib/picture/reel/studio/capture-plane.tsx';
export { PLANE_REST_POSE, capturePlaneProjection, capturePlaneView, lerpPlanePose, planeLiftStart, type CapturePlaneProjection, type PlaneLift, type PlanePose } from '#lib/picture/reel/models/capture-plane.ts';
export { ColumnField, type ColumnFieldProps } from '#lib/picture/reel/studio/column-field.tsx';
export { columnDiscCells, columnFieldHeight, columnFieldPoint, columnNoise, type ColumnBall, type ColumnBallState, type ColumnCameraMove, type ColumnCameraPose, type ColumnCameraState, type ColumnCell, type ColumnFieldLights, type ColumnFieldSpec, type ColumnLabel, type ColumnLight, type ColumnRise } from '#lib/picture/reel/models/column-field.ts';
export { columnBallAt, columnCameraAt, columnFieldProject, topDownPose } from '#lib/picture/reel/models/column-field-motion.ts';
export { columnTitaniumMaterial } from '#lib/picture/reel/studio/column-field-materials.ts';
export { FieldFlash, GlyphField, ShockRing } from '#lib/picture/reel/studio/glyph-field.tsx';
export { GLYPH_FIELD_COLORS, GLYPH_SHAPES, glyphFieldLayout, glyphPunchScale, glyphRegroupPlan, glyphWaveArrivals, type GlyphCell, type GlyphClip, type GlyphFieldSlot, type GlyphFilterStep, type GlyphFilterTiming, type GlyphFront, type GlyphHit, type GlyphImplode, type GlyphKey, type GlyphLayout, type GlyphPunch, type GlyphRegroup, type GlyphShape, type GlyphShapeKey, type GlyphWave } from '#lib/picture/reel/models/glyph-field.ts';
export { glyphFieldFrame, parseGlyphColor, type GlyphDraw, type GlyphFieldFrame, type GlyphFieldProps, type GlyphRest, type GlyphSample } from '#lib/picture/reel/models/glyph-field-frame.ts';
export { ReelHud, type ReelHudProps } from '#lib/picture/reel/studio/hud.tsx';
export { REEL_HUD_BOOT_DECODE, REEL_HUD_GLYPHS, REEL_HUD_PALETTE, REEL_HUD_SLOTS, REEL_HUD_SWAP_DECODE, reelHudBoxPoints, reelHudBoxes, reelHudDecode, reelHudGrounds, reelHudLitSquare, reelHudPlateMix, reelHudReadGrounds, reelHudTimecode, reelHudToneOver, reelHudToneWeights, type ReelHudCell, type ReelHudDecodeSchedule, type ReelHudGround, type ReelHudLayoutProps, type ReelHudPalette, type ReelHudRead, type ReelHudSection, type ReelHudSlot, type ReelHudTone } from '#lib/picture/reel/models/hud.ts';
export { LensFringe, channelSplitPrimitives } from '#lib/picture/reel/studio/lens.tsx';
export { lensFringeAt, lensFringeSubpixelMax, type LensFringeState, type LensFringeTiming } from '#lib/picture/reel/models/lens.ts';
export { Needle, type NeedleProps } from '#lib/picture/reel/studio/needle.tsx';
export { needleContactAt, needleCoversAt, needleExposuresAt, needleLensHeight, needlePoseAt, needleRig, needleScreenPoint, needleShotAt, type NeedleLensing, type NeedlePose, type NeedleRig, type NeedleRigSettings, type NeedleShot, type NeedleStrike, type NeedleTake } from '#lib/picture/reel/models/needle.ts';
export { FadeToBlack, GlitchFlash, RecapGrid, Shake, type RecapTile, type RecapTileView } from '#lib/picture/reel/studio/recap.tsx';
export { recapGridRects, recapPopStarts, recapTileUnder, shakeOffset, type GlitchHit, type GlitchLook, type RecapExit, type RecapLayout, type RecapOrder } from '#lib/picture/reel/models/recap.ts';
export { TickerBand, TickerBands, type TickerBandProps, type TickerBandsProps } from '#lib/picture/reel/studio/ticker.tsx';
export { layoutTickerRow, mixGlyphPose, tickerBreathAt, type GlyphPose, type TickerBreath, type TickerPose, type TickerRowStyle, type TickerSlot } from '#lib/picture/reel/models/ticker-layout.ts';
export { ARCHIVO_BASELINE_EM, ARCHIVO_CAP_EM, archivoAdvance, archivoKern, layoutGlyphLine, type GlyphAxes, type GlyphLine, type GlyphLineSlot, type VariableFontMetrics } from '#lib/picture/type/models/glyph-layout.ts';
export { TICKER_BOLD, TICKER_HERO_POSES, TICKER_LIGHT, TICKER_LOOKS, tickerLookBeat, type TickerColors, type TickerEnter, type TickerExit, type TickerHeroPoses, type TickerKick, type TickerLook } from '#lib/picture/reel/models/ticker.ts';
export { IndexLabel, RiseWord, SelectionBox, WeightWord, type WordSelection } from '#lib/picture/reel/studio/type.tsx';
export { SlantWord } from '#lib/picture/reel/studio/type-slant.tsx';
export { ScrambleText } from '#lib/picture/reel/studio/type-scramble.tsx';
export { CODE_GLYPHS, scrambleAt, scrambleFinish, slantMatrix, slantWordPose, type ScrambleTiming, type SlantEntrance, type SlantPose, type Tittle } from '#lib/picture/reel/models/type.ts';
export { useScene } from '#lib/picture/video/studio/scene.tsx';
export { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
export { useScreenRect } from '#lib/picture/measurement/studio/screen-rect.ts';
export { defineVideo, videoFormatOf, type ScenePrevis, type VideoSound } from '#lib/picture/video/studio/video.ts';
export type { LineSpan, SceneClock } from '#lib/timing/timeline/models/video-layout.ts';
export { sceneCueSeconds, sceneForTimelineClock } from '#lib/picture/video/studio/timeline-scene.tsx';
export type { SceneRung } from '#lib/timing/timeline/models/scene-rung.ts';
export { blockingScene } from '#lib/footage/previs/studio/blocking-scene.tsx';
export { SFX, Sfx, SfxCueListAudio, SfxCueListPlaying, type SfxCueSound, type SfxSound } from '#lib/timing/sound/studio/sfx.tsx';
export { STILL_FEED_SIZES, STILL_PRESETS, type StillFitReport, type StillPreset } from '#lib/picture/stills/models/still-presets.ts';
export { CoverImage, FitText, STILL_CARD_TILT, StillCard, StillHud, defineStills, stillDesign, useStillFrame, type StillAxes, type StillCardTilt, type StillDesign, type StillFocus, type StillImage, type StillsDef } from '#lib/picture/stills/studio/stills.tsx';
export { checkSourcePins, fitTake, onTake, pinnedSourceTime, sceneTimeOf, takeFrameAt, takeMouseAt, takeShot, takeTimeAt, type Take, type TakeFit, type TakeFrame, type TakeMark, type TakeMouse } from '#lib/footage/capture/studio/take.ts';
export { ThreeStage, softboxEnvironment, type ThreeBloom, type ThreeEnvironment, type ThreeFrame, type ThreeLens, type ThreeSample } from '#lib/picture/film/studio/three-stage.tsx';
export { addVec3, crossVec3, dotVec3, lengthVec3, lerpVec3, scaleVec3, subVec3, unitVec3, type Vec3 } from '#lib/picture/frame/models/vec3.ts';
// Stamp painting: a recipe of opaque and glaze groups of passes of deposits, painted on the GPU with a private style's
// brushes (docs/private-styles.md, skills/video-canvas/SKILL.md).
export { compileStampPaintRecipe, stampPaintRecipe, type CompiledStampPaint, type StampBloomSettings, type StampFillSettings, type StampGroupOptions, type StampGroupScope, type StampLiftSettings, type StampMaskSettings, type StampKeyedMaterial, type StampPaintMaterial, type StampPaintPaper, type StampPaintRecipe, type StampPaintScope, type StampPassOptions, type StampPassScope, type StampSoftenSettings, type StampUnmaskSettings, type StampWashOptions, type StampWashScope, type StampWashWait, type StampWaterSettings } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
export type { PaintMaterial, StampPaintColor } from '#lib/paint/materials/models/paint-material.ts';
export { visibleStampCountAt } from '#lib/paint/painting/models/stamp-deposit-reveal.ts';
export { STAMP_FILL_PATTERNS, stampRegionOutline, stampSmoothRegion, type StampFillApplication, type StampFillPattern, type StampFillReach, type StampFillStrokes, type StampFillTurns } from '#lib/paint/painting/models/stamp-fill.ts';
export type { StampEdge, StampPoint, StampRegion } from '#lib/paint/painting/models/stamp-region.ts';
export type { StampPaintField } from '#lib/paint/painting/models/stamp-paint-field.ts';
export type { StampGroupBoil, StampGroupMotion, StampGroupPaper } from '#lib/paint/painting/models/stamp-group-motion.ts';
export { stampWarpHandles, type StampWarpHandle, type StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
export type { StampGroupFrameState, StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
export type { StampMaterialKeys } from '#lib/paint/painting/models/stamp-material-keys.ts';
export type { StampStrokePoint, StampPlacement } from '#lib/paint/brush/models/stamp-placement.ts';
export { STAMP_PRESSURE_PROFILES, type StampPressureCurve, type StampPressureProfileName, type StampStrokeHand } from '#lib/paint/brush/models/stamp-stroke-hand.ts';
export type { StampBlend, StampBrush, StampBrushMedia } from '#lib/paint/brush/models/stamp-brush.ts';
export type { ResolvedStampPaintStyle } from '#lib/paint/style/models/style.ts';
// Figure shapes (plan 1's shape sources): a figure's named parts, silhouette, interior lines and anchors, as regions and
// paths a painting fills, clips and pins with, from posed 3D primitives, named 2D construction or SVG path data.
export type { PaintFigurePart, PaintFigureShapes, PaintFigureSilhouette } from '#lib/paint/animation/models/figure/paint-figure-shapes.ts';
export { posedFigureShapes, posedPrimitiveFigure, type PaintFigurePose, type PaintFigureView, type PosedPrimitiveFigure } from '#lib/paint/animation/models/figure/posed-primitive-figure.ts';
export { constructedFigureShapes, figureConstructionChain, type ConstructedFigure, type PaintFigureConstruction } from '#lib/paint/animation/models/figure/constructed-figure.ts';
export { svgFigureShapes, svgPathRegions, type SvgPathFigure, type SvgPathPlacement } from '#lib/paint/animation/models/figure/svg-path-figure.ts';
// Painted motion (plan 1): nodes with pins and how their marks live, clips played through writers' clocks, evaluated
// per frame into StampPainting's `frame`.
export { buildPaintMotion, paintMotionFrameAt, paintMotionPlay, type PaintLivePose, type PaintMarks, type PaintMotion, type PaintMotionFrame, type PaintMotionNode, type PaintMotionPlay, type PaintNodeClockStep } from '#lib/paint/animation/models/paint-motion-frame.ts';
export { paintIdHash, paintIdPhase, type PaintEase, type PaintMotionClip, type PaintPose, type PaintPoseClip } from '#lib/paint/animation/models/paint-motion-clips.ts';
export type { PaintPartPin, PaintPin, PaintPinMove, PaintPinRig, PaintRadialPin } from '#lib/paint/animation/models/paint-pins.ts';
export { PAINT_ANIMATION_FPS, type PaintClock, type PaintClockStep } from '#lib/paint/animation/models/paint-clock.ts';
// Pigment paint: a style that paints in pigment names its medium and pigments; a deposit lays a colour or a mixture.
export { PAINT_MEDIA, TITANIUM_WHITE, type PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
export type { PaintMixture, PaintMixturePart } from '#lib/paint/materials/models/paint-mixture.ts';
export type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
export { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
export { stampPaintStyle } from '#lib/paint/style/studio/stamp-paint-styles.ts';
export { StampPainting } from '#lib/paint/style/studio/stamp-painting.tsx';
