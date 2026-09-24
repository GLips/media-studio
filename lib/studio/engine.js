// engine.js: the runtime a project's studio.html loads to paint walkthrough frames.
//
// Every frame is a pure function of time: `renderAt(t)` paints the whole frame from `t` alone, so lib/render.mjs can
// render frames in parallel and out of order. Nothing may carry over between frames, and nothing may be random.
//
// A project supplies:
//   window.CAPTURES   captures/index.js from lib/capture.mjs: screenshots plus page-space rects
//   window.VOICEOVER  audio/manifest.js from scripts/tts.mjs: each voiced line's file and duration
//   defineScenes([...]) the shot list: each scene names its voice lines and draws itself (see defineScenes below)
// kit.js, loaded after this file, has ready-made shots (titles, glass cards, end cards) built from these primitives.
//
// Page coordinates are the capture's CSS pixels. A camera is { cx, cy, zoom }: the page point at frame centre, and a
// zoom where 1 fits the capture's viewport width to the frame.

const W = 1920;
const H = 1080;
const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';

const canvas = document.getElementById('out');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
const SHOW_CAPTIONS = params.has('captions');

// ---------- timing ----------

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => { k = clamp(k); return k * k * (3 - 2 * k); };
const easeOut = (k) => 1 - Math.pow(1 - clamp(k), 3);
const easeInOut = (k) => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
// Progress 0..1 through [a, b], eased.
const seg = (t, a, b, fn = easeInOut) => fn(clamp((t - a) / (b - a)));

// ---------- scenes ----------

let SCENES = [];
let DUR = 0;
const AUDIO_CUES = [];
const CAPTION_CUES = [];

/**
 * Registers the shot list and lays it out against the voiced lines.
 *
 * A scene is { id, lines: [lineId...], lead, gap, tail, min, draw(s) }. Its length is lead + its lines (with `gap`
 * between them) + tail, or `min` if longer. `draw` receives a scene clock:
 *   s.t          seconds since the scene started (negative or past s.dur while crossfading)
 *   s.dur        the scene's length
 *   s.line(id)   { start, end } of a voiced line, in scene time
 *
 * Adjacent scenes crossfade over `xfade` seconds centred on the cut, unless the later scene sets `cut: true`.
 */
function defineScenes(list, { xfade = 0.5 } = {}) {
  let start = 0;
  SCENES = list.map((scene) => {
    const { lead = 0.5, gap = 0.35, tail = 0.6, min = 0 } = scene;
    const lines = {};
    let cursor = lead;
    (scene.lines || []).forEach((id, i) => {
      const voiced = window.VOICEOVER?.[id];
      if (!voiced) throw new Error(`scene ${scene.id}: line "${id}" has no audio. Run npm run tts first.`);
      if (i > 0) cursor += gap;
      lines[id] = { start: cursor, end: cursor + voiced.duration };
      AUDIO_CUES.push({ src: voiced.src, start: start + cursor });
      CAPTION_CUES.push({ text: voiced.text, start: start + cursor, end: start + cursor + voiced.duration });
      cursor += voiced.duration;
    });
    const dur = Math.max(cursor + tail, min);
    const laid = { ...scene, start, dur, lines, xfade: scene.cut ? 0 : xfade };
    start += dur;
    return laid;
  });
  DUR = start;
}

function sceneClock(scene, t) {
  return {
    t: t - scene.start,
    dur: scene.dur,
    line: (id) => {
      const l = scene.lines[id];
      if (!l) throw new Error(`scene ${scene.id} has no line "${id}"`);
      return l;
    },
  };
}

function drawWorld(t) {
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  const i = Math.max(0, SCENES.findIndex((s, j) => t >= s.start && (t < s.start + s.dur || j === SCENES.length - 1)));
  const scene = SCENES[i];
  const next = SCENES[i + 1];
  const prev = SCENES[i - 1];

  // Crossfades straddle the cut: the outgoing scene keeps playing under the incoming one.
  const inFromPrev = prev && scene.xfade && t - scene.start < scene.xfade / 2;
  const intoNext = next && next.xfade && next.start - t < next.xfade / 2;

  if (inFromPrev) {
    const k = ease((t - scene.start + scene.xfade / 2) / scene.xfade);
    paintScene(prev, t, 1);
    paintScene(scene, t, k);
  } else if (intoNext) {
    const k = ease((t - next.start + next.xfade / 2) / next.xfade);
    paintScene(scene, t, 1);
    paintScene(next, t, k);
  } else {
    paintScene(scene, t, 1);
  }

  if (SHOW_CAPTIONS) drawCaption(t);
}

function paintScene(scene, t, alpha) {
  if (alpha <= 0) return;
  if (alpha >= 1) { scene.draw(sceneClock(scene, t)); return; }
  // Paint onto a scratch canvas so the whole scene fades as one layer, not shape by shape.
  const layer = scratch('fade');
  const saved = ctx;
  withContext(layer.getContext('2d'), () => scene.draw(sceneClock(scene, t)));
  saved.save();
  saved.globalAlpha = alpha;
  saved.drawImage(layer, 0, 0);
  saved.restore();
}

// Scene code draws through the global `ctx`; this swaps it for a layer and restores it after.
let activeCtx = ctx;
function withContext(layerCtx, fn) {
  const previous = activeCtx;
  activeCtx = layerCtx;
  layerCtx.save();
  layerCtx.clearRect(0, 0, W, H);
  layerCtx.fillStyle = '#fff';
  layerCtx.fillRect(0, 0, W, H);
  try { fn(); } finally { layerCtx.restore(); activeCtx = previous; }
}
const c = () => activeCtx;

const SCRATCH = {};
function scratch(name, w = W, h = H) {
  const key = `${name}:${w}x${h}`;
  if (!SCRATCH[key]) {
    SCRATCH[key] = document.createElement('canvas');
    SCRATCH[key].width = w;
    SCRATCH[key].height = h;
  }
  return SCRATCH[key];
}

// ---------- captures and camera ----------

const IMAGES = {};
function loadImages() {
  return Promise.all(Object.entries(window.CAPTURES).map(([name, shot]) => new Promise((ok, bad) => {
    const img = new Image();
    img.onload = () => { IMAGES[name] = img; ok(); };
    img.onerror = () => bad(new Error(`could not load ${shot.src}`));
    img.src = shot.src;
  })));
}

const shotOf = (name) => {
  const shot = window.CAPTURES[name];
  if (!shot) throw new Error(`no capture named "${name}"`);
  return shot;
};

/** A capture's rect by key; `index` picks from rects measured with `{ all: true }`. */
function rectOf(name, key, index) {
  const rect = shotOf(name).rects[key];
  if (!rect) throw new Error(`capture ${name} has no rect "${key}"`);
  return index === undefined ? rect : rect[index];
}

const centerOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const union = (...rects) => {
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
};

// Pixels on screen per page pixel.
const scaleFor = (name, zoom) => (W / shotOf(name).w) * zoom;

/** The camera that shows the top of a capture at zoom 1: the page as a visitor first sees it. */
function camTop(name) {
  const shot = shotOf(name);
  return { cx: shot.w / 2, cy: (H / scaleFor(name, 1)) / 2, zoom: 1 };
}

/**
 * The camera that frames `rect` with `pad` page pixels around it, as large as fits, capped at `maxZoom` (captures
 * are 2× device pixels, so past ~1.6 text starts to soften).
 */
function camFit(name, rect, { pad = 40, maxZoom = 1.6, dx = 0, dy = 0 } = {}) {
  const k1 = scaleFor(name, 1);
  const zoom = Math.min(maxZoom, W / ((rect.w + pad * 2) * k1), H / ((rect.h + pad * 2) * k1));
  const { x, y } = centerOf(rect);
  return clampCam(name, { cx: x + dx, cy: y + dy, zoom: Math.max(1, zoom) });
}

// Keeps the view inside the capture so the frame never shows past its edges.
function clampCam(name, cam) {
  const shot = shotOf(name), k = scaleFor(name, cam.zoom);
  const halfW = W / k / 2, halfH = H / k / 2;
  return { ...cam, cx: clamp(cam.cx, halfW, shot.w - halfW), cy: clamp(cam.cy, halfH, shot.h - halfH) };
}

/** Interpolates cameras with zoom in log space, so pushes feel constant-speed. */
function lerpCam(a, b, k) {
  return { cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k), zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), k)) };
}

/** Camera along keyframes [[time, cam], ...], eased between each pair. */
function camAt(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) return lerpCam(keys[i - 1][1], keys[i][1], seg(t, keys[i - 1][0], keys[i][0]));
  }
  return keys[keys.length - 1][1];
}

const toScreen = (name, cam, p) => {
  const k = scaleFor(name, cam.zoom);
  return { x: (p.x - cam.cx) * k + W / 2, y: (p.y - cam.cy) * k + H / 2 };
};
const rectToScreen = (name, cam, r) => {
  const a = toScreen(name, cam, r), k = scaleFor(name, cam.zoom);
  return { x: a.x, y: a.y, w: r.w * k, h: r.h * k };
};

/** Paints a capture through a camera. `blur` is a CSS blur radius in frame pixels. */
function drawCapture(name, cam, { alpha = 1, blur = 0 } = {}) {
  const shot = shotOf(name), img = IMAGES[name], k = scaleFor(name, cam.zoom);
  const g = c();
  g.save();
  g.globalAlpha *= alpha;
  if (blur) g.filter = `blur(${blur}px)`;
  const pad = blur ? blur * 3 / k : 0;
  // Source is in device pixels; the image is `shot.scale` times the page size.
  const sx = cam.cx - W / k / 2 - pad, sy = cam.cy - H / k / 2 - pad;
  const sw = W / k + pad * 2, sh = H / k + pad * 2;
  g.drawImage(img, sx * shot.scale, sy * shot.scale, sw * shot.scale, sh * shot.scale, -pad * k, -pad * k, sw * k, sh * k);
  g.restore();
}

/**
 * A capture moving from camera `a` to `b` with directional motion blur: `samples` exposures spread along the path of
 * the last `shutter` of the move, the way a real camera smears a fast pan.
 */
function drawCaptureMotion(name, camA, camB, k, { shutter = 0.12, samples = 14, alpha = 1 } = {}) {
  for (let i = 0; i < samples; i++) {
    const kk = clamp(k - shutter * (i / (samples - 1)));
    drawCapture(name, lerpCam(camA, camB, kk), { alpha: alpha / (i + 1) });
  }
}

// ---------- overlays ----------

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** A pointer at a screen point. `press` 0..1 squeezes it for a click. */
function drawCursor(p, { press = 0, alpha = 1 } = {}) {
  const g = c();
  g.save();
  g.globalAlpha *= alpha;
  g.translate(p.x, p.y);
  g.scale(1.55 * (1 - 0.12 * press), 1.55 * (1 - 0.12 * press));
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = 8;
  g.shadowOffsetY = 3;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(0, 22); g.lineTo(5.5, 17); g.lineTo(9.5, 26); g.lineTo(13, 24.5); g.lineTo(9, 16); g.lineTo(16, 16);
  g.closePath();
  g.fillStyle = '#111';
  g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = 1.6;
  g.strokeStyle = '#fff';
  g.stroke();
  g.restore();
}

/** An expanding ring where a click landed; `k` 0..1 over its life. */
function drawClickRipple(p, k) {
  if (k <= 0 || k >= 1) return;
  const g = c();
  g.save();
  g.globalAlpha = (1 - k) * 0.55;
  g.strokeStyle = '#1c365e';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(p.x, p.y, 10 + 44 * easeOut(k), 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/**
 * Moves a cursor through page-space waypoints [[time, point, { click }], ...] under a camera, and draws click
 * ripples. Returns nothing; cursors are part of the scene's paint.
 */
function drawCursorPath(name, cam, t, keys, { alpha = 1 } = {}) {
  let p = keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t >= keys[i][0]) p = keys[i][1];
    else { p = lerpPoint(keys[i - 1][1], keys[i][1], seg(t, keys[i - 1][0], keys[i][0])); break; }
  }
  let press = 0;
  keys.forEach(([kt, point, opts]) => {
    if (!opts?.click) return;
    press = Math.max(press, 1 - Math.abs(t - kt) / 0.12);
    drawClickRipple(toScreen(name, cam, point), (t - kt) / 0.6);
  });
  drawCursor(toScreen(name, cam, p), { press: clamp(press), alpha });
}
const lerpPoint = (a, b, k) => {
  // A slight arc reads as a hand moving a mouse rather than a robot sliding one.
  const arc = Math.sin(Math.PI * k) * Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.12);
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) - arc };
};

/** A glowing ring around a screen rect that draws itself on (`k` 0..1) and fades with `alpha`. */
function drawHighlight(r, k, { color = '#1c365e', pad = 10, radius = 12, alpha = 1 } = {}) {
  if (k <= 0 || alpha <= 0) return;
  const g = c();
  const x = r.x - pad, y = r.y - pad, w = r.w + pad * 2, h = r.h + pad * 2;
  const perimeter = 2 * (w + h);
  g.save();
  g.globalAlpha *= alpha;
  g.lineWidth = 5;
  g.strokeStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.setLineDash([perimeter * easeOut(k), perimeter]);
  roundRect(g, x, y, w, h, radius);
  g.stroke();
  g.restore();
}

/** Dims everything but a screen rect, to pull the eye to it. */
function drawSpotlight(r, k, { pad = 16, radius = 14, dim = 0.45 } = {}) {
  if (k <= 0) return;
  const g = c();
  g.save();
  g.fillStyle = `rgba(12, 22, 38, ${dim * k})`;
  g.beginPath();
  g.rect(0, 0, W, H);
  g.roundRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2, radius);
  g.fill('evenodd');
  g.restore();
}

/** A small pill label, e.g. "Today" / "With sale-only view". */
function drawTag(text, x, y, k, { bg = '#1c365e', fg = '#fff', size = 30 } = {}) {
  if (k <= 0) return;
  const g = c();
  g.save();
  g.globalAlpha *= clamp(k);
  g.font = `600 ${size}px ${FONT}`;
  const w = g.measureText(text).width + size * 1.3, h = size * 1.9;
  g.translate(x, y + (1 - easeOut(k)) * 16);
  g.shadowColor = 'rgba(0,0,0,0.18)';
  g.shadowBlur = 20;
  g.shadowOffsetY = 6;
  g.fillStyle = bg;
  roundRect(g, 0, 0, w, h, h / 2);
  g.fill();
  g.shadowColor = 'transparent';
  g.fillStyle = fg;
  g.textBaseline = 'middle';
  g.fillText(text, size * 0.65, h / 2 + 1);
  g.restore();
}

/** Text with a fade-and-rise entrance (`k` 0..1). */
function drawText(text, x, y, { size = 64, weight = 700, color = '#fff', k = 1, align = 'left', spacing = -0.01 } = {}) {
  if (k <= 0) return;
  const g = c();
  g.save();
  g.globalAlpha *= clamp(k);
  g.font = `${weight} ${size}px ${FONT}`;
  g.letterSpacing = `${spacing * size}px`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillText(text, x, y + (1 - easeOut(k)) * size * 0.35);
  g.restore();
}

/** Frosted glass: blurs what's already painted inside a rounded rect, then tints and rims it. */
function drawGlass(r, { radius = 28, blur = 30, tint = 'rgba(255,255,255,0.55)', alpha = 1 } = {}) {
  if (alpha <= 0) return;
  const g = c();
  const snapshot = scratch('glass');
  const sg = snapshot.getContext('2d');
  sg.clearRect(0, 0, W, H);
  sg.drawImage(g.canvas, 0, 0);
  g.save();
  g.globalAlpha *= alpha;
  g.shadowColor = 'rgba(10, 20, 40, 0.25)';
  g.shadowBlur = 60;
  g.shadowOffsetY = 20;
  roundRect(g, r.x, r.y, r.w, r.h, radius);
  g.fillStyle = 'rgba(255,255,255,0.01)';
  g.fill();
  g.shadowColor = 'transparent';
  g.clip();
  g.filter = `blur(${blur}px)`;
  g.drawImage(snapshot, 0, 0);
  g.filter = 'none';
  g.fillStyle = tint;
  g.fillRect(r.x, r.y, r.w, r.h);
  g.restore();
  g.save();
  g.globalAlpha *= alpha;
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  roundRect(g, r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 1.5, radius);
  g.stroke();
  g.restore();
}

/** A left-to-right gradient wash, for text over footage. */
function drawWash(color, from, to, { x0 = 0, x1 = W, y0 = 0, y1 = 0 } = {}) {
  const g = c();
  const grad = g.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, `rgba(${color}, ${from})`);
  grad.addColorStop(1, `rgba(${color}, ${to})`);
  g.save();
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.restore();
}

function wrapLines(g, text, maxWidth) {
  const words = text.split(' '), lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// A two-line caption's top edge, with room to spare. Scene text stays above it so captions never cover it.
const CAPTION_SAFE_TOP = 850;

// Captions follow the voiced lines exactly: each line is its own audio file, so its start and end are known.
function drawCaption(t) {
  const cue = CAPTION_CUES.find((q) => t >= q.start - 0.05 && t < q.end + 0.15);
  if (!cue) return;
  const k = Math.min(seg(t, cue.start - 0.05, cue.start + 0.15, easeOut), 1 - seg(t, cue.end, cue.end + 0.15, ease));
  const g = activeCtx;
  g.save();
  g.font = `600 40px ${FONT}`;
  const lines = wrapLines(g, cue.text, 1320);
  const lh = 54, padX = 34, padY = 20;
  const w = Math.max(...lines.map((l) => g.measureText(l).width)) + padX * 2, h = lines.length * lh + padY * 2;
  const x = (W - w) / 2, y = H - 70 - h;
  g.globalAlpha = k;
  g.fillStyle = 'rgba(14, 22, 36, 0.82)';
  roundRect(g, x, y, w, h, 18);
  g.fill();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, W / 2, y + padY + lh * i + lh / 2 + 1));
  g.restore();
}

// ---------- render hooks for lib/render.mjs ----------

window.renderAt = (t, type = 'image/jpeg', quality = 0.92) => {
  drawWorld(t);
  return canvas.toDataURL(type, quality);
};

window.renderSheet = (times, cols = 3, w = 640) => {
  const h = Math.round(w * H / W), rows = Math.ceil(times.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * w;
  sheet.height = rows * (h + 28);
  const g = sheet.getContext('2d');
  g.fillStyle = '#222';
  g.fillRect(0, 0, sheet.width, sheet.height);
  times.forEach((t, i) => {
    drawWorld(t);
    const x = (i % cols) * w, y = Math.floor(i / cols) * (h + 28);
    g.drawImage(canvas, x, y + 28, w, h);
    g.fillStyle = '#eee';
    g.font = `600 18px ${FONT}`;
    g.fillText(`${t.toFixed(2)}s`, x + 8, y + 20);
  });
  return sheet.toDataURL('image/jpeg', 0.9);
};

window.studioInfo = () => ({ duration: DUR, audio: AUDIO_CUES, captions: CAPTION_CUES, scenes: SCENES.map((s) => ({ id: s.id, start: s.start, dur: s.dur })) });

// The scrub bar, for looking at the video in a normal browser tab.
function mountScrubber() {
  const bar = document.getElementById('scrub');
  const label = document.getElementById('tt');
  if (!bar) return;
  bar.max = DUR;
  const show = () => {
    const t = Number(bar.value);
    drawWorld(t);
    const scene = SCENES.find((s) => t >= s.start && t < s.start + s.dur) || SCENES[SCENES.length - 1];
    label.textContent = `${t.toFixed(2)}s / ${DUR.toFixed(1)}s · ${scene.id}`;
  };
  bar.addEventListener('input', show);
  show();
}

window.studioReady = loadImages().then(() => document.fonts.ready).then(() => {
  mountScrubber();
  window.ready = true;
});
