// The simple-buy-box walkthrough's shot list. See storyboard.md for the plan and what was checked against the theme,
// and voiceover.json for the words. Scene times are seconds from each scene's start; `beat(s, id, f)` is the moment
// a fraction `f` of the way through a voiced line, so beats stay on their words when the voice is re-timed.

const NAVY = '#1c365e';
const SALE_RED = '#b82b2b';
const FULL_FRAME = { x: 0, y: 0, w: W, h: H };
const SECTIONS = 6;

const beat = (s, id, f = 0) => { const l = s.line(id); return l.start + (l.end - l.start) * f; };
const on = (t, a, len = 0.8) => seg(t, a, a + len);
const off = (t, a, len = 0.4) => 1 - seg(t, a, a + len);

const TODAY = { label: 'Today', labelBg: NAVY };
const NEW = { label: 'New buy box', labelBg: SALE_RED };

const ring = (name, cam, box, key, k, opts) => drawHighlight(rectInPanel(name, cam, box, typeof key === 'string' ? rectOf(name, key) : key), k, opts);
const ringFull = (name, cam, key, k, opts) => drawHighlight(rectToScreen(name, cam, typeof key === 'string' ? rectOf(name, key) : key), k, opts);
// A full-frame shot's arm, in the header band where the site's own chrome sits.
const armTag = (arm, k = 1) => drawTag(arm.label, 40, 40, k, { bg: arm.labelBg, size: 28 });
const section = (s, number, title) => drawSectionCard(s.t, { number, of: SECTIONS, title, bg: NAVY, accent: '#e8a0a0' });
// Crossfades through a list of [capture, fromTime] under one camera.
const drawStates = (t, cam, states, fade = 0.3) => states.forEach(([name, at], i) => drawCapture(name, cam, { alpha: i === 0 ? 1 : seg(t, at, at + fade) }));
const drawStatesIn = (t, cam, box, states, fade = 0.3) => states.forEach(([name, at], i) => drawCaptureIn(name, cam, box, { alpha: i === 0 ? 1 : seg(t, at, at + fade) }));
const pointOf = (name, key, i) => centerOf(i === undefined ? rectOf(name, key) : rectOf(name, key, i));

// ---------- title ----------

function drawTitle(s) {
  drawMotionTitle(s, {
    capture: 'sol-new',
    eyebrow: 'PAINFUL PLEASURES  ·  PRODUCT PAGE A/B TEST',
    title: 'Simple buy box',
    subtitle: 'The new product page, and what changes for shoppers.',
    accent: SALE_RED,
  });
}

// ---------- 1 · Images and speed ----------

function drawImages(s) {
  const wide = (name, box) => camFitIn(name, rectOf(name, 'gallery'), box, { pad: 20, maxZoom: 1.2 });
  const close = (name, box) => {
    const g = rectOf(name, 'gallery');
    return camFitIn(name, { x: g.x + g.w * 0.3, y: g.y + g.h * 0.1, w: g.w * 0.4, h: g.h * 0.28 }, box, { pad: 0, maxZoom: 3.2 });
  };
  const push = seg(s.t, beat(s, 'images', 0.15), beat(s, 'images', 0.45));
  const lc = lerpCam(wide('sol-control', SPLIT_LEFT), close('sol-control', SPLIT_LEFT), push);
  const rc = lerpCam(wide('sol-new', SPLIT_RIGHT), close('sol-new', SPLIT_RIGHT), push);
  drawSplitCompare({ ...TODAY, capture: 'sol-control', cam: lc }, { ...NEW, capture: 'sol-new', cam: rc }, seg(s.t, 1.6, 2.1, easeOut));
  section(s, 1, 'Images and speed');
}

// The control's `body.loader-active` spinner is a pseudo-element centred in the 1440×810 capture viewport, so it has
// no element to measure. It's 50px, like the theme's SVG.
const CONTROL_LOADER = { x: 720 - 25, y: 405 - 25, w: 50, h: 50 };
// Drawn at twice its real size, so it reads in a half-width panel.
const CONTROL_LOADER_SHOWN = { x: 720 - 50, y: 405 - 50, w: 100, h: 100 };

// The still froze the spinner mid-turn. This redraws it over itself, animated the same way as the theme's SVG: twelve
// navy bars, each fading out over a second, staggered by a twelfth.
function drawLoaderSpin(r, t, alpha) {
  if (alpha <= 0) return;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, u = r.w / 100;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#f2f2f2';
  ctx.beginPath(); ctx.arc(cx, cy, r.w * 0.45, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = NAVY;
  for (let i = 0; i < 12; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((i * Math.PI) / 6);
    ctx.globalAlpha = alpha * (1 - ((t + 1 - (11 - i) / 12) % 1));
    ctx.beginPath(); ctx.roundRect(-3 * u, -26 * u, 6 * u, 12 * u, 3 * u); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawSpeed(s) {
  const frame = (name, box) => camFitIn(name, union(rectOf(name, 'gallery'), rectOf(name, 'swatches', 2), rectOf(name, 'addToCart' in shotOf(name).rects ? 'addToCart' : 'stepper')), box, { pad: 20, maxZoom: 1 });
  const clickL = beat(s, 'speed-a', 0.3), clickR = beat(s, 'speed-b', 0.12), newTurn = beat(s, 'speed-b', 0);
  // The real spinner is small, so Today pushes in on it and the swatch that set it off, then eases back out.
  const spinClose = camFitIn('sol-control', union(CONTROL_LOADER, rectOf('sol-control', 'swatches', 1), rectOf('sol-control', 'price')), SPLIT_LEFT, { pad: 40, maxZoom: 2.2 });
  const lc = camAt(s.t, [[clickL + 0.3, frame('sol-control', SPLIT_LEFT)], [clickL + 1.1, spinClose], [newTurn - 0.3, spinClose], [newTurn + 0.5, frame('sol-control', SPLIT_LEFT)]]);
  const rc = frame('sol-new', SPLIT_RIGHT);
  drawSplitCompare({ ...TODAY, capture: 'sol-control', cam: lc }, { ...NEW, capture: 'sol-new', cam: rc });
  drawCaptureIn('sol-control-spin', lc, SPLIT_LEFT, { alpha: seg(s.t, clickL + 0.05, clickL + 0.2) });
  drawCaptureIn('sol-new-pink', rc, SPLIT_RIGHT, { alpha: seg(s.t, clickR + 0.02, clickR + 0.12) });

  const pinkL = pointOf('sol-control', 'swatches', 1), pinkR = pointOf('sol-new', 'swatches', 1);
  drawCursorPathIn('sol-control', lc, SPLIT_LEFT, s.t, [[0, { x: pinkL.x + 120, y: pinkL.y + 160 }], [clickL - 0.1, pinkL], [clickL, pinkL, { click: true }], [clickL + 1.5, { x: pinkL.x + 60, y: pinkL.y + 90 }]], { alpha: off(s.t, beat(s, 'speed-a', 1)) });
  const spinAlpha = seg(s.t, clickL + 0.05, clickL + 0.2) * off(s.t, newTurn);
  drawLoaderSpin(rectInPanel('sol-control-spin', lc, SPLIT_LEFT, CONTROL_LOADER_SHOWN), s.t, spinAlpha);
  ring('sol-control-spin', lc, SPLIT_LEFT, CONTROL_LOADER_SHOWN, on(s.t, clickL + 0.5), { color: NAVY, alpha: off(s.t, newTurn) });
  drawCursorPathIn('sol-new', rc, SPLIT_RIGHT, s.t, [[newTurn - 0.8, { x: pinkR.x + 120, y: pinkR.y + 160 }], [clickR - 0.1, pinkR], [clickR, pinkR, { click: true }], [clickR + 1.5, { x: pinkR.x + 60, y: pinkR.y + 90 }]], { alpha: seg(s.t, newTurn - 0.8, newTurn - 0.5) });
  ring('sol-new-pink', rc, SPLIT_RIGHT, 'gallery', on(s.t, clickR + 0.3), { color: SALE_RED });
}

// ---------- 2 · What's available ----------

function drawAvailable(s) {
  const pickOos = beat(s, 'avail-a', 0.62), toClash = beat(s, 'avail-b', 0) - 0.4, pickCobalt = beat(s, 'avail-b', 0.3);
  const cardCam = camFit('flare-new', rectOf('flare-new', 'card'), { pad: 30, maxZoom: 1.3 });
  // The clash message pushes the card past the caption band, so the camera follows it down.
  const noteCam = camFit('flare-clash', union(rectOf('flare-25', 'cobalt'), rectOf('flare-clash', 'note')), { pad: 40, maxZoom: 1.3 });
  const cam = camAt(s.t, [[pickCobalt + 0.2, cardCam], [pickCobalt + 1, noteCam]]);
  drawStates(s.t, cam, [['flare-new', 0], ['flare-oos', pickOos], ['flare-25', toClash], ['flare-clash', pickCobalt]]);
  armTag(NEW);

  ringFull('flare-new', cam, union(...rectOf('flare-new', 'legends')), on(s.t, beat(s, 'avail-a', 0.08)), { alpha: off(s.t, beat(s, 'avail-a', 0.28)) });
  ringFull('flare-new', cam, 'amber', on(s.t, beat(s, 'avail-a', 0.3)), { color: SALE_RED, alpha: off(s.t, pickOos + 0.6) });
  ringFull('flare-oos', cam, 'notify', on(s.t, beat(s, 'avail-a', 0.8)), { color: SALE_RED, alpha: off(s.t, toClash) });
  const amber = pointOf('flare-new', 'amber'), cobalt = pointOf('flare-25', 'cobalt');
  drawCursorPath('flare-new', cam, s.t, [
    [beat(s, 'avail-a', 0.3), { x: amber.x + 140, y: amber.y + 180 }], [pickOos - 0.1, amber], [pickOos, amber, { click: true }],
    [toClash, { x: amber.x + 60, y: amber.y + 120 }], [pickCobalt - 0.1, cobalt], [pickCobalt, cobalt, { click: true }], [pickCobalt + 1.2, { x: cobalt.x + 80, y: cobalt.y + 140 }],
  ]);
  ringFull('flare-clash', cam, 'note', on(s.t, pickCobalt + 0.5), { color: SALE_RED, alpha: off(s.t, s.dur - 0.6) });
  section(s, 2, "What's available");
}

// ---------- 3 · Finding a color ----------

function drawCombo(s) {
  const a = s.line('combo-a'), b = s.line('combo-b'), cLine = s.line('combo-c'), d = s.line('combo-d');
  const typed = beat(s, 'combo-a', 0.35);
  const newCam = camFit('ink-typed', union(rectOf('ink-typed', 'combo'), rectOf('ink-typed', 'listbox')), { pad: 40, maxZoom: 1.4 });

  if (s.t < b.start - 0.2) {
    drawStates(s.t, newCam, [['ink-new', 0], ['ink-typed', typed]]);
    armTag(NEW);
    const field = pointOf('ink-new', 'combo');
    drawCursorPath('ink-new', newCam, s.t, [[0.8, { x: field.x + 200, y: field.y + 180 }], [typed - 0.5, field], [typed - 0.4, field, { click: true }]], { alpha: off(s.t, typed + 0.3) });
    ringFull('ink-typed', newCam, 'matches', on(s.t, beat(s, 'combo-a', 0.62)), { color: SALE_RED, alpha: off(s.t, b.start - 0.5) });
    ringFull('ink-typed', newCam, union(...rectOf('ink-typed', 'options').slice(0, 5)), on(s.t, beat(s, 'combo-a', 0.8)), { alpha: off(s.t, b.start - 0.5) });
  } else if (s.t < cLine.start - 0.2) {
    // Today's colour list is a native menu, drawn from the names the capture read off the page.
    const lc = camFitIn('ink-control', union(rectOf('ink-control', 'select'), rectOf('ink-control', 'price')), SPLIT_LEFT, { pad: 30, maxZoom: 1.3 });
    const rc = camFitIn('ink-typed', union(rectOf('ink-typed', 'combo'), rectOf('ink-typed', 'listbox')), SPLIT_RIGHT, { pad: 30, maxZoom: 1.3 });
    drawSplitCompare({ ...TODAY, capture: 'ink-control', cam: lc }, { ...NEW, capture: 'ink-typed', cam: rc });
    const names = shotOf('ink-control').data.names;
    drawNativeMenu(on(s.t, b.start + 0.1, 0.4), { from: rectInPanel('ink-control', lc, SPLIT_LEFT, rectOf('ink-control', 'select')), items: names, scroll: seg(s.t, b.start + 0.6, b.end + 0.2, (k) => k) });
  } else {
    // The main photo is taller than the caption-free frame even unzoomed, so the camera frames its middle.
    const g = rectOf('ink-picked', 'gallery'), photo = { x: g.x + g.w * 0.2, y: g.y + g.h * 0.15, w: g.w * 0.6, h: g.h * 0.5 };
    const pickCam = camFit('ink-picked', union(photo, rectOf('ink-picked', 'combo')), { pad: 30, maxZoom: 1.2 });
    const bulkCam = camFit('ink-bulk', union(rectOf('ink-bulk', 'back'), ...rectOf('ink-bulk', 'lines').slice(0, 4)), { pad: 40, maxZoom: 1.3 });
    const pick = cLine.start + 0.3, openBulk = beat(s, 'combo-d', 0.25);
    const cam = camAt(s.t, [[openBulk, pickCam], [openBulk + 1.1, bulkCam]]);
    drawStates(s.t, cam, [['ink-typed', 0], ['ink-picked', pick], ['ink-bulk', openBulk]]);
    armTag(NEW);
    const option = pointOf('ink-typed', 'options', 3), invite = pointOf('ink-picked', 'invite');
    drawCursorPath('ink-typed', cam, s.t, [[cLine.start - 0.4, { x: option.x + 160, y: option.y + 120 }], [pick - 0.1, option], [pick, option, { click: true }], [openBulk - 0.1, invite], [openBulk, invite, { click: true }]], { alpha: off(s.t, openBulk + 0.5) });
    ringFull('ink-picked', cam, 'combo', on(s.t, beat(s, 'combo-c', 0.25)), { color: SALE_RED, alpha: off(s.t, beat(s, 'combo-c', 0.55)) });
    ringFull('ink-bulk', cam, union(...rectOf('ink-bulk', 'lines').slice(0, 3)), on(s.t, openBulk + 1.2), { color: SALE_RED, alpha: off(s.t, s.dur - 0.5) });
  }
  section(s, 3, 'Finding a color');
}

// ---------- 4 · Sales and volume pricing ----------

function drawSale(s) {
  const lc = camFitIn('ball-control', union(rectOf('ball-control', 'sale'), rectOf('ball-control', 'price')), SPLIT_LEFT, { pad: 60, maxZoom: 1.4 });
  const rc = camFitIn('ball-8', union(rectOf('ball-8', 'price'), ...rectOf('ball-8', 'pills')), SPLIT_RIGHT, { pad: 40, maxZoom: 1.4 });
  const p10 = beat(s, 'sale', 0.55), p11 = beat(s, 'sale', 0.82);
  drawSplitCompare({ ...TODAY, capture: 'ball-control', cam: lc }, { ...NEW, capture: 'ball-8', cam: rc });
  drawStatesIn(s.t, rc, SPLIT_RIGHT, [['ball-8', 0], ['ball-10', p10], ['ball-11', p11]]);
  ring('ball-control', lc, SPLIT_LEFT, 'sale', on(s.t, beat(s, 'sale', 0.05)), { color: NAVY });
  ring('ball-10', rc, SPLIT_RIGHT, 'price', on(s.t, p10 + 0.3), { color: SALE_RED });
  const pill = (i) => pointOf('ball-8', 'pills', i);
  drawCursorPathIn('ball-8', rc, SPLIT_RIGHT, s.t, [[beat(s, 'sale', 0.3), { x: pill(1).x + 100, y: pill(1).y + 140 }], [p10 - 0.1, pill(1)], [p10, pill(1), { click: true }], [p11 - 0.1, pill(2)], [p11, pill(2), { click: true }], [p11 + 1, { x: pill(2).x + 60, y: pill(2).y + 120 }]]);
  section(s, 4, 'Sales and volume pricing');
}

function drawLadder(s) {
  const cam = camFit('ball-10', union(rectOf('ball-10', 'price'), rectOf('ball-10', 'tiers')), { pad: 50, maxZoom: 1.4 });
  drawCapture('ball-10', cam);
  armTag(NEW);
  ringFull('ball-10', cam, 'tiers', on(s.t, beat(s, 'ladder', 0.45)), { color: SALE_RED });
}

function drawQuantity(s) {
  const b = s.line('qty-b');
  if (s.t < b.start - 0.2) {
    const lc = camFitIn('tilum-control', rectOf('tilum-control', 'stepper'), SPLIT_LEFT, { pad: 50, maxZoom: 2.6 });
    const rc = camFitIn('tilum-new', rectOf('tilum-new', 'stepper'), SPLIT_RIGHT, { pad: 50, maxZoom: 2.6 });
    drawSplitCompare({ ...TODAY, capture: 'tilum-control', cam: lc }, { ...NEW, capture: 'tilum-new', cam: rc });
    ring('tilum-new', rc, SPLIT_RIGHT, 'stepper', on(s.t, beat(s, 'qty-a', 0.25)), { color: SALE_RED });
    return;
  }
  const frame = (name, box, keys) => camFitIn(name, union(...keys.map((key) => rectOf(name, key))), box, { pad: 30, maxZoom: 1.3 });
  const lc = frame('tilum-control-q5', SPLIT_LEFT, ['price', 'stepper']), rc = frame('tilum-new-q5', SPLIT_RIGHT, ['price', 'stepper']);
  const clicks = [0.2, 0.45, 0.7, 0.95].map((f) => b.start - 0.2 + f), settled = b.start + 1.1;
  drawSplitCompare({ ...TODAY, capture: 'tilum-control', cam: lc }, { ...NEW, capture: 'tilum-new', cam: rc });
  drawCaptureIn('tilum-control-q5', lc, SPLIT_LEFT, { alpha: seg(s.t, settled, settled + 0.4) });
  drawCaptureIn('tilum-new-q5', rc, SPLIT_RIGHT, { alpha: seg(s.t, settled, settled + 0.4) });
  const plus = pointOf('tilum-new', 'plus');
  drawCursorPathIn('tilum-new', rc, SPLIT_RIGHT, s.t, [[b.start - 0.4, { x: plus.x + 90, y: plus.y + 120 }], ...clicks.map((c) => [c, plus, { click: true }]), [settled + 0.8, { x: plus.x + 120, y: plus.y + 160 }]]);
  ring('tilum-new-q5', rc, SPLIT_RIGHT, 'price', on(s.t, beat(s, 'qty-b', 0.2)), { color: SALE_RED });
  ring('tilum-new-q5', rc, SPLIT_RIGHT, 'stepper', on(s.t, beat(s, 'qty-b', 0.05)), { color: SALE_RED, alpha: off(s.t, beat(s, 'qty-b', 0.2)) });
  ring('tilum-control-q5', lc, SPLIT_LEFT, 'price', on(s.t, beat(s, 'qty-b', 0.7)), { color: NAVY });
}

// ---------- 5 · Bulk ordering ----------

function drawBulk(s) {
  const a = s.line('bulk-a');
  const toNew = beat(s, 'bulk-a', 0.36), search = beat(s, 'bulk-a', 0.52), facet = beat(s, 'bulk-a', 0.68), sale = beat(s, 'bulk-a', 0.85);
  if (s.t < toNew) {
    // The control's list runs far past the frame, so its first screenful stands in for it.
    const box = rectOf('tilum-control-bulk', 'box'), head = { ...box, h: Math.min(box.h, 560) };
    const cam = camFit('tilum-control-bulk', head, { pad: 30, maxZoom: 1.2 });
    drawCapture('tilum-control-bulk', cam);
    armTag(TODAY);
    ringFull('tilum-control-bulk', cam, head, on(s.t, a.start + 0.3), { color: NAVY });
  } else {
    const cam = camFit('tilum-bulk', union(rectOf('tilum-bulk', 'facets'), rectOf('tilum-bulk', 'filter'), ...rectOf('tilum-bulk', 'lines').slice(0, 2)), { pad: 30, maxZoom: 1.3 });
    drawStates(s.t, cam, [['tilum-bulk', 0], ['tilum-bulk-search', search], ['tilum-bulk-facet', facet], ['tilum-bulk-sale', sale]]);
    armTag(NEW, seg(s.t, toNew, toNew + 0.4));
    ringFull('tilum-bulk', cam, 'filter', on(s.t, search, 0.5), { color: SALE_RED, alpha: off(s.t, facet - 0.1) });
    ringFull('tilum-bulk', cam, 'facet', on(s.t, facet, 0.5), { color: SALE_RED, alpha: off(s.t, sale - 0.1) });
    ringFull('tilum-bulk', cam, 'onSale', on(s.t, sale, 0.5), { color: SALE_RED });
  }
  section(s, 5, 'Bulk ordering');
}

function drawTyped(s) {
  const name = 'tilum-bulk-typed';
  const rows = camFit(name, union(...rectOf(name, 'lines').slice(0, 6)), { pad: 30, maxZoom: 1.3 });
  const receipt = camFit(name, union(rectOf(name, 'footer'), rectOf(name, 'receipt')), { pad: 30, maxZoom: 1.3 });
  const cam = camAt(s.t, [[beat(s, 'bulk-b', 0.4), rows], [beat(s, 'bulk-b', 0.6), receipt]]);
  drawCapture(name, cam);
  armTag(NEW);
  ringFull(name, cam, 'receipt', on(s.t, beat(s, 'bulk-b', 0.65)), { color: SALE_RED });
}

function drawReset(s) {
  const lc = camFitIn('tilum-control-bulk', rectOf('tilum-control-bulk', 'reset'), SPLIT_LEFT, { pad: 160, maxZoom: 1.3 });
  const rc = camFitIn('tilum-bulk-typed', union(rectOf('tilum-bulk-typed', 'reset'), rectOf('tilum-bulk-typed', 'footer')), SPLIT_RIGHT, { pad: 80, maxZoom: 1.3 });
  drawSplitCompare({ ...TODAY, capture: 'tilum-control-bulk', cam: lc }, { ...NEW, capture: 'tilum-bulk-typed', cam: rc });
  ring('tilum-control-bulk', lc, SPLIT_LEFT, 'reset', on(s.t, beat(s, 'bulk-c', 0.1)), { color: NAVY });
  const click = beat(s, 'bulk-c', 0.72), link = pointOf('tilum-bulk-typed', 'reset');
  ring('tilum-bulk-typed', rc, SPLIT_RIGHT, 'reset', on(s.t, beat(s, 'bulk-c', 0.5)), { color: SALE_RED, alpha: off(s.t, click) });
  drawCursorPathIn('tilum-bulk-typed', rc, SPLIT_RIGHT, s.t, [[beat(s, 'bulk-c', 0.45), { x: link.x + 120, y: link.y + 140 }], [click - 0.1, link], [click, link, { click: true }]], { alpha: off(s.t, click + 0.2) });
  drawConfirmDialog(on(s.t, click + 0.15, 0.35), { origin: 'www.painfulpleasures.com', message: 'Clear every quantity in this bulk order? This cannot be undone.', anchor: { x: SPLIT_RIGHT.x + SPLIT_RIGHT.w / 2, y: 200 } });
}

function drawWhy(s) {
  const cam = camFit('tilum-bulk', rectOf('tilum-bulk', 'card'), { pad: 60, maxZoom: 1.1 });
  const k = seg(s.t, 0, 0.9);
  drawCapture('tilum-bulk', cam, { blur: 30 * k });
  drawWash('22, 40, 70', 0.62 * k, 0.38 * k, { x0: 0, x1: W });
  drawGlassCard(seg(s.t, 0.4, 1.3, easeOut), {
    eyebrow: 'ADDED TO CART, 15 DAYS',
    points: ['One item at a time   ~$1.1M', 'Bulk ordering          ~$84K', 'Now tracking bulk opens'],
    accent: SALE_RED,
    ink: NAVY,
  });
}

// ---------- 6 · On phones ----------

function drawPhoneBar(s) {
  const phone = { cx: W / 2 - 330, cy: 432, height: 800 };
  const toBar = beat(s, 'mobile-a', 0.25);
  drawPhone('phone-top', phone);
  const bar = drawPhone('phone-bar', { ...phone, alpha: seg(s.t, toBar, toBar + 0.5) });
  drawHighlight(rectInPanel('phone-bar', bar.cam, bar.box, rectOf('phone-bar', 'bar')), on(s.t, toBar + 0.6), { color: SALE_RED, pad: 4 });
  const x = W / 2 + 40, rise = (f) => seg(s.t, beat(s, 'mobile-a', f), beat(s, 'mobile-a', f) + 0.7, easeOut);
  drawText('ON PHONES', x, 330, { size: 30, weight: 700, color: SALE_RED, k: rise(0), spacing: 0.1 });
  drawText('Price and options', x, 430, { size: 60, weight: 700, color: NAVY, k: rise(0.3), spacing: -0.015 });
  drawText('stay in reach', x, 504, { size: 60, weight: 700, color: NAVY, k: rise(0.35), spacing: -0.015 });
  section(s, 6, 'On phones');
}

function drawPhoneBulk(s) {
  const left = { cx: W / 2 - 330, cy: 470, height: 740 }, right = { cx: W / 2 + 330, cy: 470, height: 740 };
  const today = drawPhone('phone-control-bulk', left), next = drawPhone('phone-bulk', right);
  drawTag(TODAY.label, left.cx - 60, 36, 1, { bg: NAVY, size: 28 });
  drawTag(NEW.label, right.cx - 100, 36, 1, { bg: SALE_RED, size: 28 });
  drawHighlight(rectInPanel('phone-bulk', next.cam, next.box, rectOf('phone-bulk', 'footer')), on(s.t, beat(s, 'mobile-b', 0.3)), { color: SALE_RED, pad: 4 });
  drawHighlight(rectInPanel('phone-control-bulk', today.cam, today.box, rectOf('phone-control-bulk', 'scroller')), on(s.t, beat(s, 'mobile-b', 0.7)), { color: NAVY, pad: 4 });
}

function drawEnd(s) {
  drawEndCard(seg(s.t, 0, 0.6), 'Simple buy box', { bg: NAVY });
}

// Section scenes open on a card and start their voice under it (lead < the card's hold), so the card costs no time.
const OPEN = 0.9;
defineScenes([
  { id: 'title', lines: ['intro'], lead: 1.4, tail: 1.0, draw: drawTitle },
  { id: 'images', lines: ['images'], lead: OPEN + 1.2, tail: 0.6, draw: drawImages },
  { id: 'speed', lines: ['speed-a', 'speed-b'], lead: 0.4, gap: 1.2, tail: 1.2, draw: drawSpeed },
  { id: 'available', lines: ['avail-a', 'avail-b'], lead: OPEN, gap: 0.6, tail: 1.4, draw: drawAvailable },
  { id: 'combo', lines: ['combo-a', 'combo-b', 'combo-c', 'combo-d'], lead: OPEN, gap: 0.6, tail: 1.6, draw: drawCombo },
  { id: 'sale', lines: ['sale'], lead: OPEN, tail: 1.0, draw: drawSale },
  { id: 'ladder', lines: ['ladder'], lead: 0.3, tail: 0.8, draw: drawLadder },
  { id: 'quantity', lines: ['qty-a', 'qty-b'], lead: 0.4, gap: 1.2, tail: 1.2, draw: drawQuantity },
  { id: 'bulk', lines: ['bulk-a'], lead: OPEN + 0.3, tail: 0.8, draw: drawBulk },
  { id: 'typed', lines: ['bulk-b'], lead: 0.3, tail: 0.6, draw: drawTyped },
  { id: 'reset', lines: ['bulk-c'], lead: 0.3, tail: 1.4, draw: drawReset },
  { id: 'why', lines: ['why'], lead: 1.0, tail: 1.2, draw: drawWhy },
  { id: 'phone-bar', lines: ['mobile-a'], lead: OPEN, tail: 0.8, draw: drawPhoneBar },
  { id: 'phone-bulk', lines: ['mobile-b'], lead: 0.3, tail: 1.4, draw: drawPhoneBulk },
  { id: 'end', lines: [], min: 3, draw: drawEnd },
]);
