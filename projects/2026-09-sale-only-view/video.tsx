// The sale-only-view walkthrough. See storyboard.md for the plan, voiceover.json for the words and timeline.ts for when
// each scene plays and the words its picture moves on. Scene times are seconds from each scene's start, and a moment
// that lands on a word is that word's cue (`at.hunt`), so a re-recorded line moves it.

import { bindTimeline, type TimelineSceneClock } from '../../lib/models/timeline/bind-timeline.ts';
import {
  CaptureSwap, Capture, ClickToBlur, CursorPath, EndCard, GlassCard, Highlight, MotionTitle, Spotlight, Tag,
  camAt, camFit, camTop, centerOf, defineVideo, scaleFor, sceneCueSeconds, sceneForTimelineClock, screenRect, motionCurves,
  seg, union, view, type Cam, type Rect, type Shot,
} from '#studio';
import { voice } from './audio/manifest.ts';
import { captures as C } from './captures/index.ts';
import { timeline } from './timeline.ts';

type Clock<K extends keyof typeof timeline.spec.scenes & string> = TimelineSceneClock<typeof timeline, K>;

const NAVY = '#1c365e';
const SALE_RED = '#b82b2b';
const SALE_BLUE = '#366299';

// Where the cursor rests when it enters a page: lower-middle, out of the way of what it's about to point at.
const cursorRest = (shot: Shot, cam: Cam) => {
  const k = scaleFor(shot, cam.zoom);
  return { x: cam.cx - 120 / k, y: cam.cy + 300 / k };
};

type ProductPage = typeof C['partial-today'] | typeof C['partial-filtered'] | typeof C['partial-picked'] | typeof C['all-on-sale'];
const buyBoxFocus = (shot: ProductPage) => camFit(shot, union(shot.rects.price, shot.rects.picker), { pad: 70, maxZoom: 1.55 });
const cardTarget = (r: Rect) => ({ x: r.x + r.w * 0.55, y: r.y + r.h * 0.5 });

/** The collection page scrolling to a card, and the cursor arriving to click it. */
function CollectionClick({ t, card, from, scrollEnd, clickAt }: { t: number; card: Rect; from: number; scrollEnd: number; clickAt: number }) {
  const shot = C.collection;
  const cardCam = camFit(shot, card, { pad: 260, maxZoom: 1.2 });
  const v = view(shot, camAt(t, [[from, camTop(shot)], [scrollEnd, cardCam]]));
  const target = cardTarget(card);
  return (
    <>
      <Capture view={v} />
      {t < clickAt + 0.45 && <CursorPath view={v} t={t} keys={[[scrollEnd - 0.6, cursorRest(shot, cardCam)], [clickAt - 0.1, target], [clickAt, target, { click: true }]]} />}
    </>
  );
}

// ---------- 1. Title: the store rushing past, the title bottom-left ----------

const title = (clock: Clock<'title'>) => sceneForTimelineClock(clock, {
  note: 'Navy title card, then a slow fade into the collection page.',
  render: (s) => (
    <MotionTitle s={s} shot={C.home} eyebrow="PAINFUL PLEASURES  ·  NEW ON SALE PAGES" title="Sale-only view"
      subtitle="Take shoppers straight to the deal they clicked." accent={SALE_RED} />
  ),
});

// ---------- 2. Today: the click, and every option at full price ----------

const today = (clock: Clock<'today'>) => sceneForTimelineClock(clock, {
  note: 'The Tattoo Machine Sale grid. The cursor clicks the InkJecta card, and the product page as it is today: five swatches, full $824.99 price.',
  render: (s) => {
    const at = sceneCueSeconds(clock);
    const clickAt = at.click, landAt = clickAt + 0.4;
    const shot = C['partial-today'];
    const focus = buyBoxFocus(shot);
    const v = view(shot, camAt(s.t, [[landAt + 0.4, camTop(shot)], [landAt + 2.4, focus]]));
    // "They have to hunt": the cursor wanders the swatches looking for a markdown.
    const hunt = shot.rects.swatches.map((r, i) => [at.hunt + 0.2 + i * 0.6, centerOf(r)] as const);
    return (
      <>
        {s.t < landAt + 0.4 && <CollectionClick t={s.t} card={C.collection.rects.partialCard} from={0.3} scrollEnd={clickAt - 0.7} clickAt={clickAt} />}
        {s.t >= landAt && (
          <>
            <Capture view={v} alpha={seg(s.t, landAt, landAt + 0.4)} />
            <Highlight rect={screenRect(v, shot.rects.picker)} k={seg(s.t, at.fullPrice, at.fullPrice + 0.8)} alpha={1 - seg(s.t, at.hunt - 0.2, at.hunt + 0.3)} />
            <Highlight rect={screenRect(v, shot.rects.price)} k={seg(s.t, at.fullPrice + 1.0, at.fullPrice + 1.8)} color={SALE_RED} />
            <CursorPath view={v} t={s.t} keys={[[landAt + 2.4, cursorRest(shot, focus)], ...hunt]} />
          </>
        )}
        <Tag text="Today" x={64} y={56} k={seg(s.t, 0.2, 0.7, motionCurves.cubic.entrance)} bg={NAVY} />
      </>
    );
  },
});

// ---------- 3. The fix: same click, only what's on sale ----------

const fix = (clock: Clock<'fix'>) => sceneForTimelineClock(clock, {
  note: 'The same click lands on the filtered page; the camera pushes in on the red note while a ring traces it. The swatches drop to three.',
  render: (s) => {
    const at = sceneCueSeconds(clock);
    const clickAt = at.click, landAt = clickAt + 0.3;
    const card = C.collection.rects.partialCard, target = cardTarget(card);
    const collection = view(C.collection, camFit(C.collection, card, { pad: 260, maxZoom: 1.2 }));
    const shot = C['partial-filtered'];
    const v = view(shot, camAt(s.t, [[landAt + 0.4, camTop(shot)], [landAt + 2.4, buyBoxFocus(shot)]]));
    const callout = screenRect(v, shot.rects.callout);
    return (
      <>
        {s.t < landAt + 0.4 && (
          <>
            <Capture view={collection} />
            <CursorPath view={collection} t={s.t} keys={[[0, { x: target.x - 60, y: target.y + 120 }], [clickAt - 0.1, target], [clickAt, target, { click: true }]]} />
          </>
        )}
        {s.t >= landAt && (
          <>
            <Capture view={v} alpha={seg(s.t, landAt, landAt + 0.4)} />
            <Highlight rect={screenRect(v, union(...shot.rects.swatches))} k={seg(s.t, at.onlyOnSale, at.onlyOnSale + 0.8)} alpha={1 - seg(s.t, at.note - 0.4, at.note)} />
            <Spotlight rect={callout} k={seg(s.t, at.note, at.note + 0.5) * (1 - seg(s.t, s.dur - 0.6, s.dur))} />
            <Highlight rect={callout} k={seg(s.t, at.note + 0.1, at.note + 0.9)} color={SALE_RED} />
          </>
        )}
        <Tag text="With sale-only view" x={64} y={56} k={seg(s.t, 0.1, 0.6, motionCurves.cubic.entrance)} bg={SALE_RED} />
      </>
    );
  },
});

// ---------- 4. Choosing: every pick stays on sale ----------

const pick = (clock: Clock<'pick'>) => sceneForTimelineClock(clock, {
  note: 'The cursor clicks the second swatch; the marked-down price is highlighted.',
  render: (s) => {
    const clickAt = sceneCueSeconds(clock).choose;
    const from = view(C['partial-filtered'], buyBoxFocus(C['partial-filtered']));
    const to = { ...from, shot: C['partial-picked'] };
    const target = centerOf(C['partial-filtered'].rects.swatches[1]);
    return (
      <>
        <CaptureSwap from={from} to={to} k={seg(s.t, clickAt + 0.1, clickAt + 0.45)} />
        <CursorPath view={to} t={s.t} keys={[[0, cursorRest(to.shot, to.cam)], [clickAt - 0.1, target], [clickAt, target, { click: true }], [clickAt + 1.2, { x: target.x + 30, y: target.y + 60 }]]} />
        <Highlight rect={screenRect(to, C['partial-picked'].rects.price)} k={seg(s.t, clickAt + 0.7, clickAt + 1.5)} color={SALE_RED} />
        <Tag text="With sale-only view" x={64} y={56} k={1} bg={SALE_RED} />
      </>
    );
  },
});

// ---------- 5. Show all: one click back to everything ----------

const showAll = (clock: Clock<'show-all'>) => sceneForTimelineClock(clock, {
  note: 'The cursor clicks "Show all options". The note goes and all five swatches return.',
  render: (s) => {
    const clickAt = sceneCueSeconds(clock).click;
    const cam = buyBoxFocus(C['partial-filtered']);
    const from = view(C['partial-picked'], cam), to = view(C['partial-show-all'], cam);
    const exit = centerOf(C['partial-picked'].rects.exit);
    const priceTarget = centerOf(C['partial-picked'].rects.swatches[1]);
    return (
      <>
        <CaptureSwap from={from} to={to} k={seg(s.t, clickAt + 0.1, clickAt + 0.45)} />
        <CursorPath view={from} t={s.t} keys={[[0, { x: priceTarget.x + 30, y: priceTarget.y + 60 }], [clickAt - 0.1, exit], [clickAt, exit, { click: true }], [clickAt + 1.0, { x: exit.x + 40, y: exit.y + 150 }]]} />
        <Highlight rect={screenRect(to, C['partial-show-all'].rects.picker)} k={seg(s.t, clickAt + 0.6, clickAt + 1.4)} />
        <Tag text="With sale-only view" x={64} y={56} k={1 - seg(s.t, s.dur - 0.5, s.dur)} bg={SALE_RED} />
      </>
    );
  },
});

// ---------- 6. All on sale: the calmer note ----------

const allOnSale = (clock: Clock<'all-on-sale'>) => sceneForTimelineClock(clock, {
  note: 'Back on the grid, a click on Peak Matrix ("Up to 68%"). The page opens with the blue "All options are on sale." box.',
  render: (s) => {
    const at = sceneCueSeconds(clock);
    const landAt = at.land, clickAt = landAt - 0.3;
    const card = C.collection.rects.allOnSaleCard, target = cardTarget(card);
    const collection = view(C.collection, camAt(s.t, [[0, camFit(C.collection, card, { pad: 320, maxZoom: 1.1 })], [0.6, camFit(C.collection, card, { pad: 260, maxZoom: 1.2 })]]));
    const shot = C['all-on-sale'];
    const v = view(shot, camAt(s.t, [[landAt + 0.3, camTop(shot)], [landAt + 1.8, buyBoxFocus(shot)]]));
    return (
      <>
        {s.t < landAt + 0.4 && (
          <>
            <Capture view={collection} />
            <CursorPath view={collection} t={s.t} keys={[[0, { x: target.x + 90, y: target.y + 140 }], [clickAt - 0.1, target], [clickAt, target, { click: true }]]} />
          </>
        )}
        {s.t >= landAt && (
          <>
            <Capture view={v} alpha={seg(s.t, landAt, landAt + 0.4)} />
            <Highlight rect={screenRect(v, shot.rects.callout)} k={seg(s.t, at.saysSo, at.saysSo + 0.8)} color={SALE_BLUE} />
          </>
        )}
        <Tag text="Everything on sale" x={64} y={56} k={seg(s.t, 0.1, 0.6, motionCurves.cubic.entrance) * (1 - seg(s.t, s.dur - 0.5, s.dur))} bg={SALE_BLUE} />
      </>
    );
  },
});

// ---------- 7. Big listings: 136 down to 3 ----------

const big = (clock: Clock<'big'>) => sceneForTimelineClock(clock, {
  note: 'Kwadron cartridges: the full four-option picker, then the filtered view. The camera pushes in on "3 of 136".',
  render: (s) => {
    const at = sceneCueSeconds(clock);
    const swapAt = at.narrowed;
    const before = C['big-today'], after = C['big-filtered'];
    const beforeCam = camFit(before, union(before.rects.price, before.rects.listbox), { pad: 50, maxZoom: 1.3 });
    const afterCam = camFit(after, union(after.rects.price, after.rects.listbox), { pad: 70, maxZoom: 1.45 });
    const cam = camAt(s.t, [[0, { ...beforeCam, zoom: beforeCam.zoom * 0.92 }], [2.0, beforeCam], [swapAt, beforeCam], [swapAt + 1.0, afterCam]]);
    const vBefore = view(before, cam), vAfter = view(after, cam);
    const listK = seg(s.t, at.listings, at.listings + 0.8) * (1 - seg(s.t, swapAt - 0.3, swapAt));
    return (
      <>
        <Capture view={vBefore} />
        <Capture view={vAfter} alpha={seg(s.t, swapAt, swapAt + 0.6)} />
        <Highlight rect={screenRect(vBefore, before.rects.listbox)} k={listK} />
        <Highlight rect={screenRect(vAfter, after.rects.callout)} k={seg(s.t, swapAt + 1.1, swapAt + 1.9)} color={SALE_RED} />
        <Tag text="136 variations" x={64} y={56} k={seg(s.t, 0.2, 0.7, motionCurves.cubic.entrance) * (1 - seg(s.t, swapAt - 0.3, swapAt))} bg={NAVY} />
        <Tag text="3 on sale" x={64} y={56} k={seg(s.t, swapAt + 0.2, swapAt + 0.7, motionCurves.cubic.entrance) * (1 - seg(s.t, s.dur - 0.5, s.dur))} bg={SALE_RED} />
      </>
    );
  },
});

// ---------- 8 & 9. Closing cards: frosted glass over a checkout ----------

// Both cards share one checkout backdrop, so the cut between them only changes the words.
const checkout = { shot: C.cart, frame: union(C.cart.rects.item, C.cart.rects.checkout), target: C.cart.rects.checkout };
const closingCard = { accent: SALE_RED, ink: NAVY };

const pricing = (clock: Clock<'pricing'>) => sceneForTimelineClock(clock, {
  note: "A glass card over a blurred product page: each customer's own pricing.",
  render: (s) => {
    // The card settles in as the line starts.
    const { card } = sceneCueSeconds(clock);
    return (
      <>
        <ClickToBlur t={s.t} {...checkout} />
        <GlassCard k={seg(s.t, card - 0.2, card + 0.7, motionCurves.cubic.entrance)} {...closingCard} eyebrow="EVERY CUSTOMER, THEIR OWN PRICE"
          points={['Uses each customer’s pricing', 'Pro and distributor accounts', 'see only their own discounts']} />
      </>
    );
  },
});

const rollout = (clock: Clock<'rollout'>) => sceneForTimelineClock(clock, {
  note: 'The rollout card, then the end card.',
  render: (s) => {
    const { card } = sceneCueSeconds(clock);
    return (
      <>
        <ClickToBlur t={s.t + 20} {...checkout} />
        <GlassCard k={seg(s.t, card - 0.1, card + 0.8, motionCurves.cubic.entrance) * (1 - seg(s.t, s.dur - 2.8, s.dur - 2.1))} {...closingCard} eyebrow="ROLLING OUT"
          points={['Switched on per collection', 'A/B tested with Intelligems', 'before it goes everywhere']} />
        <EndCard k={seg(s.t, s.dur - 2.4, s.dur - 1.6)} title="Sale-only view" bg={NAVY} />
      </>
    );
  },
});

export default defineVideo({
  title: 'Sale-only view',
  voice,
  scenes: bindTimeline(timeline, {
    title, today, fix, pick, 'show-all': showAll, 'all-on-sale': allOnSale, big, pricing, rollout,
  }),
});
