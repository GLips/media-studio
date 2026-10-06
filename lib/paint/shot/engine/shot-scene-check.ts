// shot-scene-check.ts: the painted shots a project's scenes render, checked in Node for `studio paint check`. Each
// scene renders as markup (react-dom/server in a Remotion Thumbnail: no effect runs) at its first, middle and last
// shown frames; each PaintedShot hands over its shot (PaintedShotSeenContext), compiled as its render would and held
// to its scene's span, fps and length.
//
// Negative space: no page. Its canvases are those its planes name, far to near, and HTML is taken to lie behind it;
// the page's checks are the render's. A shot shown only between those frames isn't seen, nor is a StampPainting.

import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Thumbnail } from '@remotion/player';
import { Sequence } from 'remotion';
import { paintSpanFrames, paintSpanMoments, paintSpanProblem, paintSpanShownProblems } from '#lib/paint/animation/models/paint-span-moments.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
import { PictureDrawnContext } from '#lib/picture/frame/studio/picture-drawn.ts';
import { SceneContext } from '#lib/picture/video/studio/scene.tsx';
import { laidVideoOf, videoFormatOf, type LaidScene, type VideoDef } from '#lib/picture/video/studio/video.ts';
import { resolveStudioProject, studioProjectOfFile } from '#lib/platform/project/engine/studio-project.ts';
import { sceneClockAt } from '#lib/timing/timeline/models/video-layout.ts';
import { compilePaintedShot } from '../models/shot-compile.ts';
import { shotPlaneDepthRange } from '../models/shot-depths.ts';
import type { PaintedShotProps } from '../models/shot-props.ts';
import { shotWarmPastScene } from '../models/shot-warm.ts';
import { PaintedShotSeenContext } from '../studio/painted-shot.tsx';

/** A scene's shot checked: the scene's id, and the shot's problems, errors and warnings both. */
export type ShotSceneCheck = { readonly scene: string; readonly problems: readonly PaintingProblem[] };

/**
 * The canvases `shot`'s planes name, in the order its page must hold them: the farthest plane's first, a depth in
 * time by the farthest it lies at its span's frames (none when the span has none: the compile says why).
 */
function shotNamedCanvases(shot: PaintedShotProps): string[] {
  const moments = paintSpanProblem(shot.span) ? [] : paintSpanMoments(paintSpanFrames(shot.span, { bloom: 0, shutter: 0 }));
  const far = new Map(shot.planes.map((plane) => [plane, shotPlaneDepthRange(plane, moments, shot.camera.animationFps ?? PAINT_ANIMATION_FPS).far]));
  return [...new Set(shot.planes.toSorted((a, b) => far.get(b)! - far.get(a)!).flatMap(({ canvas }) => (canvas === undefined ? [] : [canvas])))];
}

/** The shots `scene` renders at video frame `frame`, as the composition lays it there, in render order. */
function shotsRenderedAt(scene: LaidScene, frame: number, video: { fps: number; width: number; height: number; frames: number }): PaintedShotProps[] {
  const seen: PaintedShotProps[] = [], clock = sceneClockAt(scene, frame / video.fps);
  const SceneAtFrame = (): ReactNode => createElement(
    Sequence, { from: scene.visible.from, durationInFrames: Math.max(1, scene.visible.to - scene.visible.from), layout: 'none' },
    createElement(PictureDrawnContext, { value: false }, createElement(SceneContext.Provider, { value: clock }, createElement(
      PaintedShotSeenContext, { value: (shot: PaintedShotProps) => seen.push(shot) }, scene.render(clock),
    ))),
  );
  try {
    renderToStaticMarkup(createElement(Thumbnail, {
      component: SceneAtFrame, compositionWidth: video.width, compositionHeight: video.height, fps: video.fps, durationInFrames: video.frames, frameToDisplay: frame,
    }));
  } catch (error) {
    throw new Error(`scene ${scene.id} at ${clock.t.toFixed(3)} s didn't render in Node: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return seen;
}

/** What `studio paint check` checks given `arg`: a project (its name or folder) or its video.tsx, every scene; a scene's file in scenes/ or bars/, or its folder's, that scene. */
export function shotSceneCheckTarget(arg: string): { readonly project: string; readonly scene: string | null } {
  const path = resolve(arg);
  if (!existsSync(path) || statSync(path).isDirectory()) return { project: resolveStudioProject(arg), scene: null };
  if (basename(path) === 'video.tsx') return { project: dirname(path), scene: null };
  const project = studioProjectOfFile(path), [dir, file, ...below] = project ? relative(project, path).split(sep) : [];
  if (!project || !(dir === 'scenes' || dir === 'bars') || (!below.length && !file.endsWith('.tsx'))) {
    throw new Error(`${arg} is no painting source (*.painting.ts), project, video.tsx or scene file (scenes/<id>.tsx, bars/<id>.tsx, or in their folders)`);
  }
  return { project, scene: below.length ? file : file.replace(/\.tsx$/, '') };
}

/**
 * The shots of the project at `project` (a folder holding its video.tsx), each scene's (only `sceneId`'s when given)
 * checked as the file's head says. Throws for a scene id the video lacks. Its scenes evaluate their painting sources
 * as they import, so the caller registers the render's tsx hooks first.
 */
export async function checkProjectSceneShots(project: string, sceneId: string | null): Promise<ShotSceneCheck[]> {
  // SAFETY: a project's video.tsx default-exports its VideoDef (DEFAULT_EXPORT_MODULE_GLOBS).
  const { default: video } = (await import(pathToFileURL(join(project, 'video.tsx')).href)) as { default: VideoDef };
  const laid = laidVideoOf(video), { fps, width, height } = videoFormatOf(video);
  const scenes = sceneId === null ? laid.scenes : laid.scenes.filter(({ id }) => id === sceneId);
  if (!scenes.length) throw new Error(`the video has no scene ${sceneId}: its scenes are ${laid.scenes.map(({ id }) => id).join(', ')}`);
  return scenes.flatMap((scene) => {
    const { from, to } = scene.visible, frames = [...new Set([from, Math.floor((from + to - 1) / 2), to - 1])];
    const shots = [...new Set(frames.flatMap((frame) => shotsRenderedAt(scene, frame, { fps, width, height, frames: laid.frames })))];
    return shots.map((shot): ShotSceneCheck => ({
      scene: scene.id,
      problems: [
        ...paintSpanShownProblems(shot.span, fps, scene.dur).map((message) => paintingProblem('error', 'shot', 'span', message)),
        ...compilePaintedShot(shot, shotNamedCanvases(shot), { htmlBehind: true }).problems,
        ...(shot.warm ? shotWarmPastScene(shot.warm, scene.dur) : []),
      ],
    }));
  });
}
