import { Box } from '@mantine/core';
import type { ReactNode } from 'react';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { formatStudioAgo } from '#web/shared/ui/studio-ago.ts';

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

type ProjectAgeProps = {
  readonly at: string;
  /** What happened then, for the tooltip: `rendered`, `reviewed`. */
  readonly what: string;
  /** A glyph before the age, telling two ages in one row apart. */
  readonly glyph?: ReactNode;
  /** The moment ages count back from: when the row's summary was read, so a render stays pure. */
  readonly now: number;
};

/** How long ago something happened, in mono; the tooltip has the date. It moves on each time the summary polls. */
export function ProjectAge({ at, what, glyph, now }: ProjectAgeProps) {
  return (
    <HotkeyTooltip name={`${what} ${formatWhen(at)}`}>
      <Box component="span" display="inline-flex">
        <Readout>{glyph}{formatStudioAgo(at, now)}</Readout>
      </Box>
    </HotkeyTooltip>
  );
}
