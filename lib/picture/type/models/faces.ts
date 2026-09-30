// faces.ts: the studio's faces by name and metric, which layout reads without loading a font. lib/picture/type/studio/fonts.ts
// loads the files themselves.

/** The system face: walkthroughs set their text in it, so it reads as the product's own UI. */
export const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';

/**
 * A face as FitText and a brand kit name it: its CSS family list, and the range of its width axis when it has one,
 * which FitText narrows within. Without one, FitText only shrinks.
 */
export type StudioFace = { family: string; stretch?: readonly [number, number] };

/** Heavy display type. Set `fontStretch` (62–125%) and `fontWeight` (100–900) freely: both are continuous. */
export const DISPLAY_FONT = `"Archivo", ${FONT}`;
/** Archivo as a StudioFace: FitText's face unless it's given another. */
export const ARCHIVO_FACE: StudioFace = { family: DISPLAY_FONT, stretch: [62, 125] };
/** HUD labels, timecodes, readouts, typed queries. */
export const MONO_FONT = '"JetBrains Mono", ui-monospace, Menlo, monospace';
/** JetBrains Mono's cap height in em (730/1000): the font size for caps `cap` px tall is cap / MONO_CAP_EM. */
export const MONO_CAP_EM = 0.73;
/** JetBrains Mono's advance in em (600/1000), every glyph's: a line of n characters is n × 0.6 em wide. */
export const MONO_ADVANCE_EM = 0.6;
