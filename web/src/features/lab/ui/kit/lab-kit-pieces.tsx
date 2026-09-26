import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { DRAW_PATH_KIT_DEFAULTS, DrawPathKitStage, drawPathKitSeconds } from '#studio/lab/kit/draw-path-kit-stage.tsx';
import { END_CARD_KIT_DEFAULTS, EndCardKitStage, endCardKitSeconds } from '#studio/lab/kit/end-card-kit-stage.tsx';
import { GLASS_CARD_KIT_DEFAULTS, GlassCardKitStage, glassCardKitSeconds } from '#studio/lab/kit/glass-card-kit-stage.tsx';
import { GRADE_KIT_DEFAULTS, GradeKitStage, gradeKitSeconds } from '#studio/lab/kit/grade-kit-stage.tsx';
import { ODOMETER_KIT_DEFAULTS, OdometerKitStage, odometerKitSeconds } from '#studio/lab/kit/odometer-kit-stage.tsx';
import { SECTION_CARD_KIT_DEFAULTS, SectionCardKitStage, sectionCardKitSeconds } from '#studio/lab/kit/section-card-kit-stage.tsx';
import { SHUTTER_BLUR_KIT_DEFAULTS, ShutterBlurKitStage, shutterBlurKitSeconds } from '#studio/lab/kit/shutter-blur-kit-stage.tsx';
import { WORD_REVEAL_KIT_DEFAULTS, WordRevealKitStage, wordRevealKitSeconds } from '#studio/lab/kit/word-reveal-kit-stage.tsx';
import { colors } from '#web/shared/ui/theme.stylex.ts';
import { LabKitDrawPathControls } from './lab-kit-draw-path-controls.tsx';
import { LabKitEndCardControls } from './lab-kit-end-card-controls.tsx';
import { LabKitGlassCardControls } from './lab-kit-glass-card-controls.tsx';
import { LabKitGradeControls } from './lab-kit-grade-controls.tsx';
import { LabKitOdometerControls } from './lab-kit-odometer-controls.tsx';
import type { LabKitPiece, LabKitPieceId } from './lab-kit-piece.ts';
import { LabKitSectionCardControls } from './lab-kit-section-card-controls.tsx';
import { LabKitShutterBlurControls } from './lab-kit-shutter-blur-controls.tsx';
import { LabKitWordRevealControls } from './lab-kit-word-reveal-controls.tsx';

const styles = stylex.create({
  emphasis: { color: colors.cream, fontWeight: 700 },
});

/**
 * The registry, in the order the picker shows it. Keyed by id so each piece's stage, defaults and controls are checked
 * against its own props, and the tab hands a piece only its own.
 */
export const LAB_KIT_PIECES: { readonly [K in LabKitPieceId]: LabKitPiece<K> } = {
  'word-reveal': {
    id: 'word-reveal',
    name: 'WordReveal',
    title: 'Words one by one',
    blurb: 'Words that come in one after another.',
    source: 'lib/studio/kit/kit.tsx',
    whenUsed: 'A headline or a key line of the voice-over, so the words arrive as they’re read rather than all at once.',
    note: 'It uses the system font on purpose: it’s a walkthrough piece, and there the words should look like the product’s own screens. Letter by letter is for one short word; on a sentence it takes too long.',
    defaults: WORD_REVEAL_KIT_DEFAULTS,
    seconds: wordRevealKitSeconds,
    Stage: WordRevealKitStage,
    Controls: LabKitWordRevealControls,
  },
  odometer: {
    id: 'odometer',
    name: 'Odometer',
    title: 'Rolling number',
    blurb: 'A number whose digits roll on wheels, like a car’s mileage counter, and land sharp on the final value.',
    source: 'lib/studio/kit/kit.tsx',
    whenUsed: 'A result worth dwelling on: a price, a total, a percentage saved. The roll makes the viewer watch the number arrive.',
    note: (
      <>
        A digit blurs while its wheel turns and is pin-sharp once it stops, so a fast roll reads as motion, not as a flicker of numbers. Every digit sits in a box of the same width, so the
        number never wobbles sideways. How fast the value moves is up to the curve: the <Text component="b" inherit {...stylex.props(styles.emphasis)}>calm</Text> one eases in,
        the <Text component="b" inherit {...stylex.props(styles.emphasis)}>fast</Text> one arrives almost at once and creeps the last bit.
      </>
    ),
    defaults: ODOMETER_KIT_DEFAULTS,
    seconds: odometerKitSeconds,
    Stage: OdometerKitStage,
    Controls: LabKitOdometerControls,
  },
  'draw-path': {
    id: 'draw-path',
    name: 'DrawPath',
    title: 'Pen stroke',
    blurb: 'A line that draws itself on, as if by a pen.',
    source: 'lib/studio/kit/kit.tsx',
    whenUsed: 'Pointing at something: ticking off a step, underlining the word that matters, circling a price, an arrow to where to click.',
    note: 'The pen starts fast and slows as it finishes, like a real hand. Thickness is in screen pixels, so the checkmark (drawn in its own little 100×100 box, like an icon) is as thick as the rest.',
    defaults: DRAW_PATH_KIT_DEFAULTS,
    seconds: drawPathKitSeconds,
    Stage: DrawPathKitStage,
    Controls: LabKitDrawPathControls,
  },
  'glass-card': {
    id: 'glass-card',
    name: 'GlassCard',
    title: 'Frosted summary card',
    blurb: 'A frosted card whose few big lines come in one by one.',
    source: 'lib/studio/kit/kit.tsx',
    whenUsed: 'The closing summary of a walkthrough: “In short”, then two or three lines, over the blurred product.',
    note: 'The glass needs something blurred and tinted behind it, which in a video is the page the viewer just watched. Keep it to three short lines: it holds while the voice reads them.',
    defaults: GLASS_CARD_KIT_DEFAULTS,
    seconds: glassCardKitSeconds,
    Stage: GlassCardKitStage,
    Controls: LabKitGlassCardControls,
  },
  'section-card': {
    id: 'section-card',
    name: 'SectionCard',
    title: 'Chapter card',
    blurb: 'A full-screen chapter title that slides away to reveal the next part.',
    source: 'lib/studio/kit/kit.tsx',
    whenUsed: 'Longer walkthroughs split into parts: “3 / 6 · Finding a colour”, so the viewer knows where they are and how much is left.',
    note: 'The voice starts the next part while the card is still up, so the chapter title costs no extra time. Here the “scene underneath” is a stand-in page.',
    defaults: SECTION_CARD_KIT_DEFAULTS,
    seconds: sectionCardKitSeconds,
    Stage: SectionCardKitStage,
    Controls: LabKitSectionCardControls,
  },
  'end-card': {
    id: 'end-card',
    name: 'EndCard',
    title: 'End card',
    blurb: 'The last frame: a solid colour with one centred line.',
    source: 'lib/studio/kit/kit.tsx',
    whenUsed: 'The very end of a walkthrough: the feature’s name, held for a moment so the video doesn’t just stop.',
    defaults: END_CARD_KIT_DEFAULTS,
    seconds: endCardKitSeconds,
    Stage: EndCardKitStage,
    Controls: LabKitEndCardControls,
  },
  grade: {
    id: 'grade',
    name: 'FilmGrain + Vignette',
    title: 'Film grain & dark corners',
    blurb: 'A fine flicker of film grain and darkened corners, laid over the whole frame.',
    source: 'lib/studio/film/grade.tsx',
    whenUsed: 'Teasers and showreels, over every frame: grain makes flat colour look filmed rather than drawn (and hides the stripes a smooth gradient can show), and a vignette holds the eye in the middle.',
    note: 'Grain is fine by nature and this stage is shrunk to fit the page: press the player’s full-screen button to see it at size. Around 0.06–0.1 reads as film; past 0.15 it becomes a look of its own. Grain barely shows on near-black, by design.',
    defaults: GRADE_KIT_DEFAULTS,
    seconds: gradeKitSeconds,
    Stage: GradeKitStage,
    Controls: LabKitGradeControls,
  },
  'shutter-blur': {
    id: 'shutter-blur',
    name: 'ShutterBlur',
    title: 'Motion blur',
    blurb: 'Smears fast movement a little, like a real camera, so it glides instead of jumping.',
    source: 'lib/studio/film/motion-blur.tsx',
    whenUsed: 'Anything that whips across the screen in a reel: a card flung in, a fast camera pan, type slamming into place.',
    note: (
      <>
        <Text component="b" inherit {...stylex.props(styles.emphasis)}>Why fast motion strobes:</Text> a video is 30 still pictures a second. If something crosses the screen in a
        third of a second, it only appears in about ten of them, a hand-width apart each time, and your eye sees it hop between spots instead of moving. A real camera’s shutter stays
        open for part of each frame, so a fast object is caught as a short smear along its path, and the smears join up into motion. The studio fakes that by drawing each frame several
        times across the “open shutter” and blending them. Slow it to ¼ speed to see the difference frame by frame; the ticks under each lane show where the card was on every frame.
      </>
    ),
    defaults: SHUTTER_BLUR_KIT_DEFAULTS,
    seconds: shutterBlurKitSeconds,
    Stage: ShutterBlurKitStage,
    Controls: LabKitShutterBlurControls,
  },
};
