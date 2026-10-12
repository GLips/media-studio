import { Box, Group, Image, Menu } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { formatStudioAgo } from '#web/shared/ui/studio-ago.ts';
import { colors, radius } from '#web/shared/ui/theme.stylex.ts';
import { reviewStillUrl } from '#web/shared/media-urls.ts';
import { useReviewFrame, useReviewScreen } from './review-screen-context.tsx';
import type { ReviewComparedVersion } from './use-review-render-versions.ts';

const styles = stylex.create({
  item: { cursor: 'pointer', backgroundColor: { default: 'transparent', ':hover': colors.raised } },
  // The 2px inner cream edge every selected thing has (the version on screen), drawn as an inset outline: shadows.ts
  // holds every box shadow, and has no selected edge.
  shown: { outlineColor: colors.cream, outlineStyle: 'solid', outlineWidth: '2px', outlineOffset: '-2px' },
  thumb: { position: 'relative', flexShrink: 0, height: '27px', overflow: 'hidden', borderRadius: radius.control, backgroundColor: colors.screen },
  pending: { backgroundColor: colors.skeleton },
  aspect: (aspect: number) => ({ aspectRatio: aspect }),
  image: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' },
  hidden: { opacity: 0 },
  age: { marginInlineStart: 'auto' },
});

/** The shape a thumbnail holds when the render's snapshot gave no frame size. */
const REVIEW_VERSION_GUESSED_ASPECT = 16 / 9;

/** `3a9f2c1*`: the workspace's commit (the project's code) where there's one, else the studio's; `*` if it was dirty. */
export function formatReviewVersionCommit({ source }: ReviewComparedVersion): string {
  const commit = source.workspace ?? source.engine;
  return `${commit.commit.slice(0, 7)}${commit.dirty ? '*' : ''}`;
}

/** `workspace 3a9f2c1 dirty · engine c2f33d9`: both commits a version was made from. */
function formatReviewVersionSource({ source: { engine, workspace } }: ReviewComparedVersion): string {
  return [workspace && formatReviewRepoCommit('workspace', workspace), formatReviewRepoCommit('engine', engine)].filter(Boolean).join(' · ');
}

const formatReviewRepoCommit = (repo: string, { commit, dirty }: { commit: string; dirty: boolean }) => `${repo} ${commit.slice(0, 7)}${dirty ? ' dirty' : ''}`;

type ReviewRenderVersionRowProps = {
  readonly version: ReviewComparedVersion;
  readonly shown: boolean;
  readonly now: number;
  readonly onChoose: () => void;
};

/**
 * One kept version in the `r14 ▾` menu: its frame at the playhead, cut from the archived copy, then `rN`, commit and
 * age. A version too short for the playhead's frame shows the bare ground.
 */
export function ReviewRenderVersionRow({ version, shown, now, onChoose }: ReviewRenderVersionRowProps) {
  const { project, artifact, timing } = useReviewScreen();
  const frame = useReviewFrame();
  const [picture, setPicture] = useState<'pending' | 'shown' | 'failed'>('pending');
  const aspect = artifact.frameSize ? artifact.frameSize.w / artifact.frameSize.h : REVIEW_VERSION_GUESSED_ASPECT;
  const src = reviewStillUrl({ project, path: version.file, render: { hash: version.hash } }, frame, timing.fps);
  return (
    <HotkeyTooltip name={formatReviewVersionSource(version)}>
      <Menu.Item onClick={onChoose} aria-current={shown || undefined} {...stylex.props(styles.item, shown && styles.shown)}>
        <Group gap="gap" wrap="nowrap">
          <Box aria-hidden {...stylex.props(styles.thumb, styles.aspect(aspect), picture === 'pending' && styles.pending)}>
            {picture !== 'failed' && (
              <Image src={src} alt="" loading="lazy" onLoad={() => setPicture('shown')} onError={() => setPicture('failed')}
                {...stylex.props(styles.image, picture === 'pending' && styles.hidden)} />
            )}
          </Box>
          <Readout bright>r{version.r}</Readout>
          <Readout>{formatReviewVersionCommit(version)}</Readout>
          <Box {...stylex.props(styles.age)}><Readout>{formatStudioAgo(version.at, now)}</Readout></Box>
        </Group>
      </Menu.Item>
    </HotkeyTooltip>
  );
}
