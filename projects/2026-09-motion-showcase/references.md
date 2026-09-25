# References: launch clips and showreel motion, as numbers (PP buy box · 1920×1080 · 30 fps · music only)

Tags: **[M]** I measured it from downloaded clips (ffmpeg scene cuts, 2 fps contact sheets, ORB affine drift sampled at 5 Hz).
**[S]** from a written source (links at the end). **[R]** my recollection or craft knowledge, not checked in this pass.
Apple and Stripe "going big" is all [R]. I didn't measure them.

## 0. What the references do
- **Linear launch shorts** [M, channel listing]: 16, 16, 18, 19, 21, 24, 26, 29, 30, 34 s. No voiceover. The two I measured have **no headline text**; the UI is the only text, and a logo card (lockup ≈ 20–22% of frame width) holds for 3.0–3.6 s.
  - *"Linear for Microsoft Teams"* (18 s, **calm register**): one continuous take. Push-in 0–1.8 s, then the **camera is locked for ~9.8 s** while text types (~10 chars/s) and a 3-row result card lands. Payoff held ~3 s, a 1.6 s pull-back to 64% scale, a ~1 s blur-dissolve, then the logo shrinks and settles over 1.4 s and holds for 1.4 s. This static middle is the "jank/static" look to avoid.
  - *"Mobile app redesign"* (15 s, **showreel register**): black ground and a phone at an extreme grazing angle (~45–60°, eyeballed) with shallow depth of field. Glassy buttons catch specular light, tab icons pop in one by one about 0.5 s apart, and tiny colour dots are the only colour. Shots run 3.6 / 5.2 / 2.8 s, then a still logo for 3.6 s. **The camera never stops inside a shot** (numbers in §3).
- **Framer "Design Agents — Cannonball"** (20 s, 24 fps) [M]: cuts at 1.2, 2.75, 3.7, 6.75, 11.2, 16.8 s, giving shots of **1.2 / 1.5 / 1.0 / 3.0 / 4.5 / 5.6 / 3.4 s**. Fast at the top, longer into the payoff. UI appears as single isolated elements on pure black (prompt pill, Publish button, typed URL), about 1 s each.
- **Linear's method, per Lago** [S]: ~20 s, "no voiceover, no stock footage, no abstract 3D shapes", "the camera moves through the real product, one action at a time". Also "zoom into the action, whip-pan between screens, hold the payoff", real pixels only, a closed palette, and reading holds specified per shot.
- **Apple event openers and feature reels** [R]: an opening montage of 0.4–1.0 s shots cut on musical accents, then a title held 1.5–2.5 s. UI floats or sits on a device with a slow push that never stops. Supers are SF Pro semibold/bold with tight tracking, 1–4 words, and a grey supporting line. The iOS 26 Liquid Glass films rely on moving specular edges.
- **Stripe (Sessions reels, stripe.com)** [R]: a slowly animating gradient-mesh ground, UI cards stacked in 3D with big soft layered shadows, one accent glow, and very little colour otherwise. "Premium interfaces use surprisingly little color" [S, Mantlr].

## 1. Timing and rhythm
- The whole piece is 15–20 s (Linear shorts cluster at 16–19 s) [M]. The end card takes 2.5–3.5 s of that [M: 3.0–3.6].
- Beats run **2–4 s** (1–2 bars at 120 BPM). Sub-second shots (0.5–1.0 s = 1–2 beats) belong only in an opening montage [M: Framer 1.0–1.5 s early, 3–5.6 s late].
- **Tempo.** Pick the track first. These tempos land exactly on frames at 30 fps: **120 BPM → beat 15 f, bar 60 f**; 112.5 BPM → 16 f; 90 BPM → 20 f. Cut on bars or half-bars. Put the hero hit (the price drop) on a downbeat [R].
- **Read holds.** A read stays static and legible for ≥ 1.0 s + 0.25 s per word, so a 4-word super needs ~2 s = 60 f. A payoff UI state holds ~3 s [M: Linear payoff ~3 s]. Headlines exit on a beat, faster than they entered [R].

## 2. Easing (30 fps frame counts)
- **Camera arrivals: expo-out.** The Linear push-in [M] decays in speed ~3.5× every 0.4 s: ~85% of the travel is done by 0.6 s and it's dead still by 1.8 s. That matches `cubic-bezier(0.16,1,0.3,1)` over ~2 s nominal (60 f) [R: fit]. The repo's `motionCurves` has no expo-out (its strongest is `expressive.entrance` = (0,0,0.3,1)), so add one rather than stretching `cubic`.
- **UI element entries:** strong ease-out `cubic-bezier(0.23,1,0.32,1)` [S, Emil Kowalski], from scale 0.94–0.97 plus opacity 0. Never scale(0) and never ease-in on an entry [S]. Emil's <300 ms is for interactive UI. In film, panels take **18–24 f** and text **15–18 f**, because nothing primed the eye [R].
- **Reframes and pull-backs:** strong in-out `cubic-bezier(0.77,0,0.175,1)` [S] over 36–48 f. Linear's pull-back peaks ~0.4 s into a 1.6 s move [M].
- **Springs (Remotion `spring`)** for chips and badges: mass 1, damping 14–18, stiffness 140–180, which gives ~4–7% overshoot [R]. "5–8% overshoot, not 20%" [S, weak source]. Keep bounce at 0.1–0.3 [S, Emil]. Use `damping: 200` for no bounce [R].
- **Stagger:** 2–3 f (67–100 ms) between words or rows [S: Emil 30–80 ms; others 50–100 ms]. **Exits:** ease-in at ~60% of the entry duration, or hide them in a cut [R].
- **Continuous drift:** linear, or a very long sine. It must never visibly "arrive" [R].

## 3. Camera: always alive
- **Measured showreel drift** (Linear Mobile [M], normalised to 1080p): scale **+1.5 to +8%/s (typically 3–5%/s)**, translation **10–80 px/s (typically 25–50)**, in-plane roll **1–2°/s** (4.5°/s in a swing), plus 3D rotation the 2D fit can't see. The last UI shot slows to −0.5 to −0.8%/s and ~5 px/s (a settle); the logo card is the only still frame.
- **Measured calm register** (Linear Teams [M]): 0.0%/s for ~10 s. That flatness is what reads as "static".
- **Push-in to a detail:** 1.5–2.5× total scale, landing with expo-out. Blur the rest (depth of field) so the target is the only sharp thing [R].
- **3D angles [R]:** for reading beats, perspective ~2000 px, rotateX 8–12°, rotateY −10 to −18°, and drift the angle 3–6° across the beat to get parallax. Texture and opening beats can go to **35–50°** grazing with shallow depth of field. Linear does this on text it doesn't need you to read [M].
- **Focus pull:** move the blur from 0 → 10–14 px on one plane while the other goes 12 → 0 px, over 12–18 f, `motionCurves.dissolve`-shaped [R].

## 4. Depth, light, colour
- **Ground.** Linear floats a white UI card on near-black and puts a soft diagonal light sheen on the end-card black [M]. For PP, use deep navy, not black: a radial from ~#0b1730 at the edges to #1c365e behind the hero, with a 15–25% corner vignette. The white UI is then the brightest thing on screen and pulls the eye for free [R].
- **Floating-card shadow** (the widely copied stripe.com value) [R]: `0 50px 100px -20px rgba(50,50,93,.25), 0 30px 60px -30px rgba(0,0,0,.3)`. On navy, tint it to navy-black and allow 60–120 px blur at 35–50% opacity.
- **Planes and parallax [R]:** background 0.3–0.5× of the camera move, UI 1×, foreground chips/badges 1.3–1.5×. Depth-of-field blur: background 8–16 px, mid-plane 2–4 px, hero 0. Keep crossfade blur under 20 px [S]; blur-dissolves may peak at 16–24 px [R].
- **Light [R]:** **one** specular sweep per hero moment (a 20–30° diagonal band 15–25% of frame width, peak 12–18% white in screen blend, crossing in 18–27 f). Glow/bloom only on red or white hero elements (a copy blurred 40–60 px at 25–35%, add/screen blend). An ambient radial light orbits at 20–40 px/s so the ground is never flat.
- **Grain** [R]: monochrome, 2–4%, regenerated every frame (or every 2nd frame). It also stops banding in navy gradients.
- **Colour budget:** Linear is black, white and a few tiny coloured dots [M]. For PP [R]: navy, white, and **red #b82b2b only for the discount** ($1.60, "19% Off", the strikethrough). The 174 ink swatches are the colour spectacle, so don't invent rainbow gradients. Keep captured UI pixels ungraded; grade only the ground and the light.

## 5. Kinetic type: great vs cheap
- **Sizes [R]:** supers 110–140 px (cap ≈ 80–100 px), semibold 600–700, tracking −0.02 to −0.03em. Support line 40–48 px regular at 60–70% white, tracking 0. ≤4 words per super, ≤7 words in frame, one family, 2 weights. Linear and Framer mostly have **no** supers [M]; a music-only piece for a new product should use 2–4.
- **Great [R]:** a per-word mask rise (40–60% of line height from behind a clip, 15–18 f expo-out, 2–3 f stagger), or a blur-in (8–12 px → 0 plus y 12–20 px plus opacity, 15–18 f). Once set, the type sits still in its plane (it moves only with the camera) and exits on a beat in ~9 f. It shares the frame only with a *dimmed or blurred* UI (≤40% or ≥8 px), never with a UI read.
- **Cheap [R]:** per-letter bounce or overshoot; 3D word flips; scaling text up from 0; typewriter on headlines (typing is fine *inside a UI field* [M: Linear, Framer]); every word entering at once; 0.8 s+ opacity fades; drop shadows or outer glows on type; text that drifts fast while it has to be read.

## 6. Number counters: great vs cheap
- **Great: an odometer [R].**
  - each digit is a vertical strip in a mask with 8–12 px feathered top and bottom edges
  - tabular figures, so the width never jitters
  - the strip rolls over 18–24 f with expo-out and vertical motion blur scaled to its speed (4–10 px, or `@remotion/motion-blur` at 180° shutter, 8–10 samples), reaching 0 at settle
  - digits lock left to right 2–3 f apart, like a slot machine
  - on landing, a **scale punch 1.00 → 1.06 → 1.00 in 8–10 f** on the downbeat
- **The price drop here:**
  - the old price gets a strikethrough drawn left to right in 9 f
  - then $2.00 → $1.60 rolls: the dollar digit steps down one, the tenths roll 0→6, the hundredths stay put
  - then "19% Off" springs in 6 f after the lock (≤6% overshoot), in red with the one glow
  - "17 of 174": roll 174 → 17 in ~15 f as the search term lands; don't count down through every integer
- **Cheap [R]:**
  - a linear count through every intermediate value (2.00, 1.99, 1.98… reads as a glitch)
  - proportional digits that jitter the width; −0 or dropped decimals mid-roll
  - no settle or punch; counts longer than ~1.2 s
  - several counters running at once; a counter moving with a fast camera

## 7. Transitions
- **Linear** [M]: a continuous one-take push/pull, hard cuts on dark frames, and a ~1 s blur-dissolve into the logo. Lago adds "whip-pan between screens" [S].
- **Use [R]:** a **whip** that continues the camera's direction of travel (6–8 f at ≥3000 px/s with 180° shutter blur, landing on a beat); a **blur-dissolve** (10–15 f, peak 16–24 px); a **match cut on shape or colour** (swatch → product image → mixed-order row); a **mask wipe** along a UI edge. Never cut from a moving shot into a dead one.

## 8. Restraint (what they deliberately don't do)
- No stock footage, abstract 3D blobs, invented UI or data, or off-palette colour [S, Lago].
- One action at a time. The UI does the talking and the headlines are optional [M].
- "Don't compete for attention you haven't earned" [S, Linear]: secondary things get dimmed, not removed.
- No lens flares, no multiple accents, and no two reads at once [R].

## 9. Recipe for PP (16–18 s, 5–6 beats; everything moves, only one thing asks to be read)
1. **Track first, then cut to it.** 120 BPM (beat 15 f, bar 60 f). Beat boundaries sit on bars or half-bars, and the price drop lands on a downbeat.
2. **The camera never stops inside a beat.** Use linear drift of 2–4%/s scale, 20–40 px/s, and 0.5–1.5°/s yaw. Ease only the arrivals. The end card may approach still (≤0.5%/s).
3. **Three motion tiers:**
   - ambient, which never stops: ground, grain, orbiting light, drift
   - secondary: ≤50% opacity or ≥8 px blur
   - the one read: sharp, full contrast, still in its plane for ≥1.2 s (≥2 s for a super)
4. **Arrivals are expo-out (0.16,1,0.3,1):** camera 45–60 f, panels 18–24 f, text 15–18 f, badges on a spring (≤6% overshoot). Exits run at 60% of the entry duration or hide in a cut.
5. **3D has a reading budget:** ≤12–15° tilt when something must be read, 35–50° plus depth of field only on texture/opening beats.
6. **Every frame has depth:** navy radial ground, grain at 3%, one light behind the hero, the UI card with the layered shadow, 1–2 foreground chips at 1.3–1.5× parallax, and background at 0.3–0.5×.
7. **Colour budget:** navy, white, red. Red means discount only. The 174 inks are where the spectrum lives.
8. **One light event per hero moment:** a specular sweep (18–27 f, ≤18% white) or a 40–60 px bloom, never both on the same beat.
9. **Supers:** ≤4 words, 110–140 px semibold, −0.025em, per-word mask rise with 3 f stagger. A super never shares the frame with a UI read.
10. **Prices are odometers, not count-ups:** an 18–24 f roll with motion blur and tabular figures, locking left to right, then a 1.06 punch; the badge follows 6 f later.
11. **Transitions carry momentum:** a whip in the travel direction (6–8 f, blurred), or a 10–15 f blur-dissolve, or a colour match cut.
12. **Real pixels only:** capture at 2× DPR so a 2× push on "19% Off" stays sharp. Invent nothing.

## 10. Three beat structures (17.0 s at 120 BPM; bar = 2 s; one dominant move per beat)
**A. "One take across the buy box"** (Linear Mobile × Apple float: a continuous camera through one giant 3D buy box)
| # | t (s) | beat | dominant move |
|---|---|---|---|
| 1 | 0–2 | Ink grid macro, 40° grazing, depth of field | lateral dolly along the swatches (~150 px/s) plus a light sweep |
| 2 | 2–5 | Tap a swatch → image and price swap instantly | rack focus from swatch to product image while the tilt eases to 12° |
| 3 | 5–8 | Search "red" → "17 of 174 choices" | push-in 1.0 → 1.7× onto the count; 174 → 17 roll |
| 4 | 8–11 | Qty 5 → $2.00 → $1.60, "19% Off" | odometer lands on the 9.0 s downbeat; punch, then badge pop |
| 5 | 11–14 | Mixed-order builder adds rows | pull-back plus yaw −18° → −6° to reveal the whole floating buy box |
| 6 | 14–17 | Logo + "The new buy box" | near-still with one specular sweep |

**B. "Beat montage → price payoff"** (Apple opener / Framer rhythm: fast in, long on the payoff)
| # | t (s) | beat | dominant move |
|---|---|---|---|
| 1 | 0–2 | 4 macro stings × 0.5 s: swatch, search glyph, qty stepper, badge | whip cuts on each beat, alternating direction |
| 2 | 2–4 | Super "A faster buy box." over the blurred, drifting UI | per-word mask rise |
| 3 | 4–7 | Swatch tap flows into search "17 of 174" | one push-in (1.0 → 1.5×) linking both |
| 4 | 7–11 | Tier table: $2.00 → $1.60 at 8.0 s, then held (the one long read) | odometer plus punch on the downbeat |
| 5 | 11–14 | Bulk builder fills | rows stagger in (3 f) with a parallax pull-out |
| 6 | 14–17 | End card | near-still, glow breathes once |

**C. "174 colours"** (colour-led: the ink list is the spectacle; red is held back until the price)
| # | t (s) | beat | dominant move |
|---|---|---|---|
| 1 | 0–3 | All 174 swatches as a tilted plane (35°) | low fly-over, the only full-spectrum beat |
| 2 | 3–5.5 | Type "blue": 157 blur and fall away, 17 reflow into the list | filter morph ("17 of 174 choices" locks) |
| 3 | 5.5–8 | One swatch becomes the selected variant in the buy box | match cut on the swatch shape |
| 4 | 8–11 | Qty 5: $1.60, "19% Off" (first red in the film) | odometer plus red bloom |
| 5 | 11–14 | Four inks from beat 1 fly into mixed-order rows | staggered fly-in, parallax |
| 6 | 14–17 | End card | near-still |

## Sources
- Lago, "We killed our motion design job" (Linear's method, Remotion pipeline): https://getlago.com/blog/we-killed-our-motion-design-job
- Emil Kowalski, animation standards: https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md
- Linear, "A calmer interface for a product in motion": https://linear.app/now/behind-the-latest-design-refresh
- Mantlr, "How Stripe, Linear, and Vercel ship premium UI": https://mantlr.com/blog/stripe-linear-vercel-premium-ui
- A weak source: https://trydemotion.com/blog/apple-style-animation-guide. Its "Apple curve" (0.4,0,0.2,1) is Material's standard curve, so its overshoot figure is the only number used here.
- Measured clips: Linear for Microsoft Teams https://www.youtube.com/watch?v=dailmhIBBUI · Linear Mobile app redesign https://www.youtube.com/watch?v=9IsOcWesym8 · Framer Design Agents — Cannonball https://www.youtube.com/watch?v=QQW5kFjQhHM
