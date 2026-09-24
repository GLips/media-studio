// kit.js: shots that recur across videos, built from engine.js primitives. Load it after engine.js.
//
// Each shot is a pure function of time like everything else, and takes its colours and words as arguments, so a
// project brings its own brand. Text-bearing shots keep clear of CAPTION_SAFE_TOP, where burned-in captions sit.

// ---------- panels: a capture in part of the frame ----------
// A panel is a screen box showing a capture through its own camera: halves of a before/after, a phone screen. The
// camera keeps engine.js's shape ({ cx, cy, zoom }, zoom 1 = capture width fills the frame), so rects and cursor
// paths work the same way, through rectInPanel instead of rectToScreen.

/**
 * The camera that frames page `rect` inside screen `box`, never narrower than the box's share of the capture. Like
 * camFit, it centres the rect in the part of the box above the caption band.
 */
function camFitIn(name, rect, box, { pad = 40, maxZoom = 1.6 } = {}) {
  const area = { ...box, h: Math.min(box.h, CAPTION_FREE.h - box.y) };
  const k1 = scaleFor(name, 1);
  const zoom = Math.max(box.w / W, Math.min(maxZoom, area.w / ((rect.w + pad * 2) * k1), area.h / ((rect.h + pad * 2) * k1)));
  const shot = shotOf(name), k = scaleFor(name, zoom);
  const { x, y } = centerOf(rect);
  const cx = x, cy = y - (area.y + area.h / 2 - (box.y + box.h / 2)) / k;
  const halfW = box.w / k / 2, halfH = box.h / k / 2;
  return { cx: clamp(cx, halfW, Math.max(halfW, shot.w - halfW)), cy: clamp(cy, halfH, Math.max(halfH, shot.h - halfH)), zoom };
}

/** Paints a capture through a camera, clipped to screen `box`. */
function drawCaptureIn(name, cam, box, { alpha = 1 } = {}) {
  if (alpha <= 0) return;
  const shot = shotOf(name), k = scaleFor(name, cam.zoom), g = c();
  g.save();
  g.globalAlpha *= alpha;
  g.beginPath();
  g.rect(box.x, box.y, box.w, box.h);
  g.clip();
  g.fillStyle = '#fff';
  g.fillRect(box.x, box.y, box.w, box.h);
  const sx = cam.cx - box.w / k / 2, sy = cam.cy - box.h / k / 2;
  g.drawImage(IMAGES[name], sx * shot.scale, sy * shot.scale, (box.w / k) * shot.scale, (box.h / k) * shot.scale, box.x, box.y, box.w, box.h);
  g.restore();
}

/** A page rect (or point, with w/h 0) mapped onto the screen through a panel's camera. */
function rectInPanel(name, cam, box, r) {
  const k = scaleFor(name, cam.zoom);
  return { x: (r.x - cam.cx) * k + box.x + box.w / 2, y: (r.y - cam.cy) * k + box.y + box.h / 2, w: (r.w || 0) * k, h: (r.h || 0) * k };
}

/** drawCursorPath for a panel: the same page-space waypoints, drawn through the panel's camera. */
function drawCursorPathIn(name, cam, box, t, keys, opts = {}) {
  drawCursorPath(name, cam, t, keys, { ...opts, map: (p) => rectInPanel(name, cam, box, p) });
}

// The labels live in their own strip above the panels, so a label can never cover the page it names.
const SPLIT_LABEL_STRIP = 92;
const SPLIT_LEFT = { x: 0, y: SPLIT_LABEL_STRIP, w: W / 2 - 2, h: H - SPLIT_LABEL_STRIP };
const SPLIT_RIGHT = { x: W / 2 + 2, y: SPLIT_LABEL_STRIP, w: W / 2 - 2, h: H - SPLIT_LABEL_STRIP };

/**
 * Before and after, side by side: each side { capture, cam, label, labelBg, alpha }. Use SPLIT_LEFT / SPLIT_RIGHT
 * with camFitIn and rectInPanel to aim cameras and highlights. `k` fades the labels in.
 */
function drawSplitCompare(left, right, k = 1) {
  const g = c();
  g.save();
  g.fillStyle = '#eef1f5';
  g.fillRect(0, 0, W, SPLIT_LABEL_STRIP);
  g.fillStyle = '#d5d9e0';
  g.fillRect(W / 2 - 2, 0, 4, H);
  g.fillRect(0, SPLIT_LABEL_STRIP - 2, W, 2);
  g.restore();
  for (const [side, box] of [[left, SPLIT_LEFT], [right, SPLIT_RIGHT]]) {
    drawCaptureIn(side.capture, side.cam, box, { alpha: side.alpha ?? 1 });
    if (side.label) drawTag(side.label, box.x + 32, (SPLIT_LABEL_STRIP - 53) / 2, k, { bg: side.labelBg, size: 28 });
  }
}

/**
 * A phone at screen centre (cx, cy) showing a viewport capture (see `scrollY` in lib/capture.mjs). Returns the
 * screen box and camera, for rectInPanel. `height` is the whole device in frame pixels.
 */
function drawPhone(name, { cx = W / 2, cy = H / 2 + 10, height = 980, alpha = 1 } = {}) {
  const shot = shotOf(name);
  const bezel = 14;
  const screen = { h: height - bezel * 2 };
  screen.w = screen.h * (shot.w / shot.h);
  screen.x = cx - screen.w / 2;
  screen.y = cy - screen.h / 2;
  const cam = { cx: shot.w / 2, cy: shot.h / 2, zoom: screen.w / W };
  const g = c();
  g.save();
  g.globalAlpha *= alpha;
  g.shadowColor = 'rgba(10, 20, 40, 0.35)';
  g.shadowBlur = 70;
  g.shadowOffsetY = 24;
  g.fillStyle = '#15171b';
  roundRect(g, screen.x - bezel, screen.y - bezel, screen.w + bezel * 2, screen.h + bezel * 2, 64);
  g.fill();
  g.restore();
  g.save();
  g.globalAlpha *= alpha;
  roundRect(g, screen.x, screen.y, screen.w, screen.h, 50);
  g.clip();
  drawCaptureIn(name, cam, screen, { alpha: 1 });
  g.restore();
  return { box: screen, cam };
}

// ---------- whole shots ----------

/** Crossfades one capture into another under the same camera: a "the page updated" moment. `k` 0..1. */
function drawCaptureSwap(fromName, toName, cam, k) {
  drawCapture(fromName, cam);
  if (k > 0) drawCapture(toName, cam, { alpha: ease(k) });
}

/**
 * An opening title over a capture scrolling top to bottom, with a directional motion smear masked into the
 * bottom-left behind the type: the product stays visible, and the title sits on motion instead of a flat card.
 *   { capture, eyebrow, title, subtitle, accent, wash }   `wash` is an "r, g, b" string for the darkening gradient.
 */
function drawMotionTitle(s, { capture, eyebrow, title, subtitle, accent, wash = '16, 30, 54' }) {
  const shot = shotOf(capture);
  const top = camTop(capture);
  const bottom = { ...top, cy: shot.h - top.cy };
  const k = s.t / (s.dur + 0.5);
  const cam = lerpCam(top, bottom, k);
  drawCapture(capture, cam);

  const smear = scratch('title-smear');
  const sg = smear.getContext('2d');
  withContext(sg, () => drawCaptureMotion(capture, lerpCam(top, bottom, k - 0.05), cam, 1, { shutter: 1, samples: 48 }));
  sg.save();
  sg.globalCompositeOperation = 'destination-in';
  const mask = sg.createLinearGradient(0, H, W * 0.75, 0);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.45, 'rgba(0,0,0,0.85)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = mask;
  sg.fillRect(0, 0, W, H);
  sg.restore();
  c().drawImage(smear, 0, 0);
  drawWash(wash, 0.9, 0.3, { x0: 0, y0: H, x1: W * 0.95, y1: 0 });

  // The block hangs from the accent bar, which sits a clear gap above the caption band.
  const barY = CAPTION_SAFE_TOP - 120;
  const inK = (at) => seg(s.t, at, at + 0.7, easeOut);
  if (eyebrow) drawText(eyebrow, 120, barY - 230, { size: 26, weight: 600, color: 'rgba(255,255,255,0.75)', k: inK(0.3), spacing: 0.12 });
  drawText(title, 114, barY - 110, { size: 124, weight: 800, k: inK(0.5), spacing: -0.025 });
  if (subtitle) drawText(subtitle, 120, barY - 35, { size: 42, weight: 500, color: 'rgba(255,255,255,0.88)', k: inK(0.8) });
  const g = c();
  g.save();
  g.fillStyle = accent;
  g.fillRect(120, barY, 150 * inK(1.0), 8);
  g.restore();
}

/**
 * A page that the cursor clicks, which then blurs out under a tinted wash: the backdrop for closing glass cards.
 *   { capture, frame, target, clickAt, from, blur, wash, push }
 * `frame` is the page rect the camera holds on, `target` the rect clicked, `from` the cursor's start offset from the
 * target, `push` a slow zoom over 18s so the backdrop never sits dead still. Pass a later `t` to resume mid-push.
 */
function drawClickToBlur(t, { capture, frame, target, clickAt = 1.3, from = { dx: -220, dy: 160 }, blur = 34, wash = '22, 40, 70', push = 1.08 }) {
  const start = camFit(capture, frame, { pad: 80, maxZoom: 1.25 });
  const cam = camAt(t, [[0, start], [18, { ...start, zoom: start.zoom * push }]]);
  const k = seg(t, clickAt + 0.3, clickAt + 1.4);
  drawCapture(capture, cam, { blur: blur * k });
  if (t < clickAt + 0.6) {
    const p = centerOf(target);
    drawCursorPath(capture, cam, t, [[0, { x: p.x + from.dx, y: p.y + from.dy }], [clickAt - 0.1, p], [clickAt, p, { click: true }]]);
  }
  // Without the wash, a white glass card over a white page reads as a smudge rather than a pane.
  drawWash(wash, 0.62 * k, 0.38 * k, { x0: 0, x1: W });
}

/** A frosted card with an eyebrow and a few big lines that stagger in. `k` 0..1 drives the entrance. */
function drawGlassCard(k, { eyebrow, points, accent, ink, rect = { x: (W - 1120) / 2, y: 270, w: 1120, h: 540 } }) {
  if (k <= 0) return;
  const r = rect;
  const y0 = r.y + (1 - easeOut(k)) * 40;
  drawGlass({ ...r, y: y0 }, { alpha: clamp(k * 1.4), tint: 'rgba(255,255,255,0.78)', blur: 24 });
  drawText(eyebrow, r.x + 88, y0 + 126, { size: 28, weight: 700, color: accent, k, spacing: 0.1 });
  points.forEach((p, i) => {
    const pk = clamp((k - 0.15 * (i + 1)) / 0.6);
    drawText(p, r.x + 88, y0 + 250 + i * 104, { size: 60, weight: 700, color: ink, k: pk, spacing: -0.015 });
  });
}

/**
 * A full-frame card naming the section that follows, e.g. "3 / 6 · Finding a color". It holds for `hold` seconds of
 * scene time, then slides up to uncover the scene drawn beneath it. Start the scene's first line during the hold, so
 * the voice carries straight on and the card costs no time.
 *   { number, of, title, bg, accent }
 */
function drawSectionCard(t, { number, of, title, bg, accent, hold = 1.3 }) {
  const out = seg(t, hold, hold + 0.55, easeInOut);
  if (out >= 1) return;
  const g = c(), y = -out * H;
  g.save();
  g.fillStyle = bg;
  g.fillRect(0, y, W, H);
  g.restore();
  const inK = seg(t, 0, 0.5, easeOut);
  drawText(`${number} / ${of}`, 160, y + H / 2 - 70, { size: 34, weight: 700, color: accent, k: inK, spacing: 0.08 });
  drawText(title, 154, y + H / 2 + 50, { size: 112, weight: 800, k: seg(t, 0.1, 0.6, easeOut), spacing: -0.025 });
  g.save();
  g.fillStyle = accent;
  g.fillRect(160, y + H / 2 + 100, 150 * seg(t, 0.3, 0.8, easeOut), 8);
  g.restore();
}

/**
 * The browser's own confirm() box, which a screenshot can't catch because it isn't part of the page. `anchor` is the
 * screen point it drops from (the top centre of a real one sits under the address bar). `k` 0..1 brings it in.
 *   { origin, message, anchor }
 */
function drawConfirmDialog(k, { origin, message, anchor = { x: W / 2, y: 120 } }) {
  if (k <= 0) return;
  const g = c(), w = 640, pad = 34;
  g.save();
  g.font = `400 26px ${FONT}`;
  const lines = wrapLines(g, message, w - pad * 2);
  g.restore();
  const h = pad + 44 + lines.length * 36 + 36 + 56 + pad;
  const x = anchor.x - w / 2, y = anchor.y + (1 - easeOut(k)) * -20;
  g.save();
  g.globalAlpha *= clamp(k);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fillRect(0, 0, W, H);
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = 40;
  g.shadowOffsetY = 12;
  g.fillStyle = '#fff';
  roundRect(g, x, y, w, h, 16);
  g.fill();
  g.shadowColor = 'transparent';
  g.fillStyle = '#1f1f1f';
  g.font = `600 28px ${FONT}`;
  g.textBaseline = 'top';
  g.fillText(`${origin} says`, x + pad, y + pad);
  g.font = `400 26px ${FONT}`;
  lines.forEach((l, i) => g.fillText(l, x + pad, y + pad + 50 + i * 36));
  const by = y + h - pad - 52;
  const button = (label, bx, bw, primary) => {
    g.fillStyle = primary ? '#0b57d0' : '#fff';
    g.strokeStyle = '#c4c7c5';
    g.lineWidth = primary ? 0 : 2;
    roundRect(g, bx, by, bw, 52, 26);
    g.fill();
    if (!primary) g.stroke();
    g.fillStyle = primary ? '#fff' : '#0b57d0';
    g.font = `600 24px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, bx + bw / 2, by + 27);
    g.textAlign = 'left';
  };
  button('OK', x + w - pad - 100, 100, true);
  button('Cancel', x + w - pad - 100 - 20 - 130, 130, false);
  g.restore();
}

/**
 * A native <select> menu, open, which a screenshot can't catch: the page's own option names (see `data` in
 * lib/capture.mjs) in a plain list dropped from screen rect `from`. `scroll` 0..1 runs the list from top to bottom.
 */
function drawNativeMenu(k, { from, items, scroll = 0, rowH = 34, bottom = CAPTION_FREE.h }) {
  if (k <= 0) return;
  const g = c();
  const x = from.x, y = from.y + from.h + 4, w = from.w;
  const h = Math.min(bottom - y, items.length * rowH + 12);
  const offset = scroll * Math.max(0, items.length * rowH + 12 - h);
  g.save();
  g.globalAlpha *= clamp(k);
  g.shadowColor = 'rgba(0,0,0,0.3)';
  g.shadowBlur = 30;
  g.shadowOffsetY = 10;
  g.fillStyle = '#fbfbfb';
  roundRect(g, x, y, w, h * easeOut(k), 10);
  g.fill();
  g.shadowColor = 'transparent';
  g.clip();
  g.font = `400 ${Math.round(rowH * 0.56)}px ${FONT}`;
  g.fillStyle = '#1f1f1f';
  g.textBaseline = 'middle';
  items.forEach((item, i) => {
    const ry = y + 6 + i * rowH - offset;
    if (ry + rowH < y || ry > y + h) return;
    g.fillText(item, x + 18, ry + rowH / 2);
  });
  g.restore();
}

/** A solid card with one centred line, faded in by `k`: the last frame. */
function drawEndCard(k, title, { bg }) {
  if (k <= 0) return;
  const g = c();
  g.save();
  g.globalAlpha = k;
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.restore();
  drawText(title, W / 2, H / 2 + 30, { size: 96, weight: 800, align: 'center', k, spacing: -0.025 });
}
