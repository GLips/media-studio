import { Box, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ReviewArtifact } from '#lib/output/review/models/review-artifact.ts';
import { reviewNoteContext, type ReviewContextSources } from '#lib/output/review/models/review-notes.ts';
import { spacing } from '#web/shared/ui/theme.stylex.ts';
import { reviewArtifactStatusQueryOptions } from '../controllers/review-queries.ts';
import { useReviewNotes } from '../controllers/use-review-notes.ts';
import { ReviewBanners } from './review-banners.tsx';
import { ReviewComposer } from './review-composer.tsx';
import { ReviewHeader } from './review-header.tsx';
import type { ReviewNoteDraft } from './review-note-format.ts';
import { ReviewNoteList } from './review-note-list.tsx';
import { ReviewScrubber } from './review-scrubber.tsx';
import { ReviewStage } from './review-stage.tsx';
import { ReviewStoryboard } from './review-storyboard.tsx';
import { ReviewTransport } from './review-transport.tsx';
import { useReviewHotkeys } from './use-review-hotkeys.ts';
import { useReviewPlayback } from './use-review-playback.ts';

const styles = stylex.create({
  page: { maxWidth: '1600px', marginInline: 'auto', padding: `${spacing.inset} ${spacing.pageMargin} 4rem` },
  body: { display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${spacing.sideWidth}`, gap: spacing.sectionGap, alignItems: 'start' },
  side: { maxHeight: 'calc(100vh - 140px)', overflow: 'auto', position: 'sticky', top: spacing.inset },
});

/**
 * The review of one file: play it, pin notes on its frames (a click for a moment and a point, a drag along the
 * scrubber for a range, a sound's marker for that sound), and copy them as markdown. Every change saves. Bound to the
 * render it loaded: a replacement on disk raises a banner and waits.
 */
export function ReviewScreen({ artifact, onLoadReplacement }: { readonly artifact: ReviewArtifact; readonly onLoadReplacement: () => void }) {
  const isVideo = artifact.kind === 'video';
  const fps = artifact.fps ?? 30;
  const playback = useReviewPlayback({ fps, durationInFrames: artifact.durationInFrames });
  const { notes, updateNotes, saveState } = useReviewNotes(artifact);
  const [draft, setDraft] = useState<ReviewNoteDraft | null>(null);
  const status = useQuery(reviewArtifactStatusQueryOptions(artifact.project, artifact.path));
  useReviewHotkeys({ playback, isVideo, onCancelDraft: () => setDraft(null) });
  const sources: ReviewContextSources = useMemo(() => ({
    fps, frameSize: artifact.frameSize, scenes: artifact.scenes, sounds: artifact.sounds, motion: artifact.motion, cells: artifact.cells, timing: artifact.timing,
  }), [artifact, fps]);
  const sorted = notes.toSorted((a, b) => (a.frame ?? 0) - (b.frame ?? 0));
  const { frame, seekToFrame } = playback;

  const commitDraft = () => {
    if (!draft?.text.trim()) return;
    // Stamped with the render the screen loaded, even once it's replaced: that's the one the note is about.
    updateNotes((all) => [...all, { ...draft, text: draft.text.trim(), id: crypto.randomUUID(), render: artifact.render.hash, context: reviewNoteContext(draft, sources) }]);
    setDraft(null);
  };
  // A moment note follows the playhead; a range or a sound's note keeps its time.
  const pin = (x: number, y: number) => {
    playback.video.current?.pause();
    setDraft((d) => (d ? { ...d, x, y, ...(isVideo && d.end === undefined && !d.cue && { frame }) } : { ...(isVideo && { frame }), x, y, text: '' }));
  };
  // A moment note moves to the sound it's aimed at; a range keeps its span.
  const aimAtSound = (id: string, at: number) => {
    seekToFrame(at);
    setDraft((d) => (d ? { ...d, cue: id, ...(d.end === undefined && { frame: at }) } : { frame: at, cue: id, text: '' }));
  };

  return (
    <Stack gap="md" {...stylex.props(styles.page)}>
      <ReviewHeader artifact={artifact} artifacts={status.data?.artifacts ?? artifact.artifacts} notes={notes} saveState={saveState} />
      <ReviewBanners artifact={artifact} disk={status.error ? { error: status.error.message } : { status: status.data ?? artifact }} onLoadReplacement={onLoadReplacement} />
      <Box {...stylex.props(styles.body)}>
        <Stack gap="xs">
          <ReviewStage artifact={artifact} video={playback.video} onVideoMetadata={playback.measureVideo} frame={isVideo ? frame : null} notes={sorted} draft={draft} onPin={pin} />
          {isVideo && <ReviewTransport playback={playback} fps={fps} />}
          {isVideo && (
            <ReviewScrubber artifact={artifact} fps={fps} playback={playback} notes={sorted} draft={draft} onSound={aimAtSound}
              onRange={(first, last) => setDraft((d) => ({ ...d, text: d?.text ?? '', frame: first, end: last }))} />
          )}
          {artifact.storyboard && <ReviewStoryboard artifact={artifact} cards={artifact.storyboard} fps={fps} frame={frame} notes={sorted} onSeek={seekToFrame} />}
        </Stack>
        <Stack gap="sm" {...stylex.props(styles.side)}>
          {draft ? (
            <ReviewComposer draft={draft} fps={fps} context={reviewNoteContext(draft, sources)} onChange={setDraft} onSave={commitDraft} onCancel={() => setDraft(null)} />
          ) : (
            <Text size="sm" c="dimmed">{isVideo ? 'Pause where something feels off and click the frame there.' : 'Click the image where something feels off.'}</Text>
          )}
          <ReviewNoteList notes={sorted} render={artifact.render} fps={fps} frame={isVideo ? frame : null} onSeek={seekToFrame} onUpdateNotes={updateNotes} />
        </Stack>
      </Box>
    </Stack>
  );
}
