import * as stylex from '@stylexjs/stylex';

/**
 * The token source: the only module allowed a raw visual value, everything else names a token. The studio's look is
 * the motion showcase's (projects/2026-09-motion-showcase): a near-black ground, cream type, red-orange and cobalt,
 * Archivo for display and JetBrains Mono for readouts. `.stylex.ts` is a StyleX compiler requirement: the file may
 * export nothing but `defineVars`.
 */

export const colors = stylex.defineVars({
  /** The page under every screen. */
  ground: '#0c0c0e',
  /** A surface lifted off the ground: panels, cards, the composer. */
  panel: '#16161a',
  /** The line between two surfaces, and a track's rail. */
  line: '#2a2a31',
  /** Type on the ground. */
  cream: '#f3f0e7',
  /** Secondary type: readouts, hints, captions. */
  dim: '#8d8a83',
  /** The studio's accent: the playhead, a note, the active tab, the primary action. */
  accent: '#ee4c23',
  /** The second accent: what's being written, a draft note's pin and range. */
  cobalt: '#4144f4',
  /** A check that passes, the scene rung that's final, and a sound the video plays. */
  pass: '#3ccf7a',
  /** The scene rung that's still blocking. */
  blocking: '#6f8ff0',
  /** A named cue on the timing strip, and a sound from the cue list rather than the video. */
  cue: '#d7b33a',
  /** A replay on the timing strip. */
  replay: '#4fb3c8',
  /** A music fit's stretches of song, after accent, cobalt and pass: enough hues that neighbours never match. */
  musicSpanGold: '#e8b53c',
  musicSpanViolet: '#c55bd6',
  musicSpanTeal: '#3cc6d0',
  /** The dark ground under a frame: letterboxing, a still loading. */
  screen: '#000000',
  /** A warning that isn't a failure: a replaced render, a stale note, a draft voice. */
  caution: '#f2b134',
  /** The light squares of a transparent render's checkerboard. */
  checkerLight: '#ffffff',
  /** Its dark squares. */
  checkerDark: '#cccccc',
  /** The flat grounds a transparent render can be proofed over, besides the checkerboard. */
  proofCoral: '#ff6f59',
  proofNavy: '#1d2b53',
  proofWhite: '#ffffff',
  proofBlack: '#000000',
  /** The lighter squares of the dark checkerboard a generated still sits on, so a cut-out reads as see-through. */
  mediaCheckerLight: '#26262c',
  /** Its darker squares. */
  mediaCheckerDark: '#1b1b20',
  /** The white under a reference photo, whose product may be cut out on a transparent ground. */
  photoGround: '#ffffff',
  /** A picked card's ground, the panel warmed toward the accent that edges it. */
  pickedPanel: '#211512',
});

export const fonts = stylex.defineVars({
  display: '"Archivo", -apple-system, "Helvetica Neue", Arial, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Menlo, monospace',
});

export const typography = stylex.defineVars({
  /** A tag inside a readout: a storyboard moment's kind. */
  micro: '0.625rem',
  /** A HUD readout: frame numbers, hashes, labels. */
  readout: '0.75rem',
  body: '0.875rem',
  lede: '1.1875rem',
  section: '1.25rem',
  /** A part's heading inside a lab tab, under the tab's title. */
  partTitle: '1.875rem',
  title: '2.75rem',
  brand: '3.5rem',
});

export const spacing = stylex.defineVars({
  hairline: '2px',
  tight: '0.375rem',
  gap: '0.75rem',
  inset: '1rem',
  sectionGap: '1.75rem',
  pageMargin: '2.5rem',
  /** The widest the app's column gets. */
  pageMaxWidth: '1320px',
  /** The review screen's notes column. */
  sideWidth: '380px',
  /** The lab's controls column beside its stage. */
  benchWidth: '340px',
});

export const radius = stylex.defineVars({
  surface: '10px',
  control: '6px',
  pill: '999px',
});
