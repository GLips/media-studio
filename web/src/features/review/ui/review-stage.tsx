import { Box, Image, SegmentedControl, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState, type RefObject } from 'react';
import type { ReviewArtifact } from '#models/review/review-artifact.ts';
import type { ReviewNote } from '#models/review/review-notes.ts';
import { shadows } from '#web/shared/ui/shadows.ts';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';
import { reviewNoteCovers, type ReviewNoteDraft } from './review-note-format.ts';
import { reviewMediaUrl } from './review-media-urls.ts';

/** The grounds a transparent render can be proofed over: the checkerboard, and the flat colours it may sit on. */
const REVIEW_PROOF_GROUNDS = ['checker', 'coral', 'navy', 'white', 'black'] as const;
type ReviewProofGround = (typeof REVIEW_PROOF_GROUNDS)[number];

const styles = stylex.create({
  stage: {
    position: 'relative', overflow: 'hidden', marginInline: 'auto', borderRadius: '4px', cursor: 'crosshair',
    backgroundColor: colors.screen,
  },
  sized: (aspect: number) => ({ aspectRatio: aspect, width: `min(100%, calc(72vh * ${aspect}))` }),
  media: { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' },
  checker: {
    backgroundColor: colors.checkerLight,
    backgroundImage: `repeating-conic-gradient(${colors.checkerDark} 0 25%, transparent 0 50%)`,
    backgroundSize: '32px 32px',
  },
  coral: { backgroundColor: colors.proofCoral },
  navy: { backgroundColor: colors.proofNavy },
  white: { backgroundColor: colors.proofWhite },
  black: { backgroundColor: colors.proofBlack },
  pin: {
    position: 'absolute', transform: 'translate(-50%, -50%)', width: '26px', height: '26px', borderRadius: '50%',
    backgroundColor: colors.accent, color: colors.ground, fontFamily: fonts.mono, fontWeight: 700,
    lineHeight: '26px', textAlign: 'center', pointerEvents: 'none',
  },
  draftPin: { backgroundColor: colors.cobalt, color: colors.cream },
  pinAt: (x: number, y: number) => ({ left: `${x * 100}%`, top: `${y * 100}%` }),
});

type ReviewStageProps = {
  readonly artifact: ReviewArtifact;
  readonly video: RefObject<HTMLVideoElement | null>;
  readonly onVideoMetadata: (video: HTMLVideoElement) => void;
  /** The frame on screen, for a video; null for a still, whose pins all show. */
  readonly frame: number | null;
  /** In frame order, numbered as the list numbers them. */
  readonly notes: readonly ReviewNote[];
  readonly draft: ReviewNoteDraft | null;
  readonly onPin: (x: number, y: number) => void;
};

/** The frame, large, with the pins of the notes on it now. A click pins a point, as a fraction of the frame. */
export function ReviewStage({ artifact, video, onVideoMetadata, frame, notes, draft, onPin }: ReviewStageProps) {
  const [naturalAspect, setNaturalAspect] = useState<number | null>(null);
  const [ground, setGround] = useState<ReviewProofGround>('checker');
  const aspect = artifact.frameSize ? artifact.frameSize.w / artifact.frameSize.h : naturalAspect ?? 16 / 9;
  const src = reviewMediaUrl(artifact);
  return (
    <Stack gap="xs">
      <Box
        {...stylex.props(styles.stage, styles.sized(aspect), artifact.transparent && styles[ground])}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          onPin(clampToUnit((e.clientX - box.left) / box.width), clampToUnit((e.clientY - box.top) / box.height));
        }}
      >
        {artifact.kind === 'video' ? (
          <Box component="video" ref={video} src={src} preload="auto" playsInline {...stylex.props(styles.media)}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setNaturalAspect(v.videoWidth / v.videoHeight);
              onVideoMetadata(v);
            }} />
        ) : (
          <Image src={src} alt="" {...stylex.props(styles.media)} onLoad={(e) => setNaturalAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
        )}
        {notes.map((note, i) => note.x !== undefined && note.y !== undefined && (frame === null || reviewNoteCovers(note, frame)) && (
          <Text key={note.id} component="span" size="xs" {...stylex.props(styles.pin, shadows.pinHalo, styles.pinAt(note.x, note.y))}>{i + 1}</Text>
        ))}
        {draft?.x !== undefined && draft.y !== undefined && <Text component="span" size="xs" {...stylex.props(styles.pin, shadows.pinHalo, styles.draftPin, styles.pinAt(draft.x, draft.y))}>+</Text>}
      </Box>
      {artifact.transparent && (
        <SegmentedControl size="xs" value={ground} onChange={(value) => setGround(REVIEW_PROOF_GROUNDS.find((g) => g === value) ?? 'checker')}
          data={REVIEW_PROOF_GROUNDS.map((g) => ({ value: g, label: g === 'checker' ? 'checkerboard' : g }))} />
      )}
    </Stack>
  );
}

const clampToUnit = (v: number) => Math.min(1, Math.max(0, v));
