# Motion showcase: the beat sheet

Painful Pleasures' new buy box as a 24.7 s reel on `music['drive-fit']` (Lyria, 120 BPM: drive's bars 1–7 and 9–13,
fitted with `studio music fit --bars` to a two-beat pickup, nine bars and its own final hit, then 1 s of silence). One
bar per idea; the HUD names the craft each bar shows off, as the reference reel's does. Copy runs as one sentence
across the reel: THE NEW BUY BOX. EVERY COLOR, ONE TAP. 174 INKS, ONE SEARCH. BUY MORE, PAY LESS. ONE BOX.

The beats come from the bar table in `timeline.ts` (`BAR_TABLE`), each bar's length in beats: 4, 4, 6, 6, 4, 4, 4, 8
and 4, the 44 beats from bar 1's downbeat (the track's beat 0, frame 25) to the final hit (686); the finale cuts in on
its first beat's "and". A bar times itself in beats from its own first beat (`barBeatFrame(k, n)`), so a bar made
longer moves every later bar with it. Each hit is two frames ahead of the tracker's beat (`HIT_LEAD_FRAMES`), since the
tracker hears a hit ~20 ms late and the picture leads the sound by about a frame, as the reference's does; a placed
sound lands `SOUND_LAG_SECONDS` (35 ms) after its frame. `node tools/bar-clock.ts` prints every bar's frames and every
beat's frame (30 fps). Frames below are video frames.

Palette (measured from the reference): ground #0c0c0e, red-orange #ee4c23, cobalt #4144f4, cream #f3f0e7, ink #140b0e;
the product's own colours where the product speaks (the Solice swatches #000000 / #ff00c2 / #3d404b, an ink chart).
Type: Archivo variable (width 62–125%, weight to 900) for display, JetBrains Mono for the HUD.

| Bar | Frames | Craft (HUD) | Beats |
|---|---|---|---|
| pickup | 0–24 | — | HUD brackets grow from the corners and every label decodes; THE fills the frame on the ground line, and the red drop rises out of a landing and lands on its T on beat −1 (10). |
| 1 | 25–85 | 01 — SQUASH & STRETCH | The drop lands on beats 0, 1, 2 (25, 40, 55), a step right each time, and each landing's shock swaps the frame-wide word for the next: NEW, BUY, BOX; beat 3 (70) lands it on a pad as BOX's full stop, crouching, and it launches and swells to fill the frame in red-orange by 85. |
| 2 | 86–145 | 02 — KINETIC TYPE | One word per beat, figure and ground swapping each cut: EVERY rises from its mask on the red (86); COLOR in five inks goes Thin to Black under a closing selection (101); ONE slants in on red and the camera dives into its O (116); TAP. decodes on black and is tapped at its full stop (135), red rings spreading. |
| 3 | 146–235 | 03 — DEPTH / UI | The Solice page lands on a card over black, tilted in 3D, the machine photo two-thirds of the frame tall beside its name, price and swatches (146); one camera move swings the card through square and pushes in, in half-beat swings before each tap. Each swatch is tapped on a beat (161, 176, 191): it lifts with a tap, the page swaps so the machine takes the colour, and the colour floods out behind the card and holds as the ground, PINK, CHARCOAL, BLACK rising under the swatches in turn. On the "and" (198) the camera whips onto the black machine and glides round it in slow motion on the page's white; its sleeping display flares awake on the music's downbeat (206), the voltage counting up to 7.5 as a glint crosses its body; from 232 the camera dives into the display, drawn sharp, and lands on its ".00" (235) where bar 4's needle strikes. |
| 4 | 236–325 | 04 — INK × 174 | The signature: a tattoo cartridge needle (7RL, steel, its tip wet with ink), in from the upper right, strikes a dark dot matrix in one blow (236), on the very point the display's ".00" left, and is gone by the fourth frame after; the ink bursts outward through the dots as a ripple, one ink per ring, flooding the field by 244 as the odometer rolls to 58, and the splash rebounds on the next beat (251). From the music's downbeat it strikes a beat each, on 266 and 281, each ripple repainting the field in new inks as the count rolls to 174; INKS. slams on 296, and the fourth strike (311) lands every dot on its own ink. |
| 5 | 326–385 | 05 — FILTER | "blue" slams in a letter a sixteenth on the track's swung grid, heavy and huge (326, 330, 333, 338); on the "e" the 17 blues flash up and the other 157 dim, and on the next beat (341) the 157 fall out of the frame as the count rolls to 17 OF 174; on its "and" (348) the 17 fly into a block as the cursor swells into a cobalt flood that fills the frame on 356; the camera dives through the poster (363) and the real list swoops in on a card tilted in 3D that fills four fifths of the frame from 368, its rows leaning −7° as bar 6's bands will, slamming down on 371; the list snaps up under it a row every four frames, each name settling sharp, and its search box lifts off on the "and" (378). |
| 6 | 386–445 | 06 — TYPE AS TEXTURE | BUY MORE in ticker bands tilted −7°, whipping in over bar 5's blue, neighbours drifting opposite ways; the hero band's QTY rolls 1 → 2 → 3 → 5 on the beats as red takes the bands a pair a beat; on 431 the camera pushes into QTY 5, rolling level, as the bands fly off. |
| 7 | 446–505 | 07 — 3D / DEPTH OF FIELD | A bronze anodized titanium ball hops down four tiers of columns, cream to red, on a lit charcoal stage, landing a tier on each beat (446, 461, 476, 491), under a raking key and a warm back light that sheens the field to the horizon; each tier's price sits on a card at its front, the camera cranes from overhead to a low three-quarter view, and the focus racks with the ball. $1.60's card flips to red and flares on 476; the ball rolls off right, and the camera whips after it into bar 8 (501–505). |
| 8 | 506–632 | 08 — ODOMETER | The price page whips in on red, carrying bar 7's streak (506), and glides on as the camera pushes in; the price rolls $2.00 → $1.60 and locks two beats in with a punch and a clack (536), and the old price is struck through on the next beat (551); PAY LESS. rises beneath it on the music's next downbeat (566), and "$1.60 PAY LESS." glides left as the poster; two beats on (596) a −20% stamp falls out of the lens and slams onto the poster beside the price, jolting it, and the camera pushes in and pans toward the stamp over the finale's downbeat (626), to the cut on its "and". |
| 9 | 633–741 | 09 — EDIT / RHYTHM | The earlier bars play on, live, in a 2×2 on the downbeat's "and" (633) and a 3×3 (641) whose tiles all hit on the "and" (648); three sixteenth flashes (656, 659, 663) run into the ink field (667) imploding to a red "+", the BUY MORE flash and the implode ticking where the music's sixteenths fall; ONE BOX, cut out of a grey flash (671), rises cream on black; the needle comes back, leaning in from the upper right, and tattoos its full stop on the final hit (686), the ground flashing full red, the card jolting as red runs back through the letters. painfulpleasures.com decodes under ONE BOX as it rises (whole on 674), and PAINFUL PLEASURES rises onto a rule on the "and" (678); the lockup pushes in as the red dies and grain rises, and the whole frame, HUD and all, fades to black in the music's silence (733–737). |

The needle is the piece's own: the rest pays homage to the reference reel's devices (the bounce, the kinetic words, the
cube field, the ticker bands, the recap), and the needle, the ink and the colour are what make it Painful Pleasures'.
The HUD is set larger than the reference's (20 px mono, not 14) so it reads at 1080p.

## Colour script

Red leads, blue answers, black is the stage and cream is only ever the product's own: its name, its paper (the buy
box, a ticker band). The cut runs one arc: red, then the product's colours spreading to all 174 inks, narrowed by the
search to one colour, blue, which hands back to red for the price, then black. Colour count goes 1 → 3 → 174 → 1 → 1.
The piece opens on a red drop that lands as THE NEW BUY BOX.'s full stop, and closes on ONE BOX.'s, tattooed in red:
the same dot.

| Bar | Grounds, beat by beat | Colour's job |
|---|---|---|
| 1 | black under frame-wide cream words; the red drop swells to full red by 85 | the brand, one dot |
| 2 | EVERY red · COLOR black, its letters in inks · ONE red · TAP. black | red and black trade places; COLOR previews the inks |
| 3 | the card over black · pink · charcoal · black · the page's white round the black machine · its display's blue band over the lime timer | each tap floods its colour out behind the card, where it holds for the beat, lightest to darkest; then the product's own white and its display's blue carry the hold and the dive, landing on bar 4's black |
| 4 | black, the inks rippling through it | every colour, the peak |
| 5 | black, until "blue" floods it blue (356) and stays | the search narrows 174 inks to one colour |
| 6 | blue bands over bar 5's blue, cream bands beside the hero; red takes the bands over as the quantity climbs | blue hands back to red |
| 7 | charcoal; the tiers' columns ramp from cream to red as the price drops | the cheaper, the hotter |
| 8 | red, the −20% stamp landing on it in ink | the price |
| 9 | the recap's tiles replay the order (red, pink, blue, red in the 2×2; the whole cut in the 3×3); the implosion to black; a grey flash; ONE BOX cream on black; the last hit flashes the ground full red, dying back to black; its full stop red | everything once more, then the dot |

A ground changes only on a beat or its "and", by a cut or by a shape of the new colour growing to fill the frame. Magenta, graphite
and the inks appear only where the product has them.

**Every beat carries a strong frame.** No near-black or empty frame anywhere before the final fade: a dark ground
always holds a big figure (the drop at its full size, a word, the needle, the field).
