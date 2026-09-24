// The simple-buy-box walkthrough. See storyboard.md for the plan and what was checked against the theme, and
// voiceover.json for the words. Scene times are seconds from each scene's start. Beats anchor to speech, so they stay
// on their words when the voice is re-timed: `s.line(id).word('seventeen')` when a word is spoken, `.at(f)` a
// fraction of the way through a line.

import {
  Capture, CaptureStates, ConfirmDialog, CursorPath, EndCard, GlassCard, Highlight, MotionTitle, NativeMenu, Phone,
  SPLIT_LEFT, SPLIT_RIGHT, SectionCard, SplitCompare, Tag, Text, Wash, W, camAt, camFit, centerOf, defineScene,
  defineVideo, easeOut, lerpCam, linear, off, on, phoneView, screenRect, seg, union, view,
  type Rect, type SceneClock, type Shot, type View,
} from '../../lib/studio/api.ts';
import { voice } from './audio/manifest.ts';
import { captures as C } from './captures/index.ts';

const NAVY = '#1c365e';
const SALE_RED = '#b82b2b';
const SECTIONS = 6;

const TODAY = { label: 'Today', labelBg: NAVY };
const NEW = { label: 'New buy box', labelBg: SALE_RED };

/** A full-frame shot's arm, in the header band where the site's own chrome sits. */
const ArmTag = ({ arm, k = 1 }: { arm: typeof TODAY; k?: number }) => <Tag text={arm.label} x={40} y={40} k={k} bg={arm.labelBg} size={28} />;
const Section = ({ s, number, title }: { s: SceneClock; number: number; title: string }) => (
  <SectionCard t={s.t} number={number} of={SECTIONS} title={title} bg={NAVY} accent="#e8a0a0" />
);
const Ring = ({ v, rect, k, color, alpha, name }: { v: View; rect: Rect; k: number; color?: string; alpha?: number; name?: string }) => (
  <Highlight rect={screenRect(v, rect)} k={k} color={color} alpha={alpha} name={name} />
);

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

// ---------- 1 · Images and speed ----------

const images = defineScene({
  id: 'images', lines: ['images'], lead: OPEN + 1.2, tail: 0.6,
  render: (s) => {
    const wide = (shot: Shot & { rects: { gallery: Rect } }, box: Rect) => camFit(shot, shot.rects.gallery, { pad: 20, maxZoom: 1.2 }, box);
    const close = (shot: Shot & { rects: { gallery: Rect } }, box: Rect) => {
      const g = shot.rects.gallery;
      return camFit(shot, { x: g.x + g.w * 0.3, y: g.y + g.h * 0.1, w: g.w * 0.4, h: g.h * 0.28 }, { pad: 0, maxZoom: 3.2 }, box);
    };
    const line = s.line('images');
    const push = seg(s.t, line.at(0.15), line.at(0.45));
    const control = C['sol-control'], next = C['sol-new'];
    return (
      <>
        <SplitCompare
          left={{ ...TODAY, view: view(control, lerpCam(wide(control, SPLIT_LEFT), close(control, SPLIT_LEFT), push), SPLIT_LEFT) }}
          right={{ ...NEW, view: view(next, lerpCam(wide(next, SPLIT_RIGHT), close(next, SPLIT_RIGHT), push), SPLIT_RIGHT) }}
          k={seg(s.t, 1.6, 2.1, easeOut)}
        />
        <Section s={s} number={1} title="Images and speed" />
      </>
    );
  },
});

// The control's `body.loader-active` spinner is a pseudo-element centred in the 1440×810 capture viewport, so it has
// no element to measure. It's 50px, like the theme's SVG.
const CONTROL_LOADER = { x: 720 - 25, y: 405 - 25, w: 50, h: 50 };
// Drawn at twice its real size, so it reads in a half-width panel.
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
  id: 'speed', lines: ['speed-a', 'speed-b'], lead: 0.4, gap: 1.2, tail: 1.2,
  render: (s) => {
    const control = C['sol-control'], next = C['sol-new'];
    const frameControl = camFit(control, union(control.rects.gallery, control.rects.swatches[2], control.rects.stepper), { pad: 20, maxZoom: 1 }, SPLIT_LEFT);
    const frameNew = camFit(next, union(next.rects.gallery, next.rects.swatches[2], next.rects.addToCart), { pad: 20, maxZoom: 1 }, SPLIT_RIGHT);
    const clickL = s.line('speed-a').at(0.3), clickR = s.line('speed-b').at(0.12), newTurn = s.line('speed-b').start;
    // The real spinner is small, so Today pushes in on it and the swatch that set it off, then eases back out.
    const spinClose = camFit(control, union(CONTROL_LOADER, control.rects.swatches[1], control.rects.price), { pad: 40, maxZoom: 2.2 }, SPLIT_LEFT);
    const left = view(control, camAt(s.t, [[clickL + 0.3, frameControl], [clickL + 1.1, spinClose], [newTurn - 0.3, spinClose], [newTurn + 0.5, frameControl]]), SPLIT_LEFT);
    const right = view(next, frameNew, SPLIT_RIGHT);
    const spinning = { ...left, shot: C['sol-control-spin'] };
    const pinkL = centerOf(control.rects.swatches[1]), pinkR = centerOf(next.rects.swatches[1]);
    return (
      <SplitCompare
        left={{ ...TODAY, view: left, over: <>
          <Capture view={spinning} alpha={seg(s.t, clickL + 0.05, clickL + 0.2)} />
          <CursorPath view={left} t={s.t} alpha={off(s.t, s.line('speed-a').end)}
            keys={[[0, { x: pinkL.x + 120, y: pinkL.y + 160 }], [clickL - 0.1, pinkL], [clickL, pinkL, { click: true }], [clickL + 1.5, { x: pinkL.x + 60, y: pinkL.y + 90 }]]} />
          <LoaderSpin r={screenRect(spinning, CONTROL_LOADER_SHOWN)} t={s.t} alpha={seg(s.t, clickL + 0.05, clickL + 0.2) * off(s.t, newTurn)} />
          <Ring v={spinning} rect={CONTROL_LOADER_SHOWN} k={on(s.t, clickL + 0.5)} color={NAVY} alpha={off(s.t, newTurn)} />
        </> }}
        right={{ ...NEW, view: right, over: <>
          <Capture view={{ ...right, shot: C['sol-new-pink'] }} alpha={seg(s.t, clickR + 0.02, clickR + 0.12)} />
          <CursorPath view={right} t={s.t} alpha={seg(s.t, newTurn - 0.8, newTurn - 0.5)}
            keys={[[newTurn - 0.8, { x: pinkR.x + 120, y: pinkR.y + 160 }], [clickR - 0.1, pinkR], [clickR, pinkR, { click: true }], [clickR + 1.5, { x: pinkR.x + 60, y: pinkR.y + 90 }]]} />
          <Ring v={right} rect={C['sol-new-pink'].rects.gallery} k={on(s.t, clickR + 0.3)} color={SALE_RED} />
        </> }}
      />
    );
  },
});

// ---------- 2 · What's available ----------

const available = defineScene({
  id: 'available', lines: ['avail-a', 'avail-b'], lead: OPEN, gap: 0.6, tail: 1.4,
  render: (s) => {
    const a = s.line('avail-a'), b = s.line('avail-b');
    const pickOos = a.at(0.62), toClash = b.start - 0.4, pickCobalt = b.at(0.3);
    const fresh = C['flare-new'], oos = C['flare-oos'], alt = C['flare-25'], clash = C['flare-clash'];
    const cardCam = camFit(fresh, fresh.rects.card, { pad: 30, maxZoom: 1.3 });
    // The clash message pushes the card past the caption band, so the camera follows it down.
    const noteCam = camFit(clash, union(alt.rects.cobalt, clash.rects.note), { pad: 40, maxZoom: 1.3 });
    const v = view(fresh, camAt(s.t, [[pickCobalt + 0.2, cardCam], [pickCobalt + 1, noteCam]]));
    const amber = centerOf(fresh.rects.amber), cobalt = centerOf(alt.rects.cobalt);
    return (
      <>
        <CaptureStates view={v} t={s.t} states={[[fresh, 0], [oos, pickOos], [alt, toClash], [clash, pickCobalt]]} />
        <ArmTag arm={NEW} />
        <Ring v={v} rect={union(...fresh.rects.legends)} k={on(s.t, a.at(0.08))} alpha={off(s.t, a.at(0.28))} />
        <Ring v={v} rect={fresh.rects.amber} k={on(s.t, a.at(0.3))} color={SALE_RED} alpha={off(s.t, pickOos + 0.6)} />
        <Ring v={v} rect={oos.rects.notify} k={on(s.t, a.at(0.8))} color={SALE_RED} alpha={off(s.t, toClash)} />
        <CursorPath view={v} t={s.t} keys={[
          [a.at(0.3), { x: amber.x + 140, y: amber.y + 180 }], [pickOos - 0.1, amber], [pickOos, amber, { click: true }],
          [toClash, { x: amber.x + 60, y: amber.y + 120 }], [pickCobalt - 0.1, cobalt], [pickCobalt, cobalt, { click: true }],
          [pickCobalt + 1.2, { x: cobalt.x + 80, y: cobalt.y + 140 }],
        ]} />
        <Ring v={v} rect={clash.rects.note} k={on(s.t, pickCobalt + 0.5)} color={SALE_RED} alpha={off(s.t, s.dur - 0.6)} />
        <Section s={s} number={2} title="What's available" />
      </>
    );
  },
});

// ---------- 3 · Finding a color ----------

const combo = defineScene({
  id: 'combo', lines: ['combo-a', 'combo-b', 'combo-c', 'combo-d'], lead: OPEN, gap: 0.6, tail: 1.6,
  expect: (s) => [{ see: 'matches', during: s.line('combo-a').word('seventeen') }],
  render: (s) => {
    const a = s.line('combo-a'), b = s.line('combo-b'), c = s.line('combo-c'), d = s.line('combo-d');
    const blank = C['ink-new'], typed = C['ink-typed'], picked = C['ink-picked'], bulk = C['ink-bulk'], control = C['ink-control'];
    let body;
    if (s.t < b.start - 0.2) {
      const typedAt = a.at(0.35);
      const v = view(blank, camFit(typed, union(typed.rects.combo, typed.rects.listbox), { pad: 40, maxZoom: 1.4 }));
      const field = centerOf(blank.rects.combo);
      body = (
        <>
          <CaptureStates view={v} t={s.t} states={[[blank, 0], [typed, typedAt]]} />
          <ArmTag arm={NEW} />
          <CursorPath view={v} t={s.t} alpha={off(s.t, typedAt + 0.3)} keys={[[0.8, { x: field.x + 200, y: field.y + 180 }], [typedAt - 0.5, field], [typedAt - 0.4, field, { click: true }]]} />
          <Ring v={v} rect={typed.rects.matches} name="matches" k={on(s.t, a.word('seventeen').start - 0.4)} color={SALE_RED} alpha={off(s.t, b.start - 0.5)} />
          <Ring v={v} rect={union(...typed.rects.options.slice(0, 5))} k={on(s.t, a.at(0.8))} alpha={off(s.t, b.start - 0.5)} />
        </>
      );
    } else if (s.t < c.start - 0.2) {
      // Today's colour list is a native menu, drawn from the names the capture read off the page.
      const left = view(control, camFit(control, union(control.rects.select, control.rects.price), { pad: 30, maxZoom: 1.3 }, SPLIT_LEFT), SPLIT_LEFT);
      const right = view(typed, camFit(typed, union(typed.rects.combo, typed.rects.listbox), { pad: 30, maxZoom: 1.3 }, SPLIT_RIGHT), SPLIT_RIGHT);
      body = (
        <SplitCompare left={{ ...TODAY, view: left }} right={{ ...NEW, view: right }}>
          <NativeMenu k={on(s.t, b.start + 0.1, 0.4)} from={screenRect(left, control.rects.select)} items={control.data.names} scroll={seg(s.t, b.start + 0.6, b.end + 0.2, linear)} />
        </SplitCompare>
      );
    } else {
      // The main photo is taller than the caption-free frame even unzoomed, so the camera frames its middle.
      const g = picked.rects.gallery, photo = { x: g.x + g.w * 0.2, y: g.y + g.h * 0.15, w: g.w * 0.6, h: g.h * 0.5 };
      const pickCam = camFit(picked, union(photo, picked.rects.combo), { pad: 30, maxZoom: 1.2 });
      const bulkCam = camFit(bulk, union(bulk.rects.back, ...bulk.rects.lines.slice(0, 4)), { pad: 40, maxZoom: 1.3 });
      const pick = c.start + 0.3, openBulk = d.at(0.25);
      const v = view(typed, camAt(s.t, [[openBulk, pickCam], [openBulk + 1.1, bulkCam]]));
      const option = centerOf(typed.rects.options[3]), invite = centerOf(picked.rects.invite);
      body = (
        <>
          <CaptureStates view={v} t={s.t} states={[[typed, 0], [picked, pick], [bulk, openBulk]]} />
          <ArmTag arm={NEW} />
          <CursorPath view={v} t={s.t} alpha={off(s.t, openBulk + 0.5)}
            keys={[[c.start - 0.4, { x: option.x + 160, y: option.y + 120 }], [pick - 0.1, option], [pick, option, { click: true }], [openBulk - 0.1, invite], [openBulk, invite, { click: true }]]} />
          <Ring v={v} rect={picked.rects.combo} k={on(s.t, c.at(0.25))} color={SALE_RED} alpha={off(s.t, c.at(0.55))} />
          <Ring v={v} rect={union(...bulk.rects.lines.slice(0, 3))} k={on(s.t, openBulk + 1.2)} color={SALE_RED} alpha={off(s.t, s.dur - 0.5)} />
        </>
      );
    }
    return (
      <>
        {body}
        <Section s={s} number={3} title="Finding a color" />
      </>
    );
  },
});

// ---------- 4 · Sales and volume pricing ----------

const sale = defineScene({
  id: 'sale', lines: ['sale'], lead: OPEN, tail: 1.0,
  render: (s) => {
    const line = s.line('sale');
    const control = C['ball-control'], b8 = C['ball-8'];
    const left = view(control, camFit(control, union(control.rects.sale, control.rects.price), { pad: 60, maxZoom: 1.4 }, SPLIT_LEFT), SPLIT_LEFT);
    const right = view(b8, camFit(b8, union(b8.rects.price, ...b8.rects.pills), { pad: 40, maxZoom: 1.4 }, SPLIT_RIGHT), SPLIT_RIGHT);
    const p10 = line.at(0.55), p11 = line.at(0.82);
    const pill = (i: number) => centerOf(b8.rects.pills[i]);
    return (
      <>
        <SplitCompare
          left={{ ...TODAY, view: left, over: <Ring v={left} rect={control.rects.sale} k={on(s.t, line.at(0.05))} color={NAVY} /> }}
          right={{ ...NEW, view: right, over: <>
            <CaptureStates view={right} t={s.t} states={[[b8, 0], [C['ball-10'], p10], [C['ball-11'], p11]]} />
            <Ring v={right} rect={C['ball-10'].rects.price} k={on(s.t, p10 + 0.3)} color={SALE_RED} />
            <CursorPath view={right} t={s.t} keys={[
              [line.at(0.3), { x: pill(1).x + 100, y: pill(1).y + 140 }], [p10 - 0.1, pill(1)], [p10, pill(1), { click: true }],
              [p11 - 0.1, pill(2)], [p11, pill(2), { click: true }], [p11 + 1, { x: pill(2).x + 60, y: pill(2).y + 120 }],
            ]} />
          </> }}
        />
        <Section s={s} number={4} title="Sales and volume pricing" />
      </>
    );
  },
});

const ladder = defineScene({
  id: 'ladder', lines: ['ladder'], lead: 0.3, tail: 0.8,
  expect: (s) => [{ see: 'tiers', during: s.line('ladder').word('no volume discount') }],
  render: (s) => {
    const shot = C['ball-10'];
    const v = view(shot, camFit(shot, union(shot.rects.price, shot.rects.tiers), { pad: 50, maxZoom: 1.4 }));
    return (
      <>
        <Capture view={v} />
        <ArmTag arm={NEW} />
        <Ring v={v} rect={shot.rects.tiers} name="tiers" k={on(s.t, s.line('ladder').word('no volume discount').start - 0.4)} color={SALE_RED} />
      </>
    );
  },
});

const quantity = defineScene({
  id: 'quantity', lines: ['qty-a', 'qty-b'], lead: 0.4, gap: 1.2, tail: 1.2,
  render: (s) => {
    const a = s.line('qty-a'), b = s.line('qty-b');
    const control = C['tilum-control'], next = C['tilum-new'];
    if (s.t < b.start - 0.2) {
      const left = view(control, camFit(control, control.rects.stepper, { pad: 50, maxZoom: 2.6 }, SPLIT_LEFT), SPLIT_LEFT);
      const right = view(next, camFit(next, next.rects.stepper, { pad: 50, maxZoom: 2.6 }, SPLIT_RIGHT), SPLIT_RIGHT);
      return (
        <SplitCompare left={{ ...TODAY, view: left }}
          right={{ ...NEW, view: right, over: <Ring v={right} rect={next.rects.stepper} k={on(s.t, a.at(0.25))} color={SALE_RED} /> }} />
      );
    }
    const controlQ5 = C['tilum-control-q5'], newQ5 = C['tilum-new-q5'];
    const left = view(control, camFit(controlQ5, union(controlQ5.rects.price, controlQ5.rects.stepper), { pad: 30, maxZoom: 1.3 }, SPLIT_LEFT), SPLIT_LEFT);
    const right = view(next, camFit(newQ5, union(newQ5.rects.price, newQ5.rects.stepper), { pad: 30, maxZoom: 1.3 }, SPLIT_RIGHT), SPLIT_RIGHT);
    const clicks = [0.2, 0.45, 0.7, 0.95].map((f) => b.start - 0.2 + f), settled = b.start + 1.1;
    const plus = centerOf(next.rects.plus);
    return (
      <SplitCompare
        left={{ ...TODAY, view: left, over: <>
          <Capture view={{ ...left, shot: controlQ5 }} alpha={seg(s.t, settled, settled + 0.4)} />
          <Ring v={left} rect={controlQ5.rects.price} k={on(s.t, b.at(0.7))} color={NAVY} />
        </> }}
        right={{ ...NEW, view: right, over: <>
          <Capture view={{ ...right, shot: newQ5 }} alpha={seg(s.t, settled, settled + 0.4)} />
          <CursorPath view={right} t={s.t} keys={[
            [b.start - 0.4, { x: plus.x + 90, y: plus.y + 120 }], ...clicks.map((c) => [c, plus, { click: true }] as const),
            [settled + 0.8, { x: plus.x + 120, y: plus.y + 160 }],
          ]} />
          <Ring v={right} rect={newQ5.rects.price} k={on(s.t, b.at(0.2))} color={SALE_RED} />
          <Ring v={right} rect={newQ5.rects.stepper} k={on(s.t, b.at(0.05))} color={SALE_RED} alpha={off(s.t, b.at(0.2))} />
        </> }}
      />
    );
  },
});

// ---------- 5 · Bulk ordering ----------

const bulk = defineScene({
  id: 'bulk', lines: ['bulk-a'], lead: OPEN + 0.3, tail: 0.8,
  render: (s) => {
    const a = s.line('bulk-a');
    const toNew = a.at(0.36), search = a.at(0.52), facet = a.at(0.68), onSale = a.at(0.85);
    let body;
    if (s.t < toNew) {
      // The control's list runs far past the frame, so its first screenful stands in for it.
      const shot = C['tilum-control-bulk'];
      const box = shot.rects.box, head = { ...box, h: Math.min(box.h, 560) };
      const v = view(shot, camFit(shot, head, { pad: 30, maxZoom: 1.2 }));
      body = (
        <>
          <Capture view={v} />
          <ArmTag arm={TODAY} />
          <Ring v={v} rect={head} k={on(s.t, a.start + 0.3)} color={NAVY} />
        </>
      );
    } else {
      const shot = C['tilum-bulk'];
      const v = view(shot, camFit(shot, union(shot.rects.facets, shot.rects.filter, ...shot.rects.lines.slice(0, 2)), { pad: 30, maxZoom: 1.3 }));
      body = (
        <>
          <CaptureStates view={v} t={s.t} states={[[shot, 0], [C['tilum-bulk-search'], search], [C['tilum-bulk-facet'], facet], [C['tilum-bulk-sale'], onSale]]} />
          <ArmTag arm={NEW} k={seg(s.t, toNew, toNew + 0.4)} />
          <Ring v={v} rect={shot.rects.filter} k={on(s.t, search, 0.5)} color={SALE_RED} alpha={off(s.t, facet - 0.1)} />
          <Ring v={v} rect={shot.rects.facet} k={on(s.t, facet, 0.5)} color={SALE_RED} alpha={off(s.t, onSale - 0.1)} />
          <Ring v={v} rect={shot.rects.onSale} k={on(s.t, onSale, 0.5)} color={SALE_RED} />
        </>
      );
    }
    return (
      <>
        {body}
        <Section s={s} number={5} title="Bulk ordering" />
      </>
    );
  },
});

const typed = defineScene({
  id: 'typed', lines: ['bulk-b'], lead: 0.3, tail: 0.6,
  render: (s) => {
    const shot = C['tilum-bulk-typed'], b = s.line('bulk-b');
    const rows = camFit(shot, union(...shot.rects.lines.slice(0, 6)), { pad: 30, maxZoom: 1.3 });
    const receipt = camFit(shot, union(shot.rects.footer, shot.rects.receipt), { pad: 30, maxZoom: 1.3 });
    const v = view(shot, camAt(s.t, [[b.at(0.4), rows], [b.at(0.6), receipt]]));
    return (
      <>
        <Capture view={v} />
        <ArmTag arm={NEW} />
        <Ring v={v} rect={shot.rects.receipt} k={on(s.t, b.at(0.65))} color={SALE_RED} />
      </>
    );
  },
});

const reset = defineScene({
  id: 'reset', lines: ['bulk-c'], lead: 0.3, tail: 1.4,
  render: (s) => {
    const c = s.line('bulk-c');
    const control = C['tilum-control-bulk'], next = C['tilum-bulk-typed'];
    const left = view(control, camFit(control, control.rects.reset, { pad: 160, maxZoom: 1.3 }, SPLIT_LEFT), SPLIT_LEFT);
    const right = view(next, camFit(next, union(next.rects.reset, next.rects.footer), { pad: 80, maxZoom: 1.3 }, SPLIT_RIGHT), SPLIT_RIGHT);
    const click = c.at(0.72), link = centerOf(next.rects.reset);
    return (
      <SplitCompare
        left={{ ...TODAY, view: left, over: <Ring v={left} rect={control.rects.reset} k={on(s.t, c.at(0.1))} color={NAVY} /> }}
        right={{ ...NEW, view: right, over: <>
          <Ring v={right} rect={next.rects.reset} k={on(s.t, c.at(0.5))} color={SALE_RED} alpha={off(s.t, click)} />
          <CursorPath view={right} t={s.t} alpha={off(s.t, click + 0.2)} keys={[[c.at(0.45), { x: link.x + 120, y: link.y + 140 }], [click - 0.1, link], [click, link, { click: true }]]} />
        </> }}
      >
        {/* The browser draws its dialog over the whole window, not inside the page's panel. */}
        <ConfirmDialog k={on(s.t, click + 0.15, 0.35)} origin="www.painfulpleasures.com" message="Clear every quantity in this bulk order? This cannot be undone."
          anchor={{ x: SPLIT_RIGHT.x + SPLIT_RIGHT.w / 2, y: 200 }} />
      </SplitCompare>
    );
  },
});

const why = defineScene({
  id: 'why', lines: ['why'], lead: 1.0, tail: 1.2,
  render: (s) => {
    const shot = C['tilum-bulk'];
    const k = seg(s.t, 0, 0.9);
    return (
      <>
        <Capture view={view(shot, camFit(shot, shot.rects.card, { pad: 60, maxZoom: 1.1 }))} blur={30 * k} />
        <Wash color="22, 40, 70" from={0.62 * k} to={0.38 * k} x0={0} x1={W} />
        <GlassCard k={seg(s.t, 0.4, 1.3, easeOut)} eyebrow="ADDED TO CART, 15 DAYS" accent={SALE_RED} ink={NAVY}
          points={['One item at a time   ~$1.1M', 'Bulk ordering          ~$84K', 'Now tracking bulk opens']} />
      </>
    );
  },
});

// ---------- 6 · On phones ----------

const phoneBar = defineScene({
  id: 'phone-bar', lines: ['mobile-a'], lead: OPEN, tail: 0.8,
  render: (s) => {
    const a = s.line('mobile-a');
    const at = { cx: W / 2 - 330, cy: 432, height: 800 };
    const toBar = a.at(0.25);
    const top = phoneView(C['phone-top'], at), bar = phoneView(C['phone-bar'], at);
    const x = W / 2 + 40, rise = (f: number) => seg(s.t, a.at(f), a.at(f) + 0.7, easeOut);
    return (
      <>
        <Phone view={top} />
        <Phone view={bar} alpha={seg(s.t, toBar, toBar + 0.5)} />
        <Highlight rect={screenRect(bar, C['phone-bar'].rects.bar)} k={on(s.t, toBar + 0.6)} color={SALE_RED} pad={4} />
        <Text text="ON PHONES" x={x} y={330} size={30} weight={700} color={SALE_RED} k={rise(0)} spacing={0.1} />
        <Text text="Price and options" x={x} y={430} size={60} weight={700} color={NAVY} k={rise(0.3)} spacing={-0.015} />
        <Text text="stay in reach" x={x} y={504} size={60} weight={700} color={NAVY} k={rise(0.35)} spacing={-0.015} />
        <Section s={s} number={6} title="On phones" />
      </>
    );
  },
});

const phoneBulk = defineScene({
  id: 'phone-bulk', lines: ['mobile-b'], lead: 0.3, tail: 1.4,
  render: (s) => {
    const b = s.line('mobile-b');
    const today = phoneView(C['phone-control-bulk'], { cx: W / 2 - 330, cy: 470, height: 740 });
    const next = phoneView(C['phone-bulk'], { cx: W / 2 + 330, cy: 470, height: 740 });
    return (
      <>
        <Phone view={today} />
        <Phone view={next} />
        <Tag text={TODAY.label} x={W / 2 - 330 - 60} y={36} k={1} bg={NAVY} size={28} />
        <Tag text={NEW.label} x={W / 2 + 330 - 100} y={36} k={1} bg={SALE_RED} size={28} />
        <Highlight rect={screenRect(next, C['phone-bulk'].rects.footer)} k={on(s.t, b.at(0.3))} color={SALE_RED} pad={4} />
        <Highlight rect={screenRect(today, C['phone-control-bulk'].rects.scroller)} k={on(s.t, b.at(0.7))} color={NAVY} pad={4} />
      </>
    );
  },
});

const end = defineScene({
  id: 'end', min: 3,
  render: (s) => <EndCard k={seg(s.t, 0, 0.6)} title="Simple buy box" bg={NAVY} />,
});

export default defineVideo({
  title: 'Simple buy box',
  voice,
  scenes: [title, images, speed, available, combo, sale, ladder, quantity, bulk, typed, reset, why, phoneBar, phoneBulk, end],
});
