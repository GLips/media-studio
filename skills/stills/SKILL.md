---
name: stills
description: Make a still image for a product or a video, such as an OG/link-preview image, a YouTube thumbnail, an Instagram square, portrait or story, or a digital poster, from the brief to a checked, reviewed PNG at every size. Use when asked for any of these, or for notes on one ("the headline's too small", "try another crop").
---

# Making a still

Work in the studio repo (`cd "$(studio home)"`); paths below are relative to it. Each verb explains itself:
`studio <verb> --help`. A worked example closes "Designing it" below: read it before designing, and copy from it.

A still is made in six steps: **brief → image → design → sheet → check → review**. The tools take care of sizes, fitted
type and the checks. Your job is to make the still *good*, and the whole of "Designing it" below is about that.

## 1. Brief

Write these down (in the chat, or at the top of `stills.tsx`) before touching code:

- **What it's for, and the one thing it says.** An OG image sells the page behind the link. A thumbnail sells the
  click on a video. It says one thing, and the headline is that thing.
- **Where it shows**, which sets the presets: `og` 1200×630 (link cards in Slack, X, iMessage, LinkedIn), `youtube`
  1280×720, and Instagram's `square` 1080², `portrait` 1080×1350 and `story` 1080×1920. Render only the ones asked for.
- **The subject**: one thing, whatever carries the message (a product, the UI's key control, a face, a big number,
  an object, a shape). A still with two subjects has none.
- **Three to five headline candidates**, 1–5 words each, up to 3 for a thumbnail. Write them in the brand's voice
  (`work/brands/<name>/brand.ts` `voice`). Each becomes a variant, so you can compare them on the sheet.
- **The brand.** If the client has a kit in `work/brands/`, use it (`docs/brand-kits.md`). A campaign's own colour or voice
  goes in the project's `brand.ts`, not the design. A client the studio will make more than one thing for gets a kit,
  made first. For a one-off with no kit, write the brand's colours as constants at the
  top of `stills.tsx`, put its logo file in the project and draw it with `<Img>` (a small image is checked like a logo),
  and use Archivo where the brand's face isn't available.

## 2. Start the project and get the image

`studio new <slug> --capability still-only [--url <page>] [--brand <kit>] [--title "<headline>"]` starts
`work/projects/<yyyy-mm>-<slug>/` with a `project.ts`, a `capture.ts` and a starter `stills.tsx`: one design, og and
youtube, a headline axis. With `--url` it captures the page as `home` at 3× and puts it on a tilted card. An existing
video project gets a `stills.tsx` beside its `video.tsx` instead (copy the starter's shape), and its `project.ts`
becomes `mixed`: check:arch holds the declared capability to what the project binds.

The hero image comes from one of two places:

- **A capture of the real thing** (the `video-capture` skill): the product page, the UI's control. Name the rects the
  design will crop to (`rects: { photo: '.product img', card: '.buy-box' }`); `studio probe <p> <url>` lists a page's
  elements with the rect specs to use. A capture is the truth, so it's the
  first choice for a product or UI. Film at `scale: 3`, since a story crop fills 1080 px with a few hundred page px.
  Pause anything that animates on the page before the shot, or it's caught mid-move.
- **`studio gen image`** for what no capture gives: a scene, an object, texture, a background. Generate at the widest
  aspect the presets need (`--aspect 16:9` for og and youtube), or one image per orientation (`16:9` and `9:16`).
  Ask in the prompt for a **quiet region where the type goes** ("the subject on the right third, the left
  two-fifths plain dark ground"). `--transparent` gives a cutout to stand on a field, and `--ref` sends the capture so
  the product keeps its likeness. A project with a kit adds the kit's voice and palette to the prompt itself.
  `images['<name>']` from `./generated/images.ts` is a `StillImage` like a capture.

A hero can also be drawn in JSX: a product's output (the frame a code sample renders), a price tag, a big number.
Its text is checked like any other, so draw it at real sizes and let the check catch what's clipped or under a badge.

An image is refused if it's drawn at more than 1.5× its pixels. Capture or generate it big enough; don't crop in hard.

## 3. Designing it

**The failure mode is a plain template:** a flat split with an eyebrow, headline and CTA stacked small on one side
and a screenshot trailing off the other, with a white band where the page ran out. It passes every check and
nobody looks at it. The studio's register is its motion reels (frames described in
`skills/video-motion/references/showreel-breakdown.md`), and a still is one of their frames held still:

- **Type is the image.** The headline is set as large as the frame allows: `FitText` with `max` at 20–30 `u` and
  `min` at about 6 `u`, heavy (800–900), tight leading (0.9), and often uppercase. When the headline fills its box,
  the copy is the right length. A headline that sits small in a big box needs a higher `max` or a shorter line.
- **Colour comes in full-bleed fields, not tints.** Use two or three flat fields that meet at hard edges: a quiet
  ground for the type (the brand's dark, or its primary if that's dark) and a loud field for the hero. The loud colour can be the product's own (the buy box uses the
  magenta swatch) or the brand's accent. Use no gradients, no vignettes and no translucent panels over photos.
- **The subject is the hero,** big, and whole where it matters. Put a capture on a `StillCard`, tilted like the reel's
  cards, casting a shadow onto its field, with the control that matters lifted off it and ringed (`lift`, `ring`). A
  card takes its `focus` rect's shape, so choose the rect to be the subject and nothing else. Where the field is too
  small for that shape at a size that makes it the hero, let the card's `room` run past the frame's edge: the bleed
  reads as more of it. A lift covers a sliver of what's next to it, so lift a control with space around it. A cutout
  product stands on a field at 60–80% of the frame's height.
- **Use few elements.** Hero, headline, and a mark (the logo, or `StillHud`'s brackets and one mono label). Add a
  price, a big number or a lifted swatch only if it *is* the message. Cut the CTA and URL: an OG card already shows
  the domain, and a thumbnail has no room for one.
- **Swap figure and ground for contrast.** Light type goes on a dark ground and dark type on a light field. Where a
  colour doesn't reach 4.5:1 for small text, change the ink, not the field (the buy box's HUD is black over magenta).

The pieces, all from `lib/studio/api.ts`:

| Piece | What it does |
| --- | --- |
| `useStillFrame()` | `w`, `h`, `u` (1% of the shorter side, the unit for every size), `wide` (landscape: text beside the hero, not under it), `safe` (the frame less a story's top and reply bars: text and logos go inside it; pictures may run under the bars), `zones` (every UI zone, with YouTube's badge) |
| `FitText` | a headline as large as fits its box, narrowing first on a face with a width axis. `face={brand.fonts.display}` or Archivo by default |
| `StillCard` | a capture on a tilted, shadowed card the shape of its `focus` rect, as large as fits `room`, with `lift` and `ring` for one raised control |
| `CoverImage` | an image filling a box flat, cropped around `focus` (a point, or a rect the crop keeps whole) |
| `StillHud` | the reel's corner brackets and a mono label at the top; `ink` can differ top and bottom on a split frame |
| `BrandLogo` | the kit's logo that stands off the ground, as large as fits its box |
| `union`, `inflate` | build a focus rect from a capture's rects |

**One design serves every preset.** Lay it out from `useStillFrame`: a `wide` branch (the copy column on the left 40–46%
and the field on the right) and a tall one (the field on top, and two lines of copy in the bottom of `safe`). Size
everything in `u`. Don't write a design per preset.

The worked example: a product page's share images in a brand kit, one design at every preset. A full-bleed field in
the product's own colour holds the real page on a tilted card, one swatch lifted off it and ringed, beside (wide) or
over (tall) the kit's navy, where the headline is set as big as it fits.

```tsx
import brand from '@brand';
import { BrandLogo, FitText, StillCard, StillHud, defineStills, stillDesign, union, useStillFrame } from '#studio';
import { captures as C } from './captures/index.ts';

const PAGE = C.home;
const NAVY = brand.colors.primary;
// The swatch's colour as the page draws it: the product's own, so the field is the product's.
const FIELD = '#FF00C2';
// The product in the gallery photo, found as its dark pixels (the photo is on white).
const PRODUCT = { x: 274, y: 268, w: 107, h: 428 };
const PAPER = 'rgba(255, 255, 255, 0.85)';
const FOCUS = {
  page: union(PRODUCT, PAGE.rects.title, PAGE.rects.card), // the product beside its buy box
  box: PAGE.rects.card, // the buy box's options alone, larger
};

function BuyBoxStill({ headline, focus }: { headline: string; focus: keyof typeof FOCUS }) {
  const { w, h, u, wide, safe } = useStillFrame();
  const m = 5 * u;
  // Wide: the navy column takes the left 46%, the field the rest. Tall: the copy takes the bottom of the safe area,
  // as much height as a two-line headline needs, and the field everything above it.
  const copyH = 0.42 * w;
  const field = wide ? { x: 0.46 * w, y: 0, w: 0.54 * w, h } : { x: 0, y: 0, w, h: safe.y + safe.h - copyH };
  const column = wide
    ? { x: m, y: m + 4 * u, w: field.x - 1.6 * m, h: h - 2 * m - 4 * u }
    : { x: m, y: field.h + 0.9 * m, w: w - 2 * m, h: safe.y + safe.h - field.h - 1.9 * m };
  const cardTop = Math.max(field.y + 1.2 * m, safe.y + 1.2 * m);
  // The card runs off the right edge: the field is too small for the page's shape at a size that makes it the hero,
  // and the bleed says there's more of it.
  const card = { x: field.x + 1.1 * m, y: cardTop, w: field.w + 0.12 * w, h: field.y + field.h - cardTop - 1.2 * m };
  const logo = { x: column.x, y: column.y, w: column.w * 0.6, h: 4.2 * u };
  const rule = { x: column.x, y: logo.y + logo.h + 2.2 * u, w: 9 * u, h: 1.1 * u };
  const headlineBox = { x: column.x, y: rule.y + rule.h + 2.2 * u, w: column.w, h: column.y + column.h - (rule.y + rule.h + 2.2 * u) };
  return (
    <div style={{ position: 'absolute', inset: 0, background: NAVY }}>
      <div style={{ position: 'absolute', left: field.x, top: field.y, width: field.w, height: field.h, background: FIELD }} />
      <StillCard image={PAGE} room={card} focus={FOCUS[focus]} lift={PAGE.rects.swatches[1]} ring={NAVY} />
      {/* Tall, the HUD's top is on the field, where white reads under 4.5:1 and black at 6:1. */}
      <StillHud ink={wide ? PAPER : { top: '#000000', bottom: PAPER }} left="THE NEW BUY BOX" />
      <BrandLogo brand={brand} ground={NAVY} box={logo} />
      <div style={{ position: 'absolute', left: rule.x, top: rule.y, width: rule.w, height: rule.h, background: brand.colors.accent }} />
      <FitText
        name="headline" text={headline} box={headlineBox} max={(wide ? 24 : 30) * u} min={6 * u} align="center"
        face={brand.fonts.display} style={{ fontWeight: 900, lineHeight: 0.92, letterSpacing: '-0.02em', textTransform: 'uppercase', color: brand.colors.light }}
      />
    </div>
  );
}

const HEADLINES = { 'one-box': 'One box.', 'every-colour': 'Every colour. One box.' };

export default defineStills({
  'buy-box': stillDesign({
    component: BuyBoxStill,
    presets: ['og', 'youtube', 'square', 'portrait', 'story'],
    axes: { headline: ['one-box', 'every-colour'], focus: ['page', 'box'] },
    props: ({ headline, focus }) => ({ headline: HEADLINES[headline], focus }),
  }),
});
```

Without a kit, the same design takes its colours as constants and its logo as an `<Img>`.

## 4. At feed size

People see a still small: the sheet's feed row shows each variant 1:1 at the sizes a feed serves it (YouTube's
168×94 sidebar and 320×180 home, and a link card or post about 300 px wide). It has to work there:

- **Few words:** 1–3 on a thumbnail, up to 5 on an OG image. The headline must still read at 168 px wide.
- **One subject, big:** the product, a face or a single number. Detail inside a UI card won't read; its shape and
  colour will.
- **High contrast between the fields and between type and ground.** A thumbnail next to twenty others needs a loud
  colour and a dark/light split.
- **YouTube's duration badge** covers the bottom-right corner, so keep text out of it (the check refuses it).

## 5. Variants and the sheet

`stillDesign({ component, presets, axes: { headline: [...], crop: [...] }, props })` makes a variant of every
combination of the axes' values, named by those values (`short-page`). Use axes for real choices, such as the
headline, the hero's crop, or the field's colour, with two or three values each.

`studio still <p> --sheet` renders every variant and writes `out/still-sheets/<design>-<preset>.png`: the first axis
across, the rest down, each variant with its feed row. The still check frames refused variants in red with their
problems. An axis whose values **look alike at feed size** at a preset is flagged on the sheet and in the output (⚠).
That usually means a crop the frame can't show, for example two foci that both fit a short, wide field. Fix it by
making the values differ at that size (a tighter focus), or drop the axis. Read each sheet yourself before showing
anyone. Pick the variant that reads best at feed size, not at full size.

## 6. Check, then review

`studio still <p>` renders each still twice (as drawn, then with its text transparent) and writes only those that
pass to `out/stills/<design>-<preset>-<variant>.png`. A full run also clears stills of variants that no longer exist. `--check` only reports. It refuses a still for:

- **Clipped or overflowing text, or a `FitText` at its floor.** The copy is too long for the box: shorten it, or give
  it a bigger box.
- **Text or a logo under a platform's UI.** Lay out inside `safe`, and keep clear of YouTube's badge.
- **Contrast** under 4.5:1 (3:1 at display sizes), measured against the pixels actually under the text: change the
  ink or move the text onto a flatter field.
- **An image drawn at over 1.5× its pixels**: capture at a higher scale, or generate bigger.
- **An empty band of an image at an edge**, where the crop shows page with nothing on it: tighten `focus`.

`--preset` and `--variant` narrow a run. Then show Graham the sheet or the picked stills with
`studio review <file>`. His notes on a sheet name the variant under each one. Give him the file paths and say which
variant you'd pick and why.

Before calling it done, have a fresh-context subagent read the finished stills at feed size and at full size, given
only the brief, and ask it what the still says and what it would cut.
