import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';

/** Where a row or tile leads: a project's page, one of its files, a decision or its plan. */
export type ProjectRowTarget = { project: string } & ({ on: 'project' } | { on: 'file'; path: string } | { on: 'decision'; topic: string } | { on: 'plan' });

/** Marks the rows and tiles the arrow keys walk (use-project-row-hotkeys.ts). */
export const PROJECT_ROW_ATTRIBUTE = 'data-project-row';

type ProjectTargetLinkProps = {
  readonly target: ProjectRowTarget;
  /** The row's or tile's look. */
  readonly xstyle: stylex.StyleXStyles;
  readonly children: ReactNode;
};

/** A row or tile as the link to its target, one the arrow keys walk. */
export function ProjectTargetLink({ target, xstyle, children }: ProjectTargetLinkProps) {
  const link = { ...stylex.props(xstyle), underline: 'never', [PROJECT_ROW_ATTRIBUTE]: '' } as const;
  const { project } = target;
  switch (target.on) {
    case 'project': return <AnchorLink to="/projects/$project" params={{ project }} {...link}>{children}</AnchorLink>;
    case 'file': return <AnchorLink to="/projects/$project/artifacts/$" params={{ project, _splat: target.path }} {...link}>{children}</AnchorLink>;
    case 'decision': return <AnchorLink to="/projects/$project/decisions/$topic" params={{ project, topic: target.topic }} {...link}>{children}</AnchorLink>;
    default: return <AnchorLink to="/projects/$project/plan" params={{ project }} {...link}>{children}</AnchorLink>;
  }
}
