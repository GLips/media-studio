// shadows.ts: every shadow the web app draws, by name. A component applies one with stylex.props(shadows.<name>);
// style/shadow-source refuses a boxShadow written anywhere else, so this file stays the whole list.
import * as stylex from '@stylexjs/stylex';
import { colors } from './theme.stylex.ts';

export const shadows = stylex.create({
  /** A review pin on the frame: a cream ring that holds on any footage, and a soft drop under it. */
  pinHalo: { boxShadow: `0 0 0 2px ${colors.cream}, 0 2px 8px ${colors.screen}` },
  /** The word being spoken in the voice lane: underlined in the read-along's cobalt. */
  spokenUnderline: { boxShadow: `inset 0 -2px 0 ${colors.cobalt}` },
  /** A note dot ringed in the ground's dark, so it holds on a picture of its own colour. */
  groundRing: { boxShadow: `0 0 0 1px ${colors.ground}` },
});
