// review-artifact.ts: everything the review screen shows about one file of a project, read fresh from disk: its hash,
// its own snapshot (never out/check's, which is the latest check's and may postdate this render), the project's cue
// list and a variant sheet's cells. The screen stays bound to these bytes until the person loads another version.
// Its threads are read apart (review-file.ts), placed on it through the timing read here.
//
// Negative space: nothing here renders, measures or regenerates an artifact. A missing one is named in `missing`, with
// the command that makes it, so the screen can say which note fields it can't fill.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { readSfxCueList } from '#lib/output/sfx-cues/engine/cue-module.ts';
import { sfxCuePlays } from '#lib/output/sfx-cues/models/cues.ts';
import { loadRenderSnapshot, renderFileStamp, type RenderSnapshot } from '#lib/output/render/engine/render-snapshot.ts';
import { probeFrameSize } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { reviewTimingOf, type ReviewTiming } from '../models/review-moment.ts';
import { reviewStoryboardOf, reviewTimingMarksOf } from '../models/review-storyboard.ts';
import { reviewFrameAt, type ReviewMediaKind, type ReviewStillCellsFile } from '../models/review-context.ts';
import type { ReviewPlacementTarget } from '../models/review-placement.ts';
import type { ReviewArtifact } from '../models/review-artifact.ts';
import { listProjectArtifacts } from './project-artifacts.ts';
import { listReviewRenderVersions } from './review-history.ts';
import { readReviewScript } from './review-script-source.ts';
import { projectFolderNamed, projectMediaTypeOf, ProjectMediaNotFound, resolveProjectMedia } from './project-media.ts';

// SAFETY: these sidecars are written by the studio's own commands in the shape their types name.
const readJson = <T,>(file: string): T | undefined => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : undefined);

function reviewedKindOf(file: string): ReviewMediaKind {
  const kind = projectMediaTypeOf(file)?.kind;
  if (kind !== 'video' && kind !== 'still') throw new ProjectMediaNotFound(`${file} isn't a video or a still`);
  return kind;
}

/** A render's timing and length on its own clock, from its first frame: a slice starts `frames.from` in. */
function snapshotTimingOf({ timeline, frames, clock }: RenderSnapshot): { timing: ReviewTiming; durationInFrames: number } {
  return {
    timing: reviewTimingOf({ fps: timeline.fps, startsAt: frames.from, scenes: timeline.scenes, lines: timeline.cues, clock }),
    durationInFrames: frames.end - frames.from,
  };
}

/** The file on disk for `path` at the version `render` names (the file itself without one). */
export function reviewedVersionOf(project: string, path: string, render: string | undefined): string {
  const current = resolveProjectMedia(project, path);
  if (render === undefined || renderFileStamp(current).hash === render) return current;
  const kept = listReviewRenderVersions(project, path).find((v) => v.hash === render);
  if (!kept) throw new ProjectMediaNotFound(`render ${render} of ${path} is no longer kept`);
  return resolveProjectMedia(project, kept.file);
}

/**
 * What threads are placed on when `media` (the file at `path` in its project) is open. Audio is the voice take the
 * script page reads along with: its notes are on the script's lines, so it carries them, and no frames.
 */
export function reviewPlacementTargetOf(media: string, path: string): ReviewPlacementTarget {
  if (projectMediaTypeOf(media)?.kind === 'audio') {
    const projectDir = join(media, ...path.split('/').map(() => '..'));
    const scripted = existsSync(join(projectDir, 'voiceover.json'));
    return { kind: 'audio', hash: renderFileStamp(media).hash, path, durationInFrames: Infinity, ...(scripted && { scriptLines: readReviewScript(projectDir).lines }) };
  }
  const kind = reviewedKindOf(media), { hash } = renderFileStamp(media);
  const loaded = kind === 'video' ? loadRenderSnapshot(media) : undefined;
  // Without a snapshot there's no timing, so only notes written on these very bytes place, at their own frames, and
  // the length is never consulted.
  if (loaded?.kind !== 'snapshot') return { kind, hash, path, durationInFrames: Infinity };
  return { kind, hash, path, ...snapshotTimingOf(loaded.snapshot) };
}

/** A still's size in pixels; null for an SVG, which has none of its own. */
export const reviewStillSizeOf = (media: string) => (extname(media).toLowerCase() === '.svg' ? null : probeFrameSize(media));

/**
 * The file at `path`, or with `render` the version of it with that hash: the file itself while it still is that
 * version, else its archived copy (`r14 ▾`), still reviewed under `path`. A version no longer kept is not found.
 */
export function readReviewArtifact(project: string, path: string, render?: string): ReviewArtifact {
  const dir = projectFolderNamed(project);
  const media = reviewedVersionOf(project, path, render);
  const kind = reviewedKindOf(media);
  const srt = join(dirname(media), 'video.srt');
  const artifact: ReviewArtifact = {
    render: renderFileStamp(media), artifacts: listProjectArtifacts(project), project, path, kind, title: path.split('/').at(-1)!,
    fps: null, durationInFrames: null, startsAt: null, frameSize: null, transparent: false, voice: null, missing: [],
    ...(kind === 'video' && dirname(path) === 'out' && existsSync(srt) && { srt: 'out/video.srt' }),
  };
  if (kind === 'still') {
    artifact.frameSize = reviewStillSizeOf(media);
    const cells = readJson<ReviewStillCellsFile>(media.slice(0, -extname(media).length) + '.cells.json');
    if (cells) artifact.cells = cells.cells;
    return artifact;
  }

  const loaded = loadRenderSnapshot(media);
  const snapshot = loaded.kind === 'snapshot' ? loaded.snapshot : undefined;
  const cueList = readSfxCueList(dir);
  if (loaded.kind === 'none') artifact.missing.push(`timeline for this render (scenes, sounds, what's under a point): ${loaded.reason}`);
  const fps = snapshot?.timeline.fps ?? 30;
  // Seconds and frames of the video, moved onto the render's clock: a slice starts `from` frames in.
  const from = snapshot?.frames.from ?? 0, end = snapshot?.frames.end ?? Infinity;
  const shift = from / fps, holds = (at: number) => at >= shift && at < end / fps;
  if (snapshot) {
    const { timeline } = snapshot;
    Object.assign(artifact, {
      title: timeline.title, fps, startsAt: from, frameSize: { w: timeline.width, h: timeline.height }, transparent: timeline.transparent,
      voice: snapshot.voice, ...snapshotTimingOf(snapshot),
    });
    artifact.scenes = timeline.scenes.flatMap(({ id, visible, rung }) => {
      const first = Math.max(visible.from, from), last = Math.min(visible.to, end);
      return last > first ? [{ id, from: first - from, to: last - from, ...(rung && { rung }) }] : [];
    });
    artifact.storyboard = reviewStoryboardOf({ fps, frames: snapshot.frames, scenes: timeline.scenes, lines: timeline.cues, clock: snapshot.clock });
    artifact.marks = reviewTimingMarksOf({ frames: snapshot.frames, clock: snapshot.clock });
    if (snapshot.motion) artifact.motion = snapshot.motion;
    else artifact.missing.push(`motion for what's under a point: only a delivered render (studio render) measures it`);
  }
  if (snapshot || cueList) {
    artifact.sounds = [
      ...(snapshot?.timeline.sounds ?? []).map((s) => ({ ...s, source: 'video' as const })),
      ...(cueList ? sfxCuePlays(cueList) : []).map((c) => ({ id: c.id, at: c.at, sound: c.sound.sound, source: 'cue-list' as const })),
    ].filter((s) => holds(s.at)).map((s) => ({ ...s, at: s.at - shift, frame: reviewFrameAt(s.at - shift, fps) })).toSorted((a, b) => a.at - b.at);
  }
  if (cueList && snapshot) artifact.cueListPlayed = snapshot.timeline.sfxCueList;
  return artifact;
}
