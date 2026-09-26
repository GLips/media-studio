// p5 2.3 names a types file in its package.json but doesn't ship it, and p5.brush has none. These cover what
// lib/paint uses; add to them as a style needs more.

declare module 'p5' {
  export type Pts = readonly (readonly [number, number])[];
  export interface P5Graphics {
    pixelDensity(d: number): void;
    drawingContext: CanvasRenderingContext2D;
  }
  export interface P5 {
    WEBGL: 'webgl';
    ADD: string;
    BLEND: string;
    canvas: HTMLCanvasElement;
    /** The canvas's size, in the pixels createCanvas was given. */
    width: number;
    height: number;
    setup?: () => void | Promise<void>;
    draw?: () => void;
    createCanvas(w: number, h: number, mode: 'webgl'): void;
    createGraphics(w: number, h: number): P5Graphics;
    pixelDensity(d: number): void;
    noLoop(): void;
    redraw(): Promise<void>;
    clear(): void;
    background(gray: number): void;
    push(): void;
    pop(): void;
    translate(x: number, y: number): void;
    rotate(a: number): void;
    scale(s: number): void;
    resetMatrix(): void;
    randomSeed(seed: number): void;
    noiseSeed(seed: number): void;
    random(): number;
    noise(x: number, y?: number, z?: number): number;
    image(img: P5Graphics | HTMLCanvasElement, x: number, y: number, w?: number, h?: number): void;
    blendMode(mode: string): void;
    tint(r: number, g: number, b: number, a: number): void;
    noTint(): void;
    remove(): void;
  }
  const p5: new (sketch: (p: P5) => void, node?: HTMLElement) => P5;
  export default p5;
}

declare module 'p5.brush' {
  import type { P5, P5Graphics, Pts } from 'p5';
  export type BrushDef = {
    type: 'default' | 'spray' | 'marker';
    weight: number;
    scatter: number;
    sharpness: number;
    grain: number;
    opacity: number;
    spacing: number;
    pressure: [number, number];
    rotate: 'natural' | 'random' | 'none';
    noise?: number;
  };
  export function instance(p: P5): void;
  export function seed(seed: number | string): void;
  export function noiseSeed(seed: number | string): void;
  export function load(target?: P5Graphics): void;
  export function scaleBrushes(s: number): void;
  export function add(name: string, def: BrushDef): void;
  export function set(brush: string, color: string, weight: number): void;
  export function wash(color: string, opacity?: number): void;
  export function noWash(): void;
  export function fill(color: string, opacity?: number): void;
  export function noFill(): void;
  export function fillBleed(k: number): void;
  export function fillTexture(texture: number, border: number): void;
  export function hatch(dist: number, angle: number, options?: { rand?: number; gradient?: number; continuous?: boolean }): void;
  export function noHatch(): void;
  export function hatchStyle(brush: string, color: string, weight: number): void;
  export function noStroke(): void;
  export function beginShape(curvature?: number): void;
  export function vertex(x: number, y: number): void;
  export function endShape(close?: boolean): void;
  export function polygon(pts: Pts): void;
  export function spline(pts: Pts, curvature?: number): void;
}
