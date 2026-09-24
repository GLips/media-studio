// P5Canvas.tsx: p5 sketches as layers in a Remotion video. Any look p5 can draw (p5.brush watercolour, generative
// line work, shaders) plugs in as a P5Style; the sketch itself is a function of the scene's time, drawn fresh on
// every frame.
//
// Remotion renders frames out of order, in several tabs at once, and may render any frame alone. So a sketch keeps no
// state between frames: everything comes from `t`, and randomness is re-seeded from it (see watercolor.ts's
// boilSeed). The WebGL canvas is one per style per tab (p5.brush keeps global state), drawn into by one layer at a
// time, then copied onto the layer's own 2D canvas. That's how two painted scenes can crossfade.

import p5, { type P5 } from 'p5';
import { useLayoutEffect, useRef } from 'react';
import { useDelayRender } from 'remotion';
import { H, W } from '../studio/frame.ts';

export type P5Style = {
  /** One WebGL canvas per name, per tab. */
  name: string;
  /** Runs before p5's setup, e.g. `brush.instance(p)`. */
  attach?(p: P5): void;
  /** Runs once the canvas exists: brushes, textures. */
  setup?(p: P5): void | Promise<void>;
};

type P5Host = { p: P5; busy: Promise<void> };
const hosts = new Map<string, Promise<P5Host>>();

function p5HostFor(style: P5Style): Promise<P5Host> {
  let host = hosts.get(style.name);
  if (!host) {
    host = new Promise((resolve) => {
      const node = document.createElement('div');
      node.style.display = 'none';
      document.body.appendChild(node);
      new p5((p) => {
        style.attach?.(p);
        p.setup = async () => {
          p.createCanvas(W, H, p.WEBGL);
          p.pixelDensity(1);
          p.noLoop();
          await style.setup?.(p);
          resolve({ p, busy: Promise.resolve() });
        };
        p.draw = () => {};
      }, node);
    });
    hosts.set(style.name, host);
  }
  return host;
}

/**
 * A full-frame layer painted by `paint`, in frame pixels with the origin top left. It redraws on every render, so
 * `paint` must depend only on what the parent passes it (the scene's `t`, word anchors), never on earlier frames.
 * `finish` does 2D work on the copied frame (grain, lettering); `multiply` blends the layer onto what's beneath.
 */
export function P5Canvas({ style, paint, finish, multiply = false, alpha = 1 }: {
  style: P5Style;
  paint: (p: P5) => void;
  finish?: (out: CanvasRenderingContext2D) => void;
  multiply?: boolean;
  alpha?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();

  // No dependency list on purpose: `paint` is a new closure on every render and always needs drawing.
  useLayoutEffect(() => {
    const handle = delayRender(`painting a ${style.name} layer`);
    let live = true;
    p5HostFor(style)
      .then((host) => {
        // One layer at a time on the shared canvas: a crossfade paints two layers in the same frame.
        host.busy = host.busy.then(async () => {
          if (!live) return;
          const { p } = host;
          p.draw = () => {
            p.clear();
            p.push();
            p.translate(-W / 2, -H / 2);
            paint(p);
            p.pop();
          };
          await p.redraw();
          const out = ref.current!.getContext('2d')!;
          out.clearRect(0, 0, W, H);
          out.drawImage(p.canvas, 0, 0);
          finish?.(out);
        });
        return host.busy;
      })
      .then(() => continueRender(handle), cancelRender);
    return () => {
      live = false;
    };
  });

  return <canvas ref={ref} width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, opacity: alpha, pointerEvents: 'none', mixBlendMode: multiply ? 'multiply' : undefined }} />;
}
