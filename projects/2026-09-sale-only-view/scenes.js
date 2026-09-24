// The sale-only-view walkthrough's shot list. See storyboard.html for the plan and voiceover.json for the words.
// Scene times below are seconds from each scene's start; `s.line(id)` anchors a beat to the moment a line is spoken.

const NAVY = '#1c365e';
const SALE_RED = '#b82b2b';
const SALE_BLUE = '#366299';

// Where the cursor rests when it enters a page: lower-middle, out of the way of what it's about to point at.
const cursorRest = (name, cam) => {
  const k = scaleFor(name, cam.zoom);
  return { x: cam.cx - 120 / k, y: cam.cy + 300 / k };
};

// Where a shot of each product page starts: the top of the page, as a shopper lands on it.
const pdpLanding = (name) => camTop(name);
const buyBoxFocus = (name, extra = {}) =>
  camFit(name, union(rectOf(name, 'price'), rectOf(name, 'picker')), { pad: 70, maxZoom: 1.55, ...extra });

/**
 * The part of a collection shot that clicks a card: the camera scrolls to it, the cursor arrives and clicks.
 * Returns the camera so the caller can hand the scene over to the product page.
 */
function collectionClick(t, card, { from, scrollEnd, clickAt }) {
  const name = 'collection';
  const cardRect = rectOf(name, card);
  const cardCam = camFit(name, cardRect, { pad: 260, maxZoom: 1.2 });
  const cam = camAt(t, [[from, camTop(name)], [scrollEnd, cardCam]]);
  drawCapture(name, cam);
  const target = { x: cardRect.x + cardRect.w * 0.55, y: cardRect.y + cardRect.h * 0.5 };
  if (t < clickAt + 0.45) {
    drawCursorPath(name, cam, t, [[scrollEnd - 0.6, cursorRest(name, cardCam)], [clickAt - 0.1, target], [clickAt, target, { click: true }]]);
  }
  return cam;
}

// ---------- 1. Title: the store rushing past, the title bottom-left ----------

function drawTitle(s) {
  drawMotionTitle(s, {
    capture: 'home',
    eyebrow: 'PAINFUL PLEASURES  ·  NEW ON SALE PAGES',
    title: 'Sale-only view',
    subtitle: 'Take shoppers straight to the deal they clicked.',
    accent: SALE_RED,
  });
}

// ---------- 2. Today: the click, and every option at full price ----------

function drawToday(s) {
  const clickAt = 2.6, landAt = 3.0;
  if (s.t < landAt + 0.4) collectionClick(s.t, 'partialCard', { from: 0.3, scrollEnd: 1.9, clickAt });

  if (s.t >= landAt) {
    const name = 'partial-today';
    const focus = buyBoxFocus(name);
    const cam = camAt(s.t, [[landAt + 0.4, pdpLanding(name)], [landAt + 2.4, focus]]);
    drawCapture(name, cam, { alpha: seg(s.t, landAt, landAt + 0.4) });

    const b = s.line('problem-b');
    const swatches = rectOf(name, 'swatches');
    drawHighlight(rectToScreen(name, cam, rectOf(name, 'picker')), seg(s.t, landAt + 3.2, landAt + 4.0), { alpha: 1 - seg(s.t, b.start - 0.2, b.start + 0.3) });
    drawHighlight(rectToScreen(name, cam, rectOf(name, 'price')), seg(s.t, landAt + 4.2, landAt + 5.0), { color: SALE_RED });

    // "They have to hunt": the cursor wanders the swatches looking for a markdown.
    const hunt = swatches.map((r, i) => [b.start + 0.2 + i * 0.6, centerOf(r)]);
    drawCursorPath(name, cam, s.t, [[landAt + 2.4, cursorRest(name, focus)], ...hunt]);
  }
  drawTag('Today', 64, 56, seg(s.t, 0.2, 0.7, easeOut), { bg: NAVY });
}

// ---------- 3. The fix: same click, only what's on sale ----------

function drawFix(s) {
  const clickAt = 0.9, landAt = 1.2;
  if (s.t < landAt + 0.4) {
    const name = 'collection';
    const cardRect = rectOf(name, 'partialCard');
    const cam = camFit(name, cardRect, { pad: 260, maxZoom: 1.2 });
    drawCapture(name, cam);
    const target = { x: cardRect.x + cardRect.w * 0.55, y: cardRect.y + cardRect.h * 0.5 };
    drawCursorPath(name, cam, s.t, [[0, { x: target.x - 60, y: target.y + 120 }], [clickAt - 0.1, target], [clickAt, target, { click: true }]]);
  }

  if (s.t >= landAt) {
    const name = 'partial-filtered';
    const b = s.line('fix-b');
    const focus = buyBoxFocus(name);
    const cam = camAt(s.t, [[landAt + 0.4, pdpLanding(name)], [landAt + 2.4, focus]]);
    drawCapture(name, cam, { alpha: seg(s.t, landAt, landAt + 0.4) });

    const callout = rectToScreen(name, cam, rectOf(name, 'callout'));
    const swatches = rectToScreen(name, cam, union(...rectOf(name, 'swatches')));
    drawHighlight(swatches, seg(s.t, landAt + 3.4, landAt + 4.2), { alpha: 1 - seg(s.t, b.start - 0.4, b.start) });
    drawSpotlight(callout, seg(s.t, b.start, b.start + 0.5) * (1 - seg(s.t, s.dur - 0.6, s.dur)));
    drawHighlight(callout, seg(s.t, b.start + 0.1, b.start + 0.9), { color: SALE_RED });
  }
  drawTag('With sale-only view', 64, 56, seg(s.t, 0.1, 0.6, easeOut), { bg: SALE_RED });
}

// ---------- 4. Choosing: every pick stays on sale ----------

function drawPick(s) {
  const clickAt = 1.3;
  const name = 'partial-picked';
  const cam = buyBoxFocus('partial-filtered');
  drawCaptureSwap('partial-filtered', name, cam, seg(s.t, clickAt + 0.1, clickAt + 0.45));

  const target = centerOf(rectOf('partial-filtered', 'swatches', 1));
  drawCursorPath(name, cam, s.t, [[0, cursorRest(name, cam)], [clickAt - 0.1, target], [clickAt, target, { click: true }], [clickAt + 1.2, { x: target.x + 30, y: target.y + 60 }]]);
  drawHighlight(rectToScreen(name, cam, rectOf(name, 'price')), seg(s.t, clickAt + 0.7, clickAt + 1.5), { color: SALE_RED });
  drawTag('With sale-only view', 64, 56, 1, { bg: SALE_RED });
}

// ---------- 5. Show all: one click back to everything ----------

function drawShowAll(s) {
  const clickAt = 1.1;
  const cam = buyBoxFocus('partial-filtered');
  drawCaptureSwap('partial-picked', 'partial-show-all', cam, seg(s.t, clickAt + 0.1, clickAt + 0.45));

  const exit = centerOf(rectOf('partial-picked', 'exit'));
  const priceTarget = centerOf(rectOf('partial-picked', 'swatches', 1));
  drawCursorPath('partial-picked', cam, s.t, [[0, { x: priceTarget.x + 30, y: priceTarget.y + 60 }], [clickAt - 0.1, exit], [clickAt, exit, { click: true }], [clickAt + 1.0, { x: exit.x + 40, y: exit.y + 150 }]]);
  drawHighlight(rectToScreen('partial-show-all', cam, rectOf('partial-show-all', 'picker')), seg(s.t, clickAt + 0.6, clickAt + 1.4));
  drawTag('With sale-only view', 64, 56, 1 - seg(s.t, s.dur - 0.5, s.dur), { bg: SALE_RED });
}

// ---------- 6. All on sale: the calmer note ----------

function drawAllOnSale(s) {
  const clickAt = 0.7, landAt = 1.0;
  if (s.t < landAt + 0.4) {
    const name = 'collection';
    const cardRect = rectOf(name, 'allOnSaleCard');
    const cam = camAt(s.t, [[0, camFit(name, cardRect, { pad: 320, maxZoom: 1.1 })], [0.6, camFit(name, cardRect, { pad: 260, maxZoom: 1.2 })]]);
    drawCapture(name, cam);
    const target = { x: cardRect.x + cardRect.w * 0.55, y: cardRect.y + cardRect.h * 0.5 };
    drawCursorPath(name, cam, s.t, [[0, { x: target.x + 90, y: target.y + 140 }], [clickAt - 0.1, target], [clickAt, target, { click: true }]]);
  }
  if (s.t >= landAt) {
    const name = 'all-on-sale';
    const focus = buyBoxFocus(name);
    const cam = camAt(s.t, [[landAt + 0.3, pdpLanding(name)], [landAt + 1.8, focus]]);
    drawCapture(name, cam, { alpha: seg(s.t, landAt, landAt + 0.4) });
    drawHighlight(rectToScreen(name, cam, rectOf(name, 'callout')), seg(s.t, landAt + 1.9, landAt + 2.7), { color: SALE_BLUE });
  }
  drawTag('Everything on sale', 64, 56, seg(s.t, 0.1, 0.6, easeOut) * (1 - seg(s.t, s.dur - 0.5, s.dur)), { bg: SALE_BLUE });
}

// ---------- 7. Big listings: 136 down to 3 ----------

function drawBig(s) {
  const swapAt = 4.5;
  const before = 'big-today', after = 'big-filtered';
  const beforeCam = camFit(before, union(rectOf(before, 'price'), rectOf(before, 'listbox')), { pad: 50, maxZoom: 1.3 });
  const afterCam = camFit(after, union(rectOf(after, 'price'), rectOf(after, 'listbox')), { pad: 70, maxZoom: 1.45 });
  const cam = camAt(s.t, [[0, { ...beforeCam, zoom: beforeCam.zoom * 0.92 }], [2.0, beforeCam], [swapAt, beforeCam], [swapAt + 1.0, afterCam]]);

  drawCapture(before, cam);
  drawCapture(after, cam, { alpha: seg(s.t, swapAt, swapAt + 0.6) });
  const listK = seg(s.t, 0.9, 1.7) * (1 - seg(s.t, swapAt - 0.3, swapAt));
  drawHighlight(rectToScreen(before, cam, rectOf(before, 'listbox')), listK, { alpha: listK > 0 ? 1 : 0 });
  drawHighlight(rectToScreen(after, cam, rectOf(after, 'callout')), seg(s.t, swapAt + 1.1, swapAt + 1.9), { color: SALE_RED });

  drawTag('136 variations', 64, 56, seg(s.t, 0.2, 0.7, easeOut) * (1 - seg(s.t, swapAt - 0.3, swapAt)), { bg: NAVY });
  drawTag('3 on sale', 64, 56, seg(s.t, swapAt + 0.2, swapAt + 0.7, easeOut) * (1 - seg(s.t, s.dur - 0.5, s.dur)), { bg: SALE_RED });
}

// ---------- 8 & 9. Closing cards: frosted glass over a checkout ----------

// Both cards share one checkout backdrop, so the cut between them only changes the words.
const checkoutBackdrop = () => ({
  capture: 'cart',
  frame: union(rectOf('cart', 'item'), rectOf('cart', 'checkout')),
  target: rectOf('cart', 'checkout'),
});
const closingCard = (eyebrow, points) => ({ eyebrow, points, accent: SALE_RED, ink: NAVY });

function drawPricing(s) {
  drawClickToBlur(s.t, checkoutBackdrop());
  drawGlassCard(seg(s.t, 2.0, 2.9, easeOut), closingCard('EVERY CUSTOMER, THEIR OWN PRICE', ['Uses each customer’s pricing', 'Pro and distributor accounts', 'see only their own discounts']));
}

function drawRollout(s) {
  drawClickToBlur(s.t + 20, checkoutBackdrop());
  drawGlassCard(seg(s.t, 0.3, 1.2, easeOut) * (1 - seg(s.t, s.dur - 2.8, s.dur - 2.1)), closingCard('ROLLING OUT', ['Switched on per collection', 'A/B tested with Intelligems', 'before it goes everywhere']));
  drawEndCard(seg(s.t, s.dur - 2.4, s.dur - 1.6), 'Sale-only view', { bg: NAVY });
}

defineScenes([
  { id: 'title', lines: ['intro'], lead: 1.4, tail: 1.0, draw: drawTitle },
  { id: 'today', lines: ['problem-a', 'problem-b'], lead: 0.5, gap: 0.5, tail: 0.6, draw: drawToday },
  { id: 'fix', lines: ['fix-a', 'fix-b'], lead: 0.9, gap: 0.5, tail: 0.8, draw: drawFix },
  { id: 'pick', lines: ['pick'], lead: 0.6, tail: 0.5, cut: true, draw: drawPick },
  { id: 'show-all', lines: ['show-all'], lead: 0.6, tail: 1.0, min: 4.2, cut: true, draw: drawShowAll },
  { id: 'all-on-sale', lines: ['all-on-sale'], lead: 1.0, tail: 1.4, min: 5.5, draw: drawAllOnSale },
  { id: 'big', lines: ['big'], lead: 0.5, tail: 1.6, min: 8.5, draw: drawBig },
  { id: 'pricing', lines: ['pricing'], lead: 2.2, tail: 0.6, draw: drawPricing },
  { id: 'rollout', lines: ['rollout'], lead: 0.4, tail: 3.4, cut: true, draw: drawRollout },
]);
