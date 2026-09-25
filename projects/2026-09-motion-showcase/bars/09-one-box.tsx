// Bar 9, 09 — EDIT / RHYTHM: the finale, an accelerando that brakes, as the reference reel's is. Four bars replay
// live in a 2×2 on the downbeat's "and", then all eight in a 3×3 on 1, hitting together on its "and". COLOR, BUY
// MORE and PAY LESS. flash on 2's sixteenths, and the ink field implodes into a red plus. From 3 the end card builds
// by half-beats, as the reference's does by beats: ONE BOX, cut out of a grey flash, rises cream on black over a rule,
// the URL decoding under it, then PAINFUL PLEASURES; on 4, the music's last hit, the needle tattoos the full stop in
// red. The card pushes in to the strike, then holds as the music rings out, the red dying and grain rising, to black.

import type { CSSProperties } from 'react';
import {
  FPS, H, REEL_SHUTTER, SFX, W, clamp, lerp, motionAttrs, motionCurves, motionEchoAttrs, seededRandom, shutterTravel,
  type Point, type Rect,
} from '../../../lib/studio/api.ts';
import { GlyphField, ShockRing } from '../../../lib/studio/reel/glyph-field.tsx';
import { reelHudBoxPoints, reelHudToneOver, type ReelHudRead, type ReelHudSlot, type ReelHudTone } from '#models/reel/hud.ts';
import { Needle } from '../../../lib/studio/reel/needle.tsx';
import type { NeedleStrike } from '#models/reel/needle.ts';
import { GlitchFlash, RecapGrid, Shake, type RecapTile } from '../../../lib/studio/reel/recap.tsx';
import { recapTileUnder, type GlitchHit, type RecapLayout } from '#models/reel/recap.ts';
import { archivoAdvance, archivoKern } from '#models/reel/ticker-layout.ts';
import { RiseWord } from '../../../lib/studio/reel/type.tsx';
import { ScrambleText } from '../../../lib/studio/reel/type-scramble.tsx';
import type { BoundReplay } from '../../../lib/models/timeline/bind-timeline.ts';
import type { Bar, BarSound, ShowcaseClock, ShowcaseReplays } from '../bar.ts';
import { INK_FIELD } from '../ink-field.ts';
import { Field } from '../parts.tsx';
import { SHOWCASE_HUD } from '../reel.tsx';
import needleFullStop from '../sfx/needle-full-stop.ts';
import { P } from '../look.ts';

/** The finale, replaying the bars before it as the timeline cues them. */
export function oneBoxBar(clock: ShowcaseClock<'one-box'>, replays: ShowcaseReplays<'one-box'>): Bar {
  const FROM = clock.from, TO = clock.to;
  /** The last frame the reel renders, black under the reel's fade. */
  const LAST = TO - 1;
  const sec = (f: number) => f / FPS;
  const outExpo = motionCurves.expo.entrance;

  /** The bar's cues (timeline.ts): the grids, the flashes on 2's sixteenths, the field, the card, the name and the stop. */
  const { cues } = clock;
  const HIT = {
    twoUp: cues.twoUp, nineUp: cues.nineUp, flashes: [cues.flashColor, cues.flashBuyMore, cues.flashPayLess], field: cues.field,
    card: cues.card, name: cues.name, stop: cues.stop,
  } as const;

  const fill: CSSProperties = { position: 'absolute', left: 0, top: 0, width: W, height: H };
  const layer: CSSProperties = { position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' };

  // ---------- the recap ----------

  /**
   * An earlier bar replayed in a tile or a flash, as the timeline cues it (video.tsx hands the bar over). `grounds` plates
   * the HUD over a shot that is type from edge to edge, which its bar doesn't plate: its ground's colour for each tone.
   */
  type Replay = { replay: BoundReplay<Bar>; grounds?: Partial<Record<ReelHudTone, string>> };

  /** Replays popping into a grid on frame `at`, at RecapGrid's spacing and pop for its size. */
  type RecapLook = { at: number; cols: number; rows: number; tiles: readonly Replay[] };

  // Bar 5 plates only its HUD's words, but in its tile the beats and the rule cross the list's rows: plates in the
  // list card's white. Over the flood they read bare, and a blue plate there would split the rule's read from the next
  // tile's, putting it on the grid's ground from edge to edge.
  const SEARCH_GROUNDS = { dark: '#ffffff' } as const;
  // A tile busy from edge to edge under a part, whatever its bar reads there: the part sits on the grid's own ground.
  const GRID_GROUNDS = { light: P.ground, dark: P.ground, 'on-accent': P.ground } as const;

  // The reference's two grids.
  const TWO_UP: RecapLook = {
    at: HIT.twoUp, cols: 2, rows: 2,
    // The colour script in reading order, red, the product's pink, blue, red, each tile's hit on the grid's first frame:
    // EVERY rising, the pink tap flooding the card's page, the blue flood, and the −20% stamp slamming onto the poster
    // just held. Tiles with their own black ground melt into the grid's and read as litter.
    tiles: [
      { replay: replays.twoUpEvery }, { replay: replays.twoUpPinkTap }, { replay: replays.twoUpAnswer, grounds: SEARCH_GROUNDS },
      { replay: replays.twoUpStamp },
    ],
  };
  // The 3×3's tiles hit together on the "and" after it pops (timeline.ts cues them there), a second pulse inside the beat
  // before the sixteenths.
  const NINE_UP: RecapLook = {
    at: HIT.nineUp, cols: 3, rows: 3,
    // The cut's order, so the rows run the colour script: bar 1 on its last beat's "and", ONE landing on red, TAP.
    // tapped (its full stop locks a sixteenth after its cut), the graphite tap, a strike, the list card, QTY 2
    // in blue, a tier's landing, the price landing on red. The bottom row crosses QTY 2's bands, BUY MORE from edge to
    // edge, which bar 6 doesn't plate; a blue plate over their cream would let the beat squares fade.
    tiles: [
      { replay: replays.nineUpLaunch }, { replay: replays.nineUpOne }, { replay: replays.nineUpTapLock }, { replay: replays.nineUpCharcoalTap },
      { replay: replays.nineUpStrike }, { replay: replays.nineUpListLand }, { replay: replays.nineUpQty2, grounds: GRID_GROUNDS },
      { replay: replays.nineUpPlateau }, { replay: replays.nineUpLock },
    ],
  };

  /**
   * The grid as RecapGrid lays it out, for drawing it and asking what's under the HUD. All tiles pop together rather
   * than in the reference's cascade: its first frame, one small tile on black, is the empty frame the storyboard rules out.
   */
  const recapLayout = (look: RecapLook): RecapLayout => ({ at: sec(look.at), tiles: look.tiles.length, cols: look.cols, rows: look.rows, spread: 0 });

  // The reference's arrivals: the frame sliced for two frames; the lens splits it, HUD and all (`glitches`).
  const ARRIVAL: Omit<GlitchHit, 'at'> = { duration: 0.05, split: 0, slices: 6, shift: 70 };

  function Recap({ f, look, name }: { f: number; look: RecapLook; name: string }) {
    const tiles = look.tiles.map(({ replay }): RecapTile => ({ from: sec(replay.sourceFrame(look.at)), shot: (t) => replay.source.render(Math.round(t * FPS)) }));
    return (
      <GlitchFlash t={sec(f)} hits={[{ at: sec(look.at), ...ARRIVAL }]} seed={`bar-09 ${name}`} motion={`${name} arrival`}>
        <RecapGrid t={sec(f)} {...recapLayout(look)} tiles={tiles} ground={P.ground} motion={name} />
      </GlitchFlash>
    );
  }

  /**
   * A replay's read of a part at the bar's frame `frame`, asked of its bar about `box` on that bar's own frame. A plate
   * from the replay's `grounds` takes the tone that reads on it.
   */
  function replayHudRead({ replay, grounds }: Replay, frame: number, slot: ReelHudSlot, box: Rect): ReelHudRead {
    const read = replay.source.hudRead?.(slot, frame, box) ?? { tone: 'light' };
    const plate = !read.plate && grounds?.[read.tone];
    return plate ? { tone: reelHudToneOver(plate, SHOWCASE_HUD.palette), plate } : read;
  }

  /**
   * The tiles a part's box lies over at frame `f`: each one's share of the box, and the stretch of the box it holds,
   * placed in its shot. A tile scales its shot about a point, so two of the box's points in it place the rest.
   */
  function recapTilesUnder(look: RecapLook, box: Rect, f: number) {
    const layout = recapLayout(look), points = reelHudBoxPoints(box), step = box.w / 24;
    const byTile = new Map<number, { p: Point; inShot: Point }[]>();
    for (const p of points) {
      const under = recapTileUnder(p, sec(f), layout);
      if (under) byTile.set(under.index, [...(byTile.get(under.index) ?? []), { p, inShot: under.inShot }]);
    }
    return [...byTile].flatMap(([index, hits]) => {
      const a = hits[0], b = hits.at(-1)!;
      if (b === a) return [];
      const k = b.p.x !== a.p.x ? (b.inShot.x - a.inShot.x) / (b.p.x - a.p.x) : (b.inShot.y - a.inShot.y) / (b.p.y - a.p.y);
      const xs = hits.map((h) => h.p.x);
      const x0 = Math.max(box.x, Math.min(...xs) - step / 2), x1 = Math.min(box.x + box.w, Math.max(...xs) + step / 2);
      const inShot: Rect = { x: a.inShot.x + (x0 - a.p.x) * k, y: a.inShot.y + (box.y - a.p.y) * k, w: (x1 - x0) * k, h: box.h * k };
      return [{ replay: look.tiles[index], share: hits.length / points.length, inShot }];
    });
  }

  /**
   * The HUD over a grid, part by part: over one tile, as the tile's bar reads the part's box where it falls in its
   * shot. Across tiles, or off a tile's edge onto the grid's ground, the reads must agree (light inks with a paper
   * square suit a red and a dark ground alike); where they don't, the part sits on a plate of the grid's ground.
   */
  function recapHudRead(look: RecapLook, slot: ReelHudSlot, f: number, box: Rect): ReelHudRead {
    const tiles = recapTilesUnder(look, box, f);
    const onGround = 1 - tiles.reduce((sum, u) => sum + u.share, 0) > 1e-9;
    const reads = [
      ...tiles.map((u) => replayHudRead(u.replay, Math.round(u.replay.replay.sourceFrame(f)), slot, u.inShot)),
      ...(onGround ? [{ tone: 'light' as const }] : []),
    ];
    const [first] = reads;
    if (reads.every((r) => r.tone === first.tone && r.plate === first.plate)) return first;
    if (reads.every((r) => !r.plate && r.tone !== 'dark')) return { tone: 'on-accent' };
    return { tone: 'light', plate: P.ground };
  }

  // ---------- the sixteenths ----------

  // The copy's last words, each a bar's own frame, whole (timeline.ts cues them): COLOR, BUY MORE, and $1.60 PAY LESS.
  // on red, the whole poster gliding toward the stamp's place.
  const FLASHES: readonly (Replay & { at: number })[] = [
    { at: HIT.flashes[0], replay: replays.flashColor },
    { at: HIT.flashes[1], replay: replays.flashBuyMore },
    { at: HIT.flashes[2], replay: replays.flashPayLess },
  ];
  // Sliced the length of each flash and split, as the reference's are: red and blue about 16 px apart, 30 with the
  // lens's split on each flash's first two frames.
  const FLASH_HITS: GlitchHit[] = FLASHES.map((s, i) => ({ at: sec(s.at), duration: sec((FLASHES[i + 1]?.at ?? HIT.field) - s.at), split: 8 }));
  const flashAt = (f: number) => FLASHES.findLast((s) => f >= s.at)!;
  // The track plays only the beat and its "and" under the sixteenths, so the BUY MORE flash and the implode each get the
  // kit's click, 3–4 LU under the music where it lands. Each lands a frame after its picture, where the music's
  // sixteenth falls: under BUY MORE that's the track's quiet hat, which a click on the frame would flam against. Two
  // takes, so the pair doesn't repeat.
  const SIXTEENTH_CLICKS: readonly BarSound[] = [
    { id: 'click-buy-more', at: HIT.flashes[1] + 1, sound: SFX.click[0], volume: 2.1 },
    { id: 'click-implode', at: HIT.field + 1, sound: SFX.click[1], volume: 1.2 },
  ];

  function Flashes({ f }: { f: number }) {
    const shot = flashAt(f);
    return (
      <GlitchFlash t={sec(f)} hits={FLASH_HITS} seed="bar-09 flashes" motion="flashes">
        <div {...motionEchoAttrs} style={fill}>{shot.replay.source.render(shot.replay.sourceFrame(f))}</div>
      </GlitchFlash>
    );
  }

  // The fourth sixteenth: the 174 inks whole on its first frame, then twisting in to an eighth of their size by its
  // last, the red plus lit at their heart from the third, as the reference's grid does before its grey flash.
  const IMPLODE = { frames: 3.2, marker: { color: P.red, size: 36 } };

  function FieldImplode({ f }: { f: number }) {
    return (
      <>
        <Field color={P.ground} />
        <GlyphField t={sec(f)} {...INK_FIELD} implode={{ start: sec(HIT.field), duration: IMPLODE.frames / FPS, marker: IMPLODE.marker }} motion="ink field" />
      </>
    );
  }

  /** The HUD over the bar: the grids and the flashes as their shots' bars read them, then black, but for the grey flash. */
  function oneBoxHudRead(slot: ReelHudSlot, f: number, box: Rect): ReelHudRead {
    // The section label decodes in on the cut over bar 8's tile: its first cell at half strength as the tile pops in
    // smeared, then its letters over the stamp's ring of type. Bare, it all but vanishes on the first frame and is lost
    // in the type after, so it takes the grid's ground through the 2×2.
    if (slot === 'section' && f < HIT.nineUp) return { tone: 'light', plate: P.ground };
    if (f < HIT.nineUp) return recapHudRead(TWO_UP, slot, f, box);
    if (f < HIT.flashes[0]) return recapHudRead(NINE_UP, slot, f, box);
    if (f < HIT.field) {
      const shot = flashAt(f);
      return replayHudRead(shot, shot.replay.sourceFrame(f), slot, box);
    }
    // The grey flash's first frame is the one light ground; the strike's red flash takes the paper square.
    return { tone: f === HIT.card ? 'dark' : f === HIT.stop ? 'on-accent' : 'light' };
  }

  // ---------- the card ----------

  // ONE BOX set as bar 4 sets 174 INKS.: Archivo Black at width 72, caps 300 px (28% of the frame). The baseline centres
  // the lockup, its caps to the sign-off's baseline, a little above the frame's middle.
  const CARD = { text: 'ONE BOX', cap: 300, wdth: 72, spacing: -0.03, base: 610 };
  // Cap height over the em, as the type pieces set Archivo, so the letters placed here sit where RiseWord draws them.
  const CARD_SIZE = CARD.cap / 0.687;
  /** The word as the browser sets it: kerned, and tracked after every character, spaces too. */
  const CARD_LINE = (() => {
    const axes = { wght: 900, wdth: CARD.wdth }, chars = [...CARD.text], track = CARD.spacing * CARD_SIZE;
    let pen = 0;
    const letters = chars.map((char, i) => {
      const x = pen, advance = archivoAdvance(char, axes) * CARD_SIZE;
      pen += advance + track + (i < chars.length - 1 ? archivoKern(char, chars[i + 1], axes) * CARD_SIZE : 0);
      return { char, x, advance };
    });
    return { letters, width: pen - track };
  })();

  // The full stop is the reel's red drop, round, not the face's square point: 0.3 cap across on the baseline, 0.035 cap
  // past the X's advance (its side bearing adds a little), and centred with the word as one lockup.
  const STOP = { r: 0.15 * CARD.cap, gap: 0.035 * CARD.cap };
  const CARD_LEFT = (W - (CARD_LINE.width + STOP.gap + 2 * STOP.r)) / 2;
  const STOP_AT: Point = { x: CARD_LEFT + CARD_LINE.width + STOP.gap + STOP.r, y: CARD.base - STOP.r };

  // The rise: the reference's 46 ms stagger tightened to 35 so the X has landed before the needle strikes. It started
  // `lead` frames before the grey flash, under the implode, so the flash's frame catches the letters mid-rise.
  const RISE = { duration: 0.45, each: 0.035, lead: 4 };

  // The strike's ripple runs back from the dot at `speed` px/s, a letter a frame. Letters hop, less the farther out,
  // highest `peak` s after the front passes, and flush red on its frame, fading over two. Whole letters, in steps:
  // slicing across letters reads as a fault; a smooth flush pinks the word, fighting the dot.
  const RIPPLE = { speed: 8000, lift: 0.1 * CARD.cap, liftReach: 1000, peak: 1 / FPS, flush: [1, 0.35, 0.1] };
  const CREAM_RGB = [243, 240, 231], RED_RGB = [238, 76, 35];
  const inkFlush = (k: number) => `rgb(${CREAM_RGB.map((c, i) => Math.round(lerp(c, RED_RGB[i], k))).join(' ')})`;

  /** The word's letters, where each is set and its middle; the space is dropped, as it takes no turn in the rise. */
  const CARD_LETTERS = CARD_LINE.letters.filter((l) => l.char.trim()).map((l, turn) => ({
    char: l.char, turn, left: CARD_LEFT + l.x, centre: { x: CARD_LEFT + l.x + l.advance / 2, y: CARD.base - CARD.cap / 2 },
  }));

  /** A letter centred at `centre` at frame `f`: how far the ripple lifts it, px, and how red it flushes, 0..1. */
  function rippleAt(f: number, centre: Point) {
    const d = Math.hypot(centre.x - STOP_AT.x, centre.y - STOP_AT.y);
    const since = sec(f - HIT.stop) - d / RIPPLE.speed;
    if (since < -1e-6) return { lift: 0, flush: 0 };
    const k = Math.max(0, since) / RIPPLE.peak;
    // The first frame at or after the front's arrival is the letter's red one.
    const arrived = f - (HIT.stop + Math.ceil((d / RIPPLE.speed) * FPS - 1e-6));
    return { lift: RIPPLE.lift * Math.exp(-d / RIPPLE.liftReach) * k * Math.exp(1 - k), flush: RIPPLE.flush[arrived] ?? 0 };
  }

  function Word({ f }: { f: number }) {
    const t = sec(f - HIT.card + RISE.lead);
    const ripple = CARD_LETTERS.map((l) => rippleAt(f, l.centre));
    if (f < HIT.stop || ripple.every((r) => r.lift < 0.2 && r.flush < 0.004)) {
      // On the flash's frame the word is the ground's black, as if cut out of the grey.
      return (
        <RiseWord t={t} text={CARD.text} x={CARD_LEFT + CARD_LINE.width / 2} y={CARD.base} cap={CARD.cap} color={f === HIT.card ? P.ground : P.cream}
          stretch={CARD.wdth} spacing={CARD.spacing} duration={RISE.duration} each={RISE.each} motion="ONE BOX" />
      );
    }
    // While the ripple runs each letter is a word of its own, set where the word sets it and on its turn of the rise,
    // free to hop and flush alone; clipped columns of the word can't, as the X's foot reaches in under the O. No widen:
    // the word has relaxed by the stop, and a letter's later clock would still read a hair wide.
    return (
      <>
        {CARD_LETTERS.map((l, i) => (
          <div key={i} {...motionAttrs({ name: `ONE BOX ${l.turn} ${l.char}`, values: ripple[i] })} style={{ ...fill, transform: `translateY(${-ripple[i].lift}px)` }}>
            <RiseWord t={t - l.turn * RISE.each} text={l.char} x={l.left} align="left" y={CARD.base} cap={CARD.cap} color={inkFlush(ripple[i].flush)}
              stretch={CARD.wdth} spacing={CARD.spacing} duration={RISE.duration} widen={0} motion={false} />
          </div>
        ))}
      </>
    );
  }

  // On the hit's frame the dot lands whole, squashed 1.5:1 under the needle and black, as a red dot would vanish into
  // the red flash; then it springs back round in red, a frame a step, as a ring of ink runs out. Its edge is ragged as
  // ink bleeding into skin, closing fast, then settling through the hold.
  const BLOOM = { size: [1.1, 1, 1.03], ratio: [1.5, 1 / 1.15, 1.04], rough: 0.16, roughTau: 0.07, settle: 0.05, settleTau: 0.6 };
  const INK_RING = { speed: 1800, stroke: 8, opacity: 1, tau: 0.1 };
  const BLOT = (() => {
    const rnd = seededRandom('bar-09 full stop');
    return [3, 5, 7, 11].map((n) => ({ n, phase: rnd() * 2 * Math.PI, amp: (0.5 + 0.5 * rnd()) / Math.sqrt(n) }));
  })();

  function blotPath(c: Point, r: number, rough: number) {
    const points = Array.from({ length: 72 }, (_, k) => {
      const a = (k / 72) * 2 * Math.PI;
      const rr = r * (1 + rough * BLOT.reduce((sum, h) => sum + h.amp * Math.sin(h.n * a + h.phase), 0));
      return `${(c.x + rr * Math.cos(a)).toFixed(2)} ${(c.y + rr * Math.sin(a)).toFixed(2)}`;
    });
    return `M${points.join('L')}Z`;
  }

  function FullStop({ f }: { f: number }) {
    if (f < HIT.stop) return null;
    const k = f - HIT.stop, tau = sec(k);
    const r = STOP.r * (BLOOM.size[k] ?? 1), ratio = BLOOM.ratio[k] ?? 1, a = Math.sqrt(ratio);
    const since = tau - 1 / FPS;
    const rough = k === 0 ? 0 : BLOOM.rough * Math.exp(-since / BLOOM.roughTau) + BLOOM.settle * Math.exp(-since / BLOOM.settleTau);
    const color = k === 0 ? P.ground : P.red;
    const shape = motionAttrs({ name: 'full stop', values: { r, ratio } });
    return (
      <>
        {/* It leaves the dot's edge on the hit: its clock starts as far back as the dot is wide. */}
        <ShockRing t={tau} at={-STOP.r / INK_RING.speed} origin={STOP_AT} {...INK_RING} color={P.red} motion="ink ring" />
        <svg width={W} height={H} style={layer}>
          <g transform={`translate(${STOP_AT.x} ${STOP_AT.y}) scale(${a} ${1 / a}) translate(${-STOP_AT.x} ${-STOP_AT.y})`}>
            {rough > 0.002
              ? <path {...shape} d={blotPath(STOP_AT, r, rough)} fill={color} />
              : <circle {...shape} cx={STOP_AT.x} cy={STOP_AT.y} r={r} fill={color} />}
          </g>
        </svg>
      </>
    );
  }

  // Bar 4's needle, leaning 40° and running off the right edge: upright over the dot, it would read as a "!". It slams
  // down from the top right over two and a half frames, one streak on the frame before the hit, drives in and tears back
  // out. A small opening keeps it sharp tip to body.
  const NEEDLE = {
    tilt: 45, grip: 57, scale: 28, fov: 16, from: 80, climb: 15, enter: 2.5 / FPS, dwell: 1 / FPS, overdrive: 0.6, exit: 2.5 / FPS, lean: 8,
    aperture: 6, shutter: 0.25, fastShutter: 0.6, color: '#5a5e65',
  };
  const STOP_STRIKE: readonly NeedleStrike[] = [{ at: sec(HIT.stop), x: STOP_AT.x, y: STOP_AT.y, ink: P.red }];

  // ---------- the sign-off ----------

  // Under the word as the reference's sub-lines sit under its name: a rule, then a row justified to the lockup's ends,
  // the name at the left and the URL at the right, under the stop, so the eye the strike pulls there lands on it. The
  // name is the word's own face at a fifth of its cap: a brand has to read, where the reference's lines are mono at a
  // ninth. `rule` and `base` are px under the word's baseline.
  const ROW = { rule: 50, base: 150 };
  const LOCKUP = { left: CARD_LEFT, right: STOP_AT.x + STOP.r };
  // The rule draws left to right from the frame before the "and", from the name to the URL, done by the strike.
  const RULE = { weight: 2, color: 'rgb(243 240 231 / 0.32)', lead: 1, duration: 0.4 };
  // The name rises from its baseline on the "and", a letter every quarter frame, landed before the needle is in shot.
  const NAME = { text: 'PAINFUL PLEASURES', cap: 64, spacing: 0.01, duration: 0.3, each: 0.008, lead: 1 };
  // The URL decodes as the word rises: glyph noise on the flash's frame, cut out of the grey as the word is, locking left
  // to right over the next two and whole on the third, so it reads through the card's whole hold.
  const URL_LINE = { text: 'painfulpleasures.com', cap: 32, spacing: 0.08, delay: 0.02, each: 0.004, split: 6 };

  function Rule({ f }: { f: number }) {
    const t = sec(f - HIT.name + RULE.lead);
    if (t < 0) return null;
    const tip = (tt: number) => (LOCKUP.right - LOCKUP.left) * outExpo(tt / RULE.duration);
    // A thin line's tip smeared by the shutter: solid to where it was as the shutter opened, fading over the travel.
    const at = tip(t), ramp = shutterTravel(tip, t, REEL_SHUTTER, 0), solid = Math.max(0, at - ramp / 2);
    const y = CARD.base + ROW.rule - RULE.weight / 2;
    return (
      <svg width={W} height={H} style={layer}>
        <defs>
          <linearGradient id="bar-09-rule-tip">
            <stop offset={0} stopColor={RULE.color} />
            <stop offset={1} stopColor={RULE.color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <rect {...motionAttrs({ name: 'rule', values: { k: at / (LOCKUP.right - LOCKUP.left) } })} x={LOCKUP.left} y={y} width={solid} height={RULE.weight} fill={RULE.color} />
        {ramp > 1 && <rect x={LOCKUP.left + solid} y={y} width={ramp} height={RULE.weight} fill="url(#bar-09-rule-tip)" />}
      </svg>
    );
  }

  function SignOff({ f }: { f: number }) {
    const base = CARD.base + ROW.base;
    return (
      <>
        <Rule f={f} />
        <RiseWord t={sec(f - HIT.name + NAME.lead)} text={NAME.text} x={LOCKUP.left} align="left" y={base} cap={NAME.cap} color={P.cream}
          stretch={CARD.wdth} spacing={NAME.spacing} duration={NAME.duration} each={NAME.each} motion="name" />
        <ScrambleText t={sec(f - HIT.card)} text={URL_LINE.text} x={LOCKUP.right} align="right" y={base} cap={URL_LINE.cap} mono spacing={URL_LINE.spacing}
          color={f === HIT.card ? P.ground : P.cream} delay={URL_LINE.delay} each={URL_LINE.each} hits={[0]} split={URL_LINE.split} motion="url" />
      </>
    );
  }

  // ---------- the push ----------

  // The push gathers speed so the hold after the strike still moves: `linear` of it steady, the rest a square of the
  // time. The lockup's ends travel 1 px a frame as the word lands and 3 into the fade; the reference's 2% would move them
  // half a pixel. The stop's impact punches it 1.5% more.
  const PUSH = { total: 0.09, linear: 0.25, punch: 0.015, punchTau: 0.06 };
  // From the name's "and" it rushes in 3.5% more, the lockup's ends building from 2 px a frame to 6, and the strike
  // stops it dead. Until the needle slams in on the strike's last two frames, only the small name moves: the lockup's
  // own move carries those frames.
  const RUSH = { total: 0.035, linear: 0.3 };
  // The reference's closing jolt: 6 px on the hit's frame, 3 back on the next, under a pixel by the fifth. The
  // seed picks Shake's directions and rattle: this one knocks the card down and left, the way the needle drives in, and
  // swings back a clean half.
  const JOLT = { strength: 6, decay: 0.07, seed: 'stop 81' };
  const cardScaleAt = (f: number) => {
    const u = clamp((f - HIT.card) / (LAST - HIT.card)), rush = clamp((f - HIT.name + 1) / (HIT.stop - HIT.name + 1));
    return 1 + PUSH.total * lerp(u * u, u, PUSH.linear) + RUSH.total * lerp(rush * rush, rush, RUSH.linear)
      + (f >= HIT.stop ? PUSH.punch * Math.exp(-sec(f - HIT.stop) / PUSH.punchTau) : 0);
  };

  // The reference's grey flash into its end card, #a4a4a4 dying as (1 − k)² over 0.133 s, but on the card's ground,
  // under the word rather than over it: the hit's frame is ONE BOX cut out of the grey, not a blank grey frame.
  const GREY_FLASH: GlitchHit = { at: sec(HIT.card), flash: 1, split: 0, slices: 0 };
  // The strike's light: the ground flashes the brand red, flat, on the hit's frame and falls ×0.55 a frame back to
  // black, cut on the sixth; under the word and the needle so both stay sharp over it. The needle's steel mirrors it.
  const STRIKE_FLASH = { fall: 0.55, frames: 6 };
  const GROUND_RGB = [12, 12, 14];
  const strikeFlashAt = (f: number) => (f >= HIT.stop && f < HIT.stop + STRIKE_FLASH.frames ? STRIKE_FLASH.fall ** (f - HIT.stop) : 0);
  // Commas: three.js reads the needle's ground too, and not CSS's space-separated rgb().
  const strikeGround = (f: number) => `rgb(${GROUND_RGB.map((c, i) => Math.round(lerp(c, RED_RGB[i], strikeFlashAt(f)))).join(', ')})`;

  // What the flash leaves: a red glow about the stop, dying slowly through the hold, nearly gone by the fade.
  const AFTERGLOW = { opacity: 0.3, radius: 760, tau: 0.55 };
  const afterglowAt = (f: number) => (f >= HIT.stop ? AFTERGLOW.opacity * Math.exp(-sec(f - HIT.stop) / AFTERGLOW.tau) : 0);
  // The reel's grain is an overlay, which vanishes on black, so the hold's ground takes a grain of its own: cream
  // specks from the noise's top, fresh every frame, rising as the flash falls. Under the type, so the lockup stays clean.
  const HOLD_GRAIN = { opacity: 0.08, frequency: 0.45, slope: 6, cut: 0.52, rise: 6 };

  function HoldGround({ f }: { f: number }) {
    const grain = HOLD_GRAIN.opacity * clamp((f - HIT.stop) / HOLD_GRAIN.rise);
    const glow = afterglowAt(f);
    if (grain <= 0 && glow <= 0) return null;
    const alpha = `${HOLD_GRAIN.slope} 0 0 0 ${-HOLD_GRAIN.slope * HOLD_GRAIN.cut}`;
    return (
      <svg {...motionAttrs({ name: 'hold ground', values: { grain, glow } })} width={1.5 * W} height={1.5 * H} style={{ ...layer, left: -W / 4, top: -H / 4 }}>
        <defs>
          <radialGradient id="bar-09-afterglow" gradientUnits="userSpaceOnUse" cx={STOP_AT.x + W / 4} cy={STOP_AT.y + H / 4} r={AFTERGLOW.radius}>
            <stop offset={0} stopColor={P.red} stopOpacity={glow} />
            <stop offset={1} stopColor={P.red} stopOpacity={0} />
          </radialGradient>
          <filter id="bar-09-grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency={HOLD_GRAIN.frequency} numOctaves={1} seed={f} />
            <feColorMatrix type="matrix" values={`0 0 0 0 0.953  0 0 0 0 0.941  0 0 0 0 0.906  ${alpha}`} />
          </filter>
        </defs>
        <rect width={1.5 * W} height={1.5 * H} fill="url(#bar-09-afterglow)" />
        {grain > 0 && <rect width={1.5 * W} height={1.5 * H} filter="url(#bar-09-grain)" opacity={grain} />}
      </svg>
    );
  }

  function EndCard({ f }: { f: number }) {
    const t = sec(f);
    return (
      <>
        <Field color={P.ground} />
        <div style={{ ...fill, transform: `scale(${cardScaleAt(f)})`, transformOrigin: `${W / 2}px ${H / 2}px` }}>
          <Shake t={t} at={sec(HIT.stop)} {...JOLT} motion="jolt">
            {/* Looks redundant over the Field: the transforms make this its own stacking context, and the URL's colour
                split blends with what's under it here. Without a ground of its own the split goes teal. */}
            <GlitchFlash t={t} hits={[GREY_FLASH]} motion="grey flash">
              <div {...motionAttrs({ name: 'strike flash', values: { k: strikeFlashAt(f) } })}
                style={{ position: 'absolute', left: -W / 4, top: -H / 4, width: 1.5 * W, height: 1.5 * H, background: strikeGround(f) }} />
              <HoldGround f={f} />
            </GlitchFlash>
            <Word f={f} />
            <FullStop f={f} />
            <SignOff f={f} />
            {/* Out of shot, before it comes in and after it leaves, it draws nothing. */}
            <Needle t={t} strikes={STOP_STRIKE} ground={strikeGround(f)} {...NEEDLE} motion="needle" />
          </Shake>
        </div>
      </>
    );
  }

  // ---------- the bar ----------

  return {
    id: 'one-box',
    note: 'The bars replay live in a 2×2 and then a 3×3; COLOR, BUY MORE and PAY LESS. flash on the sixteenths and the ink field implodes into a red plus; after a grey flash ONE BOX rises on black as painfulpleasures.com decodes under it, a rule and PAINFUL PLEASURES come in on the "and", and the needle tattoos its red full stop on the last hit, the card jolting as red runs back through the letters; the card holds on its push as the red settles and grain rises, to black.',
    clock,
    render: (f) => {
      if (f < HIT.nineUp) return <Recap f={f} look={TWO_UP} name="two-up" />;
      if (f < HIT.flashes[0]) return <Recap f={f} look={NINE_UP} name="nine-up" />;
      if (f < HIT.field) return <Flashes f={f} />;
      if (f < HIT.card) return <FieldImplode f={f} />;
      return <EndCard f={f} />;
    },
    hudRead: (slot, f, box) => oneBoxHudRead(slot, f, box),
    kicks: [HIT.nineUp, ...HIT.flashes, HIT.field, HIT.card],
    // No split on the stop: the lens's would double the needle on its frame and the URL, already decoded, on the next
    // two. The flash, the jolt and the red running back carry the hit.
    glitches: [HIT.twoUp, HIT.nineUp, ...HIT.flashes],
    sounds: [
      ...SIXTEENTH_CLICKS,
      // The full stop is the reel's last word: it bites out of the track's quiet and rides 2 LU over the final hit's
      // tail, its sustain trimmed to keep under `studio mix`'s OVER.
      { id: 'needle-full-stop', at: HIT.stop, sound: needleFullStop },
    ],
  };
}
