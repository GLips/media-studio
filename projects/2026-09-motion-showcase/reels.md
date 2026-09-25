# Showreel register: prior art, the reference reel, and building the look in Remotion

For the Painful Pleasures buy-box piece (15–20 s, 1920×1080, Remotion 4.0.525 + three 0.186, over hi-DPI captures).
Tags: **[CAB]** `.agent_cache/resources/JohnHeibel/ClaudeAnimationBase`; **[HF]** `.agent_cache/resources/heygen-com/hyperframes`
(bare `rules/`, `blueprints/`, `examples/`, `transitions/`, `adapters/` are under `skills/hyperframes-animation/`); **[R]**
Remotion docs/source; **[ours]** this repo; **[measured]** from the reference reel with ffmpeg; **[own]** my knowledge or
inference, unverified. Untagged claims in §1 are [CAB], in §2 [HF]. URLs are in §5.

## 0. The reference reel, measured

Claude's half of x.com/shneural/status/2103151003272962130 (the first ~16 s; cached in `.agent_cache/videos/after-opus-5-5-…`).
- **Cuts sit on a 128 BPM grid** [measured]: ffmpeg scene cuts at 3.25, 3.72, 4.57, 5.60, 8.40, 9.35, 9.82, 12.63, 13.57 s =
  beats 7, 8, 9¾, 12, 18, 20, 21, 27, 29 (0.469 s a beat); 8 of 9 sit 23–37 ms early (one constant offset), the odd one
  a sixteenth early (HF's "anticipated" beat, §2.1). Shots run 1, 4, 6, 2, 1, 6, 2 beats: quick pairs, then a 6-beat hold.
- **Palette** [measured]: ground `#0C0C0E`, red-orange `#EE4C23` (card, ball), electric blue `#4144F4`, cream `#F3F0E7`,
  warm ink `#140B0E` on the red card. No acid green in Claude's half (that's GPT's).
- **HUD on every shot** [measured, full-res crops]: 1–2 px L-brackets, ~24 px arms, 43 px in from each corner; ~14 px mono
  caps (10–11 px tall, 0.63 em a character: barely tracked), scramble-decoding in, RGB-fringed ~1 px: `CLAUDE  MOTION REEL
  2026` top-left, `128 BPM  60 FPS  1920×1080` top-right, timecode `00:00:11:18` + four 8 px beat squares at a 15 px pitch
  (current one red) + a 1 px progress rule bottom-left, `07 — EDIT / RHYTHM` bottom-right, naming the craft on show.
- **Type**: one heavy grotesk at ~400 px (`EVERY` spans ~80 % of the width), a rule under it, a tiny `(01)` tag.
- **One idea per shot, never still**: a ball drops with squash, dotted arc, onion-skin ghosts and smear, its last bounce
  swelling into the full-bleed `EVERY` card → `FRAME` → a blue brush `is` on cream → dot grid → cross/diamond grids → cube
  field, rolling red ball, DOF → `MOTION` ticker bands → particle sphere → swirl → 4-up recap → radial burst → `CLAUDE.`

## 1. ClaudeAnimationBase (JohnHeibel) — p5.brush character kit

The kit behind the "I'm Upping My P(doom)" music video (README.md): Clawd painted with p5 + p5.brush, rules in
`ANIMATION_GUIDE.md`, engine in `src/core.js` + `src/timeline.js`, a puppeteer renderer in `render.mjs`. Its rules forbid
text and 3D (§1 "Never project 3D", §2 "No text"), so it didn't make the reel's type or cube field, but the reel's ball,
brushed `is` and beat discipline read as its vocabulary [own inference].
- **Structure**: `PROJECT = { duration: 11, bpm: 120, offset: 0 }` (`src/config.js`); `shots([[t0, fn], …])`, each
  `fn(t, lt, dur)` painting the whole frame; "no counters, no `Math.random()`, no physics that integrates frame by frame".
  Storyboard as reads, "one read at a time", "fast actions, slow meanings" (the demo's ending re-timed from 1.3 s to 4.05 s).
- **Timing vocabulary** (`src/core.js`, closed form):

| helper | formula | used for |
|---|---|---|
| `ease` / `easeOut` / `easeIn` | smoothstep / 1−(1−x)³ / x³ | default keys / arrivals / iris close |
| `backOut` | overshoot s = 1.9 | pops, lifts, emotes |
| `spring(t,t0,k=6,w=18)` | e^(−6Δ)·sin(18Δ) | follow-through; `ring()` = one kick per event |
| `pulse(t,k=6)` / `pulse2` | e^(−6·frac(beat)) on beats / eighths | everything idles on the beat |
| `onTwos` | floor(12t)/12 | hold drawings 2 frames |
| `shakeXY(t,a)` | hash per 1/24 s | impact: a = 7·e^(−7Δ) px |
| `jump()` | crouch 0.12 s (sq +.18), stretch −.16, parabola, land .22·e^(−8a)·cos 20a | the squash-and-stretch ball |

- **Camera never dead**: template `camBegin(960 + 20·sin(.6·lt), 540, 1 + .02·lt)` = ±20 px drift at ~0.1 Hz plus a 2 %/s
  push (guide §Build); demo impact = zoom 1 → 1.07 by 1.85 s, back to 1.03 at 2.05 s, + 7 px decaying shake (`demo.js`).
- **Transitions always** (rule 6; a plain cut only on action or a deliberate smash cut). `brushWipe(p)`: 5 fat strokes
  rotated −0.1 rad, per-stroke delays [0, .14, .06, .18, .10], cover p 0→.5 (easeOut), cut under full cover, drag off
  .5→1; last 0.3 s of shot A + first 0.3 s of B. `iris()` 0→1500 px in 0.45–0.5 s, aimed with `toScreen()`.
- **Light and texture**: `glow()` is an additive radial texture (stops 0:1, .18:.8, .45:.32, .75:.08, 1:0, alpha 150/255):
  "stays warm on dark grounds and barely shows on light ones". Grain: a static multiply canvas (55 % of pixels darkened by
  rnd²·34 levels) + vignette. Linework re-seeds 12×/s (`BOIL`) per `boilSeed(key)`. `render.mjs` makes sheets, strips, crops.
- Rules worth adopting verbatim: "Nothing is ever still… A frozen frame reads as a bug"; "Everything moves on a beat";
  overlapping action ("the eyes lead, the body follows"); "avoid twinning" (offset phases and seeds); rhyme the ending.

## 2. HyperFrames (heygen-com)

"An open-source framework for turning HTML, CSS, media, and seekable animations into deterministic MP4 videos" (README.md):
one paused GSAP timeline per composition, seeked to `floor(frame)/fps` in any order, no `Date.now`/`Math.random`/rAF. The
craft is in skills (`hyperframes-animation`, `music-to-video`, `hyperframes-creative`, `product-launch-video`) and ~200 registry
items; examples are Remotion ports with the springs kept in comments (spring(200,12) → `back.out(2)`, (80,15) → `power3.out`).

### 2.1 Structure, pacing, beat sync
- **Shots**: a blueprint is a "time-coded shot template — `Scene N (a–b s)` with `[slots]` and one named signature move"
  (`blueprints-index.md`); "Exit animations are BANNED except on the final scene… The transition IS the exit"
  (`transitions/overview.md`); `scripts/animation-map.mjs` flags gaps ≥ 1.0 s with no active tween, tweens < 0.2 s or > 2.0 s.
- **Cadence**: "Showreel-style cuts run 1.5-4 seconds per idea" (`docs/prompting/motion.mdx`); staccato ~0.4 s a word,
  statements ≥ 1.5 s (`blueprints/kinetic-type-beats.md`); staggers ≤ 0.5 s in all; exits 0.25 s, entrances 0.4 s; a word
  holds ≥ 1 beat, a headline 3–8 (`music-to-video/references/planning.md`); "Name the pattern — fast-fast-SLOW-fast-SHADER-hold".
- **Beat sync** (`skills/music-to-video`): one analyzer (`scripts/analyze-beatgrid.py`, librosa) types drums by band (kick
  < 150 Hz, snare 150–900, hats ≥ 5 kHz), puts the downbeat where the kick is, emits a 16-step grid, energy, SURGE/DROP,
  rolls and 4-bar phrases. Laws (`references/motion-primitive-catalog.md`): "Hard hits are 0ms… Easing a hit kills it"; a
  move that must land on a beat starts ~40–190 ms early, a reaction 0–45 ms after; a camera move at most once a phrase,
  "never per beat"; "`drop` ≠ `downbeat`" (a drop replaces the system). "One beat array, not scattered offsets"
  (`rules/kinetic-beat-slam.md`); "Beats may be anticipated ~0.1s for perceived sync" (`motion-graphics/agents/director.md`).
- **Stillness, contradicted**: `docs/prompting/motion.mdx` wants 1–2 % breathing on holds: "A frozen final second is the
  single biggest cheap-motion tell" (bit-identical frames, 211 KB vs 2.5 MB encoded); `product-launch-video/…/motion-language.md`:
  "No lazy breathing… I'd rather have NO motion than BAD motion". Idle if used: scale ±0.008–0.015, y 2–3 px, 1.5–3 s,
  amplitude/√N (`rules/sine-wave-loop.md`); drift 2–8 px X, 1–4 px Y at X:Y ≈ 1.3, "organic Lissajous" (`multi-phase-camera.md`).

### 2.2 Easing and spring vocabulary

| role | ease, duration | source |
|---|---|---|
| house default | `power3.out`, 0.6 s, "the house settle — smooth beats bouncy" | `adapters/gsap-easing-and-stagger.md` |
| slam / hero hit | `power4.out` default; `expo.out` hardest snap; `circ.out` heavy rise; `back.out(2)` accents only; attacks 0.35–0.6 s, exits ≤ 0.25 s, ≥ 3 distinct eases | `rules/kinetic-beat-slam.md` |
| camera | dives/landings `power4.out` 0.6–1.0 s; repositions `power2.inOut` 1.2–2.0 s; "spring/back easing on a camera feels wrong" | `rules/3d-camera-flight.md`, `blueprints/camera-journey.md` |
| overshoot | `back.out` ≤ 2 on UI reactions only (press 1.4/2.0/2.8); never cameras, data, strokes; "Bouncy back.out is the #1 instant turn-off in agent-made videos" (the music templates overshoot anyway) | `rules/spring-pop-entrance.md`, `press-release-spring.md` |
| baked spring | 1 − e^(−ωt)(1 + ωt), ω = 2π/response; ζ 1.0 default, 0.80–0.85 "felt, not seen" (1–1.5 %), 0.6–0.7 playful, < 0.55 "Don't" | `adapters/gsap-easing-and-stagger.md` |

GSAP → Remotion: power1/2/3/4 = `Easing.poly(2/3/4/5)` under `Easing.out`/`inOut`, expo ≈ `Easing.exp` [own]; our
`motionCurves.expo.entrance` is bezier(0.16, 1, 0.3, 1), `themes/bold.css`'s `--ease-standard`. Remotion's default `spring()`
(100/10/1) is ζ = 0.5, ~16 % overshoot, HF's "Don't"; `springBy(d, bounce)` is ζ = 1 − bounce, so 0.15–0.2 is "felt, not seen".

### 2.3 Transitions and cuts
- **Tiers** (`transitions/overview.md`): calm 0.5–0.8 s `sine.inOut`, 20–30 px blur held 0.3–0.5 s (blur crossfade); medium
  0.3–0.5 s `power2/3`, 8–15 px (push slide); high 0.15–0.3 s `power4`/`expo`, 3–6 px (zoom-through). "Pick ONE primary
  (60-70% of scene changes) + 1-2 accents"; hard cuts for "Sequences of 3+ quick tempo-matched switches" (`beat-direction.md`).
- **Cut at peak velocity** (`product-launch-video/references/cut-catalog.md`): zoom-through = outgoing 1 → 1.2 + 10 px blur,
  opacity → 0.15, in 0.2 s power3.in; incoming from 0.75 + 10 px blur in 0.5 s expo.out. 10 px blur on text ("At 20px text
  smears"), 18–20 px on full-frame screenshots; cut-the-curve ±230 px at power4.in/out, 0.3 s a side; speeds within ~5 %.
- **Whip** (`rules/nudge-curve.md`, `motion-blur-streak.md`): 0.12 s power3.in to 10 % of the travel, 0.10 s linear to 75 %,
  0.35 s power4.out, swap mid-burst, `feGaussianBlur stdDeviation="X 0"` 18–20 px on the stage. Palette flip: 0 ms colour
  sets 0.6 s apart, "The motion IS the colour change; layout never moves" (`music-to-video/…/motion-primitives/palette-flip`).
- **Bans**: star iris, tilt-shift, lens flare; wipes of "grids of tiles… uniform dot arrays" (`overview.md:153`; a grid that
  *is* the content differs); "Never add: equalizer bars… strobing white on beats" (`hyperframes-creative/…/audio-reactive.md`).

### 2.4 Type, colour, chrome
- **Type** (`hyperframes-creative/references/typography.md`): display tracking "-0.03em to -0.05em… Video encoding compresses
  letter detail"; "Video needs 300 vs 900"; "You will try to use 14px. Don't," chrome excepted. Slam (`rules/kinetic-beat-slam.md`):
  150 px+ Archivo Black / League Gothic / Oswald, lh 0.96, −0.03em, "exactly one accent hue", phrases 1.2–1.8 s apart, each
  on its own axis: scale 1.5 + blur 16 px → 1 in 0.5 s power4.out; x −320 → 0 in 0.45 s expo.out; y 90 + 6° → 0 in 0.55 s
  circ.out. Spread letters by x per glyph ("animating letter-spacing reflows text and stutters"); extended with no new font:
  `scaleX(1.12)`, whipped in from `{x:150, scaleX:1.7}` in 0.24 s expo.out as "fake motion blur" (`…/split-anchor-word-slot`).
- **Closest design system to the reel**: `hyperframes-creative/frame-presets/broadside/FRAME.md`: `#111111`, fire-orange
  `#E85D26`, cream `#F0ECE5`; "Fire-orange is the only color — accent on dark, full environment on orange" (one colour a
  beat, becoming the ground); Barlow 900 at ≈ 250 px, lh 0.88, −0.04em; IBM Plex Mono chrome ≈ 13.8 px, 500, 0.14em caps;
  a 36 × 2 px "Stub accent bar — the system's only ornament"; catalogue numerals (No. 01).
- **HUD** (`registry/components/telemetry-hud`): four SVG L-brackets (≈ 86 px, inset ≈ 26 px, stroke 3 at 62 %) drawn on in
  0.5 s power2.inOut, stagger 0.08; caps labels at 0.12em, `tabular-nums` values rolled to their string in 0.5 s from a
  seeded LCG; then "the HUD breathes zero". Blink: `Math.floor(seconds / 0.55) % 2` (`registry/blocks/camcorder-hud`).
  Beat ticks flash 0.25 → 1 for 0.08 s a pulse (`rules/kinetic-beat-slam.md`). "Scenes change *inside* a frame that never
  does… Let the chrome fall away for one beat. Its absence is the accent" (`docs/prompting/motion.mdx`). Nothing in the
  repo has a frame-count timecode, BPM/FPS readout or beat lamps: that part is the reel's own.

### 2.5 Captures, depth, three.js, grids, bursts, tickers
- **Screenshots**: "Use the real screenshot instead of rebuilding the full website"; "Pushing in past 1:1 wants its own 2x
  capture" (`skills/product-launch-video/SKILL.md`). Tilt rotY 4–12°, rotX 0–6° at perspective 800–2000, scrolls 0.8–1.8 s
  on one ease (`rules/3d-page-scroll.md`); target zooms 1.5–3× in 1.0–2.0 s, "under 0.8s feels like a teleport"
  (`rules/coordinate-target-zoom.md`). `examples/demo-page-scroll-spotlight.html`: perspective 1200, `rotateY(-8deg)
  rotateX(3deg)`, "Tilt is static CSS, never tweened", shadows up to `-30px 30px 60px rgba(0,0,0,.4)`, a 1 px white rim
  at 0.1. `…/card-flyby` lands 1400 × 790 screens on beats (perspective 2400, yaw −12°), moving max(0.12, min(0.42, gap × 0.32)) s.
- **Depth**: planes travelling 0.20× / 1.00× / 6.00× plus one blur(22px) foreground occluder: "The strongest cue is not the
  blur, it is the occlusion" (`docs/prompting/motion.mdx`). Camera and DOF numbers are in §3.2.
- **three.js** (`adapters/three.md`, three 0.181.2): pinned size, `setPixelRatio(1)`, render on seek, no rAF, no "Post-processing
  passes that depend on previous frame history". Sphere: 640 instanced icosahedra on a golden-angle Fibonacci sphere at 0.5 rad/s
  (`registry/blocks/orbit-card`); swirl: 20 000 additive points in 3 arms, `theta = aBranch + uSpin*r + uRate*uTime*omega`,
  "never integrated frame to frame" (`…/spiral-galaxy`); DOF: 85 mm f/1.8 circle of confusion, racked in dioptres (`…/rack-focus`).
- **Grid** (`registry/blocks/halftone-field`): one full-screen shader; noise sampled once per 34.9 px cell sizes its dot;
  gamma 4.84 ("The gamma is the whole look"); "No accumulator, no clock, no PRNG". Dots → diamonds → crosses is one
  uniform blending its distance function L2 → L1 → cross [own].
- **Bursts**: 20 lines of 5 × 180 px at (i/20)·360°, inner radius 220 + (i%3)·30, scaleY 0 → 1 in 0.18 s power4.out,
  staggered (i%5)·0.018 s, 20 ms after the word lands (`motion-primitives/radial-burst-lines`); a crash-zoom lands with a
  [9, −7, 5, −4, 2, −1] px shake, 0.03 s a step (`…/crash-zoom-in`); chips ≤ 40, G 900–1600 px/s² (`rules/particle-burst.md`).
- **Tickers**: `registry/components/perspective-marquee` lays the list twice under `rotateX(18deg)` at perspective 900 and
  moves it −360 px in 4.5 s, linear; `registry/blocks/mk-clone-wall-transition` tiles 240 px words in brick rows offset
  half a tile, drifts −46 px in 1.8 s, and sweeps a `difference`-blend inversion across in 0.65 s.

## 3. Building it in Remotion

### 3.1 Which renderer for which layer

| layer | route | why |
|---|---|---|
| UI captures on planes (buy box, swatches, ink list, price) | **CSS 3D**: `perspective` stage + `preserve-3d` world of `<Img>` planes | resamples our 2×/3× PNGs crisply, cheap, pure function of props; DOF, shadow, sheen are per-plane leaf styles |
| fields of many objects, real light, per-pixel DOF/bloom (cube field, particles) | **raw three.js**: `ThreeStage` [ours] | scene rebuilt per frame in `useLayoutEffect`, `preserveDrawingBuffer`, `setPixelRatio(1)`, `forceContextLoss()` on unmount; one `InstancedMesh` per field; `samples` exposures averaged a frame give real depth of field (`lens`), motion blur and soft shadows; `bloom` strength 0.3–1.5 |
| a real post pass over DOM (bloom, grain, chromatic split on the captured UI) | **`<HtmlInCanvas>`** [R docs/html-in-canvas] | in remotion ≥ 4.0.455; renders use Remotion's Chrome with the flag on; Studio preview needs Chrome 149+ with `#canvas-draw-element`; no nesting; experimental: try one still first |

Gotchas:
- **Flatteners**: `filter`, `opacity < 1`, `overflow ≠ visible`, `clip-path`, `mask` or `mix-blend-mode` on the world, or on
  any wrapper between it and its 3D children, collapse every `translateZ` [HF rules/3d-camera-flight.md; registry
  motion-blur: "mix-blend-mode flattens"]. Blur, dim and blend the leaf planes; put travel blur on the stage.
- **GPU**: blur, shadows, gradients and transforms are GPU work, and headless Chrome disables the GPU unless `--gl=angle`
  [R docs/gpu]; we render with `RENDER_CHROMIUM = { gl: 'angle' }` (`lib/render-session.ts:23`). Blur cost ∝ radius × area
  [HF depth-of-field-blur.md]: ≤ 24 px on big surfaces; for a full-frame glow blur a ¼-size copy scaled ×4 [own].
- **Crispness**: text snaps to whole pixels, so slow drifts stair-step: `perspective()` + `willChange: 'transform'` [R
  docs/troubleshooting/subpixel-rendering]. Captures are 2× and "past ~1.6 text starts to soften" (`lib/studio/camera.ts`);
  a plane at depth z magnifies P/(P−z), so at P = 1000 keep what the viewer reads at z ≤ ~375 px [own arithmetic].
- **three.js determinism** (three 0.186 source): `EffectComposer.render()` with no argument hands passes a wall-clock delta.
  Render/Bokeh/UnrealBloom/Output ignore it, so `ThreeStage` is fine, but `FilmPass` accumulates time, `GlitchPass` calls
  `Math.random()` and `AfterimagePass` reads the previous frame: each breaks parallel renders. Drive uniforms from `t`.
- **Packages**: skip `@remotion/three` (needs @react-three/fiber; `<ThreeCanvas>` doesn't wait for textures [R source]) and
  `@remotion/motion-blur`: `<CameraMotionBlur>` renders the subtree `samples` times (10 at 180°) via `<Freeze>`, `opacity(1/N)`
  and `plus-lighter` [R source], "destructive to colors" [R docs]; `ShutterBlur` [ours] and `Smear` cover it, `<Trail>` = onion-skin.

### 3.2 Snippets (pure functions of t; `W`, `H`, `FPS`, `clamp`, `seg` from lib/studio)

Already in the working tree (uncommitted, another agent's): `beats.ts`, `fonts.ts` (`DISPLAY_FONT` Archivo, 100–900 weight ×
62–125 % width; `MONO_FONT` JetBrains Mono), `grade.tsx` (`FilmGrain`, `Vignette`), `three-stage.tsx`, `motion-blur.tsx`
(`ShutterBlur`), `random.ts` (`seededRandom`, `hashRandom`), `motionCurves.expo`. These fill the gaps around them.

Beat accents and depth of field [CAB `pulse()`; HF depth-of-field-blur.md: 3–6 px blur per depth step, cap 8/16/24 px, dim
to 0.55 (never < 0.35), racks 0.5–1.2 s power2.inOut, the focal plane at exactly 0 px and stacked above the rest]. At 30 fps
a 128 BPM beat is 14.06 frames: cut on `frame(n)`, never on a running count of 14.
```ts
const frac = (x: number) => x - Math.floor(x);
export const beatPulse = (g: BeatGrid, t: number, k = 6) => Math.exp(-k * frac(g.beatOf(t)));  // 1 on the beat, decaying
export const beatInBar = (g: BeatGrid, t: number) => ((Math.floor(g.beatOf(t)) % 4) + 4) % 4;  // which HUD lamp is lit
export const dofAt = (z: number, focusZ: number, pxPerZ = 0.02, max = 16) => {                    // 300 px off: 6 px, 0.73
  const d = Math.abs(z - focusZ); return { blur: Math.min(max, d * pxPerZ), opacity: 1 - Math.min(0.45, d * 0.0009) }; };
```
Stage and flying camera [HF rules/3d-camera-flight.md: one lens of 800–1200 px; one camera state, one writer; rx 30–55°
(|rx| ≤ 65, |ry| ≤ 30); dives 0.6–1.0 s power4.out, flattens 1.2–2.0 s power2.inOut, pans 0.8–1.5 s; holds ≥ 0.8 s with
2–8 px / ≤ 0.5° drift; cam z + prop z ≤ 0.6 × lens]:
```tsx
type Cam3 = { x: number; y: number; z: number; rx: number; ry: number };
export const Stage3D = ({ cam, lens = 1000, children }: { cam: Cam3; lens?: number; children: ReactNode }) => (
  <AbsoluteFill style={{ perspective: lens, overflow: 'hidden' }}>
    <AbsoluteFill style={{ transformStyle: 'preserve-3d',   // translate first, then rotate: HF's order
      transform: `translate3d(${cam.x}px,${cam.y}px,${cam.z}px) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg)` }}>{children}</AbsoluteFill>
  </AbsoluteFill>);
export const camAt = (t: number): Cam3 => {   // power4.out dive on a beat, hold, power2.inOut flatten; drift at X:Y 1.3
  const d = seg(t, 0.2, 1.0, Easing.out(Easing.poly(5))) * (1 - seg(t, 2.4, 4.0, Easing.inOut(Easing.cubic)));
  return { x: -240 * d + 6 * Math.sin(1.3 * t), y: 60 * d + 3 * Math.sin(t + 1), z: -300 + 650 * d, rx: 42 * d, ry: -14 * d };
};
```
A floating capture, its shadow a plane behind it so it parallaxes [HF ambient-glow-bloom.md sweep: ~105°, band 15–35 %
wide, peak 0.10–0.25, one pass of 0.8–1.6 s, never looping; tying it to yaw is [own]]:
```tsx
export const UiPlane = ({ src, x, y, w, h, z = 0, rx = 0, ry = 0, dof = 0 }: UiPlaneProps) => {
  const at = (dz: number): CSSProperties => ({ position: 'absolute', left: x - w / 2, top: y - h / 2, width: w, height: h,
    borderRadius: 18, transform: `translateZ(${z + dz}px) rotateX(${rx}deg) rotateY(${ry}deg)` });
  const sheen = interpolate(ry, [-25, 25], [-30, 130]);                    // band centre, % of width
  return (<>
    <div style={{ ...at(-80), translate: `${-1.5 * ry}px ${30 + rx}px`, background: 'rgba(0,0,0,.5)', filter: `blur(${32 + dof}px)` }} />
    <div style={{ ...at(0), overflow: 'hidden', filter: dof > 0.3 ? `blur(${dof}px)` : undefined }}>
      <Img src={src} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen', background:
        `linear-gradient(105deg, transparent ${sheen - 15}%, rgba(255,255,255,.22) ${sheen}%, transparent ${sheen + 15}%)` }} />
    </div></>);
};
```
Shutter. `ShutterBlur` [ours] averages whole opaque shots over a trailing shutter (0.5 = film's 180°). For one element over
another shot, HF's smear [references/motion-blur.md, registry motion-blur: N + 1 copies across t ± 1 frame (720°,
"measured" against an AE export), each 1/N, `plus-lighter` in an isolated group, the sharp frame on top; "2000 px/s at
30 fps smears 133 px"; only the 1–3 beats that snap, never text being read, never drifts]:
```tsx
export const Smear = ({ t, draw, n = 8, angle = 720 }: { t: number; draw: (t: number) => ReactNode; n?: number; angle?: number }) => {
  const span = angle / 360 / FPS;
  return (<><AbsoluteFill style={{ isolation: 'isolate' }}>{Array.from({ length: n + 1 }, (_, i) => (
    <AbsoluteFill key={i} style={{ opacity: 1 / n, mixBlendMode: 'plus-lighter' }}>{draw(t - span / 2 + (i / n) * span)}</AbsoluteFill>))}
  </AbsoluteFill>{draw(t)}</>);
};
```
Bloom [own]: a second copy of the bright bits at `blur(24px) brightness(1.4)`, `plus-lighter`, 0.6. HF's hero halo is a radial
gradient behind, inset −200…−450 px, peak 0.15–0.30, in over 0.6–1.4 s, breathing ±0.02–0.05 on 2.5–4 s (ambient-glow-bloom.md).

Grain [own arithmetic, W3C blend formulas]: `FilmGrain` uses `overlay`, which shifts a pixel by (2·noise − 1)·base, so on
`#0C0C0E` (base 0.047), at 0.32 opacity and the noise's ~0.5 alpha, it moves pixels a level or two of 255. Over dark fields
use `soft-light` (≈ 2.5× on darks) at a higher `amount`, checked on a still; reseed on twos (`floor(frame / 2)`), as CAB boils.

Odometer, $2.00 → $1.60 [HF counting-dynamic-scale.md: 1.2–2.5 s power3.out, scale 0.4–0.6 → 1, `tabular-nums` and a fixed
box "MANDATORY", no back/elastic on the number ("it's data"), the suffix gets back.out(1.4–2.0) 0.3–0.6 s after]. Each digit
is a 0…9,0 strip turning only while the digits below it roll over (in cents): the ones spin, the tens click [own]:
```tsx
export const Odometer = ({ cents, size = 220, digits = 3 }: { cents: number; size?: number; digits?: number }) => (
  <div style={{ display: 'flex', fontVariantNumeric: 'tabular-nums', fontSize: size, lineHeight: 1, height: size, overflow: 'hidden' }}>
    {Array.from({ length: digits }, (_, i) => {
      const place = 10 ** (digits - 1 - i);
      const pos = (Math.floor(cents / place) % 10) + clamp((cents % place) - (place - 1));   // carry in the last unit
      return (<Fragment key={i}>{i === 1 && <span>.</span>}
        <div style={{ translate: `0 ${-pos * size}px` }}>{[...'01234567890'].map((d, j) => <div key={j}>{d}</div>)}</div></Fragment>);
    })}
  </div>);
```

## 4. What to port, ranked by payoff for a 15–20 s product reel

Payoff = the reference's feel per unit of build; 1–6 make it a reel, 7–11 add range. Build in `lib/studio/reel/` (exists, empty).
1. **Cut in beats** [measured; HF music-to-video; CAB]: shot lengths and hits as beat numbers on `steadyBeatGrid(128)`, then
   `beatGrid(track)`: quick pairs, then a hold (the reel's 1, 4, 6, 2, 1, 6, 2); hits are 0 ms switches on `frame(n)`; moves
   that must land start 1–6 frames early; one camera move a shot. 18 s at 128 BPM = 38 beats ≈ 10 shots.
2. **`ReelHud`** over every shot, §0's layout in `MONO_FONT` [measured; HF telemetry-hud]: `PAINFUL PLEASURES  BUY BOX 2026`,
   `128 BPM  30 FPS  1920×1080`, a frame-true timecode, `beatInBar` lamps, a progress rule, `01 — SWATCHES` … `04 — MIXED
   ORDER` decoding in via `hashRandom`, ±1 px red/cyan `text-shadow` fringe; drawn on once, then still; gone on the price beat.
3. **Slam type on full-bleed fields** [HF broadside, kinetic-beat-slam]: a colour a beat that becomes the ground, flipped in
   0 ms on the cut with the layout still; `DISPLAY_FONT` 900 at 300–420 px, −0.04em, the 36 × 2 rule and `(01)`; a word or
   number a beat (`INSTANT`, `174`, `$1.60`, `MIX`) on the three entrance axes in turn; Archivo's width axis, not `scaleX`.
4. **Captures as planes under one moving camera** (`Stage3D`, `camAt`, `UiPlane`, `dofAt`) [HF 3d-camera-flight,
   card-flyby]: static tilt, a shadow plane, one sheen pass, text under 1.6×, cropped close ("Never show the whole screen",
   advids), screens landing on beats. Shots: the swatch click, "17 of 174" typed in, the tier table, the mixed order.
5. **The 174 inks as the generative grid** [HF halftone-field; the reel's grid shots]: the real colours in a lattice whose
   cells go dot → diamond → cross on beats (per-cell `clip-path`, or halftone-field's shader in a `ThreeStage` quad), a
   centre-out ripple (`stagger(i, n, { from: 'center', max: 0.5 })`), a fill flurry slowing to 0.15–0.3 s onto the swatch row.
6. **The price odometer** (§3.2), `Smear` on the strips, `19% OFF` landing after it: the one number with a hero shot.
7. **Three transitions** [HF overview.md]: hard cuts as the 60–70 % primary; the swell (a swatch dot fills the frame as the
   next shot's field, as the reel's ball becomes `EVERY`); one whip with `Smear` or 18–20 px directional blur.
8. **Ticker bands** between features [HF perspective-marquee, mk-clone-wall]: `INSTANT SWATCHES · 174 INKS ·` in 3–4 bands
   running opposite ways, each list laid twice and moved linearly, one `difference` sweep on the downbeat.
9. **One `ThreeStage` shot** of 2–4 beats [HF orbit-card, spiral-galaxy, rack-focus]: instanced ink-coloured cubes with a
   red ball rolling through, the `lens` focus racked with it, light `bloom`; or the Fibonacci sphere easing into the swirl.
10. **Radial burst + landing shake** on the hero hit (§2.5), and an **ink-drop intro** on CAB's `jump()` numbers with the
    dotted arc and onion-skin ghosts drawn from `t`.
11. **Guard against "static"** [HF animation-map, motion.mdx; CAB render.mjs]: flag ≥ 1.0 s with no tracked motion (from
    `lib/motion-tracks.ts`, beside `hold-check.ts`) and runs of bit-identical frames (tracks can't see `ThreeStage`); run
    `reel-study` on our render against the reference's cut residuals and per-beat motion energy; contact sheets first.

Don't port: HF's seek runtime and GSAP (map eases per §2.2); CAB's no-text and no-3D rules; `@remotion/three`,
`@remotion/motion-blur`; overshoot on cameras, numbers or strokes; tile or dot-array wipes; EQ bars, beat strobes, idle breathing.

## 5. Sources outside the two repos

- [R] https://www.remotion.dev/docs/ + motion-blur/camera-motion-blur, motion-blur/trail, gpu, three, html-in-canvas,
  troubleshooting/subpixel-rendering; https://github.com/remotion-dev/remotion (`packages/motion-blur/src/CameraMotionBlur.tsx`,
  `packages/three`). three 0.186's passes read in `node_modules/three`.
- 180° shutter as the film norm (search summaries only): https://www.provideocoalition.com/tip_create_cinematic_motion_blur_in_after_effects_and_in_life/, https://www.premiumbeat.com/blog/motion-blur-premiere-pro/.
- "Never show the whole screen" and a 57 % floating-3D / bento-void figure for SaaS launch videos (search summary only):
  https://www.advids.co/blog/30-creative-saas-launch-video-examples-to-hype-your-saass-debut.
