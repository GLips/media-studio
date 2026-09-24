// kit.js: shots that recur across videos, built from engine.js primitives. Load it after engine.js.
//
// Each shot is a pure function of time like everything else, and takes its colours and words as arguments, so a
// project brings its own brand. Text-bearing shots keep clear of CAPTION_SAFE_TOP, where burned-in captions sit.

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
