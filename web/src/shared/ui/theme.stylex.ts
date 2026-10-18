import * as stylex from '@stylexjs/stylex';

/**
 * The token source: the only module allowed a raw visual value. The look: near-black ground, cream type, colour only
 * for a note's state. Copy on a working screen: no all-caps headings, no zero counts or counts of one, states as
 * glyphs with words in tooltips, icon tooltips from `useHotkeyLabel`, never typed. StyleX requires `.stylex.ts` to
 * export only `defineVars`.
 */

export const colors = stylex.defineVars({
  /** The page under every screen, and the playhead's halo. */
  ground: '#0c0c0e',
  /** A surface lifted off the ground: panels, the thread, the dock. */
  panel: '#16161a',
  /** One step above panel on hover: the "you can click this" signal. Decoration never takes it. */
  raised: '#202026',
  /** The line between two surfaces, and a cut through the lanes. */
  line: '#2a2a31',
  /** Type, the playhead, the focus ring and the current row's rule. */
  cream: '#f3f0e7',
  /** Secondary type, a resolved note, an absent agent. */
  dim: '#8d8a83',
  /** An open or reopened note, and the one primary action on a screen. */
  accent: '#ee4c23',
  /** The draft: its pin, range and strokes, the composer's edge; the word being read and a cue's chip on the plan. */
  cobalt: '#4144f4',
  /** An addressed note (verify it) and a picked candidate. */
  pass: '#3ccf7a',
  /** Waiting on you: an agent's question, an open decision, an unsigned scene; a plan's timing flag. */
  caution: '#f2b134',
  /** A failure only: a save or a render that failed. */
  danger: '#ff4d6d',
  /** Alternating scene bands in the dock. */
  laneA: '#1a1a1f',
  laneB: '#222228',
  /** The blocking rung's 45° stripes. */
  hatch: '#33333b',
  /** Structure: cue, landmark and replay glyphs, the waveform, sfx ticks. */
  mark: '#6b6962',
  /** The I/O band and a loop's span, across every lane. */
  rangeWash: 'rgba(243,240,231,0.08)',
  /** A reply landing on a row. */
  flash: 'rgba(65,68,244,0.25)',
  /** A tile whose picture isn't cut yet. */
  skeleton: '#18181c',
  /** The dark ground under a frame: letterboxing. */
  screen: '#000000',
  /** The light squares of a transparent render's checkerboard. */
  checkerLight: '#ffffff',
  /** Its dark squares. */
  checkerDark: '#cccccc',
  /** The flat grounds a transparent render can be proofed over, besides the checkerboard. */
  proofCoral: '#ff6f59',
  proofNavy: '#1d2b53',
  proofWhite: '#ffffff',
  proofBlack: '#000000',
});

export const fonts = stylex.defineVars({
  display: '"Archivo", -apple-system, "Helvetica Neue", Arial, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Menlo, monospace',
});

export const typography = stylex.defineVars({
  /** Mono readouts: timecode, frame numbers, hashes, key caps. */
  readout: '11px',
  /** The chrome: bars, menus, chips, tooltips. */
  chrome: '12px',
  /** Note bodies and anything read as prose. */
  body: '13px',
  /** Prose read for its content, a step up from note bodies: a plan's brief and scene fields. */
  prose: '15px',
  /** A plan's spoken line, read along with the picture: the words its page is for. */
  line: '22px',
  /** What a page is about, named once at its top: the plan's current scene. */
  heading: '30px',
  /** Text read for itself, large: a decision's text candidate. */
  reading: '19px',
  /** Project names on the dashboard, and nowhere else. */
  display: '16px',
  /** One line height for every size, so rows line up across panels. */
  lineHeight: '16px',
  /** The large sizes read as running text, so they open up past the one shared height. */
  proseLeading: '22px',
  lineLeading: '34px',
});

export const spacing = stylex.defineVars({
  hairline: '2px',
  /** The three steps every gap and inset is drawn from. */
  tight: '4px',
  gap: '8px',
  inset: '12px',
  /** A list row, and a dense one. */
  row: '24px',
  rowDense: '20px',
  /** The shell's bar and the transport row. */
  bar: '28px',
  /** The dock's glyph column. */
  laneGutter: '20px',
  /** The thread beside the stage. */
  sideWidth: '360px',
});

export const radius = stylex.defineVars({
  /** Buttons, chips, tiles and menus. */
  control: '3px',
  pill: '999px',
});
