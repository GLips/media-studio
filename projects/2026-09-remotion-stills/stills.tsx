// Remotion's share images: an OG image for remotion.dev and the thumbnail for "Make videos with React", one design.
//
// Brief. The OG image sells remotion.dev; the thumbnail sells the click on the video. Both say one thing: a video is
// a React component. Where: og 1200×630 (link cards) and youtube 1280×720, nothing else. Subject: the docs' first
// composition, with `const frame = useCurrentFrame();` lifted and ringed, and (an axis) the frame that code renders
// coming off it. Headlines, 2–3 words, Remotion's voice (plain, developer-to-developer, no hype): "Videos in React.",
// "Code your videos.", "Just React." (the thumbnail's: it adds to the video's title rather than repeating it).
// Brand: no kit in brands/ for Remotion, so its tokens live here: #0B84F3 blue (--ifm-color-primary), black type on
// white, GT Planar Black (licensed, not here: Archivo stands in) and its white logo off remotion.dev.
//
// Design: a frame of the reel held still. Black ground with the logo and the headline set as big as fits, beside a
// full-bleed Remotion-blue field holding the code on a tilted card. The logo is the mark, so no StillHud.
//   studio still remotion-stills [--preset=og,youtube] [--variant=react-frame] [--sheet]

import { Img } from 'remotion';
import { FitText, StillCard, defineStills, stillDesign, useStillFrame } from '#studio';
import logoWhite from './assets/remotion-white.png';
import { captures as C } from './captures/index.ts';

const INK = '#0A0A0C';
const BLUE = '#0B84F3';
const PAPER = '#FFFFFF';
// remotion.dev/img/remotion-white.png, 1768×445.
const LOGO = { src: logoWhite, w: 1768, h: 445 };

// `const frame = useCurrentFrame();`, the hook's call (the import names it first) to its semicolon, and the blank line
// under it: the lift scales up about its centre, so the extra height below keeps it off the line above.
const HOOK_CALL = C.code.rects.hooks[1];
const CALL_LINE = { x: 342, y: HOOK_CALL.y - 3, w: HOOK_CALL.x + HOOK_CALL.w + 29 - 342, h: HOOK_CALL.h + 16 };
// The code block, its left 480 px (the long import line runs off the edge). The card takes this shape, so the crop is
// exactly the code.
const CODE_FOCUS = { x: 318, y: 355, w: 480, h: 484 };

type Box = { x: number; y: number; w: number; h: number };

/**
 * What the code on the card renders, drawn here: MyComposition's frame 42 on a 16:9 video with a scrubber. It is the
 * "video" the headline promises, which a card of code alone only asserts.
 */
function RenderedFrame({ box }: { box: Box }) {
  const bar = 0.16 * box.h;
  const text = box.h - bar;
  return (
    <div style={{
      position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, background: PAPER, borderRadius: 0.04 * box.h,
      overflow: 'hidden', transform: 'rotate(-3deg)', boxShadow: `0 ${0.08 * box.h}px ${0.18 * box.h}px rgba(0, 0, 0, 0.45)`,
    }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: box.w, height: text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Archivo, sans-serif', fontWeight: 800, fontSize: 0.13 * box.h, color: INK }}>
        The current frame is 42.
      </div>
      <div style={{ position: 'absolute', left: 0, top: text, width: box.w, height: bar, background: INK }}>
        <div style={{ position: 'absolute', left: 0.3 * bar, top: 0.3 * bar, width: 0, height: 0, borderLeft: `${0.4 * bar}px solid ${PAPER}`, borderTop: `${0.2 * bar}px solid transparent`, borderBottom: `${0.2 * bar}px solid transparent` }} />
        <div style={{ position: 'absolute', left: bar, right: 0.3 * bar, top: 0.45 * bar, height: 0.1 * bar, background: '#3A3A40' }} />
        <div style={{ position: 'absolute', left: bar, width: 0.28 * (box.w - 1.3 * bar), top: 0.45 * bar, height: 0.1 * bar, background: BLUE }} />
      </div>
    </div>
  );
}

type RemotionProps = { headline: string; output: boolean };

function RemotionStill({ headline, output }: RemotionProps) {
  const { w, h, u } = useStillFrame();
  const m = 5 * u;
  // Only og and youtube: both wide, so there is no tall branch. The black column takes the left 46%, the field the rest.
  const field = { x: 0.46 * w, y: 0, w: 0.54 * w, h };
  const logo = { x: m, y: m, w: 22 * u, h: 5.5 * u };
  const copyTop = logo.y + logo.h + 3 * u;
  const copy = { x: m, y: copyTop, w: field.x - 1.6 * m, h: h - m - copyTop };
  // The card is the code's shape, as large as fits the field inside its margin, centred: any other shape would crop in
  // the page around the code (the white margin beside it, the prose above it).
  const room = { x: field.x + 1.1 * m, y: 1.2 * m, w: field.w - 2.2 * m, h: h - 2.4 * m };
  const fit = Math.min(room.w / CODE_FOCUS.w, room.h / CODE_FOCUS.h);
  const card = { x: room.x + (room.w - CODE_FOCUS.w * fit) / 2, y: room.y + (room.h - CODE_FOCUS.h * fit) / 2, w: CODE_FOCUS.w * fit, h: CODE_FOCUS.h * fit };
  // The render comes off the code's lower left, over the JSX it draws: inside the frame (its text is checked) and
  // clear of YouTube's badge at the bottom right.
  const frameW = 0.72 * card.w;
  const frameH = (frameW * 9) / 16;
  const rendered = { x: field.x + 0.6 * m, y: h - 0.9 * m - frameH, w: frameW, h: frameH };
  const logoW = Math.min(logo.w, (logo.h * LOGO.w) / LOGO.h);
  return (
    <div style={{ position: 'absolute', inset: 0, background: INK }}>
      <div style={{ position: 'absolute', left: field.x, top: field.y, width: field.w, height: field.h, background: BLUE }} />
      <StillCard image={C.code} room={card} focus={CODE_FOCUS} lift={CALL_LINE} ring={INK} />
      {output && <RenderedFrame box={rendered} />}
      <Img src={LOGO.src} style={{ position: 'absolute', left: logo.x, top: logo.y, width: logoW, height: (logoW * LOGO.h) / LOGO.w }} />
      <FitText
        name="headline" text={headline} box={copy} max={24 * u} min={6 * u} align="center"
        style={{ fontWeight: 900, lineHeight: 0.9, letterSpacing: '-0.02em', textTransform: 'uppercase', color: PAPER }}
      />
    </div>
  );
}

const HEADLINES = {
  react: 'Videos in React.',
  code: 'Code your videos.',
  just: 'Just React.',
};

export default defineStills({
  remotion: stillDesign({
    component: RemotionStill,
    presets: ['og', 'youtube'],
    axes: { headline: ['react', 'code', 'just'], output: ['frame', 'code'] },
    props: ({ headline, output }) => ({ headline: HEADLINES[headline], output: output === 'frame' }),
  }),
});
