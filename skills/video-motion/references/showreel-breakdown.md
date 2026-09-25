# The reference showreel, broken down

A frame-by-frame reading of the Opus 5.5 showreel (the first 15.9 s of `source.mp4`), for building a reel or a reel
piece here: the system it runs on, then its eight bars, each with how we'd build it with `lib/studio`. Read the system
first, then the bars your piece comes from. It merges the studies in the video folder,
`.agent_cache/videos/after-opus-5-5-it-actually-hurts-to-look-at-anything-gpt-6-a/`, where each study has a
`strip.jpg` contact sheet and a `work/` folder of crops, 60 fps strips and tables.

Sources, cited in brackets: [01]…[07] are `study-claude/NN-*/breakdown.md`; [hud] is `study-claude/hud/breakdown.md`
(the last study, whose clock corrects the rest); [index] is `study-claude/index.md`; [gpt] is `study-gpt/breakdown.md`;
[reels] is the repo's `projects/2026-09-motion-showcase/reels.md`, whose §0 predates the studies and is superseded.
[here] marks checks made against `source.mp4` for this file. Evidence paths are relative to the video folder, with
`NN/` short for `study-claude/NN-*/`. Where sources disagree, the later, frame-measured one wins, and the text says so.

## Where things are

- `source.mp4` is 1920×1080 at 60 fps, 31.8 s. Claude's reel is f0–953 (black on f954); GPT's runs from 16.80 s.
- fN is frame N, at N/60 s. H is the frame height (1080 px), W the width (1920).
- Beat k counts from the first downbeat, at 0.900 s. The HUD counts bar.beat from 1.1 (k 0); [index]'s labels run a
  beat ahead of it (its 1.2 is the HUD's 1.1).
- One frame: `ffmpeg -v error -ss <(N − 0.5)/60> -i source.mp4 -frames:v 1 -q:v 2 fN.jpg`. Seeking half a frame
  early lands on fN exactly.

| Bar | HUD label | k | Beats land on | Studies |
|---|---|---|---|---|
| 1 | `01 — SQUASH & STRETCH` | 0–3 | f54, 83, 111, 139 | `01-0.00-3.30` (B1: the slate, f0–53; B2–B5) |
| 2 | `02 — KINETIC TYPE` | 4–7 | f167, 195, 223, 251 | `01` (B6: EVERY), `02-3.20-4.70` |
| 3 | `03 — GENERATIVE GRID` | 8–11 | f279, 308, 336, 364 | `03-4.60-6.60` |
| 4 | `04 — 3D / DEPTH` | 12–15 | f392, 420, 448, 476 | `04-6.50-8.45` |
| 5 | `05 — VARIABLE FONTS` | 16–19 | f504, 533, 561, 589 | `05-8.35-10.30` |
| 6 | `06 — PARTICLES ×12 000` | 20–23 | f617, 645, 673, 701 | `06-10.20-13.20` (B1–B4) |
| 7 | `07 — EDIT / RHYTHM` | 24–27 | f729, 758, 786, 814 | `06` (B5–B6), `07-13.00-16.40` (B1–B3) |
| 8 | `08 — HIRE ME` | 28–31 | f842, 870, 898, 926 | `07` (B4–B7) |
| end | black | 32 | f954 | |

## The system

### Clock

- 128.000 BPM from 0.900 s (f54): a beat is 0.46875 s = 28.125 f, a sixteenth 7.03 f. Beat k's line is at
  f54 + 28.125k, and events land on the first frame at or after it, ceil(54 + 28.125k). The HUD's beat squares switch
  exactly there through k = 31 [hud]. 32 beats make 8 bars and 15.000 s; black on f954.
- Of [index]'s 18 cuts, 16 sit 0–1.2 f after a line: 14 on beats, f828 on a half-beat, f245 on a sixteenth. f616 is
  0.5 f early (its line is 616.5), and f726 is the white ramp into bar 7, which starts 4 f before its line [hud], [06].
- Moves that must arrive on a beat start early: the ticker bands 3.9 f (65 ms) [05], the CRT collapse 8 f before
  bar 3 [02], the particle morphs 12 f [06], the flash ramp 4 f [06], the full stop's fall from ≈f880 for f898 and the
  end rule from f866 [07]. Reactions trail by 1–2 f: the HUD square and callout dot +1, the ground ring +2 [01].
- The music's onsets trail the lines by ≈40 ms (2.3–2.6 f), so picture leads sound by 25–45 ms. Bar 1's kicks sit at
  f84.6, 112.8, 141.0, 197.1 against lines at 82.125, 110.25, 138.375, 194.625 [01]; bar 7–8 onsets at 13.126, 13.596,
  14.066 s against 13.0875, 13.556, 14.025 s, the cuts leading by 26–33 ms [07].
- [index]'s tracked grid (127.6 BPM from 0.461 s) lags: 1.9 f at bar 1, ≈4.6 f by bar 8, 0.088 f a beat. [01]'s
  phase (0.9167 s, f55) and [02]'s "0.3 f a beat" drift are also off; [hud]'s grid holds to the frame.
- Build: `steadyBeatGrid(128, 0.9)` and per-frame state from `Math.floor(grid.beatOf(t))`. `grid.frame(n)` rounds;
  `Math.ceil(grid.at(n) * FPS)` is the reference's rule. On a tracked song, put the hit 30–40 ms ahead of the audible
  onset and allow for the tracker's own lag: the showcase uses `grid.frame(n) − 2` at 30 fps (`reel-assembly.md`).

### Cut grammar

- One idea per bar, named by the HUD label, which changes only on the downbeat. Every beat carries an event.
- Six bars of one device each, then an accelerando that brakes: bar 7 cuts on each beat to 4 tiles, then 9, then
  four sixteenths; bar 8 adds one element a beat and goes black on the next downbeat. That's 7 cuts in 7 beats over
  3.25–6.53 s and 6 in 4 over 12.10–14.03 s, where GPT's reel makes 8 changes in 36 beats [gpt].
- Every cut is a 0 ms switch, often carrying a glitch split or a CA kick. Figure and ground trade places at each one.
- No cross-dissolves. The bars join by a colour zoom-through (1→2, f149–166; the tittle inside bar 2, f235–246), a
  point match (2→3: the CRT dot, f271–278, becomes the flash and ring on f279), a layout match (3→4, f392), a
  speed-matched whip (4→5, f497–503, the bands arriving at 159 px/f on f504), a match on the word (5→6, f616), a white
  flash (6→7, f725–729), an implosion then a grey flash (7→8, f835–842), and a fade to black (f947–953).
- The camera makes one real move, in bar 4, over 1.4 beats. Every other camera change is a punch that decays.

### Easing

- Arrivals use the exact out-expo, 1 − 2^(−10k). The reel prints it in bar 2 as
  `def out_expo(t): return 1 - 2 ** (-10 * t)`, and `motionCurves.expo.entrance` is the same curve. An ease over d
  seconds keeps 2^(−10/(fps·d)) of the remaining distance each frame, so a measured per-frame ratio gives the
  duration. A ratio r at 60 fps is r² at 30.

| Keeps per frame at 60 | d | At 30 | Where |
|---|---|---|---|
| 0.68–0.70 | 0.30–0.32 s | 0.46–0.49 | EVERY's rule, the recap's slide, the recap sphere's growth |
| 0.75 | 0.40 s | 0.56 | EVERY's letters |
| 0.763 | 0.43 s | 0.58 | bar 1's baseline |
| 0.79 | 0.49 s | 0.62 | the ticker bands' entry |
| 0.80 | 0.52 s | 0.64 | the end card's rule |
| 0.85 | 0.71 s | 0.72 | CLAUDE's letters |

- Exits accelerate exponentially: the ticker bands ×1.62–1.85 a frame (0.19–0.24 s) [05], the swell ×1.25 a frame
  [01], the tittle zoom with log2(scale) ≈ 0.029·(f − 233.5)² [02], the galaxy warp's scale +5 → 19% a frame [06].
- Hits decay. Camera punches go as 1 + a·e^(−Δt/τ): 3.1% with τ 0.11 s in bar 3 [03], 1.9 / 0.67 / 0.79% over 3 f in
  bar 4 [04]. Particle landings hit ×1.06–1.09 and relax ×0.85 a frame [06]. The ticker kick is a damped cosine
  (38 px, 4.9 Hz, τ 61 ms) [05]. Flashes fall ×0.65 a frame [03] or as (1 − k/8)² [07].
- Overshoot is rare and small: bar 3's turn (ζ ≈ 0.7, +2° on 45°) [03], the recap's back-out (s ≈ 1.95: 12.6% of the
  travel, 3% of the size) [07], bar 1's lift-off stretch and its string (6.9 Hz, ζ 0.19) [01]. Type, the camera and
  numbers never overshoot.
- Falls are physics, closed-form in t: g 15,000 px/s² (4.17 px/f²) in bar 1 [01]; 4.1 px/f² falling and 3.3
  bouncing for the full stop [07]; 125 column pitches/s² in bar 4 [04].
- Linear only for fades, the HUD's fill, scramble fronts, bar 2's code scroll (900 px/s), the ticker drift (231 px/s)
  and the white ramp (+50 luma a frame). In-out only for bar 4's camera (cubic, 1.4 beats) and the particle morphs
  (easeInOutCubic).
- Nothing is ever still. The HUD's timecode and fill change every frame; the ticker breathes on 0.875 s, off the beat;
  spins run 115–145°/s; the columns churn; the end card pushes in ≈2%. The longest HUD-only stretch is 20 f
  (f926–946), and EVERY holds still for 6 f. A median frame changes 9.4% of its pixels (mean 17.5%, p90 43.6%);
  GPT's changes 1.5% (2.9%, 6.6%) [gpt].

### Colour

Flat values are read at the centre of a flat field, since 4:2:0 chroma costs thin coloured strokes ±5 levels. The
variants are where each one is used.

| Role | Flat | Variants |
|---|---|---|
| ground | #0a0a0c | #0c0c0e [06], #0d0d0f [07]; bar 3 #101013 with #0f0f11 between cells; bar 4 #0c0604 under fog #120d16 |
| cream | #efece6 [05] | HUD paper #e8e5df; bar 3 #eae7de; type on blue #f3f0e7; CLAUDE #f2efe6; "is" ground #f0eee5 (#dad7d1 corners); slate #f4f2ee |
| red-orange | #ef4c22 [01] | EVERY ground #eb4a20 (#d5431e corners); hero band #ee4c2f; bar 3 #e64c23; stop #e94d24; bar 4 ball #e8461f; recap card #f04d24; particles #e4533f |
| blue | #3037f2 (CODE; #2b33da corners) | bar 3 #3238eb; bands #3a3cf4; CODE flash #3139ec; particles #3d36e5; "is" ink #464bf5 |
| warm ink | #15090c [02] | #19090d [01]; #1a0502 [07]; the hero band's type #1c0a16 [05] |

- [index]'s #e34920, #7f80eb and #adace4 are means over falloffs and blends, not colours to use. The HUD's accent is
  #e34920 at 73% alpha.
- Two accents, used full bleed. The ground is the colour event and changes on the beat: orange → ink → cream → blue
  over 3.20–4.13 s. An accent reaches full frame by a zoom through a shape of its colour.
- Accents are scattered by hash in small shares: 21% red and 8% blue among bar 3's diamonds, 11% and 5% among its
  squares, 12% and 4.3% of bar 4's columns, 4% and 3% of the particles. In 3D the ball is the only saturated warm thing
  that moves.

### Type

| Text | Size | Face and setting |
|---|---|---|
| EVERY | cap 316–318 (29.4% H), ink x 203–1738 | E 0.8 cap wide, stems 93 px (0.29 cap), gaps 12–26 px, R and Y interlock; Archivo 900, width unresolved (bar 2) |
| FRAME | cap 264 (24.4%), x 330–1597 | weight 100→900, letters 0.96 cap wide, tracking ≈0 |
| is | x-height 335 (31%), box 420×451 | stem 37 px, slant 15.5°, round 50×48 tittle |
| CODE | cap 306 (28.3%) | ≈0.6 cap wide, stems 75 px (0.245 cap), gaps 21 px: Archivo 900 at width 62% |
| MOTION, bands | cap 110 (10.2%; 0.71 of a band) | light 2.8× cap wide, stems 0.10 cap, gaps 3–7 px ↔ bold 6.4–6.8× cap, stems 0.31, gaps 8–10: Archivo ≈500 / width 62 / scaleX 0.71 ↔ ≈875 / 105 |
| MOTION, held | 538 px wide (4.9× cap) | stems 28 px (0.25 cap): ≈850 at width 75 |
| CLAUDE | cap 220 (20.4%) | L stem 61 px (0.28 cap), C 1.04 cap wide, gaps 13/4/0/22/14 px: 900 at width 125, ≈−0.03 em |
| end card sub-lines | cap 24 (2.2%) | mono, ≈+0.12 em |
| status | cap 16 (1.5%) | mono caps |
| tagline | x-height 22 (2.0%) | light italic grotesk |
| (01)–(04) word labels | cap ≈14 (1.3%) | mono |
| bar 1 callouts | cap 10–11 | mono, 10.5 px advance |
| HUD | cap 10 (0.93%), ≈14 px type | JetBrains Mono ≈600 |
| slate | cap 110 | over "01 / 02" in 18 px mono |

- One word is the image, at 20–31% of H; everything else is mono at 2.2% of H or less, with nothing in between.
  [gpt]: GPT's heads run 88–224 px (8–21% H), a new size nearly every line.
- Each word gets its own mechanism: letters rising from a mask, a weight sweep in a selection box, a slant, a
  scramble, breathing bands, particles.
- Display type is set tight: 0–26 px between letters at 220–318 px caps, CLAUDE at ≈−0.03 em. [reels] quotes
  HyperFrames' −0.03 to −0.05 em.
- Archivo's cap height is ≈0.69 em (cap 110 is 160 px type), JetBrains Mono's ≈0.73 em.
- Words whose letters move are set one glyph per span, placed from the font's advances (`layoutGlyphLine`,
  `lib/studio/reel/ticker-layout.ts`), not by the browser's line layout.

### HUD [hud]

Dim static chrome in the outer 60 px, over the content and every transition and under the frame post. It takes the
glitch splits and the flashes but not the CRT collapse, zooms, shake or warp, and fades out with the end card
(f947–953). Where the section studies' HUD geometry differs (brackets 41–44 px in, squares 7–10 px, a 1 or 2 px
rule), [hud]'s numbers win.

- **Brackets:** four corners, outer edge 43 px from the frame edges, arms 25 px long including their 2 px stroke
  (TL x and y 43–67; TR x 1852–1876; bottom y 1012–1036).
- **Top row:** caps y 50–59 (baseline 60) across x 84–1836. TL: `CLAUDE` (x 84–141), then `MOTION REEL 2026`
  (x 168–324) 26 px on. TR: `128 BPM   60 FPS   1920×1080`, right edge at 1836.
- **Bottom row:** caps y 1022–1031 (baseline 1032). The timecode at x 85–186. Four 9 px squares with a 1 px outline
  on a 15 px pitch (x 264/279/294/309, y 1021–1029). The progress rule at x 334–1455 (1122 px, 58.4% W), y 1026–1027,
  2 px. The label right-aligned at 1836: `NN — TITLE`, with an em dash (U+2014).
- **Type:** cap 10 px, ≈14 px type. Advance 9.8 px (TR 9.65, subtitle 9.93), a 0.6 em cell plus 0.10 em tracking;
  the timecode's is 9.44. JetBrains Mono at 600 matches (cap 10.2).
- **Ink:** paper #e8e5df or ink #0a0a0c at a per-element alpha, so it reads peach ≈#f69680 on orange and lavender
  ≈#979dfe on blue. It isn't a blend mode, as [05] guessed. Light: primary text 68% (#a0a09c), secondary 57%
  (#888885), brackets 60%, fill 52% (#7c7c7c), track 11% (#222225), square outlines ≈40%, the lit square #e34920 at
  73% (#ab3520). Dark: 50 / 45 / 60 / 46 / 8%, and the lit square turns ink (≈62%).
- **Tone follows the ground under each element.** All dark over "is" (3.713–4.083 s). Bar 5 flips TR at 8.417 s, TL
  at 8.583, the bottom left at 8.650, then each element follows its own stripe from 9.017. Under a flash it goes dark
  where the ground reaches luma ≥130 (f280, f728–730, f842), crosses over on f727, 731 and 843, and is light again at
  ≤98. Over the 2-up, TR is dark f731–735, light f736–744, dark f746–757. The rule keeps one tone across a panel edge,
  and small tiles don't count. Where the tone is wrong an element vanishes: those frames are flaws.
- **Boot, f54–84:** the brackets draw out from each corner (arm px over f54–69: 2, 7, 11, 14, 17, 19, 20, 21, 22, 23,
  24, 24, 24, 24, 25, 25) while the track fades in (11/25/36/44/57/63/71/78/87/91%). The text decodes over 30 f: cell
  i of n appears at u ≈ 0.7·i/n and locks at u ≈ 0.35 + 0.65(i + 1)/n; a new cell shows at ≈50% on its first frame and
  scramble glyphs at ≈87%, drawn from `A–Z 0–9 # $ % & * + / < = > [ ] { } ¥ ₿ ₵ ₽ ≠ ‡`. TR's groups lock on f70, 76
  and 84; the timecode locks on f83, reading 00:00:00:29.
- **Running:** t is reel time from f54. The timecode reads `HH:MM:SS:FF`, FF in 60ths (last live read 14:57, on
  f951). The lit square is floor(t/0.46875) mod 4. The fill grows 1122·t/15 px (74.8 px/s). Each label decodes over
  18 f from its downbeat (reveal 0.61·i/n, lock 0.28 + 0.72(i + 1)/n); the old one lingers a frame on f279, 504, 729.
- Evidence: `hud/build/r_0071.png`…`r_0088.png` and `build_right_bottom_{a,b}.png`, `hud/sec/`, `hud/verify/`,
  `hud/crops/`, `hud/{rule,theme}.tsv`. The `build/tl_build.png` that [hud] cites doesn't exist.
- Build: `ReelHud` (`lib/studio/reel/hud.tsx`) takes the clock, the sections and `toneAt(slot, t)` (light, dark or
  on-accent per slot). `REEL_HUD_BOOT_DECODE` and `REEL_HUD_SWAP_DECODE` hold the schedules above, and
  `reelHudToneWeights` mixes tones over sub-frame samples. At 30 fps FF runs 00–29, the readout says 30 FPS, the
  decodes take 15 and 9 frames, and the squares alternate 14- and 15-frame beats. The showcase sets it at 20 px.

### Frame post

- **Grain: none; leave `FilmGrain` off.** Static holds change 0.00–0.36 levels (sd) frame to frame [here]: orange
  f189/191 0.22 and f191/193 0.00, blue f247/249 0.07, black f930/932 0.30, cream f930/932 0.05. The sections agree
  ([01], [02] σ < 1; [05] none; [06] sd 0.13; [07] σ 0.6); [hud]'s "grain covers everything" is wrong.
- **Chromatic aberration: radial, with kicks.** At rest red sits 0.3–0.7 px out and blue in at the corners ([05]
  reads the TL bracket's R, G, B edges at 43.4 / 44.1 / 44.9 px). Cuts kick it: 2 px on f195–200, then 1 px to f211
  [02]; −4 px on f279 [02]; ±2 / ±1.2 / ±1 px on f392 / 394 / 396 [03]. Bar 4's render shows 1–2 px at its corners
  [04]. Unresolved: [hud] says the resting fringe covers the whole frame; [03] saw it on the HUD but not on the grid
  before f392.
- **Glitch hits:** horizontal R/G splits of 6–14 px falling ×0.85 a frame, 10–60 px slices shifted ±10–40 px, and
  ghost copies [02]; whole-frame splits of 10–30 px on the recap's cuts, HUD included [07].
- **Flashes:** bar 3's grey (peak 57%, ×0.65 a frame) [03], the white ramp into bar 7 (luma 39, 77, 127, 176, 227 over
  f725–729) [06], the grey #a4a4a4 into bar 8 [07]. The HUD sits over them, toned dark.
- **Vignette: a falloff, layer unresolved.** f190's orange reads 107.1 luma at the centre, 104.3 top-middle, 101.7 at
  the side middles and 95.4–95.7 in the corners (×0.89); f930's black 10.6 top-middle, 10.2–10.3 at the sides and
  9.6–9.9 in the corners [here]. The section studies read corner shades into their grounds, and [05] reads the outer
  bands ≈4% darker. [hud] rules out a post vignette because the progress fill is flat to ±4 luma, but the ground along
  that row varies only ≈4 luma, so the test can't tell. Build it into the grounds (`Vignette` at ≈0.11 on the ground
  layer), never over the HUD.
- **Bloom:** only on the end card, +15 luma within 40 px of the title [07]. None on the particles [06].
- Build: `LensFringe` (`lib/studio/reel/lens.tsx`) wraps the whole frame, HUD included: `radial` at rest, `kicks` on
  cuts, `splits` for glitches. Glitch slices and ghosts live in `ScrambleText` and `GlitchFlash`.

### 60 fps, 30 fps and smear

- The reference is 60 fps with a centred 180° shutter: each frame averages sub-frames over n ± ¼ f. The HUD square is
  half-lit on f504, f532 is a 24% blend, and f560 and f588 are clean [05]. The reel's printed recipe says the same:
  `frame = accumulate(subframes) / nsub`, `shutter = 0.5` [02].
- Smear runs 0.4–0.5 of a frame's travel: 28 px at 62 px/f, 71 at 278, 55 at 143, 4.3 at 10.5.
- We render 30 fps: a beat is 14.0625 frames, a sixteenth 3.52. Keep timings in seconds, since `stagger` rounds each
  step to whole frames (46 ms steps land on 0, 1, 3, 4, 6, 7). A per-frame ratio r becomes r². Smear anything moving
  over ≈40 px a frame.
- `REEL_SHUTTER` (1/120 s, a 0.25 shutter at 30 fps) keeps the reference's smear length; 0.5 suits transitions.
  [01] and [05] ask for 0.5, [02] and [06] for 0.25: a matter of taste, not measurement.
- These strobe at 30 without smear: bar 1's drop (≈140 px a frame) and swell, the tittle zoom, the band entry (≈320)
  and exit (≈1,100), bar 4's falling ball (≈170), the whip (≥150), the implosion, the full stop's fall (134–142).
- These poses must land on a rendered frame: every max squash, bar 3's newborn orange, each glitch frame, the CRT
  line, the HUD's dark frames under a flash.
- Bar 6's sphere spins 115°/s and wagon-wheels at 30: halve it to ≈60°/s. The ticker kick at 30 reads as a jolt of
  0.7–1.0·A, a frame near 0, then two frames of ≈−0.2·A.
- `ShutterBlur` trails (its samples span [t − span, t]) where the reference centres: shift t by half the span to
  match. Around a `ThreeStage` every sample is a WebGL context, and Chrome drops contexts past ≈16: use the stage's
  own `samples` and `shutter` (being added as of 2026-09-24).

### Pieces

Status as of 2026-09-24, in `lib/studio/reel/` unless noted. Several were still being built.

| Piece | File | Reference bars |
|---|---|---|
| `BounceBall`, `bouncingBallAt`, `BounceCallout`, `FieldSwell` | `bounce.tsx` | 1; bar 2's tittle zoom; bar 8's full stop |
| `RiseWord`, `WeightWord`, `SelectionBox`, `SlantWord`, `ScrambleText` | `type.tsx` | 2, 8 |
| `GlyphField`, `FieldFlash`, `ShockRing` | `glyph-field.tsx` | 3; bar 7's implosion |
| a column field on `ThreeStage`'s accumulation | `column-field.tsx` (planned), `lib/studio/three-stage.tsx` | 4 |
| `TickerBands` | `ticker.tsx`, `ticker-layout.ts` | 5 |
| none yet; [06] specs `particleMorph` | | 6 |
| `RecapGrid`, `GlitchFlash`, `Shake`, `FadeToBlack` | `recap.tsx` | 7, 8 |
| `ReelHud` | `hud.tsx` | all |
| `LensFringe` | `lens.tsx` | the frame post |
| `Odometer` | `lib/studio/kit.tsx`, `lib/studio/odometer-wheels.ts` | bar 5's price roll; the showcase's |
| `CapturePlane`, `Needle` | `capture-plane.tsx`, `needle.tsx` | none: the showcase's own |

## The bars

### Bar 1: 01 — SQUASH & STRETCH (f54–166) [01]

- **Slate, f0–53:** "Opus 5.5 Max" (cap 110, x 442–1480) over "01 / 02" in 18 px mono. It fades up linearly over
  f0–7 (+36 luma a frame), holds 40 f, fades down over f47–54 and cuts to the reel on f54. A riser starts at 0.94 s.
- **Beat 0:** a 2 px baseline (y 699–700, x 359–1560) draws out from the centre at ×0.763 a frame from f55, with ruler
  ticks every 40 px (8 px; 12 px every 200). A 40 px dot lattice (x, y ≡ 39 mod 40, luma 12–27) turns on at random
  over f61–120. The path guide fades in over f61–65, its cusps at x 699.4, 959.6, 1219.8 (y 643.5). The ball (Ø112,
  0.104 H, flat #ef4c22) falls in at 4.17 px/f² with vx 7.5 px/f, touching on f80 at 71 px/f, stretched s = 1 + v/107
  (1.3 on f70, 1.71 on f79).
- **Beats 1–3:** max squash on f82, 110 and 138, just before each line. A contact runs from touch (f80) to lift-off
  (f84) at w:h 0.76 / 2.0 / 3.4 (206×61) / 2.5 / 1.17. 24 f in the air, the apex 298 px up on the "and" (f96, f124),
  steps of 260.2 px; g = 8·apex/(spb − 4/60)². The lift-off stretches to 1.58 (the speed law gives 1.40), ringing ≈8 f.
- **The baseline is a string:** pressed as a Gaussian (σ 100 px) 8.0 / 11.9 / 9.4 / 1.8 px deep over a contact, then
  ringing at 6.9 Hz, ×0.55 each half-cycle: −5.4, +3.2, −2.0, +1.0, −0.7, +0.5 px.
- **Marks, counted from max squash:** a 16 px #e4e4e4 diamond at the cusp on +0; the HUD square and the callout dot on
  +1; five sparks over +1…+5 (2×14 px ticks, up, ±45° and ±80°, r 75→120); a ground ring over +2…+13 (aspect 0.30,
  a 50→150, fading from luma 164); the music's kick at +2.6; onion skins of the ball's past shapes at −2/−4/−6 f,
  contrast 16:8:4, ≈1.5 px.
- **Callouts:** a 5 px dot (#f3f3f5) at (contact x + 16, 718); a leader (#a4a4a7) 56 px down-right at 45° over f82–85,
  then 31 px across over f85–90; a two-line label (#dcdcde, cap 10), the number in accent over the name ("01" at
  y 733–742 over "SQUASH & STRETCH" at y 753–762, x 796), typed with scramble at 1.5 chars a frame over f86–95,
  resolved by ≈f98, faded over f104–109. Then "02 ARCS + TIMING" and "03 ANTICIPATION".
- **Beat 3, the launch:** the impact squashes 1.76 / 3.21 / 2.83, rebounds to 1.45 on f140, then crouches over
  f141–148 (224.5×57, 3.9:1) with the string pressed 15.6 px. Launch on f149 (the string at −7.4 on f152, +3.9 on
  f156). The ball arcs to (960, 540), peaking at y 512 on f153 and settling by f161 in steps of 18, 54, 46, 38, 30,
  24, 18, 13, 9, 6, 3, 1 px.
- **Swell out:** the ball grows ×1.10 (f149), 2.31 (f155), 8.41 (f161, 944 px), 15.7 (f164) and fills the frame on
  f165, ×1.25 a frame from f157. It stretches 1.75:1 over f151–154 and is round by f158, its edge soft (≈0.085 r). The
  guide, diamonds and ghosts fade over f151–157, the callout over f151–156. No cut: f165's orange is bar 2's ground.
- Evidence: `01/work/{contact1,ghosts,callouts,rings2,swell,pathbuild}.jpg`.
- Build: `BounceBall` and `bouncingBallAt` (`bounce.tsx`, whose reference values are this bar's), `BounceCallout`,
  `FieldSwell`. At 30 fps put each max squash on a rendered frame; the swell's last ≈5 frames grow ×1.56 each, so
  soften its edge (σ ≈0.035 r) or give it `ShutterBlur` at 0.5.

### Bar 2: 02 — KINETIC TYPE (f167–278) [02]; EVERY also [01]

One word a beat, each with its own mechanism and ground. Above each word's box sits a mono label, (01) to (04), cap 14,
5 px in and 20–30 px up, fading in over 3–4 f, 5–7 f after the word starts.

- **EVERY (f167):** ground #eb4a20 (#d5431e corners), ink #15090c, caps y 382–699. The letters rise 332 px through a
  mask at y ≈712, ×0.75 a frame (0.40 s), 1.5 f apart (starting 166.95, 168.5, 170.0, 171.5, 173.0); E's offsets run
  245, 183, 136, 101, 75, 56, 44, 32, 23, 18, 13, 9, 7, 5, 4, 3. The lockup widens 6–7% as it lands and relaxes by
  f181 ([01] read a 43 px slide; [02]'s per-letter offsets show the widen). An 11–12 px rule (y 733–744, x 180–1740)
  draws from +4.5 f at ×0.70 a frame (remaining 1324, 940, 662, 464, 327, 234, 164, 116, 81 px), its tip smeared
  ≈130 px at 380 px/f. (01) at x 186, baseline 356, fades in over f174–177. Still over f189–194; cut on f195.
- **FRAME (f195):** ground #0a0a0c, ink #e84a20, caps y 408–671. Weight 100→900: the F's stem runs 14, 20, 30, 36, 44,
  50, 54, 60, 64, 66, 68, 70, 71, 72, 72, 73, 74 px over f195–211, the word widening 1188→1268 px. A selection box
  starts at the frame's edges (8 / 15 / 1910) and closes over ≈18 f (remaining 267, 195, 140, 104, 81, 40, 26, 19,
  14, 9 px) to x 275.5–1643.5, y 374–705, with 12 px #e5e1e2 handles. A 124×30 size pill (y 724–754) arrives on
  f203 and ticks the box's size: 1386×368, 1380×356, 1376×348, … 1369×332, then 1368×331 from f218. (02) at x 282
  fades in over f202–206. The CA kick: 2 px over f195–200, 1 px to f211.
- **is (f223):** set type with motion blur, not a brush. Ground #f0eee5 (#dad7d1 corners), ink #464bf5, x-height 335.
  It enters at scale 1.4 and settles (the s's height 450, 414, 389, 370, 359, 350, 344, 340, 338, 336, 335), its
  baseline tilted −11° until f228 while the slant climbs −1.1, 1.7, 4.6, 7.3, 9.8, 11.9, 13.5, 14.6, 15.3, 15.6°. At
  rest (f233) the tittle is at (874, 347). (03) at x 730 fades in over f228–232. From f235 the tittle zooms about
  (868, 328): widths 58, 63, 71, 84, 106, 141, 200, 297, 455, 716, 1147 px, its centre moving to (914, 527), smears
  38 / 66 / 112 px. Blue from f246 (a sixteenth), held 5 f.
- **CODE (f251):** ground #3037f2 (#2b33da corners), ink #f3f0e7, x 561–1321, letters 181 / 192 / 187 / 139 px wide.
  A 68×304 cursor at x 1352–1419 shows on f251, 253–254, 258–261 and 266–272. Code lines scroll behind at 15 px/f:
  12 lines of the reel's own recipe (expo, the shutter, the accumulator; verbatim in [02]). The letters scramble and
  lock on f253, 256, 259, 262. Glitch hits on f251, 258 and 265: R/G splits of 12 10 9 8 7 6 6 | 13 11 10 8 6 6 6 |
  14 11 10 9 8 px (×0.85 a frame, 0 by f270), 10–60 px slices shifted ±10–40 px, ghosts on f251–252, 255, 261, 265.
- **Out, a CRT collapse:** scaleY 0.98 / 0.80 / 0.55 as luma climbs 149→218; a 6 px line on f274–275, 1804 px wide on
  f276, 54 px with a glow dot on f277; a dot on f278 (10 px [02], 14 px [03]); cut on f279 with a −4 px split.
- Evidence: `02/work/crops/{every-build-a,frame-box-early,frame-pill,is-in,is-cut,code-bg,crt-off}.png`,
  `01/work/every.jpg`, `02/work/strip60/`.
- Build: `RiseWord`; `WeightWord` inside `SelectionBox`; `SlantWord` (its tittle a separate circle) into
  `FieldSwell`; `ScrambleText` with glitch `hits`. Unresolved: `RiseWord` ships width 92%, where [02] read EVERY as
  Archivo at 125%; match the ink span (x 203–1738 at cap 318) before trusting either. At 30 fps keep the stagger
  continuous (1.5 f is 25 ms), the tittle zoom is ≈6 frames at ×2.5 each, the glitch decay is ×0.72 a frame, hits land
  3–4 frames apart, and the CRT line needs a frame of its own.

### Bar 3: 03 — GENERATIVE GRID (f279–391) [03]

A 19×11 field of glyphs on a 100 px pitch, cell centres at (959.5 + 100i, 539.5 + 100j), over #101013 (#0f0f11
between cells), in #eae7de, #3238eb and #e64c23. Each beat a wave carries a new shape through it. Shapes as a rounded
stroke (length L, width w, radius r, angle θ): DOT L = w = 45, r 22.5; PLUS 64×20; X; DIAMOND 55, r 9, 45°; SQUARE 64,
r 12, 90°. Ink covers 17 / 19 / 23 / 40% of the frame by beat. The camera punches 1.031 and 1.032 (τ 6.6 f) on beats 9
and 10, ≈3% under the flash on beat 8, not at all on 11.

- **Beat 8 (f279):** the CRT dot becomes a flash: #6a6a6c, then #919191 (#999 centre, #878787 corners), then ×0.65 a
  frame (#656567, #474749, #333336, #272729, #1d1d1f), gone by f288; peak 57%. An outer ring runs out at 44.5 px/f
  (22 px, 17%, τ 4.6 f, gone by f291), an inner one (16–27 px) at 29 px/f, gone by f287. Dots are born by distance,
  f = 281.0 + 2.27·r (r in cells), the corners on f304.4; each grows 0→53 px by +9.5 f and settles to 45 by +17,
  #e64c23 on its first frame and cream from +2. Scale 1.012 on f283, 1.000 by f298. f307 is a double exposure.
- **Beat 9 (f308):** a wave at f = 305.2 + 3.14·r (edges f321, sides f333, corners f337). Each cell morphs through
  its clip: +0 fill, +1–2 squircle, +3 quatrefoil (54.5 px, +21%), +4 fat plus, +5–6 plus, +7 lavender, +8 cream. 29%
  of cells are blue at f330.
- **Beat 10 (f336):** a diagonal wave, each cell's half-point at f = 361.0 + 1.75(i + j), the front at 40 px/f. Cells
  turn 0→43° over 6 f, passing octagon, round and diamond over +4…7, and grow 55→62 over +7…13. 21% red, 8% blue.
  Past i + j ≈ 5 the cells are still plus signs when the beat ends.
- **Beat 11 (f364):** inward from the edges, half-point at f = 379.6 − 1.16·r (13 f from corners to centre). Each cell
  snaps to a square (progress 0.16, 0.42, 0.62, 0.78, 0.91, 1.0), overshoots 2° over +7…10, is home by +18 and grows
  62→72. 11% red, 5% blue; colour trails shape by 5 f. The centre cell reads 45° on f383, 48° on f386, back by f390.
- **Out (f392):** a layout match: the squares become bar 4's column tops seen from overhead. +1.25% scale; splits of
  ±2 / ±1.2 / ±1 px on f392 / 394 / 396.
- Evidence: `03/work/tiles/{morph,swirlcells,c00}.jpg`, `03/work/strip-*/`.
- Build: `GlyphField` (`glyph-field.tsx`) with `GLYPH_SHAPES`, waves from `glyphWaveArrivals`, `FieldFlash` and
  `ShockRing`; `glyphFieldLayout` feeds the match cut and bar 7's implosion. [03]'s wave fits: beat 8 from its line
  + 2 f at 0.038 s a cell; beat 9 from its line − 2 f at 0.0523 s a cell; beat 10 along (1, 1)/√2 at 0.0292 s a step;
  beat 11 from the edges at 0.019 s a cell, the turn on `springBy(0.09, 0.3)`. Flash 0.57 with τ 2.3 f; ring 2670 px/s,
  22 px, 0.17, τ 4.6 f, the inner ring at 0.65× its speed. At 30 fps keep the delays continuous, give the newborn
  orange at least 1/30 s, and the flash reads 1.0, 0.42, 0.18, 0.07; the ring moves 89 px a frame.

### Bar 4: 04 — 3D / DEPTH (f392–503) [04]

The grid's squares, seen from overhead, are the tops of rounded columns (pitch 101.3 → 100.7 px). The camera tilts
into 3D while an orange ball bounces across the tops, one bounce a beat, then leaves in a whip.

- **Beat 12 (f392):** a hold over f392–396; yaw from f396, push from f398, tilt from f402. The columns extrude from
  f404 at 0.7 pitch a frame. The ball's shadow appears on f401, the ball ≈6 f later at 83 px/f; it lands on f420.
- **Beats 13–15:** contacts on f420, 448, 476, squashing 188×165 / 198×157 / 189×147 px (h/w 0.88 / 0.79 / 0.78;
  de-projected y 0.87 / 0.74 / 0.73, xz 1.07 / 1.13 / 1.14). Each punches the camera +1.9 / +0.67 / +0.79% with a
  2–4 px jolt over 3 f. Apexes on f436 (313 px up) and f464 (361); drops of 29 / 115 / 291 px; g 3.6 px/f² on screen,
  125 pitches/s²; impact ≈50 px/f.
- **Beat 14:** the camera pans 3.5° (8 px/f over f468–470) and pushes in from +39 to +44% over f459–476.
- **Beat 15:** the ball launches through (1165, 461), (1358, 298), (1606, 199), (1783, 147), stretched 1.45:1, gone by
  f495–498. The camera pans on the sixteenths, 2.1° over f485–489 (+69 px) and 2.4° over f490–494 (−76 px), and holds
  f495–496. The whip starts on f497 at 0.5 / 1.2 / 2.3° a frame (−16 / −37 / −74 px/f) and blurs over f500–503
  (150–300 px, edges 3→6→9+ px wide) into bar 5's bands.
- **Camera:** focal length 2250 px (vertical FOV 27°). Elevation 90° to f402, then 78 (f408), 68 (f412), 58 (f416), 48
  (f420), 39 (f426), 33–35 (f430–436); yaw −5, −19, −28, −31, then 36°; scale +30 then +39%; distance 17.8 then 9.7
  pitches. Its rates peak over f411–419 (1.2–1.3° / 1.46% / 2.5° a frame): one in-out cubic over f396–436.
- **Columns:** 0.64 pitch square, bevel 0.1, 0.6–3 pitches tall and churning; 83.7% cream (tops #d4ccbe), 12.0% red
  (#c23b20, sides #6c1e16), 4.3% blue (#1f2192, sides #171873).
- **Ball:** #d64629 / #ec542c with a #69271f core; reflections #ea836f, #fdf5f0, #ffc6fd, #f8ca6c, #591635.
- **Light:** a soft key from the upper left, tops : lit : shaded faces ≈1 : 0.85 : 0.45 in linear light (#9e9792,
  #918a82, #6a625d), violet bleed #2d1f53, fog #120d16 over ground #0c0604; the pool reads in bands of 58–70, 118–123,
  154–177, 174–187, 189–201, 189–192, 166–173, 136–138 luma. DOF: edges 3 / 4–6 / ≈4 px, aperture ≈0.17 pitch.
- Evidence: `04/work/{t_rise_392,t_drop_410,t_shadow_444,dof465,z436_ball,t_exit_484,z_ca}.jpg`,
  `04/work/{flow_cum,lattice}.tsv`, `04/work/ball_*.tsv`, `04/work/strips60/`.
- Build: `column-field.tsx` (planned) on `ThreeStage`: an `InstancedMesh` of `RoundedBoxGeometry(0.64, 1, 0.64, 3,
  0.1)` with a per-instance height attribute, heights `rise·(0.6 + 2.4·noise(i·0.35, j·0.35, t·0.8))`, each rising
  from f404 + r/42. Ball squash s 0.13 / 0.26 / 0.27, peaking 25 ms after contact and gone by 70 ms. A crane-orbit
  move from 0.14 to 1.56 beats after the downbeat; punches as fov × (1 − a·e^(−Δt/25 ms)). A `DirectionalLight` with
  a 4096² shadow map, bias −0.0005, normalBias 0.02, radius 3–4; `Fog('#120d16', 18, 34)`; a violet hemisphere
  light; AO and bleed baked per instance. The ball: `MeshPhysicalMaterial` #e8461f, roughness 0.3, clearcoat 1,
  clearcoat roughness 0.05, its own PMREM room. Depth of field and motion blur by accumulating 8–16 Halton samples
  (aperture disc 0.085 pitch); `BokehPass` only as a fallback (focus 17.8, aperture 6e-4, maxBlur 0.006, 0.02 in the
  whip). At 30 fps squash peaks on contact + 1 frame, and the fast moves need ≥8 sub-frames.

### Bar 5: 05 — VARIABLE FONTS (f504–615) [05]

Seven full-width bands (154.3 px each) of MOTION between dots, scrolling in alternate directions and breathing
between light-condensed and heavy-wide. Band 3 (y 463–617) is the hero. Cap 110 (0.71 of a band, 22 px above and
below); dots Ø19–20. Bands are blue #3a3cf4 or cream #efece6, each band's type in the other colour (cream on blue
reads #e9e8e6, blue on cream #4244ec); the hero is #ee4c2f with #1c0a16 type; dots are accent (#e34840 on blue,
#e9553c on cream).

- **Breath:** period 52.5 f (0.875 s, off the beat), lagging 2.8 f a band; each word swells over 19–20.5 f, the front
  travelling 31 px/f with a wavelength of ≈1,600 px. The hero word's width is 528.5 + 159.5·cos(2π(n − 531.5)/52.5)
  px. The dots slide ±150–300 px as the words swell (gaps 11–73 px).
- **Drift:** −3.9, +3.8, −3.9, 0, −4.0, +3.8, −3.8 px/f by band (231 px/s); the hero holds.
- **Kick** on each beat: ±26–29 px, sign (−1)^(band + beat), by frame 1, .46, 0, −.12, −.30, −.30, −.22, −.10, 0 of its
  peak: a damped cosine, A 38 px, 4.9 Hz, τ 61 ms.
- **Beat 16 (f504), in:** the bands arrive from the right as the whip ends, left edge x = 1920·0.79^(n − s_k), with
  starts s_k = 500.1 / 501.3 / 502.5 / 503.6 (1.2 f apart). On f504 the edges sit at 765 / 1011 / 1334 / 1761; the
  hero's runs 765, 606, 479, 378, 302, 240, 190, 150, 120, 95, 75, 60, 47 … 0 (f529). The whip before it moves −4, 0,
  −4, −16, −36, −72, −128, then ≥160 px/f.
- **Beat 17 (f533):** stripes, alternate bands swapping ground and type; kicks +26 / −23. f532 is a 24% blend.
- **Beat 18 (f561):** oblique 11.3°; word gaps 13–15 px, words 290–815 px of ink, dot gaps 24–38 px; kicks +28 / −25.
- **Beat 19 (f589):** kicks +29 / −28. The hero word holds and tightens 667 → 551 → 538 px (τ 2.4 f), stems 28 px.
  The other bands fly out from f601: ±1 at ×1.62 a frame over 14.4 f (2, 4.5, 9.5, 16.5, 28.5, 47, 78, 128, 208, 339,
  549, 891, 1445 px), ±2 at ×1.715 over 12.9 f from f602.8, ±3 at ×1.85 over 11.3 f from f604.4, all clearing on
  f615.7. The hero band closes on the word (152 px to f608, then 148, 148, 140, 132, 112, 80, 16, 0) over #f2eee6.
- **Out (f616):** the held word (x 691–1228, y 485–594) becomes bar 6's particles.
- Evidence: `05/work/{kymo_b0,flip532,ital}.png` and siblings, `05/work/{ent_1,ex_a}.jpg`, `05/work/strip60/` (whose
  labels run a frame early; see Gotchas).
- Build: `TickerBands` (`ticker.tsx`) with `TICKER_LIGHT`, `TICKER_BOLD`, `TICKER_HOLD` and `TICKER_LOOKS` (plain,
  stripes, oblique 11.3°, hero hold); rows laid out from Archivo's advances (`layoutGlyphLine`, `ticker-archivo.ts`),
  spans placed by translateX. At 30 fps the entry and exit need `ShutterBlur` at 0.5 with 8 samples.

### Bar 6: 06 — PARTICLES ×12 000 (f616–728) [06]

The held word dissolves into points that become a sphere, a trefoil knot and a galaxy, one shape a beat. Each holds
≈16 f and morphs over 12 f to land on the beat, hitting ×1.06–1.09 and relaxing ×0.85 a frame; each landing is a
1-frame motion-energy spike (1.61 / 0.93 / 1.14 against 0.3–0.4 in the holds). The camera is locked over f616–716.

- **Word (f616):** box x 689–1230, y 480–590, cap 107, #f3f0e7. It holds over f616–618, then dissolves at 21 px/f over
  f619–643 (surging on f634–636), the N last, on f644; streaks 20–40 × 2–3 px at 40–60% luma. The cloud bursts over
  f633–638, 397→773 px wide (+46, +143, +126, +47, +14), condenses over f639–644 and lands on f645 at ×1.06 (r 332).
- **Sphere (f645):** r 313 px, dots on a 12.8 px pitch (≈6.5k points), spinning 1.9° a frame (115°/s; 11.1→10.2 px/f
  at the rim); 93% cream, 4% and 3% accents. It morphs over f661–672 in three 4 f phases: streaks of 10–20 px, a swell
  to +18% (f667), red by f666, blue on f668–670.
- **Knot (f673; [07]'s "swirl"):** a trefoil 0.54×0.60 H at (941, 555), tube σ 15 px, dots of 6.8 and 12.5–14 px.
  It lands ×1.07–1.09 and tumbles 0.9–1.4° a frame; colour ⅔ / ⅙ / ⅙, the blue gone by f696, red 27–37%.
- **Galaxy (f701):** tilted 70° (aspect 0.32–0.37), ≈920 px wide, ¾ turn per arm, 5% blue. It spins 2.4° a frame
  (145°/s) and rolls 1° a frame, its dots 10–15 px dashes. Warp out: spin −4 → −26° a frame, scale +5 / 9 / 19% a
  frame, aspect 0.33 → 0.57, streaks 40–100 px.
- **Out:** a white flash, luma 39, 77, 127, 176, 227 over f725–729.
- **Look:** point sprites 5 px in front, 3.4 px behind; the camera 5.1 radii back, FOV 40°; normal blending (mean
  (201, 66, 35) over the red); no bloom, no depth of field; streaks 0.4–0.5 of a frame's step.
- Evidence: `06/work/{z_word618_2x,z_trefoil_views,m_pop645,m_morph1,m_warp}.png`,
  `06/work/{z_sphere654,z_galaxy708}.jpg`, `06/work/s60/`.
- Build: no piece yet. [06] specs `particleMorph` as `ThreeStage` points: shapes from `glyphMask`, `fibonacciSphere`,
  `trefoil`, `spiralGalaxy`; position `lerp(A, B, easeInOutCubic(u)) + swell·sin(πu)·curl`, swell 0.06 H; colour
  `smoothstep(0.3, 0.6, u + 0.1(1 − targetY))`; landing scale 1 + 0.065·0.85^(60Δt); streaks 0.45/60 s long; fog for
  depth; the word's clip eats 0.02 H a frame; the flash 0 → 0.89 over 0.067 s, back over 0.12 s. At 30 fps: morphs of
  6 frames, a ×0.72 decay, half the sphere's spin.

### Bar 7: 07 — EDIT / RHYTHM (f729–841) [06], [07]

The recap: the reel's bars replayed live in a 2-up, a 2×2 and a 3×3, one a beat, then four sixteenth-note flashes and
an implosion. Tiles pop in fresh and keep playing; none is the previous shot scaled down.

- **2-up (f729):** the white veil decays 229, 171, 125, 87, 57, 35, 21 → 15 luma while two panels slide apart at ×0.70
  a frame (the split at 0.98, 0.86, 0.76, 0.67, 0.62, 0.59, 0.56, 0.54 W; 99% home by f742). The HUD tones by panel.
- **2×2 (f758):** tiles of 942×522 with 12 px margins and gutters (x 12–953 | 966–1907, y 12–533 | 546–1067) on
  #0d0d0f. They pop in z-order on f758, 760, 762, 764, each scaling about its centre on a back-out (s ≈1.95): BR's
  width runs 719 (0.763), 788, 845, 888, 922, 945, 962, 968, 970 (1.030 at +8) … 942 at +15. The tiles play on: the
  grid ripples dots into crosses, the cube camera tracks the ball, the sphere grows 239 → 311 px at ×0.68 a frame
  ([07] reads Ø325), bursts (f770) and re-forms as the knot (f771–780). On f784 BR swaps EVERY (card #f04d24, ink
  #1a0502) for an orange FRAME. The whole frame splits on f758–760 (R↔G 10–12 px, R↔B 19–23).
- **3×3 (f786):** cells of 640×360, tiles 624×344 (8 px inset, 16 px gutters). By rows: ball, FRAME, grid / cubes,
  "is", bands / knot, CODE, galaxy, so the centre column reads FRAME / is / CODE. They pop along anti-diagonals from
  the top left (f786, 787, 789, 791, 792), from lower: the "is" card's width runs 0.635, 0.755, 0.849, 0.923, 0.978,
  1.016; CODE peaks at 1.035 on +6 and is home by +13. Split ±9 px on f787. On the "and" (f800) the exits start: the
  tittle swells into a blue disc filling its card (f801–808) and code glyphs scramble in it (f812–813); CODE powers
  off like a CRT (f805–812); the galaxy bursts from its core (≈1600, 900), streaks 30 → 100 → 200+ px, whiting out to
  ≈#dcdcdc by f813; FRAME's tile swaps to "is" on f813.
- **Flashes (f814), one a sixteenth:** CODE on f814–820 (#3139ec, cap ≈300, slices up to 100 px, split 12–16 px);
  the cubes inverted on f821–827 (#d2d5d1, split 24–30 px); the knot on f828–834 (split 17–26 px); the implosion on
  f835–841: bar 3's grid collapses (extents 1388×843 → 846×511 → 162×74 px, scale 0.76 → 0.47 → 0.09, turning −13 →
  −22 → −36°, streaks 50–250 px) into a red "+" of ≈20 px. No burst lines.
- Evidence: `07/work/{m_758,m_840,m_vortex}.jpg` and the other `m_*.jpg`, `06/work/m_recap.png`.
- Build: `RecapGrid` (`recap.tsx`: `order` 'z' or 'antidiagonal', `backOutEase`, exits 'pop', 'crt' or 'cut'; margins
  12 / 8, gutters 12 / 16, popping from 0.76 / 0.65), each tile a live bar; `GlitchFlash` for the sixteenths; the
  implosion from the `GlyphField` layout, 1 − x² over 0.067 s. At 30 fps each flash gets 3–4 frames, the implosion 2.

### Bar 8: 08 — HIRE ME (f842–953) [07]

- **Flash (f842):** grey #a4a4a4 (#949494 edges), falling as (1 − k/8)² to f850.
- **Title:** CLAUDE, cap 220 (20.4% H), #f2efe6, Archivo 900 at width 125%, ≈−0.03 em. Its letters rise 240 px
  through a clip at y 567 at ×0.85 a frame, starting on f842.1, 844.8, 847.8, 850.5, 853.2, 855.9 (≈2.7 f, 46 ms,
  apart), readable by f860, with a colour fringe to f856. A push-in of ≈2% over f858–906. The HUD label decodes over
  f843–858.
- **Beat 29 (f870):** the rule (#474749, y 607–608, x 276–1643) draws from f866 at ×0.80 a frame; the mono sub-lines
  (cap 24, #f0eeea and #8b8b8d) decode over f870–894.
- **Beat 30 (f898), the full stop:** a Ø65 #e94d24 dot at x ≈1600 falls from ≈f880 at 4.1 px/f² (47 → 67 px/f),
  stretching h/w 1.36 → 1.63 (width 56 → 51). It hits on f898 and squashes 2.02:1 (107×53) on f899; a ground ring
  (4.6:1) grows 118 → 171 px over f900–904, gone by f906; the frame shakes 6 then 3 px over f898–902. It bounces to a
  72 px apex on f908 and lands on f915 (g 3.3, restitution 0.3), squashing 1.55 / 0.94 / 1.06, round by f927, and
  drifts x 1602 → 1606 to rest at (1606, 515).
- **f912:** the status line (#d3d1d0, mono cap 16, a Ø15 bullet) and the tagline (#c8c8c9, light italic, x-height 22)
  rise 8 px over 15 f.
- **Beat 31 (f926):** hold to f946; fade 0.97, 0.92, 0.83, 0.72, 0.58, 0.42, 0.22 over f947–953; black on f954.
- **Lockup:** y 326–773, x 286–1561; baselines 654 / 762 / 767; sub-lines from x 279 and to 1639; status at x 280;
  the tagline ends at 1637. Bloom: +15 luma within 40 px of the title.
- **Music:** an accent at 15.00–15.08 s (+4 dB), then −16 / −27 / −35 / −53 / −67 dB; black and silence land within
  3 f of each other.
- Evidence: `07/work/{c_title,c_dot,c_dotzoom}.jpg` and the other `c_*.jpg`, `07/work/outro.txt`.
- Build: `RiseWord` (cap 220, 900 at width 125, −0.03 em, 0.7 s, 46 ms apart); the rule on `seg` over 0.5 s;
  `ScrambleText` in mono over 0.4 s; the stop from `bouncingBallAt`'s physics (in the showcase the needle strikes it);
  `Shake`; `FadeToBlack`. Bloom as a CSS drop-shadow (0 0 30 px at 15%); the italic needs Archivo Italic. At 30 fps
  the fall moves 134–142 px a frame, the stagger rounds to 0, 1, 3, 4, 6, 7 frames, and the fade takes 4 frames.

## The foil: GPT's reel (16.80–31.82 s) [gpt]

144 BPM (25 f a beat from 0.202 s), six slides on a 150 f timer, picture leading sound by 3.6 f. Five of its seven
changes are one 7 f left-to-right wipe (edge at 7/22/41/62/80/94/100% of the width). Every slide enters alike: both
headline lines at 40% opacity, 106 px left, easing home over 25 f, line 2 from +5 f; then the text is frozen for
76–80% of the slide while the object idles at 25–35°/s. [gpt]'s diagnosis: on the beat but not cutting (8 changes in
36 beats); one program with the content swapped; almost nothing moving while the copy says it does; chrome as loud as
the idea (15–24 px caps at the headline's luma, all over the frame); no type scale; a fine palette (#c9fe25 over
#090b08 and #ebede1) whose ground changes on a timer. Worth stealing: slide 4's beat pump (+12% on the beat, back over
8 f), the triptych (a word every 2 beats, hard cuts flipping the ground, outline echoes), a ground-colour wipe with an
accent edge (`ColorWipe`), and the chrome material (metalness 1, roughness ≈0.1, a #c9fe25 area light, white strips).

Where [gpt] disagrees with the Claude studies, the studies measured it:

- the "is" is set type with motion blur [02], not the brush that [gpt], [reels] and the video's transcript describe;
- 16 of 18 cuts sit 0–1.2 f after the 128 BPM lines [hud]; [gpt]'s "12 of 18 at −2 to −3 f" uses [index]'s grid;
- caps run 220–318 px, plus the "is"'s 335 px x-height, measured per word (Type); [gpt] gives 227–321;
- the HUD's alphas give luma ≈135–159 [hud]; [gpt] reads 125–153;
- the accents' flat centres are #ef4c22 and #3037f2; [gpt]'s #e34920 and #3138eb are [index]'s means.

## Gotchas

- **SSAO and GTAO are nondeterministic** from render to render: bake AO per instance [04].
- **`BokehPass` blurs linearly with depth**, not by a lens's circle of confusion, so the far field over-blurs;
  accumulate aperture samples for real depth of field [04].
- `PCFSoftShadowMap` is gone as of three r186: use PCF with a shadow `radius`. Scaling a `RoundedBoxGeometry`
  stretches its bevel: set height per instance [04]. FilmPass, GlitchPass and AfterimagePass break determinism, and
  `CameraMotionBlur` shifts colours [reels].
- **Overlay grain is invisible on near-black:** `FilmGrain` blends overlay, which leaves #0a0a0c almost untouched.
- **Archivo's width floor is 62%:** anything narrower, like the ticker's light pose, takes scaleX on top [05].
- **[index]'s grid is off** (see Clock), and four of its 18 "cuts" aren't cuts: 4.083 s (the tittle's blue), 5.133
  and 5.600 (punches), 12.100 (the white ramp). It misses the flashes on f821 and f835.
- **`renderStrip` at 60 fps** seeks with `-ss (first/fps).toFixed(4)`, which rounds up when first ≡ 1 (mod 3): the
  strip starts a frame late and every label reads a frame early (`05/work/strip60/` labels f504 as 8.383 s). The work
  strips also fit their own beat grids: trust their frame numbers, not their beat labels.
- Flaws not to copy: accent on accent (the HUD's lit square over orange), HUD text vanishing over paper tiles, and
  sub-frame blends on cut frames (f307, f532).
