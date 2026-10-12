// review-markdown.ts: a project's threads as the markdown an agent acts on: `studio review notes`, `watch`, and the
// page's copy. Each item leads with what it's on and where, then everything an agent needs to find and see it, with
// paths from the repo root so it can Read them from any working directory. A note's paragraphs are kept as written.
//
// The list holds the states asked for, open and reopened by default; keep threads, the reviewer's standing
// constraints, are always listed in their own section until resolved.
import { formatSliceReplyCommand, renderSlicePathOf } from '#lib/output/render/models/render-splice.ts';
import { formatReviewMomentPlace } from './review-moment.ts';
import { formatReviewMoment, formatStillAxes, reviewNoteContext, reviewSceneAtFrame, type ReviewContextSources, type ReviewNoteContext } from './review-context.ts';
import type { PlacedReviewThread, ReviewLaidSlice, ReviewPlacement } from './review-placement.ts';
import { formatReviewClock } from './review-timeline-geometry.ts';
import type { ReviewAnchor, ReviewEntry, ReviewRenderSource, ReviewThreadState, ReviewWrittenOn } from './review-threads.ts';

/** How much of a frame the `look:` line crops around a note's point, in render pixels. */
const LOOK_CROP = { w: 400, h: 300 };
/** Frames the `look:` line shows either side of a note. */
const LOOK_REACH_FRAMES = 3;

export type ReviewMarkdownOptions = {
  project: string;
  /** The render the threads are placed on, project-relative. */
  renderPath: string;
  renderHash: string;
  /** The render as a scene's span names it, `out/video.mp4 r14`: its path and version, when it has been kept. */
  renderName?: string;
  fps: number;
  /** The render's frame in pixels, from its snapshot; null without one, which leaves points as fractions. */
  size: { w: number; h: number } | null;
  states?: readonly ReviewThreadState[];
  /** The render's context sources, so a video note names what's under it and near it on this render. */
  sources?: ReviewContextSources;
  /** Each scene's source file, project-relative (`bars/ink.tsx`). */
  sceneSources?: Readonly<Record<string, string>>;
  /** The stills other notes are on, by path, as they are now: a still note is read on its own still, not the render. */
  stills?: Readonly<Record<string, ReviewMarkdownStill>>;
  /** The slices laid into the render: a note written on one is looked at on the slice, its fixed picture. */
  splices?: readonly Pick<ReviewLaidSlice, 'hash'>[];
};

/** A still as it is on disk: its bytes' hash and its size in pixels (null for an SVG). */
export type ReviewMarkdownStill = { hash: string; size: { w: number; h: number } | null };

export function formatReviewThreadsMarkdown(items: readonly PlacedReviewThread[], options: ReviewMarkdownOptions): string {
  const { project, renderPath, renderHash, fps } = options, states = options.states ?? ['open', 'reopened'];
  const listed = items.filter((t) => t.kind !== 'keep' && states.includes(t.state)).toSorted(byPlace);
  const keeps = items.filter((t) => t.kind === 'keep' && t.state !== 'resolved').toSorted(byPlace);
  const head = [`## Review notes: ${project}`, `\`${projectPathOf(project, renderPath)}\` \`${renderHash}\` · ${fps} fps`];
  const sections = [
    head.join('\n'),
    listed.length ? listed.map((t) => formatReviewThreadItem(t, options)).join('\n\n') : `(no ${states.join(' or ')} notes)`,
    ...(keeps.length ? [['## Keep', ...keeps.map((t) => formatReviewThreadItem(t, options))].join('\n\n')] : []),
  ];
  return `${sections.join('\n\n')}\n`;
}

const projectPathOf = (project: string, path: string) => `work/projects/${project}/${path}`;

const ANCHOR_ORDER = ['video', 'still', 'script', 'decision', 'project'] as const;

/** Placed video notes in time order, then stills, the script by line, decisions, the project; the unplaced last. */
function byPlace(a: PlacedReviewThread, b: PlacedReviewThread): number {
  return placeRankOf(a) - placeRankOf(b) || placeOrderOf(a) - placeOrderOf(b) || a.id - b.id;
}

const placeRankOf = (t: PlacedReviewThread) => ('unplaced' in t.placement ? ANCHOR_ORDER.length : ANCHOR_ORDER.indexOf(t.anchor.on));

function placeOrderOf({ placement }: PlacedReviewThread): number {
  if ('frame' in placement) return placement.frame;
  return 'word' in placement ? (placement.word ?? -1) : -1;
}

type AnchorLines = { head: string; lines: string[] };

function formatAnchorLines(thread: PlacedReviewThread, options: ReviewMarkdownOptions): AnchorLines {
  const { anchor } = thread;
  switch (anchor.on) {
    case 'video': {
      const fix = thread.kind === 'fix' && (thread.state === 'open' || thread.state === 'reopened') ? thread.id : undefined;
      return formatVideoNoteLines(anchor, thread.placement, options, fix);
    }
    case 'still': return formatStillNoteLines(anchor, options);
    case 'script': {
      const word = anchor.word === undefined ? '' : `, word ${anchor.word + 1}${anchor.text ? ` "${anchor.text}"` : ''}`;
      return { head: ` — script line ${anchor.line}${word}${anchor.take ? ` in take \`${anchor.take}\`` : ''}`, lines: [] };
    }
    case 'decision': {
      const at = anchor.at === undefined ? '' : ` at ${formatReviewClock(anchor.at)}`;
      return { head: ` — decision #${anchor.decision}${anchor.candidate ? `, candidate ${anchor.candidate}` : ''}${at}`, lines: [] };
    }
  }
  return { head: ' — the project', lines: [] };
}

function formatReviewThreadItem(thread: PlacedReviewThread, options: ReviewMarkdownOptions): string {
  const { placement } = thread;
  const lead = `### #${thread.id} ${thread.kind} · ${thread.state}${thread.entries[0].author === 'agent' ? ' · asked by the agent' : ''}`;
  const unplaced = 'unplaced' in placement ? [`unplaced: ${placement.unplaced}`] : [];
  const about = formatAnchorLines(thread, options);
  const [note, ...replies] = thread.entries;
  return [
    [`${lead}${about.head}`, ...unplaced, ...about.lines].join('\n'),
    note.text.trim(),
    ...replies.map(formatReviewReply),
  ].join('\n\n');
}

/**
 * A video note's lines. `fix` is the note's id when it's a fix still to make (open or reopened), which gets the render
 * and reply that hand the fix over.
 */
function formatVideoNoteLines(anchor: Extract<ReviewAnchor, { on: 'video' }>, placement: ReviewPlacement, options: ReviewMarkdownOptions, fix: number | undefined): AnchorLines {
  const { project, renderPath, renderHash, fps, size, sources } = options;
  const placed = 'frame' in placement ? placement : undefined;
  const context: ReviewNoteContext = placed && sources
    ? reviewNoteContext({ frame: placed.frame, end: placed.end, x: anchor.point?.x, y: anchor.point?.y, cue: anchor.cue }, sources)
    : {};
  const moment = context.moment ?? anchor.moment;
  const when = (frame: number, end: number | undefined) => `${formatReviewMoment(frame, fps)}${end !== undefined && end !== frame ? `–${formatReviewMoment(end, fps)}` : ''}`;
  const head = [moment && ` · ${formatReviewMomentPlace(moment)}`, placed && ` — ${when(placed.frame, placed.end)} on ${renderPath} \`${renderHash}\``].filter(Boolean).join('')
    || ` — written at ${when(anchor.frame, anchor.end)}`;
  // A note on a laid slice sits over the very picture it was written on: no shift to report, and it's looked at there.
  const onSlice = placed && options.splices?.some((s) => s.hash === anchor.writtenOn.hash);
  const moved = placed && !onSlice ? ` · now f${placed.frame} (${signed(placed.frame - anchor.frame)})` : '';
  const written = anchor.writtenOn.hash === renderHash ? undefined
    : `written on ${formatWrittenOn(anchor.writtenOn)} at f${anchor.frame}${onSlice ? ', laid into this render' : moved}`;
  const look = onSlice ? { path: anchor.writtenOn.path, frames: { frame: anchor.frame, ...(anchor.end !== undefined && { end: anchor.end }) } } : placed && { path: renderPath, frames: placed };
  const span = placed && sources?.scenes && reviewSceneAtFrame(sources.scenes, placed.frame);
  const scene = span?.id ?? moment?.scene;
  return {
    head,
    lines: [
      written,
      // Unplaced, the render may not be a video of this size at all (a still): the point stays a fraction.
      [formatPoint(anchor.point, placed ? size : null), ...formatContextBits(context)].filter(Boolean).join(' · '),
      anchor.image && `frame: ${projectPathOf(project, anchor.image)}`,
      scene && formatSceneLine(scene, span, options),
      look && `look:  ${formatLookCommand(project, look.path, look.frames, anchor.point, size)}`,
      placed && scene && fix && `fix:   ${formatFixCommand(project, scene, fix)}`,
    ].filter((line): line is string => Boolean(line)),
  };
}

/** `scene: ink (bars/ink.tsx) · f240–f311 on out/video.mp4 r14`: the scene, its source and the frames it's on screen. */
function formatSceneLine(scene: string, span: { from: number; to: number } | undefined, options: ReviewMarkdownOptions): string {
  const source = options.sceneSources?.[scene];
  const shown = span ? ` · f${span.from}–f${span.to - 1} on ${options.renderName ?? options.renderPath}` : '';
  return `scene: ${scene}${source ? ` (${projectPathOf(options.project, source)})` : ''}${shown}`;
}

/** The render that shows a fix to `scene` and the reply that hands it over, for note `id`. */
function formatFixCommand(project: string, scene: string, id: number): string {
  return `studio render ${project} --scene ${scene}, commit, then ${formatSliceReplyCommand(project, id, renderSlicePathOf({ scene }))}`;
}

function formatStillNoteLines(anchor: Extract<ReviewAnchor, { on: 'still' }>, options: ReviewMarkdownOptions): AnchorLines {
  const { project, renderPath, renderHash, size, sources } = options;
  // Read on the render when it is this still; else on the still as it is now, never in the render's pixels.
  const own = anchor.writtenOn.path === renderPath;
  const still: ReviewMarkdownStill | undefined = own ? { hash: renderHash, size } : options.stills?.[anchor.writtenOn.path];
  const { cell } = own && anchor.point && sources ? reviewNoteContext({ x: anchor.point.x, y: anchor.point.y }, sources) : {};
  const written = anchor.writtenOn.hash === still?.hash ? undefined : `written on ${formatWrittenOn(anchor.writtenOn)}`;
  return {
    head: ` — ${anchor.writtenOn.path}${anchor.cell ? ` · variant \`${anchor.cell}\`` : ''}`,
    lines: [
      written,
      [formatPoint(anchor.point, still?.size ?? null), cell && `variant \`${cell.variant}\` (${formatStillAxes(cell.axes)})${cell.refused ? ', refused by the still check' : ''}`].filter(Boolean).join(' · '),
      anchor.image && `frame: ${projectPathOf(project, anchor.image)}`,
    ].filter((line): line is string => Boolean(line)),
  };
}

const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);
const shortCommit = ({ commit, dirty }: ReviewRenderSource['engine']) => `${commit.slice(0, 7)}${dirty ? ' dirty' : ''}`;

function formatWrittenOn({ path, hash, commit }: ReviewWrittenOn): string {
  const made = commit && ` (${[commit.workspace && `workspace ${shortCommit(commit.workspace)}`, `engine ${shortCommit(commit.engine)}`].filter(Boolean).join(', ')})`;
  return `${path} \`${hash}\`${made ?? ''}`;
}

function formatPoint(point: { x: number; y: number } | undefined, size: ReviewMarkdownOptions['size']): string | undefined {
  if (!point) return undefined;
  if (!size) return `point (${point.x.toFixed(2)}, ${point.y.toFixed(2)}) of the frame`;
  return `point (${Math.round(point.x * size.w)}, ${Math.round(point.y * size.h)}) px of ${size.w}×${size.h}`;
}

function formatContextBits({ elements, sounds }: ReviewNoteContext): string[] {
  return [
    elements?.length ? `under it: ${elements.map((e) => `\`${e.id}\``).join(' inside ')}` : '',
    ...(sounds ?? []).map((s) => `sound ${s.sound} \`${s.id}\` f${s.frame}${s.targeted ? ' (aimed at)' : ''}`),
  ].filter(Boolean);
}

function formatLookCommand(project: string, renderPath: string, placed: { frame: number; end?: number }, point: { x: number; y: number } | undefined, size: ReviewMarkdownOptions['size']): string {
  const frames = `${Math.max(0, placed.frame - LOOK_REACH_FRAMES)}:${(placed.end ?? placed.frame) + LOOK_REACH_FRAMES}`;
  if (!point || !size) return `studio look ${project} --video ${renderPath} --frames ${frames}`;
  const w = Math.min(LOOK_CROP.w, size.w), h = Math.min(LOOK_CROP.h, size.h);
  const x = Math.min(Math.max(0, Math.round(point.x * size.w - w / 2)), size.w - w), y = Math.min(Math.max(0, Math.round(point.y * size.h - h / 2)), size.h - h);
  return `studio look ${project} --video ${renderPath} --frames ${frames} --crop ${x},${y},${w},${h}`;
}

/** A reply, quoted under its note: who, what it did to the note, and the commit and render it points at. */
function formatReviewReply(entry: ReviewEntry): string {
  const about = [
    `r${entry.rev}`,
    entry.commit && `commit ${[entry.commit.workspace && `workspace ${entry.commit.workspace.slice(0, 7)}`, `engine ${entry.commit.engine.slice(0, 7)}`].filter(Boolean).join(', ')}`,
    entry.render && `render ${entry.render.path} \`${entry.render.hash}\``,
  ].filter(Boolean).join(', ');
  const did = [entry.transition, entry.asks && 'asks'].filter(Boolean).map((d) => ` · ${d}`).join('');
  const lead = `  > ${entry.author}${did} (${about})`;
  const text = entry.text.trim();
  return text ? [`${lead}:`, ...text.split('\n').map((line) => (line ? `  > ${line}` : '  >'))].join('\n') : lead;
}
