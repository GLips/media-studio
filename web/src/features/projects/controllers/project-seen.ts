// project-seen.ts: what the reviewer has seen of a project's files, kept in this browser's localStorage, so the latest
// view can mark what's new: when they last looked at it (`lookedAt`) and when they last opened each file. A file is new
// when it changed after both (projectFileIsNew). Per browser on purpose: it's one reviewer's reading position, not the
// project's state, and review/review.json stays the agents' and reviewer's shared record.
import { Result, Schema } from 'effect';
import { useEffect, useSyncExternalStore } from 'react';

/**
 * `lookedAt` is when the latest view last opened; `lookedBefore` the look before it, which that view marks new from,
 * so its marks hold while it stays open. `opened` is when each file's review last opened, by path.
 */
type ProjectSeen = { lookedAt: string | null; lookedBefore: string | null; opened: Readonly<Record<string, string>> };

/** Before the reviewer has ever looked at a project's latest, the last day's files read as new. */
const FIRST_LOOK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A look within this long of the last is the same look: the view can mount twice as it loads (a suspense retry), and
 * a second mount mustn't move `lookedBefore` up to the first and clear every mark.
 */
const SAME_LOOK_MS = 60 * 1000;

const NOTHING_SEEN: ProjectSeen = { lookedAt: null, lookedBefore: null, opened: {} };

const keyOf = (project: string) => `studio.project-seen.${project}`;

const listeners = new Set<() => void>();

function subscribeToProjectSeen(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  listeners.add(onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    listeners.delete(onChange);
  };
}

/** What's saved under a project's key; anything else there reads as nothing seen. */
const ProjectSeenText = Schema.fromJsonString(Schema.Struct({
  lookedAt: Schema.NullOr(Schema.String),
  lookedBefore: Schema.NullOr(Schema.String),
  opened: Schema.Record(Schema.String, Schema.String),
}));
const decodeProjectSeenText = Schema.decodeUnknownResult(ProjectSeenText);

function readProjectSeen(raw: string | null): ProjectSeen {
  if (raw === null) return NOTHING_SEEN;
  const decoded = decodeProjectSeenText(raw);
  return Result.isSuccess(decoded) ? decoded.success : NOTHING_SEEN;
}

function writeProjectSeen(project: string, change: (seen: ProjectSeen) => ProjectSeen) {
  localStorage.setItem(keyOf(project), JSON.stringify(change(readProjectSeen(localStorage.getItem(keyOf(project))))));
  for (const listener of listeners) listener();
}

/** Called as a file's review opens: it stops reading as new until it changes again. */
export function markProjectFileOpened(project: string, path: string) {
  const at = new Date().toISOString();
  writeProjectSeen(project, (seen) => ({ ...seen, opened: { ...seen.opened, [path]: at } }));
}

/** True when the file changed after the reviewer last looked (`since`) and after they last opened it. */
export const projectFileIsNew = (modified: string, path: string, since: string, opened: ProjectSeen['opened']) =>
  modified > since && modified > (opened[path] ?? '');

/** What the reviewer has seen of the project, kept in step across tabs; nothing seen in the server's render. */
function useProjectSeen(project: string): ProjectSeen {
  return readProjectSeen(useSyncExternalStore(subscribeToProjectSeen, () => localStorage.getItem(keyOf(project)), () => null));
}

/** Which of the project's files read as new: a test on a file's path and modified time. */
export type ProjectFileIsNewTest = ((path: string, modified: string) => boolean) | null;

const firstLookOf = (now: number) => new Date(now - FIRST_LOOK_WINDOW_MS).toISOString();

/** New since the reviewer last opened the latest view, for the count beside its link. `now` is the page's clock. */
export function useProjectNewSinceLastLook(project: string, now: number): ProjectFileIsNewTest {
  const seen = useProjectSeen(project);
  const since = seen.lookedAt ?? firstLookOf(now);
  return (path, modified) => projectFileIsNew(modified, path, since, seen.opened);
}

/**
 * The latest view's: new since the look before this one, which this one records as it opens. The marks hold while the
 * view stays open, so reading down the list doesn't clear them; opening a file does.
 */
export function useProjectLatestLook(project: string, now: number): ProjectFileIsNewTest {
  const seen = useProjectSeen(project);
  useEffect(() => {
    const at = new Date();
    writeProjectSeen(project, (was) => {
      const sameLook = was.lookedAt !== null && at.getTime() - Date.parse(was.lookedAt) < SAME_LOOK_MS;
      return { ...was, lookedBefore: sameLook ? was.lookedBefore : was.lookedAt, lookedAt: at.toISOString() };
    });
  }, [project]);
  const since = seen.lookedBefore ?? firstLookOf(now);
  return (path, modified) => projectFileIsNew(modified, path, since, seen.opened);
}
