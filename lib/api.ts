// api.ts: the studio's conveniences for a project's video.tsx or stills.tsx, in one import: `#studio`. A scene may import
// anything else in a feature's studio/ or models/ folder too, as `#lib/<area>/<feature>/<role>/<file>`.

export { BrandLogo, brandLogoFor, type StudioBrand, type StudioBrandLogo } from '#lib/picture/brand/studio/brand.tsx';
export { Blockout, type BlockoutShape, type BlockoutSubject } from '#lib/footage/previs/studio/blockout.tsx';
export { dollyMove, orbitMove, pushInMove, type BlockoutLookAt, type BlockoutMove } from '#lib/footage/previs/models/blockout-camera.ts';
export { FlatBlockout, type FlatPiece, type FlatPieceKind, type FlatViewMoves } from '#lib/footage/previs/studio/flat-blockout.tsx';
export type { FlatKey, FlatPose, FlatView } from '#lib/footage/previs/models/flat-blockout-pose.ts';
export { transcriptLines, type FootageTranscript } from '#lib/footage/transcript/models/footage-transcript.ts';
export type { SpokenWord } from '#lib/footage/transcript/models/spoken-word.ts';
export { libraryFootage, type LibraryFootage, type LibraryScreenWaypoint, type LibrarySpeechEdits, type LibraryTranscriptFile } from '#lib/footage/library/models/library-footage.ts';
export type { LibraryLineCleanup, LibraryLineEdits } from '#lib/footage/library/models/library-line-cut.ts';
export { LIBRARY_PAUSE_PACING, type LibraryPausePacing } from '#lib/footage/library/models/library-pause-pacing.ts';
export { spokenPauseKindOf, type SpokenPauseClassifier, type SpokenPauseKind } from '#lib/footage/transcript/models/spoken-pauses.ts';
export {
  SPOKEN_CLEANUP_RULES, spokenFalseStarts, spokenFillers, spokenRepeats, spokenWordKey, type SpokenDisfluency, type SpokenDisfluencyRule,
} from '#lib/footage/transcript/models/spoken-disfluencies.ts';
export { followPointAt, pointOnPathAt, type TimedPoint } from '#lib/picture/camera/models/follow-point.ts';
export { pointZoomOf, type PointZoom } from '#lib/picture/camera/models/point-zoom.ts';
export { ZoomOnPoint } from '#lib/picture/camera/studio/zoom-on-point.tsx';
export { PictureInPicture, type InsetRing } from '#lib/picture/inset/studio/picture-in-picture.tsx';
export { DEFAULT_INSET_PLACEMENT, insetBoxAt, type InsetCorner, type InsetPlacement } from '#lib/picture/inset/models/inset-layout.ts';
export { useLibraryInputLog } from '#lib/footage/library/studio/use-library-input-log.ts';
export { LibraryVideo, type LibraryVideoProps } from '#lib/footage/library/studio/library-video.tsx';
export { LibraryAudio, type LibraryAudioProps } from '#lib/footage/library/studio/library-audio.tsx';
export type { RecordedSpeech, SpokenPause, SpokenRemoval, SpokenStretch, SpokenUnheard } from '#lib/timing/voice/models/recorded-speech.ts';
export { inputLogKeyStrikes, inputLogWaypoints, parseRecorderInputLog, type InputEvent, type InputLog, type InputLogCoordinates, type InputModifier, type InputWaypoint } from '#lib/footage/input-log/models/input-log.ts';
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
export { type WordPopCaptionPlate, wordPopCaptionBand, wordPopCaptions } from '#lib/picture/captions/studio/word-pop-captions.tsx';
export { FilmGrain, Vignette } from '#lib/picture/film/studio/grade.tsx';
export { ClickToBlur, ConfirmDialog, DrawPath, EndCard, GlassCard, MotionTitle, NativeMenu, ODOMETER_DIGIT_EM, Odometer, Phone, SPLIT_LABEL_STRIP, SectionCard, SplitCompare, WordReveal, phoneView, splitLeftRect, splitRightRect, wordRevealFinish, type OdometerMode, type OdometerProps, type SplitSide, type WordRevealTiming } from '#lib/picture/kit/studio/kit.tsx';
export { backOutEase, clamp, latchCurve, lerp, motionCurves, motionDurations, off, on, perceptualSpring, powerOutEase, seg, sineInOutEase, stagger, staggerFinish, type CurveRoles, type EaseFn, type PerceptualSpring, type SettlingCurve, type StaggerFrom, type StaggerTiming } from '#lib/picture/motion/models/motion.ts';
export { foldAbout, foldMatrix, type FoldMatrix } from '#lib/picture/motion/models/fold.ts';
export { CONTACT_SHARPNESS, STRAIN_ROUND, contactLoad, mixStrain, scaleStrain, strainAbout, strainAffine, strainAlong, strainAlongPath, strainAlongVelocity, strainCssMatrix, strainEllipse, strainExtent, strainMatrix, strainMatrix3, strainOfContact, strainOfLift, type Strain } from '#lib/picture/motion/models/strain.ts';
export { ShutterBlur } from '#lib/picture/film/studio/motion-blur.tsx';
export { momentEarlier, REEL_SHUTTER, shutterOpensAt, shutterTravel, smearSigma } from '#lib/picture/lens/models/lens-shutter.ts';
export { motionAttrs, motionEchoAttrs, pieceMotionAttrs, unmeasuredAttrs, useMotionTag, type MotionTag } from '#lib/picture/measurement/studio/motion-tag.ts';
export { ClickRipple, ClipToBox, Cursor, CursorPath, Glass, Highlight, Spotlight, Tag, TakeCursor, Text, Wash, cursorAt, offscreen, type CursorKey } from '#lib/picture/kit/studio/overlays.tsx';
export { hashRandom, randomSeedFromKey, seededRandom } from '#lib/picture/motion/models/random.ts';
export { SEEDED_SCATTER_ATTEMPTS, seededScatter, type SeededScatterArea, type SeededScatterItem, type SeededScatterOptions } from '#lib/picture/motion/models/scatter.ts';
// The reel pieces: the high-energy register of music-led videos (skills/video-motion/references/reel-pieces.md).
// Each model is re-exported by name: the helpers it exports only for its own drawing stay out of the barrel.
export { BounceBall, FieldSwell, type BounceCallout } from '#lib/picture/reel/studio/bounce.tsx';
export { bouncingBallAt, type BallLaunch, type BallPhase, type BallPose, type BounceParams, type BounceTiming } from '#lib/picture/reel/models/bounce.ts';
export { fieldSwellAt, type FieldSwellOptions, type SwellFrom, type SwellPose } from '#lib/picture/reel/models/bounce-swell.ts';
export { DropWord } from '#lib/picture/reel/studio/letter-drop.tsx';
export { letterDropAt, letterDropDuration, type LetterDropOptions, type LetterDropPose } from '#lib/picture/reel/models/letter-drop.ts';
export { CapturePlane, type CapturePlaneProps } from '#lib/picture/reel/studio/capture-plane.tsx';
export { PLANE_REST_POSE, capturePlaneProjection, capturePlaneView, lerpPlanePose, planeLiftStart, type CapturePlaneProjection, type PlaneLift, type PlanePose } from '#lib/picture/reel/models/capture-plane.ts';
export { ColumnField, type ColumnFieldProps } from '#lib/picture/reel/studio/column-field.tsx';
export { columnDiscCells, columnFieldHeight, columnFieldPoint, columnNoise, type ColumnBall, type ColumnBallState, type ColumnCameraMove, type ColumnCameraPose, type ColumnCameraState, type ColumnCell, type ColumnFieldLights, type ColumnFieldSpec, type ColumnLabel, type ColumnLight, type ColumnRise } from '#lib/picture/reel/models/column-field.ts';
export { columnBallAt, columnCameraAt, columnFieldCameraAt, columnFieldFrame, topDownPose } from '#lib/picture/reel/models/column-field-motion.ts';
export { columnTitaniumMaterial } from '#lib/picture/reel/studio/column-field-materials.ts';
export { FieldFlash, GlyphField, ShockRing } from '#lib/picture/reel/studio/glyph-field.tsx';
export { GLYPH_FIELD_COLORS, GLYPH_SHAPES, glyphFieldLayout, glyphPunchScale, glyphRegroupPlan, glyphWaveArrivals, type GlyphCell, type GlyphClip, type GlyphFieldSlot, type GlyphFilterStep, type GlyphFilterTiming, type GlyphFront, type GlyphHit, type GlyphImplode, type GlyphKey, type GlyphLayout, type GlyphPunch, type GlyphRegroup, type GlyphShape, type GlyphShapeKey, type GlyphWave } from '#lib/picture/reel/models/glyph-field.ts';
export { glyphFieldFrame, parseGlyphColor, type GlyphDraw, type GlyphFieldFrame, type GlyphFieldProps, type GlyphRest, type GlyphSample } from '#lib/picture/reel/models/glyph-field-frame.ts';
export { ReelHud, type ReelHudProps } from '#lib/picture/reel/studio/hud.tsx';
export { REEL_HUD_BOOT_DECODE, REEL_HUD_GLYPHS, REEL_HUD_PALETTE, REEL_HUD_SLOTS, REEL_HUD_SWAP_DECODE, reelHudBoxPoints, reelHudBoxes, reelHudDecode, reelHudGrounds, reelHudLitSquare, reelHudPlateMix, reelHudReadGrounds, reelHudTimecode, reelHudToneOver, reelHudToneWeights, type ReelHudCell, type ReelHudDecodeSchedule, type ReelHudGround, type ReelHudLayoutProps, type ReelHudPalette, type ReelHudRead, type ReelHudSection, type ReelHudSlot, type ReelHudTone } from '#lib/picture/reel/models/hud.ts';
export { LensFringe, channelSplitPrimitives } from '#lib/picture/reel/studio/lens.tsx';
export { lensFringeAt, lensFringeSubpixelMax, type LensFringeState, type LensFringeTiming } from '#lib/picture/reel/models/lens.ts';
export { Needle, type NeedleProps } from '#lib/picture/reel/studio/needle.tsx';
export { needleContactAt, needleCoversAt, needleExposuresAt, needleLensHeight, needlePoseAt, needleRig, needleShotAt, needleShotCamera, type NeedleLensing, type NeedlePose, type NeedleRig, type NeedleRigSettings, type NeedleShot, type NeedleStrike, type NeedleTake } from '#lib/picture/reel/models/needle.ts';
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
export { sceneForTimelineClock } from '#lib/picture/video/studio/timeline-scene.tsx';
export { sceneCueSeconds } from '#lib/timing/timeline/models/scene-cue-seconds.ts';
export { defineCueCharacter, type AnyCueCharacter, type CueCharacter, type CueCharacterState, type CueMove, type CueSlider } from '#lib/timing/character-cues/models/cue-character.ts';
export type { CueBlend, CueEaseCurve, CueSpring } from '#lib/timing/character-cues/models/cue-blend.ts';
export type { CueCast, CueFrame, CueMoveCall, CueMoveEnd, CueRow, CueVector } from '#lib/timing/character-cues/models/cue-score.ts';
export type { CueLeaf, CueLeafPath, CueNumberPath, CuePatch, CuePath, CueState } from '#lib/timing/character-cues/models/cue-state.ts';
export { cueSecondsOf, cueTimeSeconds, type CueAnchor, type CueClock, type CueNamesOfClock, type CueOffset, type CueSeconds, type CueTime } from '#lib/timing/character-cues/models/cue-time.ts';
export { compileCueScore, type CueScore } from '#lib/timing/character-cues/models/cue-tracks.ts';
export {
  drawingSchedule, redrawSeed, type DrawingCadence, type DrawingPhase, type DrawingSchedule, type RedrawToken, type ScheduledDrawing,
} from '#lib/timing/drawings/models/drawing-schedule.ts';
export { createLineLook, createPencilLook } from '#lib/paint/looks/models/line-look.ts';
export { deriveLook, defineLook, printLook, type PaintLook } from '#lib/paint/looks/models/paint-look.ts';
export { lookDraw, type LookRedraw, type LookStep, type LookPlace, type LookProcess } from '#lib/paint/looks/models/look-step.ts';
export { lookPlanes, lookSheets } from '#lib/paint/looks/models/look-planes.ts';
export { defineLookCatalog, type LookCatalog, type LookDescription, type LookPaletteOf, type LookSampling } from '#lib/paint/looks/models/look-catalog.ts';
export {
  checkGltfCueManifest, gltfCueCharacter, type GltfClipMove, type GltfClipPose, type GltfClipSample, type GltfCueManifest, type GltfCueState, type GltfMorphPatch,
} from '#lib/picture/character/models/gltf-cue-character.ts';
export { gltfCueGlbBytes, gltfCueModelPosed, loadGltfCueModel, type GltfCueModel, type GltfRootMotion } from '#lib/picture/character/studio/gltf-cue-model.ts';
export { useGltfCueModel } from '#lib/picture/character/studio/use-gltf-cue-model.ts';
export { sceneSecondsOf, type SceneClockSeconds, type SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';
export type { SceneRung } from '#lib/timing/timeline/models/scene-rung.ts';
export { blockingScene } from '#lib/footage/previs/studio/blocking-scene.tsx';
export { SFX, Sfx, SfxCueListAudio, SfxCueListPlaying, type SfxCueSound, type SfxSound } from '#lib/timing/sound/studio/sfx.tsx';
export { SoundClip, type SoundClipProps } from '#lib/timing/sound/studio/sound-clip.tsx';
export { STILL_FEED_SIZES, STILL_PRESETS, type StillFitReport, type StillPreset } from '#lib/picture/stills/models/still-presets.ts';
export { CoverImage, FitText, STILL_CARD_TILT, StillCard, StillHud, defineStills, stillDesign, useStillFrame, type StillAxes, type StillCardTilt, type StillDesign, type StillFocus, type StillImage, type StillsDef } from '#lib/picture/stills/studio/stills.tsx';
export { checkSourcePins, fitTake, onTake, pinnedSourceTime, sceneTimeOf, takeFrameAt, takeMouseAt, takeShot, takeTimeAt, type Take, type TakeFit, type TakeFrame, type TakeMark } from '#lib/footage/capture/studio/take.ts';
export { ThreeStage, softboxEnvironment, type ThreeBloom, type ThreeEnvironment, type ThreeFrame, type ThreeLens, type ThreeSample } from '#lib/picture/film/studio/three-stage.tsx';
// Stamp painting: a recipe of opaque and glaze groups of passages of applications, written against a style and
// painted on the GPU with its brushes (the paint skill).
export { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
export { compileStampPaintRecipe, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
export type {
  StampApplicationOptions, StampDepositGeometry, StampFillOptions, StampGroupOptions, StampGroupScope, StampKeyedMaterial, StampKnockoutOptions, StampKnockoutScope, StampLiftOptions,
  StampMarkPaintOptions, StampMaskSettings, StampPaintEnvironment, StampPaintMaterial, StampPaintPaper, StampPaintRecipe, StampPaintScope, StampPassageDefaults, StampPassageOptions,
  StampPassageScope, StampPlacementOptions, StampPreparation, StampStrokeOptions, StampToolOptions, StampUnmaskSettings, StampWaterOptions, StampWell,
} from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
export { defineStampTechnique, type StampApplicationRef, type StampDepositRef, type StampFootprint, type StampTechniqueContext, type StampTechniqueHandle, type StampTechniqueSpec } from '#lib/paint/painting/models/stamp-paint-passage.ts';
export { stampBlot, stampChargedForm, stampDrawnLine, stampFaceValues, stampGradedWash, stampGuidedMarks, type StampBlotOptions, type StampChargedFormOptions, type StampDrawnLineOptions, type StampFormFace, type StampFormValue, type StampGradedWashOptions, type StampGuidedMarksOptions } from '#lib/paint/painting/models/stamp-technique-catalogue.ts';
export { STAMP_SOFTEN_WATER, stampBackrun, stampBloom, stampCharge, stampSoften, type StampBackrunOptions, type StampBloomOptions, type StampChargeOptions, type StampSoftenOptions } from '#lib/paint/painting/models/stamp-wet-techniques.ts';
export { stampSizeToken, type StampSheet, type StampSize, type StampSizeRange, type StampSizeToken } from '#lib/paint/painting/models/stamp-paint-sizes.ts';
export type { PaintMaterial, StampPaintColor } from '#lib/paint/materials/models/paint-material.ts';
export type { StampCondition, StampSheen, StampWaitEffect, StampWashWait, StampWetEffectKind } from '#lib/paint/painting/models/stamp-wash-effects.ts';
export { stampMarkStamps, stampScatteredStrokePath, stampScatterMarks, type StampMark, type StampMarkAnchor, type StampMarkGeometry, type StampScatterAngle, type StampScatteredMark, type StampScatterOptions, type StampScatterPlacement } from '#lib/paint/painting/models/stamp-marks.ts';
export { pickStampMaterial, stampMaterialSet, stampMaterialSetProblem, type StampMaterialSet, type StampMaterialSetEntry } from '#lib/paint/painting/models/stamp-material-set.ts';
export { compileStampWetness } from '#lib/paint/painting/models/stamp-wash-waits.ts';
export { assertStampWetEffects, stampWetReport, stampWetReportStrictFailures, stampWetReportWarnings, type StampWetReport, type StampWetReportDrying, type StampWetReportEffect, type StampWetReportTouch, type StampWetReportWait, type StampWetReportWash } from '#lib/paint/painting/models/stamp-wet-report.ts';
export { stampRegionOutline, stampSmoothRegion, type StampFillApplication } from '#lib/paint/painting/models/stamp-fill.ts';
export { STAMP_FILL_PATTERNS, stampFillMarks, stampFillStrokePath, type StampFillGuides, type StampFillMark, type StampFillPattern, type StampFillReach, type StampFillStrokes, type StampFillTurns, type StampGuide } from '#lib/paint/painting/models/stamp-fill-strokes.ts';
export { PAPER_KEY_LIGHT, stampFittedEllipse, stampRoundedForm, type PaintLight, type StampFormEllipse, type StampRoundedForm, type StampRoundedFormSettings } from '#lib/paint/painting/models/stamp-form.ts';
export type { StampEdge, StampPoint, StampRegion } from '#lib/paint/painting/models/stamp-region.ts';
export type { StampArea, StampStandsBefore, StampWithin } from '#lib/paint/painting/models/stamp-area.ts';
export type { StampBoundaries, StampBoundary, StampBoundaryTreatment } from '#lib/paint/painting/models/stamp-area-boundaries.ts';
export type { StampNoiseField, StampPaintField } from '#lib/paint/painting/models/stamp-paint-field.ts';
// StampGroupMotion is the recipe path's (StampPainting): keyed placements, linear between keys. A shot moves a group
// by a node's place play, its value a PresentationValue.
export type { StampGroupMotion, StampGroupPaper } from '#lib/paint/painting/models/stamp-group-motion.ts';
export type { StampWarpMap } from '#lib/paint/painting/models/stamp-group-warp.ts';
export { paintMoment, type PaintMoment, type StampGroupFrameState, type StampPaintFrameAt, type StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
export type { StampMaterialKeys } from '#lib/paint/painting/models/stamp-material-keys.ts';
export type { StampStrokePoint, StampPlacement } from '#lib/paint/brush/models/stamp-placement.ts';
export { STAMP_PRESSURE_PROFILES, type StampPressureCurve, type StampPressureProfileName, type StampStrokeHand } from '#lib/paint/brush/models/stamp-stroke-hand.ts';
export type { StampBlend, StampBrush, StampBrushMedia } from '#lib/paint/brush/models/stamp-brush.ts';
export type { ResolvedStampPaintStyle } from '#lib/paint/style/models/style.ts';
// Figure shapes (plan 1's shape sources): a figure's named parts, silhouette, interior lines and anchors, as regions and
// paths a painting fills, clips and pins with, from posed 3D primitives, named 2D construction or SVG path data.
export { paintFigurePartPieces, paintFigurePartRegion, type PaintFigurePart, type PaintFigureShapes, type PaintFigureSilhouette } from '#lib/paint/animation/models/figure/paint-figure-shapes.ts';
export { posedFigureShapes, posedPrimitiveFigure, type PaintFigurePose, type PaintFigurePrimitive, type PaintFigureView, type PosedPrimitiveFigure } from '#lib/paint/animation/models/figure/posed-primitive-figure.ts';
export { constructedFigureShapes, figureConstructionChain, type ConstructedFigure, type PaintFigureConstruction } from '#lib/paint/animation/models/figure/constructed-figure.ts';
export { svgFigureShapes, svgPathRegions, type SvgPathFigure, type SvgPathPlacement } from '#lib/paint/animation/models/figure/svg-path-figure.ts';
// Subject painting: a subject (what exists and what shows, by semantic id) painted whole by a style's painter, with
// intents, per-target tunes and hand-painted replacements resolved before it plans.
export { SUBJECT_HIDDEN, subjectAreaBox, subjectAreaVisibility, subjectPathVisibility, subjectVisible, type SubjectArea, type SubjectLandmarkPoint, type SubjectPath, type SubjectPathRun, type SubjectRing, type Visibility, type Visible } from '#lib/paint/subject/models/subject-geometry.ts';
export type { FeatureGroupId, FeatureId, FrameId, MaterialId, PartId, SubjectId, SubjectIds, SubjectTag } from '#lib/paint/subject/models/subject-id.ts';
export { formatSubjectDiagnostics, SubjectDiagnosticError, type SubjectDiagnostic, type SubjectDiagnosticCode, type SubjectResult } from '#lib/paint/subject/models/subject-diagnostic.ts';
export { subjectKeyPageDirection, type IlluminationEvidence, type SubjectEvidenceKind, type SubjectLight, type SubjectSampleLayout, type SubjectVector3, type SurfaceEvidence } from '#lib/paint/subject/models/subject-evidence.ts';
export { subjectFrameMarks } from '#lib/paint/subject-painting/models/subject-frame-marks.ts';
export { subjectFramePoint, subjectFrameUnitPx, type SubjectFrame, type SubjectFrameBasis, type SubjectFrameSource, type SubjectFrameStatus } from '#lib/paint/subject/models/subject-frame.ts';
export {
  checkSubject, defineSubject, findSubjectFeature, findSubjectFrame, findSubjectMaterial, findSubjectPart, subjectMaterialOf, subjectRefKey,
  type PaintableRef, type Subject, type SubjectFeature, type SubjectHex, type SubjectInput, type SubjectLineKind, type SubjectMaterial, type SubjectPart, type SubjectRef,
} from '#lib/paint/subject/models/subject.ts';
export { selectFeature, selectFeatureGroup, selectMaterial, selectPart, selectTag, type PaintableSelector, type SubjectSelector, type SubjectTarget } from '#lib/paint/subject/models/subject-selector.ts';
export { requireSubjectEvidence, type SubjectWithEvidence } from '#lib/paint/subject/models/subject-check.ts';
export {
  defineSubjectFromThree, projectSubjectFromThree, type SubjectThreeAnnotation, type SubjectThreeCenterline, type SubjectThreeDiagnostic,
  type SubjectThreeFrameInput, type SubjectThreePlaneFrame, type SubjectThreeFeatureInput, type SubjectThreeInput, type SubjectThreeLight, type SubjectThreePartInput, type SubjectThreeSurfaceAnnotation,
} from '#lib/paint/subject/models/subject-three.ts';
export {
  definePrimitiveSubject, primitiveSubjectEdgeId,
  type PrimitiveFrameBinding, type PrimitiveLandmarkBinding, type PrimitivePartBinding, type PrimitiveRegionBinding, type PrimitiveSubjectBinding, type PrimitiveSubjectView,
} from '#lib/paint/subject/models/subject-primitive.ts';
export {
  defineSubjectPainter, subjectPaintKey,
  type ResolvedSubjectIntent, type SubjectContribution, type SubjectEdgeIntent, type SubjectEmphasis, type SubjectIntent, type SubjectPainter, type SubjectPainterContext,
  type SubjectPainterOptions, type SubjectPainterReport, type SubjectPaintKey, type VisibleSubjectFeature, type VisibleSubjectPart,
} from '#lib/paint/subject-painting/models/subject-painter.ts';
export { subjectIntent, subjectReplace, subjectTune, type SubjectOverride, type SubjectReplacementContext } from '#lib/paint/subject-painting/models/subject-overrides.ts';
export { paintSubject, requireSubjectPainting, type SubjectOverridesFor, type SubjectPainting } from '#lib/paint/subject-painting/models/paint-subject.ts';
export { type SubjectPaintingDiagnostic, type SubjectPaintingReport } from '#lib/paint/subject-painting/models/subject-painting-report.ts';
export { subjectAreaRegion, subjectPathSubpaths } from '#lib/paint/subject-painting/models/subject-document-geometry.ts';
export { SUBJECT_FIGURE_CARD_FADE, SUBJECT_GROUND_SLOT, subjectFigureCard } from '#lib/paint/subject-painting/models/subject-figure-card.ts';
export { subjectAreasUnion } from '#lib/paint/subject/models/subject-area-union.ts';
export { subjectShowingOnly } from '#lib/paint/subject/models/subject-showing-only.ts';
export {
  WATERCOLOR_SUBJECT_DEFAULTS, watercolorSubjectPainter,
  type SubjectPigment, type WatercolorSubjectBinding, type WatercolorSubjectBrushes, type WatercolorSubjectOptions, type WatercolorSubjectSlot,
} from '#lib/paint/subject-painting/models/painters/watercolor.ts';
export {
  GOUACHE_SUBJECT_DEFAULTS, gouacheSubjectPainter,
  type GouacheSubjectBinding, type GouacheSubjectBrushes, type GouacheSubjectOptions, type GouacheSubjectSlot,
} from '#lib/paint/subject-painting/models/painters/gouache.ts';
export { SUBJECT_LIGHT_TREATMENTS, type SubjectLightTreatment } from '#lib/paint/subject-painting/models/painters/subject-light-zones.ts';
export {
  LINE_SUBJECT_DEFAULTS, lineSubjectPainter, type LineSubjectBrushes, type LineSubjectOptions, type LineTool,
} from '#lib/paint/subject-painting/models/painters/line.ts';
export { hasSubjectTag, SUBJECT_WELL_KNOWN_TAGS, type SubjectWellKnownTag } from '#lib/paint/subject/models/subject-tags.ts';
// Painted motion (plan 1): nodes over a compiled painting's groups, with pins and how their marks live (a live node
// registers its poser), clips played through clocks written as parts, evaluated per frame into StampPainting's `frame`.
export { buildPaintMotion, type PaintMotionBuild } from '#lib/paint/animation/models/paint-motion.ts';
export { paintMotionPlay, type PaintWobbleMarks, type PaintLivePose, type PaintLivePoser, type PaintMarks, type PaintMotion, type PaintMotionNode, type PaintMotionPlay } from '#lib/paint/animation/models/paint-motion-compile.ts';
export { paintMotionFrameAt } from '#lib/paint/animation/models/paint-motion-frame.ts';
export { paintIdHash, paintIdPhase, type PaintMotionClip, type PaintPlaceClip, type PaintPose, type PaintPoseClip } from '#lib/paint/animation/models/paint-motion-clips.ts';
export type { PaintPartPin, PaintPin, PaintPinRig, PaintPlacementMove, PaintRadialPin } from '#lib/paint/animation/models/paint-pins.ts';
// Values in time (the paint skill's shots): a constant or a function of the moment, keyed with curves.
export { presentationValueAt, type PaintKeyed, type PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
export { paintKeyed, paintKeyedAccent, paintKeyedHit, type PaintKey, type PaintKeyedOptions } from '#lib/paint/animation/models/paint-keyed.ts';
export type { PaintCurve } from '#lib/paint/animation/models/paint-curves.ts';
export { type PaintNodeClock, type PaintPlayClock, type PaintPlayLoop } from '#lib/paint/animation/models/paint-clock.ts';
export { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
// Pigment paint: a style that paints in pigment names its medium and pigments; a deposit lays a colour or a mixture.
export { PAINT_MEDIA, TITANIUM_WHITE, type PaintMedium, type PaintSheen } from '#lib/paint/materials/models/paint-medium.ts';
export type { PaintMixture, PaintMixturePart } from '#lib/paint/materials/models/paint-mixture.ts';
export type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
export { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
export { stampPaintStyle } from '#lib/paint/style/studio/stamp-paint-styles.ts';
export { StampPainting } from '#lib/paint/style/studio/stamp-painting.tsx';
// A scene as planes: each a depth and a source, painted groups (on paper at the back, clear film nearer), a picture
// worked out per moment, or three.js, seen through one camera; StampPainting takes the camera and the sources.
export type { StampPictureAt, StampPictureRgba, StampPlane, StampPlaneSource } from '#lib/paint/painting/models/stamp-plane.ts';
export type { PaintedThree, PaintedThreeOffscreenPass, PaintedThreeSource, PaintedThreeSourceScene, PaintedThreeSourceTools, PaintedThreeTexture } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
export { paintedThreeColorNode } from '#lib/paint/three-layers/studio/painted-three-material.ts';
// Folded sheets in three.js: a print cut into faces hinged in a tree, each folding by an angle in time (a card is one
// face); paper is their material preset, lit as paper; a pop-up stands sheets on faces of a base and of each other.
export {
  PAINTED_THREE_SHEET_ROOT, paintedThreeSheetFolding, type PaintedThreeSheet, type PaintedThreeSheetEdge, type PaintedThreeSheetFace, type PaintedThreeSheetFaceCut, type PaintedThreeSheetFold,
  type PaintedThreeSheetFolding, type PaintedThreeSheetRing, type PaintedThreeSheetRoot,
} from '#lib/paint/three-layers/models/painted-three-sheet.ts';
export {
  createPaintedThreeSheet, createPaintedThreeSheetFaceMeshes, createPaintedThreeSheetGeometry, type PaintedThreeSheetFaceGeometry, type PaintedThreeSheetMaterial, type PaintedThreeSheetMeshes,
  type PaintedThreeSheetGeometry,
} from '#lib/paint/three-layers/studio/painted-three-sheet.ts';
export { PAINTED_THREE_PAPER_LIGHT_SHARES, type PaintedThreePaperLeak, type PaintedThreePaperLightShares } from '#lib/paint/three-layers/models/painted-three-paper.ts';
export {
  createPaintedThreePaperLights, paintedThreePaperMaterial, setPaintedThreePaperShow, type PaintedThreePaperLights, type PaintedThreePaperLook, type PaintedThreePaperShow,
} from '#lib/paint/three-layers/studio/painted-three-paper.ts';
export type { PaintedThreePopUp, PaintedThreePopUpSheet, PaintedThreePrintTint } from '#lib/paint/three-layers/models/painted-three-pop-up.ts';
export { paintedThreePopUp, type PaintedThreePopUpLook } from '#lib/paint/three-layers/studio/painted-three-pop-up.ts';
export { paperPopUpPlane, type PaperPopUpPlaneOptions, type PaperPopUpPrint } from '#lib/paint/shot/studio/shot-paper-pop-up.ts';
// The paper kit: cut-paper constructions as pop-up sheets, folding up from flat by a rise, and a diorama's presets.
export {
  PAPER_BOX_HOUSE_WALLS, PAPER_STAND_UP_TAB, PAPER_TENT_BACK, paperBoxHouse, paperBoxHouseNet, paperBoxHouseRoofId, paperBoxHouseTabFace, paperStandUp, paperTent, paperXTree,
  paperXTreeSlots, type PaperBoxHouseNet, type PaperBoxHouseOptions, type PaperBoxHouseWall, type PaperConstruction, type PaperConstructionPlace, type PaperOutline, type PaperRise,
  type PaperStandUpOptions, type PaperTentOptions, type PaperXTreeOptions, type PaperXTreeSlots,
} from '#lib/paint/paper-kit/models/paper-constructions.ts';
export { PAPER_DIORAMA_PITCH, paperDioramaFocus, paperDioramaLight } from '#lib/paint/paper-kit/models/paper-diorama.ts';
export { paintWorldLightDirection, type PaintWorldDirection } from '#lib/paint/animation/models/paint-camera-world.ts';
export { setThreeMirrorCamera } from '#lib/picture/shot-camera/studio/three-mirror-camera.ts';
export type { PaintedThreeShadows } from '#lib/paint/three-layers/studio/painted-three-shadows.ts';
// Painting sources (the paint skill): a `*.painting.ts` factory returns a PaintingDocument. Its everyday types are
// here; the rest are in lib/paint/document/models/painting-document.ts. A scene evaluates it and selects its layers.
export type {
  Application, BrushRef, Charge, DirectApplication, Footprint, LayerNode, Mix, PaintingDocument, Paper, Region, Subpath,
} from '#lib/paint/document/models/painting-document.ts';
export { checkPaintingSource, painting, type PaintingEvaluation, type PaintingFactory, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
export type { PropertySchema, PropertySpec, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
export type { PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
export { layersOf, type LayerSelection, type SelectionGround } from '#lib/paint/document/models/painting-selection.ts';
export { dissolve, type Dissolve, type PaintedSource } from '#lib/paint/shot/models/shot-selection.ts';
export { paintingInTime, type PaintingInTime, type PaintingInTimeOptions, type PaintingInTimeValues } from '#lib/paint/shot/models/shot-painting-in-time.ts';
// A figure card's subtree as an image a plane places, its silhouette read beside it (the paint skill's shots).
export { scheduledSource } from '#lib/paint/shot/models/shot-props.ts';
export { shotFigure, shotFigureInTime, shotFigureSilhouette, shotPlace, type ShotFigure } from '#lib/paint/shot/models/shot-figure.ts';
// Effects: a definition's models half and its studio half, made alike by the built-ins and a project's own.
export {
  defineShotEffect, shotPlaneImage, type ShotPlaneImage, SHOT_EFFECT_READS_MOST, type ShotEffect, type ShotEffectDefinition, type ShotEffectImage, type ShotEffectParams, type ShotEffectMoment, type ShotEffectProblem,
  type ShotEffectRead, type ShotEffectVaries, type ShotImageSource,
} from '#lib/paint/shot/models/shot-effect.ts';
export { offsetCopies, type ShotOffsetCopiesParams } from '#lib/paint/shot/models/shot-offset-copies.ts';
export { channelSplit, type ShotChannelSplitParams } from '#lib/paint/shot/models/shot-channel-split.ts';
export { slices, type ShotSlicesParams } from '#lib/paint/shot/models/shot-slices.ts';
export { trail, trailStrobe, type ShotTrailParams } from '#lib/paint/shot/models/shot-trail.ts';
export { mosh } from '#lib/paint/shot/models/shot-mosh.ts';
export { signalBreak } from '#lib/paint/shot/models/shot-signal-break.ts';
export { signalGround } from '#lib/paint/shot/models/shot-signal-ground.ts';
export { defineShotEffectGpu, SHOT_EFFECT_PARAMS_MOST, type ShotBlockMotion, type ShotEffectGpu } from '#lib/paint/shot/studio/shot-effect-gpu.ts';
// Light one plane throws on another, and neon: tubes, flicker and wall spill as parts.
export { illuminate, lightSpill, SHOT_LIGHT_SPILLS_MOST, type ShotLightSpill } from '#lib/paint/shot/models/shot-light-spill.ts';
export { neon, neonFlickerValue, neonTubes, type Neon, type NeonFlicker, type NeonOptions, type NeonSpill, type NeonTubesParams } from '#lib/paint/shot/models/shot-neon.ts';
export type {
  CoverFrame, InstancedPlaneProps, OccurrenceKey, OccurrenceProps, OccurrenceRig, PaintedShotProps, PaintedTexture, PictureSource, PinPoint, PlaneInstance,
  PlaneLay, PlaneMask, PlaneProps, RigPart, RigPartPose, RigPose, ScreenPin, ShotNodePlay, ThreeSource,
} from '#lib/paint/shot/models/shot-props.ts';
export type { PaintShotCamera, PaintShotLens } from '#lib/paint/animation/models/paint-camera-build.ts';
export { PaintedShot, PaintedShotCanvas } from '#lib/paint/shot/studio/painted-shot.tsx';
