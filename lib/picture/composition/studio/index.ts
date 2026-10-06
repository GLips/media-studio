// First: scenes evaluate paintings as they load, so the render's painting values are set before Root imports them.
// oxlint-disable-next-line import/no-unassigned-import -- imported for its effect alone, which must come first
import './composition-painting-values-install.ts';
import { registerRoot } from 'remotion';
import { Root } from './Root.tsx';

// Chrome sizes SVG text for the screen from every CSS transform above it, but re-sizes it only when the <svg>'s own
// layout changes, so under a changing camera or tile scale a frame depends on what its tab drew before.
// geometricPrecision sets it at its own size and lets the transform scale the glyphs.
const svgTextAtOwnSize = document.createElement('style');
svgTextAtOwnSize.textContent = 'svg { text-rendering: geometricPrecision; }';
document.head.append(svgTextAtOwnSize);

registerRoot(Root);
