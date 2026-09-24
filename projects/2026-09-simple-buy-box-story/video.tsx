// The simple-buy-box walkthrough's story cut: one shopper's visit, each beat showing today's page and the new one.
// See storyboard.md for the plan and what was checked against the theme, and voiceover.json for the words. Scene
// times are seconds from each scene's start; beats anchor to speech (`s.line(id).at(f)`, `.word(…)`), so they stay on
// their words when the voice is re-timed.

import {
  Capture, CaptureStates, ClipToBox, ConfirmDialog, CursorPath, EndCard, FULL_FRAME, H, Highlight, MotionTitle,
  NativeMenu, Phone, SFX, inflate, SPLIT_LEFT, SPLIT_RIGHT, SectionCard, Sfx, SplitCompare, Tag, Text, W, camAt, camFit,
  centerOf, defineScene, defineVideo, CAPTION_FREE, FONT, easeInOut, easeOut, lerpCam, linear, off, on, phoneView, screenPoint, screenRect,
  seg, union, view, fitTake, onTake, takeShot, takeTimeAt, TakeCursor,
  type Rect, type SceneClock, type Shot, type Take, type TakeMark, type View,
} from '../../lib/studio/api.ts';
import { voice } from './audio/manifest.ts';
import { captures as C, takes as T } from './captures/index.ts';
import { music } from './music/index.ts';

const NAVY = '#1c365e';
const SALE_RED = '#b82b2b';
const SECTIONS = 4;

const TODAY = { label: 'Today', labelBg: NAVY };
const NEW = { label: 'New buy box', labelBg: SALE_RED };

/** A full-frame shot's arm, in the header band where the site's own chrome sits. */
const ArmTag = ({ arm, k = 1 }: { arm: typeof TODAY; k?: number }) => <Tag text={arm.label} x={40} y={40} k={k} bg={arm.labelBg} size={28} />;
const Section = ({ s, number, title }: { s: SceneClock; number: number; title: string }) => (
  <SectionCard t={s.t} number={number} of={SECTIONS} title={title} bg={NAVY} accent="#e8a0a0" />
);
const Ring = ({ v, rect, k, color, alpha, name, pad }: { v: View; rect: Rect; k: number; color?: string; alpha?: number; name?: string; pad?: number }) => (
  <Highlight rect={screenRect(v, rect)} k={k} color={color} alpha={alpha} name={name} pad={pad} />
);
// A dropdown plus the space its drawn-open menu needs below it, so the camera leaves room for the list.
const withMenuRoom = (r: Rect, rows: number): Rect => ({ ...r, h: r.h + rows * 34 + 20 });
// Screen rect of row `i` in a NativeMenu dropped from screen rect `from` (its default 34px rows and 6px padding).
const menuRow = (from: Rect, i: number): Rect => ({ x: from.x, y: from.y + from.h + 10 + i * 34, w: from.w, h: 34 });
// Where a cursor rests off to the lower right of a target, before it moves in or after it's done.
const aside = (p: { x: number; y: number }, dx = 120, dy = 160) => ({ x: p.x + dx, y: p.y + dy });

// Section scenes open on a card and start their voice under it (lead < the card's hold), so the card costs no time.
const OPEN = 0.9;

// ---------- title ----------

const title = defineScene({
  id: 'title', lines: ['intro'], lead: 1.4, tail: 1.0,
  render: (s) => (
    <MotionTitle s={s} shot={C['sol-new']} eyebrow="PAINFUL PLEASURES  ·  PRODUCT PAGE A/B TEST" title="Simple buy box"
      subtitle="The new product page, and what changes for shoppers." accent={SALE_RED} />
  ),
});

// ---------- 1 · Looking at the product ----------

// Kwadron's spec sheet's small print (the LONG TAPER and SHORT TAPER notes), as fractions of the photo. It sits in
// the same place in both arms, clear of the new gallery's arrows.
const kwadronText = (g: Rect): Rect => ({ x: g.x + g.w * 0.04, y: g.y + g.h * 0.64, w: g.w * 0.3, h: g.h * 0.24 });

// "…so details go soft" pushes into Solice's machine; "and fine print, like this spec sheet" cuts to Kwadron's.
const photos = defineScene({
  id: 'photos', lines: ['photos-a', 'photos-b'], lead: OPEN + 1.2, gap: 0.6, tail: 1.4,
  render: (s) => {
    const a = s.line('photos-a');
    let body;
    if (s.t < a.at(0.6)) {
      const wide = (shot: Shot & { rects: { gallery: Rect } }, box: Rect) => camFit(shot, shot.rects.gallery, { pad: 20, maxZoom: 1.2 }, box);
      const close = (shot: Shot & { rects: { gallery: Rect } }, box: Rect) => {
        const g = shot.rects.gallery;
        return camFit(shot, { x: g.x + g.w * 0.3, y: g.y + g.h * 0.1, w: g.w * 0.4, h: g.h * 0.28 }, { pad: 0, maxZoom: 3.2 }, box);
      };
      const push = seg(s.t, a.at(0.2), a.at(0.5));
      const control = C['sol-control'], next = C['sol-new'];
      body = (
        <SplitCompare k={seg(s.t, 1.6, 2.1, easeOut)}
          left={{ ...TODAY, view: view(control, lerpCam(wide(control, SPLIT_LEFT), close(control, SPLIT_LEFT), push), SPLIT_LEFT) }}
          right={{ ...NEW, view: view(next, lerpCam(wide(next, SPLIT_RIGHT), close(next, SPLIT_RIGHT), push), SPLIT_RIGHT) }} />
      );
    } else {
      // Filmed: each page's thumbnail is clicked on "print" and its sheet is up by "blurs", when the camera pushes
      // into the small print. The take between is sped up a little (about 1.4×) to fit.
      const pushFrom = a.word('blurs').start;
      const push = seg(s.t, pushFrom, a.end + 0.3);
      const side = (take: Take & { marks: { pick: TakeMark; shown: TakeMark } }, box: Rect, arm: typeof TODAY) => {
        const fit = fitTake(take, [[a.word('print').start - 0.1, 'pick'], [pushFrom, 'shown']]);
        const tt = takeTimeAt(fit, s.t), shot = takeShot(take, tt);
        const { pick, shown } = take.marks;
        const wide = camFit(shot, union(onTake(take, tt, pick.rects.gallery as Rect), onTake(take, tt, pick.rects.thumb as Rect)), { pad: 20, maxZoom: 1.2 }, box);
        const close = camFit(shot, kwadronText(onTake(take, tt, shown.rects.sheet as Rect)), { pad: 30, maxZoom: 6 }, box);
        const v = view(shot, lerpCam(wide, close, push), box);
        return { ...arm, view: v, over: <TakeCursor view={v} t={s.t} fit={fit} alpha={1 - push} /> };
      };
      body = <SplitCompare left={side(T['kw-control-browse'], SPLIT_LEFT, TODAY)} right={side(T['kw-new-browse'], SPLIT_RIGHT, NEW)} />;
    }
    return (
      <>
        {body}
        <PhotoWipe s={s} />
        <Section s={s} number={1} title="Looking at the product" />
      </>
    );
  },
});

// "The new one loads them at full size": the same small print from both pages, one over the other in a lightbox, with
// a divider sweeping across that sharpens it as it passes, then settling mid-box so the halves read side by side.
// The box is about the print's shape: a wide one would run past the new page's left edge, and the camera, kept
// inside the capture, would slide off the print.
const LIGHTBOX = { x: (W - 1000) / 2, y: 40, w: 1000, h: 790 };
function PhotoWipe({ s }: { s: SceneClock }) {
  const b = s.line('photos-b');
  const k = seg(s.t, b.start - 0.35, b.start);
  if (k <= 0) return null;
  const control = C['kw-control'], next = C['kw-new'];
  // The margin is a share of the photo rather than page pixels, since the two pages show it at different sizes.
  const closeUp = (shot: Shot & { rects: { sheet: Rect } }) => {
    const r = kwadronText(shot.rects.sheet);
    return view(shot, camFit(shot, inflate(r, r.h * 0.1), { pad: 0, maxZoom: 16 }, LIGHTBOX), LIGHTBOX);
  };
  const { x: left, w } = LIGHTBOX;
  const sweep = seg(s.t, b.start + 0.1, b.end + 0.4, linear);
  // Across to the far edge, then back to the middle: the whole print is seen sharp before the halves are compared.
  const x = left + (sweep < 0.6 ? w * easeInOut(sweep / 0.6) : w - (w / 2) * easeInOut((sweep - 0.6) / 0.4));
  const tags = seg(s.t, b.start + 0.2, b.start + 0.5), top = LIGHTBOX.y + 20;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: k }}>
      <div style={{ position: 'absolute', inset: 0, background: '#10151d' }} />
      <Capture view={closeUp(control)} />
      <ClipToBox box={{ ...LIGHTBOX, w: Math.max(1, x - left) }}><Capture view={closeUp(next)} /></ClipToBox>
      <div style={{ position: 'absolute', left: x - 2, top: LIGHTBOX.y, width: 4, height: LIGHTBOX.h, background: '#fff', boxShadow: '0 0 18px rgba(0,0,0,0.5)' }} />
      <Tag text={NEW.label} x={left - 250} y={top} k={tags} bg={NEW.labelBg} size={28} />
      <Tag text={TODAY.label} x={left + w + 30} y={top} k={tags} bg={TODAY.labelBg} size={28} />
    </div>
  );
}

// The control's `body.loader-active` spinner is a pseudo-element centred in the 1440×810 capture viewport, so it has
// no element to measure. It's drawn at twice its real 50px, so it reads in a half-width panel.
const CONTROL_LOADER_SHOWN = { x: 720 - 50, y: 405 - 50, w: 100, h: 100 };

// The still froze the spinner mid-turn. This redraws it over itself, animated the same way as the theme's SVG: twelve
// navy bars, each fading out over a second, staggered by a twelfth.
function LoaderSpin({ r, t, alpha }: { r: Rect; t: number; alpha: number }) {
  if (alpha <= 0) return null;
  const u = r.w / 100;
  return (
    <svg style={{ position: 'absolute', left: r.x, top: r.y, overflow: 'visible', opacity: alpha }} width={r.w} height={r.h}>
      <circle cx={r.w / 2} cy={r.h / 2} r={r.w * 0.45} fill="#f2f2f2" />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={-3 * u} y={-26 * u} width={6 * u} height={12 * u} rx={3 * u} fill={NAVY}
          opacity={1 - ((t + 1 - (11 - i) / 12) % 1)} transform={`translate(${r.w / 2} ${r.h / 2}) rotate(${i * 30})`} />
      ))}
    </svg>
  );
}

const speed = defineScene({
  id: 'speed', lines: ['speed-a', 'speed-b'], lead: 0.4, gap: 1.2, tail: 2.2,
  render: (s) => {
    const control = C['sol-control'], next = C['sol-new'];
    const left = view(control, camFit(control, union(control.rects.gallery, control.rects.swatches[2], control.rects.stepper), { pad: 20, maxZoom: 1 }, SPLIT_LEFT), SPLIT_LEFT);
    const right = view(next, camFit(next, union(next.rects.gallery, next.rects.swatches[2], next.rects.addToCart), { pad: 20, maxZoom: 1 }, SPLIT_RIGHT), SPLIT_RIGHT);
    const clickL = s.line('speed-a').at(0.45), clickR = s.line('speed-b').at(0.12), newTurn = s.line('speed-b').start;
    const spinning = { ...left, shot: C['sol-control-spin'] };
    // Flipping through options, faster as it goes: click… click click click. It keeps spinning on the left meanwhile.
    const flips = [0, 0.9, 1.45, 1.85, 2.2].map((d) => clickR + d);
    const flipShots = [C['sol-new-pink'], C['sol-new-grey'], C['sol-new-grey-double'], C['sol-new-black-double'], C['sol-new-pink']];
    const pinkL = centerOf(control.rects.swatches[1]), pinkR = centerOf(next.rects.swatches[1]);
    const targets = [pinkR, centerOf(next.rects.swatches[2]), centerOf(next.rects.pills[1]), centerOf(next.rects.swatches[0]), pinkR];
    const spin = seg(s.t, clickL + 0.05, clickL + 0.2);
    const shown = flips.filter((at) => s.t >= at);
    return (
      <SplitCompare
        left={{ ...TODAY, view: left, over: <>
          <Capture view={spinning} alpha={spin} />
          <CursorPath view={left} t={s.t} alpha={off(s.t, s.line('speed-a').end)}
            keys={[[0, aside(pinkL)], [clickL - 0.1, pinkL], [clickL, pinkL, { click: true }], [clickL + 1.5, aside(pinkL, 60, 90)]]} />
          <LoaderSpin r={screenRect(spinning, CONTROL_LOADER_SHOWN)} t={s.t} alpha={spin} />
          <Ring v={spinning} rect={CONTROL_LOADER_SHOWN} k={on(s.t, clickL + 0.5)} color={NAVY} alpha={off(s.t, newTurn)} />
          <Tally box={SPLIT_LEFT} k={on(s.t, clickR, 0.4)} count={0} label="options seen" color={NAVY} />
        </> }}
        right={{ ...NEW, view: right, over: <>
          <CaptureStates view={right} t={s.t} fade={0.08} states={[[next, 0], ...flipShots.map((shot, i) => [shot, flips[i] + 0.02] as const)]} />
          <CursorPath view={right} t={s.t} alpha={seg(s.t, newTurn - 0.8, newTurn - 0.5)} keys={[
            [newTurn - 0.8, aside(pinkR)],
            ...flips.flatMap((at, i) => [[at - 0.12, targets[i]] as const, [at, targets[i], { click: true }] as const]),
            [flips[4] + 1.2, aside(pinkR, 60, 90)],
          ]} />
          <Ring v={right} rect={C['sol-new-pink'].rects.gallery} k={on(s.t, clickR + 0.3)} color={SALE_RED} />
          <Tally box={SPLIT_RIGHT} k={on(s.t, clickR, 0.4)} count={shown.length} pop={shown.length ? off(s.t, shown[shown.length - 1], 0.3) : 0} label="options seen" color={SALE_RED} />
        </> }}
      />
    );
  },
});

/** A running count pinned to the top corner of a panel. `pop` 1..0 swells the number as it changes. */
function Tally({ box, k, count, label, color, pop = 0 }: { box: Rect; k: number; count: number; label: string; color: string; pop?: number }) {
  if (k <= 0) return null;
  return (
    <div style={{
      position: 'absolute', right: W - (box.x + box.w) + 28, top: box.y + 24, opacity: k, transform: `translateY(${(1 - k) * -12}px)`,
      display: 'flex', alignItems: 'baseline', gap: 12, padding: '10px 22px', borderRadius: 16, background: 'rgba(255,255,255,0.94)',
      boxShadow: '0 8px 28px rgba(16,30,54,0.22)', fontFamily: FONT, color,
    }}>
      <span style={{ fontSize: 64, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1, transform: `scale(${1 + 0.3 * pop})` }}>{count}</span>
      <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '0.02em' }}>{label}</span>
    </div>
  );
}

// ---------- 2 · Choosing options ----------

// Flare plugs at 2mm, where Amber Purple and the 6mm gauge are sold out.
const stock = defineScene({
  id: 'stock', lines: ['stock-a', 'stock-b'], lead: OPEN + 0.3, gap: 0.6, tail: 1.4,
  render: (s) => {
    const a = s.line('stock-a'), b = s.line('stock-b');
    const control = C['flare-control'], fresh = C['flare-new'], oos = C['flare-oos'];
    const gaugeL = control.data.gauge, gaugeR = fresh.data.gauge;
    const oosRow = gaugeR.findIndex((name) => name.includes('out of stock'));
    const left = view(control, camFit(control, union(control.rects.price, withMenuRoom(control.rects.gauge, gaugeL.length)), { pad: 30, maxZoom: 1.3 }, SPLIT_LEFT), SPLIT_LEFT);
    const right = view(fresh, camFit(fresh, union(fresh.rects.price, withMenuRoom(fresh.rects.gauge, gaugeR.length)), { pad: 30, maxZoom: 1.3 }, SPLIT_RIGHT), SPLIT_RIGHT);
    const pickOos = b.at(0.74), menuAt = b.at(0.4), menuShut = pickOos - 0.5;
    const fromR = screenRect(right, fresh.rects.gauge);
    const amber = centerOf(fresh.rects.amber);
    return (
      <>
        <SplitCompare
          // Today: a slashed blank where the colour was, and a gauge list that says nothing.
          left={{ ...TODAY, view: left, over: <Ring v={left} rect={control.rects.amber} k={on(s.t, a.at(0.3))} color={NAVY} alpha={off(s.t, a.at(0.6))} /> }}
          // New: the colour kept behind a dashed border, the gauge list marked, and a sold-out pick offers the email.
          right={{ ...NEW, view: right, over: <>
            <CaptureStates view={right} t={s.t} states={[[fresh, 0], [oos, pickOos]]} />
            <Ring v={right} rect={fresh.rects.amber} k={on(s.t, b.at(0.1))} color={SALE_RED} alpha={off(s.t, b.at(0.38))} />
            <CursorPath view={right} t={s.t} alpha={seg(s.t, menuShut, menuShut + 0.3)}
              keys={[[menuShut, aside(amber, 140, 180)], [pickOos - 0.1, amber], [pickOos, amber, { click: true }], [pickOos + 1.2, aside(amber, 60, 120)]]} />
            <Ring v={right} rect={oos.rects.notify} k={on(s.t, pickOos + 0.5)} color={SALE_RED} />
          </> }}
        >
          <NativeMenu k={on(s.t, a.at(0.62), 0.4) * off(s.t, a.end + 0.3)} from={screenRect(left, control.rects.gauge)} items={gaugeL} />
          <NativeMenu k={on(s.t, menuAt, 0.4) * off(s.t, menuShut)} from={fromR} items={gaugeR} />
          <Highlight rect={menuRow(fromR, oosRow)} k={on(s.t, menuAt + 0.4)} alpha={off(s.t, menuShut)} color={SALE_RED} pad={2} />
        </SplitCompare>
        <Section s={s} number={2} title="Choosing options" />
      </>
    );
  },
});

// 2.5mm with Cobalt, which isn't made.
const clash = defineScene({
  id: 'clash', lines: ['clash-a', 'clash-b'], lead: 0.3, gap: 0.8, tail: 1.2,
  render: (s) => {
    const a = s.line('clash-a'), b = s.line('clash-b');
    const control = C['flare-control-clash'], alt = C['flare-25'], shown = C['flare-clash'];
    const left = view(control, camFit(control, union(control.rects.price, control.rects.addToCart), { pad: 30, maxZoom: 1.3 }, SPLIT_LEFT), SPLIT_LEFT);
    const right = view(alt, camFit(shown, union(shown.rects.price, shown.rects.note), { pad: 30, maxZoom: 1.3 }, SPLIT_RIGHT), SPLIT_RIGHT);
    const pick = b.at(0.1), cobalt = centerOf(alt.rects.cobalt);
    return (
      <SplitCompare
        left={{ ...TODAY, view: left, over: <Ring v={left} rect={control.rects.addToCart} k={on(s.t, a.at(0.7))} color={NAVY} /> }}
        right={{ ...NEW, view: right, over: <>
          <CaptureStates view={right} t={s.t} states={[[alt, 0], [shown, pick]]} />
          <CursorPath view={right} t={s.t}
            keys={[[a.at(0.8), aside(cobalt, 140, 180)], [pick - 0.1, cobalt], [pick, cobalt, { click: true }], [pick + 1.2, aside(cobalt, 80, 140)]]} />
          <Ring v={right} rect={shown.rects.note} k={on(s.t, b.at(0.4))} color={SALE_RED} />
        </> }}
      />
    );
  },
});

// Intenze's 174 colours. A count, read off the capture, follows the list from the native menu into the search, and falls to seventeen as
// "blue" is typed, one key at a time.
const INK_COLOURS = C['ink-control'].data.names.length;
// What the voice says typing "blue" finds.
const INK_BLUE_MATCHES = 17;
const lists = defineScene({
  id: 'lists', lines: ['lists-a', 'lists-b'], lead: 0.3, gap: 0.6, tail: 1.2,
  expect: (s) => [{ see: 'matches', during: s.line('lists-b').word('seventeen') }],
  render: (s) => {
    const a = s.line('lists-a'), b = s.line('lists-b');
    const countIn = on(s.t, a.word('174').start, 0.4);
    if (s.t < b.start - 0.2) {
      // Today's colour list is a native menu, drawn from the names the capture read off the page.
      const control = C['ink-control'];
      const v = view(control, camFit(control, union(control.rects.price, withMenuRoom(control.rects.select, 12)), { pad: 30, maxZoom: 1.3 }));
      const open = a.at(0.5);
      return (
        <>
          <Capture view={v} />
          <ArmTag arm={TODAY} />
          <NativeMenu k={on(s.t, open, 0.4)} from={screenRect(v, control.rects.select)} items={control.data.names} scroll={seg(s.t, open + 0.5, b.start, linear)} />
          <Tally box={CAPTION_FREE} k={countIn} count={INK_COLOURS} label="colours" color={NAVY} />
        </>
      );
    }
    const blank = C['ink-new'], typed = C['ink-typed'];
    const blue = b.word('blue');
    const keys = [0, 1, 2, 3].map((i) => blue.start - 0.1 + i * 0.13), at = keys[3] + 0.04;
    const v = view(blank, camFit(typed, union(typed.rects.combo, typed.rects.listbox), { pad: 40, maxZoom: 1.4 }));
    const field = centerOf(blank.rects.combo);
    const falling = seg(s.t, keys[0], at + 0.3, easeOut);
    return (
      <>
        <CaptureStates view={v} t={s.t} fade={0.15} states={[[blank, 0], [typed, at]]} />
        <TypedText view={v} field={blank.rects.combo} text="blue" t={s.t} keys={keys} until={at + 0.15} />
        <ArmTag arm={NEW} />
        <CursorPath view={v} t={s.t} alpha={off(s.t, keys[0])} keys={[[b.start, aside(field, 200, 180)], [keys[0] - 0.45, field], [keys[0] - 0.35, field, { click: true }]]} />
        <Ring v={v} rect={typed.rects.combo} k={on(s.t, keys[0] - 0.2)} color={SALE_RED} alpha={off(s.t, b.word('seventeen').start - 0.3)} />
        <Ring v={v} rect={typed.rects.matches} name="matches" k={on(s.t, b.word('seventeen').start - 0.7, 0.6)} color={SALE_RED} />
        <Ring v={v} rect={union(...typed.rects.options.slice(0, 5))} k={on(s.t, b.at(0.8))} color={SALE_RED} />
        <Tally box={CAPTION_FREE} k={1} count={Math.round(INK_COLOURS + (INK_BLUE_MATCHES - INK_COLOURS) * falling)} label={falling < 1 ? 'colours' : 'match "blue"'}
          color={falling > 0 ? SALE_RED : NAVY} pop={off(s.t, at + 0.3, 0.3) * (falling >= 1 ? 1 : 0)} />
      </>
    );
  },
});

/**
 * Letters appearing in an empty text field as keys are struck, each with a key sound, in the field's own type. It
 * stands in for the capture until `until`, when the capture of the typed page takes over.
 */
function TypedText({ view: v, field, text, t, keys, until }: { view: View; field: Rect; text: string; t: number; keys: readonly number[]; until: number }) {
  const r = screenRect(v, field);
  const shown = keys.filter((at) => t >= at).length;
  return (
    <>
      {keys.map((at, i) => <Sfx key={i} src={SFX.key} at={at} t={t} volume={0.35} rate={1 + ((i * 7) % 5 - 2) * 0.04} />)}
      {t < until && shown > 0 && (
        <div style={{ position: 'absolute', left: r.x + r.h * 0.45, top: r.y, height: r.h, display: 'flex', alignItems: 'center', fontFamily: FONT, fontSize: r.h * 0.42, color: '#222' }}>
          {text.slice(0, shown)}<span style={{ width: 2, height: r.h * 0.5, background: '#222', marginLeft: 2 }} />
        </div>
      )}
    </>
  );
}

// ---------- 3 · Pricing it ----------

const sale = defineScene({
  id: 'sale', lines: ['sale'], lead: OPEN, tail: 1.0,
  render: (s) => {
    const line = s.line('sale');
    const control = C['ball-control'], b8 = C['ball-8'];
    // The Sale flag is small, so Today eases in on it while the voice names it, holds, and eases back out.
    const wide = camFit(control, union(control.rects.sale, control.rects.price), { pad: 60, maxZoom: 1.4 }, SPLIT_LEFT);
    const flag = camFit(control, control.rects.sale, { pad: 120, maxZoom: 2.2 }, SPLIT_LEFT);
    const left = view(control, camAt(s.t, [[line.at(0.12), wide], [line.at(0.3), flag], [line.at(0.52), flag], [line.at(0.66), wide]]), SPLIT_LEFT);
    const right = view(b8, camFit(b8, union(b8.rects.price, ...b8.rects.pills), { pad: 40, maxZoom: 1.4 }, SPLIT_RIGHT), SPLIT_RIGHT);
    const p10 = line.at(0.78), p11 = line.at(0.92);
    const pill = (i: number) => centerOf(b8.rects.pills[i]);
    return (
      <>
        <SplitCompare
          left={{ ...TODAY, view: left, over: <Ring v={left} rect={control.rects.sale} k={on(s.t, line.at(0.25))} color={NAVY} /> }}
          right={{ ...NEW, view: right, over: <>
            <CaptureStates view={right} t={s.t} states={[[b8, 0], [C['ball-10'], p10], [C['ball-11'], p11]]} />
            <Ring v={right} rect={C['ball-10'].rects.price} k={on(s.t, p10 + 0.3)} color={SALE_RED} />
            <CursorPath view={right} t={s.t} keys={[
              [line.at(0.6), aside(pill(1), 100, 140)], [p10 - 0.1, pill(1)], [p10, pill(1), { click: true }],
              [p11 - 0.1, pill(2)], [p11, pill(2), { click: true }], [p11 + 1, aside(pill(2), 60, 120)],
            ]} />
          </> }}
        />
        <Section s={s} number={3} title="Pricing it" />
      </>
    );
  },
});

const quantity = defineScene({
  id: 'quantity', lines: ['qty-a', 'qty-b', 'qty-c'], lead: 0.4, gap: 0.5, tail: 1.2,
  render: (s) => {
    const a = s.line('qty-a'), b = s.line('qty-b'), c = s.line('qty-c');
    const control = C['tilum-control'], next = C['tilum-new'];
    if (s.t < c.start - 0.2) {
      const left = view(control, camFit(control, control.rects.stepper, { pad: 50, maxZoom: 2.6 }, SPLIT_LEFT), SPLIT_LEFT);
      const right = view(next, camFit(next, next.rects.stepper, { pad: 50, maxZoom: 2.6 }, SPLIT_RIGHT), SPLIT_RIGHT);
      // What the recordings showed: plus, over and over, on today's page.
      // Anchored to "tapped plus over and over", more taps than the words, so it reads as a habit.
      const plus = centerOf(control.rects.plus), from = b.word('tapped').start - 0.1;
      const taps = Array.from({ length: 7 }, (_, i) => from + i * 0.26);
      const tapped = taps.filter((at) => s.t >= at);
      return (
        <SplitCompare
          left={{ ...TODAY, view: left, over: <>
            <CursorPath view={left} t={s.t} alpha={seg(s.t, from - 0.6, from - 0.4)}
              keys={[[from - 0.6, aside(plus, 90, 110)], ...taps.map((at) => [at, plus, { click: true }] as const), [c.start - 0.3, aside(plus, 90, 110)]]} />
            {taps.map((at, i) => <PlusOne key={i} at={screenPoint(left, plus)} k={seg(s.t, at, at + 0.7, linear)} />)}
            <Tally box={SPLIT_LEFT} k={on(s.t, from, 0.3)} count={tapped.length} pop={tapped.length ? off(s.t, tapped[tapped.length - 1], 0.25) : 0} label="taps on +" color={NAVY} />
          </> }}
          right={{ ...NEW, view: right, over: <Ring v={right} rect={next.rects.stepper} k={on(s.t, a.at(0.25))} color={SALE_RED} alpha={off(s.t, b.start)} /> }}
        />
      );
    }
    const controlQ5 = C['tilum-control-q5'], newQ5 = C['tilum-new-q5'];
    const left = view(control, camFit(controlQ5, union(controlQ5.rects.price, controlQ5.rects.stepper), { pad: 30, maxZoom: 1.3 }, SPLIT_LEFT), SPLIT_LEFT);
    const right = view(next, camFit(newQ5, union(newQ5.rects.price, newQ5.rects.stepper), { pad: 30, maxZoom: 1.3 }, SPLIT_RIGHT), SPLIT_RIGHT);
    const clicks = [0.2, 0.45, 0.7, 0.95].map((f) => c.start - 0.2 + f), settled = c.start + 1.1;
    const plus = centerOf(next.rects.plus);
    return (
      <SplitCompare
        left={{ ...TODAY, view: left, over: <>
          <Capture view={{ ...left, shot: controlQ5 }} alpha={seg(s.t, settled, settled + 0.4)} />
          <Ring v={left} rect={controlQ5.rects.price} k={on(s.t, c.at(0.7))} color={NAVY} />
        </> }}
        right={{ ...NEW, view: right, over: <>
          <Capture view={{ ...right, shot: newQ5 }} alpha={seg(s.t, settled, settled + 0.4)} />
          <CursorPath view={right} t={s.t} keys={[
            [c.start - 0.4, aside(plus, 90, 120)], ...clicks.map((at) => [at, plus, { click: true }] as const), [settled + 0.8, aside(plus)],
          ]} />
          <Ring v={right} rect={newQ5.rects.price} k={on(s.t, c.at(0.2))} color={SALE_RED} />
          <Ring v={right} rect={newQ5.rects.stepper} k={on(s.t, c.at(0.05))} color={SALE_RED} alpha={off(s.t, c.at(0.2))} />
        </> }}
      />
    );
  },
});

/** A "+1" floating up off a tapped button and fading. */
function PlusOne({ at, k }: { at: { x: number; y: number }; k: number }) {
  if (k <= 0 || k >= 1) return null;
  return (
    <div style={{
      position: 'absolute', left: at.x + 18, top: at.y - 40 - 70 * easeOut(k), opacity: 1 - k * k, fontFamily: FONT,
      fontSize: 34, fontWeight: 800, color: NAVY, textShadow: '0 2px 8px rgba(255,255,255,0.9)',
    }}>+1</div>
  );
}

// A desktop viewport is 16:9 like the frame, so shown whole it would run under the captions; it sits in a smaller
// window instead, with the bottom of the screen, where the bar is, above the caption band.
const DESK_WINDOW = { x: (W - 1400) / 2, y: 30, w: 1400, h: 787.5 };

const sticky = defineScene({
  id: 'sticky', lines: ['sticky'], lead: 0.3, tail: 1.2,
  render: (s) => {
    const line = s.line('sticky');
    const desk = C['desk-sticky-new'], bar = C['phone-bar'];
    const v = view(desk, camFit(desk, { x: 0, y: 0, w: desk.w, h: desk.h }, { pad: 0 }, DESK_WINDOW), DESK_WINDOW);
    const toPhone = line.at(0.62), k = seg(s.t, toPhone, toPhone + 0.5);
    const phone = phoneView(bar, { cx: W / 2 - 330, cy: 420, height: 780 });
    const x = W / 2 + 40, rise = (d: number) => seg(s.t, toPhone + d, toPhone + d + 0.7, easeOut) * k;
    return (
      <>
        <div style={{ position: 'absolute', inset: 0, background: '#e6eaf0' }} />
        <Capture view={v} />
        <ArmTag arm={NEW} />
        <Ring v={v} rect={desk.rects.bar} k={on(s.t, line.at(0.3))} color={SALE_RED} pad={4} alpha={off(s.t, toPhone)} />
        {k > 0 && (
          <>
            <div style={{ position: 'absolute', inset: 0, background: '#e6eaf0', opacity: k }} />
            <Phone view={phone} alpha={k} />
            <Ring v={phone} rect={bar.rects.bar} k={on(s.t, toPhone + 0.5)} color={SALE_RED} pad={4} />
            <Text text="AND ON PHONES" x={x} y={330} size={30} weight={700} color={SALE_RED} k={rise(0.1)} spacing={0.1} />
            <Text text="Sticky buy button" x={x} y={430} size={60} weight={700} color={NAVY} k={rise(0.3)} spacing={-0.015} />
          </>
        )}
      </>
    );
  },
});

// ---------- 4 · Ordering a mix ----------

// "…a list you can filter, / search, / and preview images": Tilum for the filters (Intenze has one option, so no
// facets), then back to Intenze, whose rows carry their bottles. Each word is its own line, held so its picture lands.
const bulk = defineScene({
  id: 'bulk', lines: ['bulk-a', 'bulk-b', 'bulk-search', 'bulk-images'], lead: OPEN + 0.3, tail: 1.6,
  gap: { 'bulk-b': 0.6, 'bulk-search': 1.5, 'bulk-images': 1.4 },
  render: (s) => {
    const a = s.line('bulk-a'), b = s.line('bulk-b');
    if (s.t < b.start - 0.2) {
      // The tab runs taller than the frame, so its first screenful stands in for it.
      const shot = C['ink-control-bulk'];
      const head = { ...shot.rects.box, h: Math.min(shot.rects.box.h, 560) };
      const v = view(shot, camFit(shot, head, { pad: 30, maxZoom: 1.2 }));
      return (
        <>
          <Capture view={v} />
          <ArmTag arm={TODAY} />
          <Ring v={v} rect={head} k={on(s.t, a.at(0.55))} color={NAVY} />
          <Section s={s} number={4} title="Ordering a mix" />
        </>
      );
    }
    const ink = C['ink-bulk'], tilum = C['tilum-bulk'];
    const filterAt = b.at(0.8), searchAt = s.line('bulk-search').start - 0.1, imagesAt = s.line('bulk-images').start - 0.1;
    const inkView = view(ink, camFit(ink, union(ink.rects.back, ...ink.rects.lines.slice(0, 3)), { pad: 30, maxZoom: 1.3 }));
    const tilumView = view(tilum, camFit(tilum, union(tilum.rects.facets, tilum.rects.filter, ...tilum.rects.lines.slice(0, 2)), { pad: 30, maxZoom: 1.3 }));
    const facetClick = filterAt + 0.3, facet = centerOf(tilum.rects.facet);
    const tilumK = seg(s.t, filterAt - 0.5, filterAt - 0.25) * (1 - seg(s.t, imagesAt - 0.3, imagesAt - 0.05));
    return (
      <>
        <Capture view={inkView} />
        {tilumK > 0 && (
          <div style={{ position: 'absolute', inset: 0, opacity: tilumK }}>
            <CaptureStates view={tilumView} t={s.t} fade={0.25} states={[[tilum, 0], [C['tilum-bulk-facet'], facetClick], [C['tilum-bulk-search'], searchAt]]} />
            <Ring v={tilumView} rect={tilum.rects.facets} k={on(s.t, filterAt - 0.2, 0.5)} color={SALE_RED} alpha={off(s.t, searchAt - 0.1)} />
            <CursorPath view={tilumView} t={s.t} alpha={off(s.t, searchAt)}
              keys={[[filterAt - 0.25, aside(facet, 120, 140)], [facetClick - 0.1, facet], [facetClick, facet, { click: true }], [searchAt, aside(facet, 80, 120)]]} />
            <Ring v={tilumView} rect={C['tilum-bulk-search'].rects.filter} k={on(s.t, searchAt, 0.5)} color={SALE_RED} />
          </div>
        )}
        <Ring v={inkView} rect={union(...ink.rects.lines.slice(0, 3))} k={on(s.t, imagesAt + 0.1)} color={SALE_RED} />
        <ArmTag arm={NEW} />
      </>
    );
  },
});

const summary = defineScene({
  id: 'summary', lines: ['summary'], lead: 0.3, tail: 0.8,
  render: (s) => {
    const line = s.line('summary'), shot = C['ink-bulk-typed'];
    const first = shot.data.typed[0];
    const rows = camFit(shot, union(...shot.rects.lines.slice(first, first + 4)), { pad: 30, maxZoom: 1.3 });
    const receipt = camFit(shot, union(shot.rects.footer, shot.rects.receipt), { pad: 30, maxZoom: 1.3 });
    const v = view(shot, camAt(s.t, [[line.at(0.35), rows], [line.at(0.6), receipt]]));
    return (
      <>
        <Capture view={v} />
        <ArmTag arm={NEW} />
        <Ring v={v} rect={shot.rects.receipt} k={on(s.t, line.at(0.65))} color={SALE_RED} />
      </>
    );
  },
});

// "One tap wipes it all" is shown, not just said: the cursor taps today's Reset, and the dozen fall to nothing.
const reset = defineScene({
  id: 'reset', lines: ['reset-a', 'reset-b'], lead: 0.3, gap: 0.5, tail: 1.4,
  render: (s) => {
    const a = s.line('reset-a'), b = s.line('reset-b');
    const today = C['ink-control-bulk-typed'], wiped = C['ink-control-bulk'], fresh = C['ink-bulk-typed'];
    const left = view(today, camFit(today, today.rects.box, { pad: 40, maxZoom: 1.3 }, SPLIT_LEFT), SPLIT_LEFT);
    const right = view(fresh, camFit(fresh, union(fresh.rects.reset, fresh.rects.footer), { pad: 80, maxZoom: 1.3 }, SPLIT_RIGHT), SPLIT_RIGHT);
    const tap = a.word('wipes').start, button = centerOf(today.rects.reset);
    const click = b.at(0.72), link = centerOf(fresh.rects.reset);
    return (
      <SplitCompare
        left={{ ...TODAY, view: left, over: <>
          <Capture view={{ ...left, shot: wiped }} alpha={seg(s.t, tap + 0.05, tap + 0.2)} />
          <Flash rect={screenRect(left, today.rects.box)} k={seg(s.t, tap + 0.05, tap + 0.7, linear)} />
          <Ring v={left} rect={today.rects.reset} k={on(s.t, a.at(0.5))} color={NAVY} alpha={off(s.t, tap + 0.6)} />
          <Ring v={left} rect={today.rects.addAll} k={on(s.t, a.at(0.68))} color={NAVY} alpha={off(s.t, tap - 0.3)} />
          <CursorPath view={left} t={s.t} alpha={seg(s.t, tap - 0.9, tap - 0.7) * off(s.t, b.start)}
            keys={[[tap - 0.9, aside(button, 140, 160)], [tap - 0.1, button], [tap, button, { click: true }], [b.start, aside(button, 90, 120)]]} />
        </> }}
        right={{ ...NEW, view: right, over: <>
          <Ring v={right} rect={fresh.rects.reset} k={on(s.t, b.at(0.3))} color={SALE_RED} alpha={off(s.t, click)} />
          <CursorPath view={right} t={s.t} alpha={off(s.t, click + 0.2)} keys={[[b.at(0.25), aside(link, 120, 140)], [click - 0.1, link], [click, link, { click: true }]]} />
        </> }}
      >
        {/* The browser draws its dialog over the whole window, not inside the page's panel. */}
        <ConfirmDialog k={on(s.t, click + 0.15, 0.35)} origin="www.painfulpleasures.com" message="Clear every quantity in this bulk order? This cannot be undone."
          anchor={{ x: SPLIT_RIGHT.x + SPLIT_RIGHT.w / 2, y: 200 }} />
      </SplitCompare>
    );
  },
});

/** A red flash over a screen rect that fades over `k` 0..1: something just went wrong there. */
function Flash({ rect, k }: { rect: Rect; k: number }) {
  if (k <= 0 || k >= 1) return null;
  return <div style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: 12, background: SALE_RED, opacity: 0.35 * (1 - k) }} />;
}

// The four sections again, each as the new page's answer, tiled in the order they were told; then the title.
const RECAP: readonly { title: string; shot: Shot; rect: Rect }[] = [
  { title: 'Photos at full size', shot: C['kw-new'], rect: kwadronText(C['kw-new'].rects.sheet) },
  { title: 'Sold out, still pickable', shot: C['flare-oos'], rect: union(C['flare-oos'].rects.gauge, C['flare-oos'].rects.notify) },
  { title: 'Prices follow the discounts', shot: C['tilum-new-q5'], rect: union(C['tilum-new-q5'].rects.price, C['tilum-new-q5'].rects.stepper) },
  { title: 'Bulk orders, itemized', shot: C['ink-bulk-typed'], rect: C['ink-bulk-typed'].rects.receipt },
];
const TILE = { w: 820, h: 360, gapX: 60, gapY: 90, top: 70 };

const end = defineScene({
  id: 'end', min: 6,
  render: (s) => {
    const card = 3.6;
    return (
      <>
        <div style={{ position: 'absolute', inset: 0, background: '#eef1f6' }} />
        {RECAP.map(({ title: label, shot, rect }, i) => {
          const box = { x: (W - 2 * TILE.w - TILE.gapX) / 2 + (i % 2) * (TILE.w + TILE.gapX), y: TILE.top + Math.floor(i / 2) * (TILE.h + TILE.gapY), w: TILE.w, h: TILE.h };
          const k = seg(s.t, 0.2 + i * 0.35, 0.8 + i * 0.35, easeOut);
          return (
            <div key={i} style={{ position: 'absolute', inset: 0, opacity: k, transform: `translateY(${(1 - k) * 40}px)` }}>
              <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: 18, background: '#fff', boxShadow: '0 12px 40px rgba(16,30,54,0.18)' }} />
              <Capture view={view(shot, camFit(shot, rect, { pad: 24, maxZoom: 3 }, box), box)} />
              <Text text={`${i + 1}  ${label}`} x={box.x + 6} y={box.y + box.h + 50} size={34} weight={700} color={NAVY} k={k} />
            </div>
          );
        })}
        <EndCard k={seg(s.t, card, card + 0.6)} title="Simple buy box" bg={NAVY} />
      </>
    );
  },
});

export default defineVideo({
  title: 'Simple buy box',
  voice,
  music: { track: music.bed },
  scenes: [title, photos, speed, stock, clash, lists, sale, quantity, sticky, bulk, summary, reset, end],
});
