---
name: stills
description: Still images (OG/link-preview, YouTube thumbnail, Instagram post or story, poster) for a product or a video, from the brief to checked PNGs at every size. Use when asked for a still, or for notes on one ("the headline's too small", "try another crop").
---

# Making a still

The studio's projects live under `$(studio home)`: run `studio home` and use absolute paths for Read/Edit. Each verb
explains itself in `studio <verb> --help`; each `#studio` export in `studio api <Name>`.

A still goes **brief → image → design → sheet → check → review**. The tools handle sizes, fitted type and the checks;
your job is to make it *good*, which is what "Design" is about.

## 1. Brief

Write these down (in the chat, or at the top of `stills.tsx`) before touching code. Done when each has an answer:

- **What it's for, and the one thing it says.** An OG image sells the page behind the link; a thumbnail sells the
  click on a video. The headline is that one thing.
- **Where it shows**, which picks the presets (`studio still --help` lists them). Render only the ones asked for.
- **The subject**: the one thing that carries the message (a product, the UI's key control, a face, a big number, an
  object). A still with two subjects has none.
- **Three to five headline candidates** of 1–5 words (up to 3 for a thumbnail), in the brand's `voice`. Each becomes
  a variant, compared on the sheet.
- **The brand.** A client with a kit in `work/brands/` uses it
  (`${CLAUDE_PLUGIN_ROOT}/skills/studio-setup/references/brand-kits.md`); a campaign's own colour or voice goes in the
  project's `brand.ts`. A client the studio will make more than one thing for gets a kit, made first. A one-off with
  no kit: the colours as constants at the top of `stills.tsx`, the logo file in the project drawn with `<Img>`, and
  Archivo where the brand's face isn't available.

## 2. Project and image

`studio new <slug> --capability still-only` (with `--url`, `--brand`, `--title`) starts a project whose starter
`stills.tsx` already renders. An existing video project gets a `stills.tsx` beside its `video.tsx` (copy the starter's
shape), and its `project.ts` becomes `mixed`.

Done when the hero image is in the project, from one of:

- **A capture of the real thing** (the `video-capture` skill), the first choice for a product or UI, since a capture
  is the truth. Name the rects the design will crop to; `studio probe` gives their selectors. Film at `scale: 3`: a
  story crop fills 1080 px with a few hundred page px. Pause anything that animates on the page before the shot.
- **`studio gen image`** for what no capture gives (a scene, an object, texture, a background). Generate at the
  widest aspect the presets need, or one image per orientation. Ask in the prompt for a **quiet region where the type
  goes** ("the subject on the right third, the left two-fifths plain dark ground"), and write the brand's colours as
  hex: the prompt is sent as written. `--transparent` gives a cutout for a field; `--ref` sends the capture so the
  product keeps its likeness. Look before using it: colours drift from the hex, and a product shot can invent parts.
- **JSX**: a product's output, a price tag, a big number. Its text is checked like any other, so draw it at real sizes.
- **A painting** (the `video-canvas` skill), written to the project as a PNG and drawn like any image.

## 3. Design

**The failure mode is the plain template:** a flat split with eyebrow, headline and CTA stacked small on one side and
a screenshot trailing off the other, a white band where the page ran out. It passes every check and nobody looks at
it. The register is the studio's motion reels (`${CLAUDE_PLUGIN_ROOT}/skills/video-motion/references/reel-system.md`):
a still is one of their frames held still.

- **Type is the image.** `FitText` with `max` at 20–30 `u` and `min` about 6 `u`, weight 800–900, leading 0.9, often
  uppercase. When the headline fills its box the copy is the right length; one sitting small in a big box wants a
  higher `max` or a shorter line.
- **Colour comes in full-bleed fields.** Two or three flat fields meeting at hard edges: a quiet ground for the type
  (the brand's dark, or its primary if dark) and a loud field for the hero, in the product's own colour or the brand's
  accent. Keep every field flat and opaque.
- **The subject is the hero,** big and whole where it matters. A capture goes on a `StillCard`, tilted, shadowed onto
  its field, the control that matters lifted and ringed. The card takes its `focus` rect's shape, so make that rect
  the subject and nothing else. Where the field is too small for that shape at hero size, let `room` run past the
  frame's edge: the bleed reads as more of it. A cutout product stands at 60–80% of the frame's height.
- **Few elements.** Hero, headline, and a mark (the logo, or `StillHud`'s brackets and one mono label). A price, a big
  number or a lifted swatch only when it *is* the message. The headline carries the call: an OG card already shows the
  domain, and a thumbnail has no room for a CTA.
- **Swap figure and ground for contrast.** Light type on dark, dark on light. Where a colour misses 4.5:1 for small
  text, change the ink and keep the field.

The pieces, all from `#studio`: `useStillFrame` (`w`, `h`, `u` = 1% of the shorter side, `wide`, `safe`, `zones`),
`FitText`, `StillCard`, `CoverImage` (an image filling a box flat, cropped around `focus`), `StillHud`, `BrandLogo`,
and `union`/`inflate` to build a focus rect from a capture's rects.

**One design serves every preset.** Lay it out from `useStillFrame`: a `wide` branch (the copy column on the left
40–46%, the field on the right) and a tall one (the field on top, two lines of copy in the bottom of `safe`), every
size in `u`. Read [references/worked-example.md](${CLAUDE_PLUGIN_ROOT}/skills/stills/references/worked-example.md) before designing, and copy from it.

Done when `studio still <p> --check` passes at every preset asked for.

## 4. Feed size

People see a still small: 168 px wide in YouTube's sidebar, about 300 px in a link card. Judge it there:

- **Few words:** 1–3 on a thumbnail, up to 5 on an OG image, still legible at 168 px.
- **One subject, big.** Detail inside a UI card won't read; its shape and colour will.
- **Loud contrast** between the fields and between type and ground: a thumbnail sits among twenty others.

Done when the sheet's feed row reads each of these at 168 px.

## 5. Variants and the sheet

`stillDesign`'s `axes` make a variant of every combination, named by its values. Give axes real choices (the
headline, the hero's crop, the field's colour), two or three values each.

`studio still <p> --sheet` lays them out with each variant's feed row. An axis flagged as **looking alike at feed
size** usually means a crop the frame can't show, such as two foci that both fit a short, wide field: make the values
differ at that size (a tighter focus) or drop the axis.

Done when you've read every sheet yourself and picked the variant that reads best at feed size.

## 6. Check, then review

`studio still <p>` writes only the stills that pass. The fixes for what it refuses:

- **Clipped, overflowing, or a `FitText` at its floor:** shorten the copy or give it a bigger box.
- **Text or a logo under a platform's UI:** lay out inside `safe`, clear of YouTube's duration badge.
- **Contrast:** it's measured against the pixels under the text, so change the ink or move the text onto a flatter
  field.
- **An image drawn at over 1.5× its pixels:** capture at a higher scale, or generate bigger, rather than cropping in
  hard.
- **An empty band at an edge:** the crop shows page with nothing on it; tighten `focus`.

Then put the sheet or the picked stills up for review, through the `studio-review` skill. Say which variant you'd
pick and why; when it's the reviewer's call, post the stills as a decision and let them pick.

Done when a fresh-context subagent, given only the brief and the finished stills at feed and full size, says what
the still says, matching the brief, and what it would cut has been cut or argued for.
