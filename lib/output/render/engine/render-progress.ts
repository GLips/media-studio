// render-progress.ts: the marker `studio render` leaves in a project while it draws, out/.render-progress.json, so the
// review screen can say a newer render is on its way. Review reads it; render never imports review.
//
// A render killed before it clears its marker leaves it behind, so a marker names its process (studio-process.ts),
// and one whose process has ended reads as no render.
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { replaceFileWhole } from '#lib/platform/files/engine/replace-file-whole.ts';
import { studioProcessRunning, thisStudioProcess, type StudioProcessIdentity } from '#lib/platform/process/engine/studio-process.ts';

/**
 * A render under way: the files it may write, by their paths in the project, and when it started (ISO). A delivered
 * render names every delivery, since only its timeline says which. A slice names its scene (--scene) or its frames
 * (`end` exclusive), for the page to mark that span of the cut as being re-rendered.
 */
export type RenderProgress = { paths: string[]; startedAt: string; scene?: string; frames?: { from: number; end: number } };

/** What the command knows of its render as it starts: the files it may write and, for a slice, what it holds. */
export type RenderProgressStart = Omit<RenderProgress, 'startedAt'>;

type RenderProgressFile = RenderProgress & { process: StudioProcessIdentity };

const renderProgressFileOf = (projectDir: string) => join(projectDir, 'out', '.render-progress.json');

export function writeRenderProgress(projectDir: string, start: RenderProgressStart): void {
  const file = renderProgressFileOf(projectDir);
  const marker: RenderProgressFile = { ...start, startedAt: new Date().toISOString(), process: thisStudioProcess() };
  replaceFileWhole(file, JSON.stringify(marker));
}

export function clearRenderProgress(projectDir: string): void {
  rmSync(renderProgressFileOf(projectDir), { force: true });
}

/** The render drawing in the project now, or null. */
export function readRenderProgress(projectDir: string): RenderProgress | null {
  let text: string;
  try {
    text = readFileSync(renderProgressFileOf(projectDir), 'utf8');
  } catch (error) {
    // SAFETY: node:fs throws ErrnoExceptions. ENOENT: no render, or one cleared between polls.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  // SAFETY: only writeRenderProgress writes this file.
  const { process, ...progress } = JSON.parse(text) as RenderProgressFile;
  return studioProcessRunning(process) ? progress : null;
}
