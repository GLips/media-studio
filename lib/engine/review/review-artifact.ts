// review-artifact.ts: everything the review screen shows about one file of a project, read fresh from disk: its hash,
// its own snapshot (never out/check's, which is the latest check's and may postdate this render), the project's cue
// list, a variant sheet's cells, and the notes saved against it, each moved to its moment on this render
// (lib/models/review says how). The screen stays bound to these bytes until the person loads another version.
//
// Negative space: nothing here renders, measures or regenerates an artifact. A missing one is named in `missing`, with
// the command that makes it, so the screen can say which note fields it can't fill.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { readSfxCueList } from '#sfx/cue-module.ts';
import { sfxCuePlays } from '#sfx/cues.ts';
import { reviewTimingOf } from '#models/review/review-moment.ts';
import { reviewStoryboardOf, reviewTimingMarksOf } from '#models/review/review-storyboard.ts';
import { placeReviewNotes, REVIEW_NOTES_VERSION, reviewFrameAt, type ReviewMediaKind, type ReviewNote, type ReviewNotesFile, type ReviewStillCellsFile } from '#models/review/review-notes.ts';
import { STUDIO_ROOT } from '#engine/project/studio-project.ts';
import { loadRenderSnapshot, renderFileStamp } from '#engine/snapshot/render-snapshot.ts';
import { reviewNotesPathOf, type ReviewArtifact, type ReviewArtifactStatus } from '#models/review/review-artifact.ts';
import { listProjectArtifacts } from './project-artifacts.ts';
import { projectFolderNamed, projectMediaTypeOf, ProjectMediaNotFound, resolveProjectMedia } from './project-media.ts';

const readJson = <T,>(file: string): T | undefined => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : undefined);

function reviewedKindOf(file: string): ReviewMediaKind {
  const kind = projectMediaTypeOf(file)?.kind;
  if (kind !== 'video' && kind !== 'still') throw new ProjectMediaNotFound(`${file} isn't a video or a still`);
  return kind;
}

export function readReviewArtifactStatus(project: string, path: string): ReviewArtifactStatus {
  return { render: renderFileStamp(resolveProjectMedia(project, path)), artifacts: listProjectArtifacts(project) };
}

export function readReviewArtifact(project: string, path: string): ReviewArtifact {
  const dir = projectFolderNamed(project);
  const media = resolveProjectMedia(project, path);
  const kind = reviewedKindOf(media);
  const notesPath = reviewNotesPathOf(path);
  const saved = readJson<ReviewNotesFile>(join(dir, notesPath));
  const srt = join(dirname(media), 'video.srt');
  const artifact: ReviewArtifact = {
    ...readReviewArtifactStatus(project, path), project, path, kind, title: path.split('/').at(-1)!,
    fps: null, durationInFrames: null, startsAt: null, frameSize: null, transparent: false, voice: null, missing: [], notes: saved?.notes ?? [], notesPath,
    ...(kind === 'video' && dirname(path) === 'out' && existsSync(srt) && { srt: 'out/video.srt' }),
  };
  if (kind === 'still') {
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
      title: timeline.title, fps, durationInFrames: snapshot.frames.end - from, startsAt: from,
      frameSize: { w: timeline.width, h: timeline.height }, transparent: timeline.transparent, voice: snapshot.voice,
    });
    artifact.scenes = timeline.scenes.flatMap(({ id, start, dur, rung }) => {
      const first = Math.max(timeline.crossfades.find((c) => c.to === id)?.start ?? start, shift);
      const last = Math.min(timeline.crossfades.find((c) => c.from === id)?.end ?? start + dur, end / fps);
      // Under half a frame is a scene that only touches the slice's edge.
      return last - first > 0.5 / fps ? [{ id, start: first - shift, dur: last - first, ...(rung && { rung }) }] : [];
    });
    artifact.timing = reviewTimingOf({ fps, startsAt: from, scenes: timeline.scenes, lines: timeline.cues, clock: snapshot.clock });
    artifact.storyboard = reviewStoryboardOf({ fps, frames: snapshot.frames, scenes: timeline.scenes, lines: timeline.cues, clock: snapshot.clock });
    artifact.marks = reviewTimingMarksOf({ frames: snapshot.frames, clock: snapshot.clock });
    if (snapshot.motion) artifact.motion = snapshot.motion;
    else artifact.missing.push(`motion for what's under a point: only a delivered render (studio render) measures it`);
  }
  if (snapshot || cueList) {
    artifact.sounds = [
      ...(snapshot?.timeline.sounds ?? []).map((s) => ({ ...s, source: 'video' as const })),
      ...(cueList ? sfxCuePlays(cueList) : []).map((c) => ({ id: c.id, at: c.at, sound: c.sound.sound, source: 'cue-list' as const })),
    ].filter((s) => holds(s.at)).map((s) => ({ ...s, at: s.at - shift, frame: reviewFrameAt(s.at - shift, fps) })).sort((a, b) => a.at - b.at);
  }
  if (cueList && snapshot) artifact.cueListPlayed = snapshot.timeline.sfxCueList;
  if (artifact.timing && artifact.durationInFrames !== null) {
    artifact.notes = placeReviewNotes(artifact.notes, {
      render: artifact.render, durationInFrames: artifact.durationInFrames,
      sources: { fps, frameSize: artifact.frameSize, scenes: artifact.scenes, sounds: artifact.sounds, motion: artifact.motion, timing: artifact.timing },
    });
  }
  return artifact;
}

/** Saves a file's notes whole to its review/notes-<name>.json, stamped with the time; returns where. */
export function saveReviewNotes(project: string, path: string, { notes, fps }: { notes: ReviewNote[]; fps?: number }): { savedTo: string; saved: string } {
  const dir = projectFolderNamed(project);
  const media = resolveProjectMedia(project, path);
  const kind = reviewedKindOf(media);
  const notesPath = reviewNotesPathOf(path);
  const file: ReviewNotesFile = {
    version: REVIEW_NOTES_VERSION, media: relative(STUDIO_ROOT, media), kind, ...(kind === 'video' && fps !== undefined && { fps }), saved: new Date().toISOString(), notes,
  };
  const to = join(dir, notesPath);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, JSON.stringify(file, null, 2) + '\n');
  return { savedTo: `${project}/${notesPath}`, saved: file.saved };
}
