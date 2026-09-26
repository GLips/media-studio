// shadows.ts: every shadow the web app draws, by name. A component applies one with stylex.props(shadows.<name>);
// style/shadow-source refuses a boxShadow written anywhere else, so this file stays the whole list.
import * as stylex from '@stylexjs/stylex';
import { colors } from './theme.stylex.ts';

export const shadows = stylex.create({
  /** A review pin on the frame: a cream ring that holds on any footage, and a soft drop under it. */
  pinHalo: { boxShadow: `0 0 0 2px ${colors.cream}, 0 2px 8px ${colors.screen}` },
  /** A card lifted off the page, its shadow only below it: the lab's hold verdict. */
  cardLift: { boxShadow: `0 10px 14px -6px ${colors.ground}` },
  /** The selected item on a dark strip: a ground gap, then a cream ring. */
  selectedRing: { boxShadow: `0 0 0 2px ${colors.ground}, 0 0 0 4px ${colors.cream}` },
  /** A hairline edge that separates a pane from footage of any colour. */
  paneHairline: { boxShadow: `0 0 0 1px color-mix(in srgb, ${colors.screen} 40%, transparent)` },
});
