// project-media-rule.ts: the one rule for which of a project's media files the studio lists. Every video, still and
// audio file anywhere in the project is listed except working matter: what's in a dot folder (caches, the review's
// versions and peaks), node_modules, the review's frame grabs (review/frames/), and runs of numbered frames.

/** True for a folder (`out/.review/`, `review/frames/`) whose files are working matter, never listed. */
export function projectFolderIsWorkingMatter(folder: string): boolean {
  const parts = folder.split('/').filter(Boolean);
  return parts.some((part) => part.startsWith('.') || part === 'node_modules') || folder === 'review/frames/';
}

/**
 * How many numbered files of one prefix in one folder make a frame sequence (a render's or capture's frames), whose
 * files aren't listed. Below it, numbered files are takes or variants (`couch-plate-1.png` … `-3`) and are.
 */
export const PROJECT_FRAME_SEQUENCE_MIN = 12;

/** `f-000.png` → `f-.png`: what a numbered frame shares with its sequence; null for a name that isn't numbered. */
export function projectFrameSequencePrefixOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  const match = /^(.*?)\d{2,}$/.exec(dot < 0 ? name : name.slice(0, dot));
  return match ? `${match[1]}${dot < 0 ? '' : name.slice(dot)}` : null;
}
