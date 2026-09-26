// motion-tag.ts: how an element asks to have its motion recorded. The probe (probe.tsx) measures every tagged element
// on every frame, and lib/models/motion/motion-tracks.ts assembles the samples into tracks. A tag is DOM attributes, so only what's
// drawn is recorded: a value computed and never rendered can't pass for motion.
//
// - Hand-written motion: `data-motion="name"` on the element that moves, or `useMotionTag` for one a host renders.
// - Library pieces tag themselves (`pieceMotionAttrs`) with a name they pick, their kind and progress values, and the
//   camera they're aimed through. Every piece takes `motion`: a name of the author's, or `false` for no track.
//
// A tagged element inside another belongs to it: its id is `scene/owner/name`, measured in the owner's frame. Author
// names are identity, so two sharing a frame is an error. Two sharing a name the library picked for either are
// reported ambiguous and left untracked there; and since such a name can pass between elements, one ending on the frame
// another starts joins them into one segment.

import { useLayoutEffect, type RefObject } from 'react';
import { roundMotionValue, type StaggerMembership } from '#models/motion/motion-tracks.ts';
import { viewScale, type Rect, type View } from '#models/camera/camera.ts';

export type MotionTag = {
  /** Unique among the tagged elements of its owner. No `/`: that separates an id's levels. */
  name: string;
  /** What library piece this is, e.g. `highlight`. Hand-written tags have none. */
  kind?: string;
  /** The library picked `name`, not the scene's author: see the header on what a collision means then. */
  implicit?: boolean;
  /** Progress or value channels to record, e.g. `{ draw: k }`. Report them on every frame the element is drawn. */
  values?: Readonly<Record<string, number>>;
  /**
   * The view it's aimed through, so its own motion is measured in that camera's page space; `unknown` for a piece that
   * can't tell whether its screen position moves with a camera. Absent: measured in its owner's frame.
   */
  through?: View | 'unknown';
  /** Its place in a stagger. The probe scopes `group` to its owner, as it does names. */
  stagger?: StaggerMembership;
};

/** The camera a view shows, as the probe matches it: its layout box, centre and scale. */
export type CameraMark = { key: string; cx: number; cy: number; zoom: number; k: number; box: Rect };

export function cameraMark(v: View): CameraMark {
  const { cam, box } = v, k = viewScale(v);
  return { key: [box.x, box.y, box.w, box.h, cam.cx, cam.cy, k].map(roundMotionValue).join(','), cx: cam.cx, cy: cam.cy, zoom: cam.zoom, k, box };
}

/** The attributes that tag an element for recording; `false` tags nothing. Spread onto the element that moves. */
export function motionAttrs(tag: MotionTag | false): Record<string, string> {
  if (!tag) return {};
  return {
    'data-motion': tag.name,
    ...(tag.kind && { 'data-motion-kind': tag.kind }),
    ...(tag.implicit && { 'data-motion-implicit': '' }),
    ...(tag.values && { 'data-motion-values': JSON.stringify(tag.values) }),
    ...(tag.through && { 'data-motion-through': tag.through === 'unknown' ? 'unknown' : cameraMark(tag.through).key }),
    ...(tag.stagger && { 'data-motion-stagger': JSON.stringify(tag.stagger) }),
  };
}

/**
 * A library piece's tag: named `motion` when the author gave one, else `picked`, marked implicit; `false` tags
 * nothing. Either can be text (a Highlight's `name`, a Tag's words): a `/` in it is replaced.
 */
export function pieceMotionAttrs(motion: string | false | undefined, picked: string, tag: Omit<MotionTag, 'name' | 'implicit'>): Record<string, string> {
  if (motion === false) return {};
  return motionAttrs({ ...tag, ...(motion === undefined ? { name: picked.replaceAll('/', '∕'), implicit: true } : { name: motion.replaceAll('/', '∕') }) });
}

/**
 * Tags the element showing a view's capture as that view's camera, with its centre and zoom as values and the frame
 * that elements aimed through the view are measured in. A camera is its view, not its capture: every state of a page
 * dissolving under one view is one camera.
 */
export function cameraMotionAttrs(view: View, motion?: string | false): Record<string, string> {
  if (motion === false) return {};
  const mark = cameraMark(view);
  return { ...pieceMotionAttrs(motion, 'camera', { kind: 'camera', values: { cx: mark.cx, cy: mark.cy, zoom: mark.zoom } }), 'data-motion-camera': JSON.stringify(mark) };
}

/**
 * Marks an element whose contents move in ways no tag can see (a take's pixels, a generated clip), so the coverage
 * report names it rather than implying it was measured.
 */
export const unmeasuredAttrs = (what: string) => ({ 'data-motion-unmeasured': what });

/**
 * Marks a copy of a shot drawn only for its look (a motion-blur sample at another moment of the shutter). The probe
 * skips everything inside it (tags, framing marks, sound cues), so the one copy drawn at the frame's own time speaks
 * for the shot.
 */
export const motionEchoAttrs = { 'data-motion-echo': '' } as const;

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
