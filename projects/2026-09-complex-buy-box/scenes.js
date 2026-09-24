// The Complex buy box shot list. Scene times are seconds from each scene's start; `s.line(id)` anchors a beat to speech.

const INK = '#1c365e';
const ACCENT = '#b82b2b';

function drawTitle(s) {
  drawMotionTitle(s, { capture: 'home', eyebrow: 'WALKTHROUGH', title: "Complex buy box", accent: ACCENT });
}

function drawOutro(s) {
  const blur = seg(s.t, 0, 1.0);
  drawCapture('home', camTop('home'), { blur: 34 * blur });
  drawWash('22, 40, 70', 0.62 * blur, 0.38 * blur, { x0: 0, x1: W });
  drawGlassCard(seg(s.t, 0.4, 1.3, easeOut) * (1 - seg(s.t, s.dur - 2.8, s.dur - 2.1)), {
    eyebrow: 'IN SHORT',
    points: ['The first takeaway', 'The second takeaway'],
    accent: ACCENT,
    ink: INK,
  });
  drawEndCard(seg(s.t, s.dur - 2.4, s.dur - 1.6), "Complex buy box", { bg: INK });
}

defineScenes([
  { id: 'title', lines: ['intro'], lead: 1.4, tail: 1.0, draw: drawTitle },
  { id: 'outro', lines: ['outro'], lead: 0.6, tail: 3.4, draw: drawOutro },
]);
