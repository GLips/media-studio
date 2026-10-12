import { useMemo, useState } from 'react';
import type { ReviewArtifact } from '#lib/output/review/models/review-artifact.ts';
import { useProjectPulse } from '#web/features/projects/index.ts';
import { useReviewDraft, useReviewPlaybackClock, useReviewPlaybackState, type ReviewScreenValue, type ReviewSearch, type SetReviewSearch } from '#web/features/review/index.ts';
import type { ReviewScriptRead, ReviewScriptTakeRead } from '../controllers/review-script.ts';
import { useScriptSearch } from '../controllers/script-search.ts';
import { SCRIPT_READ_ALONG_FPS, scriptLineIndexAt, scriptTimedLinesOf, scriptTimingOf } from './script-read-along.ts';

/**
 * The take as the review's slots read a render: a video with no picture, on the read-along's clock, its lines the
 * voice lane's. The dock and the thread then work on it unchanged.
 */
function scriptTakeArtifactOf(project: string, script: ReviewScriptRead, take: ReviewScriptTakeRead): ReviewArtifact {
  return {
    render: { hash: take.hash, modified: take.modified }, project, path: take.path, kind: 'video', title: 'script',
    fps: SCRIPT_READ_ALONG_FPS, durationInFrames: null, startsAt: 0, frameSize: null, transparent: false,
    voice: take.label === 'draft' ? 'draft' : 'final', timing: scriptTimingOf(script.lines), missing: [],
  };
}

/**
 * Everything the review's slots share, for the script: the take's clock (its settled frame writes `line`), the draft,
 * the project pulse, the lines its threads are placed on, and the review search, of which the URL keeps only the thread and its filter.
 */
export function useScriptScreenValue(project: string, script: ReviewScriptRead, take: ReviewScriptTakeRead): ReviewScreenValue {
  const [scriptSearch, setScriptSearch] = useScriptSearch();
  const artifact = useMemo(() => scriptTakeArtifactOf(project, script, take), [project, script, take]);
  const timed = useMemo(() => scriptTimedLinesOf(script.lines), [script.lines]);
  const startLine = timed[script.lines.findIndex((l) => l.id === scriptSearch.line)];
  const durationGuess = Math.max(1, ...timed.map((line) => line?.to ?? 0));
  const playback = useReviewPlaybackClock({ fps: SCRIPT_READ_ALONG_FPS, durationInFrames: null, durationGuess, startFrame: startLine?.from ?? 0 }, (frame) => {
    const line = script.lines[scriptLineIndexAt(timed, frame)];
    if (line && line.id !== scriptSearch.line) setScriptSearch({ line: line.id });
  });
  const durationInFrames = useReviewPlaybackState(playback, (s) => s.durationInFrames);
  const draft = useReviewDraft(`${project}/script`);
  const pulse = useProjectPulse(project);
  // The range marks and the settled frame live on the page alone: the script's URL is its line.
  const [marks, setMarks] = useState<ReviewSearch>({});
  const search: ReviewSearch = { ...marks, ...(scriptSearch.note !== undefined && { note: scriptSearch.note }), ...(scriptSearch.filter && { filter: scriptSearch.filter }) };
  const setSearch: SetReviewSearch = (patch) => {
    const { note, filter, ...rest } = patch;
    if ('note' in patch || 'filter' in patch) setScriptSearch({ ...('note' in patch && { note }), ...('filter' in patch && { filter }) });
    if (Object.keys(rest).length) setMarks((current) => ({ ...current, ...rest }));
  };
  return {
    project, artifact, timing: { fps: SCRIPT_READ_ALONG_FPS, durationInFrames }, pulse, scriptLines: script.lines, playback, draft, search, setSearch,
    mode: 'stage', setMode: () => undefined, guides: null, setGuides: () => undefined,
  };
}
