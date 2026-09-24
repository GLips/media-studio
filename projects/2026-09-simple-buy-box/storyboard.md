# Simple buy box — walkthrough storyboard

**Audience:** the client (Painful Pleasures / Body Art Alliance), not developers. Voiceover + captions, ~2.5–3 min.
**Source:** `painful-pleasures-theme/docs/demos/2026-09-18-simple-buy-box-loom.md` (reworked 2026-09-23 off the BAA
call), plus Graham's notes on the first cut. Captured from the **Flourish Commerce - Dev Theme** (`147758514230`),
which carries the build both arms launch from. Treatment = `?view=ab-buy-box`; control = the plain URL.

## Rules from review of the first cut

- **No "pricing fixes" framing and no "reading the test" card.** The doc's "Also fixed" and "Say this in the video"
  sections are out.
- **Don't call it unified.** Bulk ordering is still separate in the new box — behind a button instead of a tab.
- **Section cards** between sections, with the voice carrying straight on over them, so it's clear what belongs where.
- **Nothing the voice talks about may sit under a tag or a caption.** Split panels have a label strip above the page;
  cameras frame above the caption band; the render refuses frames where a highlight hits a tag or caption.
- Don't show compound-option products (that's the complex video) or distributor pricing.

## Checked against the dev theme, 2026-09-23

| Doc says | Dev theme shows | Decision |
|---|---|---|
| Control locks the page on every variant change | ✔ Solice: `body.loader-active` spinner over a grey wash while the whole page is refetched for the tier ladder; Add To Cart disabled | Keep — the capture holds that refetch; the studio re-animates the frozen spinner |
| Control images soft, treatment sharp | Solice gallery, same photo both arms | Keep — zoomed side by side |
| "— unavailable" / "— out of stock" in dropdowns; dashed pills | ✔ Flare plugs: dashed swatches; Gauge list has "6mm ~ 2g — out of stock" | Keep swatches; a native `<select>` can't be photographed open |
| Impossible combination | ✔ Flare 2.5mm + Cobalt: "We don't carry 2.5mm ~ 10g + Cobalt", then what each is available in; the choice isn't cleared | Keep — say it lists what is available |
| Slash-through on unavailable swatches | Not landed (dashed = out of stock only) | Don't linger on greyed swatches |
| Combo: type to search (any option with ~10+ values, not just colours), image per row when variants have images, picture in field | ✔ Intenze: "17 of 174 choices" for "blue", bottle per row | Keep — the biggest win, most time |
| Sale tag vs per-variant % off; "none on this option" | ✔ 8g ball: 10mm "$0.88 ~~$1.25~~ 29% Off"; "No volume discount on this option" | Keep, with the live wording |
| Quantity field reads as an input | ✔ White box around the number only | Keep — zoomed side by side |
| Main price walks the ladder | ✔ Tilum q5: "$1.60 ~~$2.00~~ 19% Off"; control stays $2.00 | Keep, framed as volume pricing |
| Bulk: search, filter by option, on sale, out of stock, receipt | ✔ Tilum: facets with counts, "Search this list", "58 choices", On sale only, Show 1 out of stock | Keep |
| Reset (from Graham) | Control: full-width "Reset" button, no confirm. New: small "Reset bulk order" link + `confirm()` | Keep — dialog drawn in the studio from the theme's own message |
| Bulk share: ~$1.1M one-at-a-time vs ~$84K bulk over 15 days; bulk clicks now tracked | From the doc | Keep, as the "why" |
| Mobile: sticky bar, 80% gallery peek, bulk scrolls with pinned total; control's 400px scroller traps the gesture | ✔ bar, pinned total | Keep |

## Script and shots

The words live in `voiceover.json` (humanizer-checked 2026-09-23); this table is only the picture per line.

| § | Line | Picture |
|---|---|---|
| — | intro | Motion title over Solice. "Simple buy box" / "The new product page, in an A/B test". |
| 1 **Images and speed** | images | Split, Solice gallery zoomed on the machine's screen: Today soft, New sharp. |
|  | speed-a | Split. Left: cursor clicks Pink → page greys, spinner, disabled Add To Cart. |
|  | speed-b | Right: cursor clicks Pink → photo swaps at once. |
| 2 **What's available** | avail-a | Flare plugs, New: ring on dashed swatches. |
|  | avail-b | Cursor picks a clashing value → message ring. |
| 3 **Finding a color** | combo-a | Intenze, New: types "blue" → "17 of 174 choices", rows with bottles. |
|  | combo-b | Split: Today's list vs the search. |
|  | combo-c | Cursor picks Baby Blue → field shows bottle + name. |
| 4 **Sales and volume pricing** | sale | 8g ball, split: Today "Sale" tag vs New "29% Off" on 10mm. |
|  | ladder | New: ring "No volume discount on this option". |
|  | qty-a | Tilum, split zoom on the two steppers. |
|  | qty-b | Split at 5: rings on both prices and on the 5–9 row. |
| 5 **Bulk ordering** | bulk-a | Today's Multiple Items list → New grid; facet click, search, On sale only. |
|  | bulk-b | Typed quantities → receipt ring. |
|  | bulk-c | Split: Today's big Reset vs New's link → drawn confirm dialog. |
|  | why | Glass card: "$1.1M one at a time / $84K in bulk / 15 days". |
| 6 **On phones** | mobile-a | Phone, sticky bar ringed. |
|  | mobile-b | Phones side by side: Today's boxed scroller vs New's pinned total. |
| — | — | End card "Simple buy box". |
