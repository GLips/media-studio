// motion-tag.ts: how an element asks to have its motion recorded. The probe (probe.tsx) measures every tagged element
// on every frame it renders, and lib/motion-tracks.ts assembles those into tracks.
//
// A tag is DOM attributes, so only what's rendered is recorded: a value computed and never drawn can't pass for
// motion. Numeric helpers (camAt, seg) stay pure; whatever draws their value tags the element it draws.
//
// - Hand-written motion needs only `data-motion="name"` on the element that moves.
// - An element a host component renders itself, which hands out no ref: `useMotionTag(ref, 'name', selector)`.
// - Library pieces spread `motionAttrs({...})`, adding what they know: their kind, progress values, the camera
//   they're drawn through, their place in a stagger.
//
// A tagged element inside another tagged element belongs to it: its id is nested under the owner's
// (`scene/owner/name`), and its own motion is measured in the owner's frame. Names are identity: two elements that
// share one on a frame are an error, and one name handed from an element to another on the very next frame joins
// them into one track, so give each element its own name. A name a library piece picked for itself (a camera after
// its shot, a Tag after its words) can't promise that, so two of those sharing a frame are left untracked there and
// reported as ambiguous instead.

import { useLayoutEffect, type RefObject } from 'react';
import { scaleFor, type Cam, type Rect, type View } from './camera.ts';
import type { StaggerMembership } from '../motion-tracks.ts';

export type MotionTag = {
  /** Unique among the tagged elements of its owner. No `/`: that separates an id's levels. */
  name: string;
  /** What library piece this is, e.g. `highlight`. Hand-written tags have none. */
  kind?: string;
  /** The library picked `name`, not the scene's author: see the header on what a collision means then. */
  implicit?: boolean;
  /** Progress or value channels to record, e.g. `{ draw: k }`. Report them on every frame the element is drawn. */
  values?: Readonly<Record<string, number>>;
  /** The view this element is aimed through, so its own motion is measured in that camera's page space. */
  through?: View | null;
  stagger?: StaggerMembership;
};

/** The camera a view shows, as the probe matches it: its screen box, centre and scale. */
export type CameraMark = { key: string; cx: number; cy: number; zoom: number; k: number; box: Rect };

const round = (v: number) => Math.round(v * 1000) / 1000;

export function cameraMark({ shot, cam, box }: { shot: View['shot']; cam: Cam; box: Rect }): CameraMark {
  const k = scaleFor(shot, cam.zoom);
  return { key: [box.x, box.y, box.w, box.h, cam.cx, cam.cy, k].map(round).join(','), cx: cam.cx, cy: cam.cy, zoom: cam.zoom, k, box };
}

/** Name text for a tag from what an element says, e.g. a Text's words: `/` is replaced, since it separates levels. */
export const motionNameOf = (text: string) => text.replaceAll('/', '∕');

/** The attributes that tag an element for recording; `false` tags nothing. Spread onto the element that moves. */
export function motionAttrs(tag: MotionTag | false): Record<string, string> {
  if (!tag) return {};
  return {
    'data-motion': tag.name,
    ...(tag.kind && { 'data-motion-kind': tag.kind }),
    ...(tag.implicit && { 'data-motion-implicit': '' }),
    ...(tag.values && { 'data-motion-values': JSON.stringify(tag.values) }),
    ...(tag.through && { 'data-motion-through': cameraMark(tag.through).key }),
    ...(tag.stagger && { 'data-motion-stagger': JSON.stringify(tag.stagger) }),
  };
}

/**
 * Tags the element showing a view's capture as that view's camera, with its centre and zoom as values and the frame
 * that elements aimed through the view (`through`) are measured in. Named `name`, or after the view's shot.
 */
export function cameraMotionAttrs(view: View, name?: string): Record<string, string> {
  const mark = cameraMark(view);
  const values = { cx: mark.cx, cy: mark.cy, zoom: mark.zoom };
  const tag = name !== undefined ? { name } : { name: view.shot.name ? `camera:${view.shot.name}` : 'camera', implicit: true };
  return { ...motionAttrs({ ...tag, kind: 'camera', values }), 'data-motion-camera': JSON.stringify(mark) };
}

/**
 * Marks an element whose contents move in ways no tag can see (a take's pixels, a generated clip), so the coverage
 * report names it rather than implying it was measured.
 */
export const unmeasuredAttrs = (what: string) => ({ 'data-motion-unmeasured': what });

/**
 * Tags an element a component renders itself, which hands out no ref: the first match of `selector` inside `target`,
 * or `target` itself. Re-applied after every commit, and taken off an element it no longer matches.
 */
export function useMotionTag(target: RefObject<Element | null>, name: string, selector?: string) {
  useLayoutEffect(() => {
    const el = selector ? target.current?.querySelector(selector) : target.current;
    if (!el) return;
    el.setAttribute('data-motion', name);
    return () => {
      if (el.getAttribute('data-motion') === name) el.removeAttribute('data-motion');
    };
  });
}
