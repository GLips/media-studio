# Simple buy box (story cut): walkthrough storyboard

**Audience:** the client (Painful Pleasures / Body Art Alliance), not developers. Voiceover + captions, ~3 min.
**Source:** `painful-pleasures-theme/docs/demos/2026-09-18-simple-buy-box-loom.md`, plus Graham's notes on the
first two cuts. Captured from the **Flourish
Commerce - Dev Theme** (`147758514230`). Treatment = `?view=ab-buy-box`; control = the plain URL.

## Rules

- **Written as paragraphs, so each beat hands off to the next.** A beat can open on the current page or the new
  one, whichever continues from the line before; both always get shown. No line that only restates what the section
  card already says.
- **One visit, in order.** A studio shopper looks at a product, chooses options, prices it, then builds a mixed
  order. Section cards name those steps. Bulk runs as one continuous example, so reset has an order at stake.
- **No stats close, no "pricing fixes", no "unified".** Bulk is still separate, just behind a button.
- **Nothing the voice talks about sits under a tag or caption** (the render's framing check enforces it).
- No compound-option products except Kwadron's gallery photo; no distributor pricing.

## Checked against the dev theme, 2026-09-24

| Claim | Dev theme shows |
|---|---|
| Control images soft | Kwadron photo 9 (spec sheet): control loads a 493px image into a 493px slot, new a full-size one into 722px |
| Spinner on every option change | `body.loader-active` while the control refetches the page for its tier ladder |
| Out of stock, swatches | Control: a blank box with a slash, colour hidden. New: colour kept, dashed border; Notify Me on pick |
| Out of stock, dropdowns | Flare Gauge: control lists "6mm ~ 2g" plain; new "6mm ~ 2g — out of stock" |
| Impossible combination | Control (2.5mm + Cobalt): button reads "Unavailable", price blanks, no reason. New: "We don't carry…" + what each is available in |
| Long lists | Intenze, 174 colours: control a native list; new search, "17 of 174 choices" for blue, bottle per row |
| Quantity input | Always typeable on both; the new page styles it as an input (white box around the number only) |
| Sticky buy button | Desktop and phone; appears once the buy box scrolls out of view |
| Bulk row pictures | Only when more than half the variants have their own image. Intenze: 170 of 174. Jewelry: none of ~2,000 products, Tilum included |
| Filters in bulk | Facets need two varying options: Tilum yes, Intenze no |

## Script (voiced as one take; `voiceover.json` is the source, its paragraphs are the take's)

**Intro.** Here's the new product page we're testing, next to the one it replaces.

**1 · Looking at the product.** Start with the photos. The current version shows small images stretched to fill the space, so details go soft, and fine print, like this spec sheet, blurs. The new one loads them at full size.

If you want to look at different variants quickly today, every selection locks the page while it loads your selected variant. The new version doesn't need to load anything, so it changes the instant you click.

**2 · Choosing options.** While you're comparing, you want to know what's in stock. Today, sold-out colors are crossed out, so you can't see what they were, and dropdowns don't mark them at all. Now sold-out colors keep their color, with a dashed border, dropdowns mark them too, and you can still pick one and ask for a back-in-stock email.

Land on a combination that isn't made, and today you just get Unavailable. Now it tells you, and lists what is available.

Some products have a lot of choices, like these 174 inks. Today, that's a list of names you can't search, with no pictures. Now any long list gets a search: type blue, and you get seventeen, each with its bottle.

**3 · Pricing it.** Products on sale used to get a small flag that said "Sale" at the top of the buy box. Now each option shows its percent off.

The quantity is now styled as an input field. In Clarity screen recordings, we've seen shoppers who didn't realize they could update quantity directly, and instead tapped plus over and over. And as the quantity goes up, the price follows the volume discounts: at five, a dollar sixty each, where today it stays at two dollars.

If you scroll down to read more, a sticky buy button appears at the bottom of the screen to bring you back to the buy box as soon as you're ready.

**4 · Ordering a mix.** To restock several colors at once, the current version has a Multiple Items tab, which is just one long list of variants to scroll. Now, the bulk order page opens a list you can filter, search, and preview images when they exist.

Add items to your order, and an itemized summary is shown under the buy button. With a dozen in, there's real work at stake, and today, a big Reset button sits right above Add All to Cart; one tap wipes it all. Now reset is a small link that asks first.

## Pictures

| Paragraph | Picture |
|---|---|
| photos | Solice split pushing into the machine ("details go soft") → Kwadron photo 9 pushing into the small print; New's print ringed |
| spinner | Solice split, no zoom: spinner on Today, then the flip-through on New |
| stock | Flare split: Today's slashed swatch and plain Gauge list, New's dashed swatch and Gauge list with "— out of stock" ringed, then Notify Me |
| clash | Flare 2.5mm + Cobalt split: "Unavailable" vs "We don't carry…" |
| lists | Intenze: Today's native list scrolling → New search "blue" |
| sale | 8g ball split; Today eases in on the Sale flag, holds, eases out |
| quantity | Tilum steppers, cursor tapping Today's plus → split at 5 |
| sticky | Solice desktop scrolled on New (bar ringed) → phone (bar ringed) |
| mix | Intenze Multiple Items → New: Tilum facets (filter), Tilum search, Intenze rows with bottles (images) |
| summary, reset | Intenze with a dozen bottles in + summary → split, Today's Reset ringed vs New's link → confirm dialog. End card. |

The sticky bar reads "Choose Options" on both Solice and Tilum; that is what the live bar says. Bulk quantities skip
colours with too little stock, so both arms hold the same 4 + 2 + 6.

Bulk runs on Intenze (row pictures need per-variant images; no jewelry has them). Tilum appears once, for the
filters, since Intenze has only one option.
