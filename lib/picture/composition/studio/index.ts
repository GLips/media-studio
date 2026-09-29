import { registerRoot } from 'remotion';
import { Root } from './Root.tsx';

// Chrome sets SVG text in a font sized for the screen, from every CSS transform above it, but only re-sets it when the
// <svg>'s own layout changes. Under a camera's or tile's changing scale a <text> kept the size an earlier frame gave
// it, so a frame depended on what its tab drew before. geometricPrecision sets it at its own size and lets the
// transform scale the glyphs.
const svgTextAtOwnSize = document.createElement('style');
svgTextAtOwnSize.textContent = 'svg { text-rendering: geometricPrecision; }';
document.head.append(svgTextAtOwnSize);

registerRoot(Root);
