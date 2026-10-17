import { useParams, useRouter } from '@tanstack/react-router';
import { Film, Folder, ImageIcon, ScrollText, Split } from 'lucide-react';
import type { ReviewProjectSummary } from '#lib/output/review/models/review-dashboard.ts';
import type { QuickOpenEntriesBody, QuickOpenEntriesSource, QuickOpenEntry } from '#web/shared/ui/quick-open-entries.tsx';
import { useProjectSummariesIfLoaded } from '../controllers/project-queries.ts';

const GLYPH_SIZE = 12;

type StudioRouter = ReturnType<typeof useRouter>;

/** A project, then each of its files, decisions and its plan, as quick-open lists them; `near` on screen now. */
function quickOpenEntriesOf({ project, rows }: ReviewProjectSummary, router: StudioRouter, near: boolean): QuickOpenEntry[] {
  const projectEntry: QuickOpenEntry = {
    key: project, glyph: <Folder size={GLYPH_SIZE} />, label: project, near,
    href: router.buildLocation({ to: '/projects/$project', params: { project } }).href,
  };
  return [projectEntry, ...rows.flatMap((row): QuickOpenEntry[] => {
    switch (row.on) {
      case 'file': return [{
        key: `${project}/${row.artifact.path}`, label: row.artifact.path, context: project, near,
        glyph: row.artifact.kind === 'video' ? <Film size={GLYPH_SIZE} /> : <ImageIcon size={GLYPH_SIZE} />,
        href: router.buildLocation({ to: '/projects/$project/artifacts/$', params: { project, _splat: row.artifact.path } }).href,
      }];
      case 'decision': return [{
        key: `${project}#${row.id}`, label: row.topic, context: project, near, glyph: <Split size={GLYPH_SIZE} />,
        href: router.buildLocation({ to: '/projects/$project/decisions/$topic', params: { project, topic: row.topic } }).href,
      }];
      case 'plan': return [{
        key: `${project}:plan`, label: 'plan', context: project, near, glyph: <ScrollText size={GLYPH_SIZE} />,
        href: router.buildLocation({ to: '/projects/$project/plan', params: { project } }).href,
      }];
      default: return [];
    }
  })];
}

/**
 * Quick-open's places: every project, the most recently active first, each followed by what it holds; the project on
 * screen's places are `near`, listed and ranked first.
 */
function StudioQuickOpenEntries({ body }: { readonly body: QuickOpenEntriesBody }) {
  const data = useProjectSummariesIfLoaded();
  const router = useRouter();
  const here = useParams({ strict: false }).project;
  return body(data?.flatMap((summary) => quickOpenEntriesOf(summary, router, summary.project === here)));
}

/** The root's source for quick-open: the studio's projects and what each holds, loaded while it's open. */
export const studioQuickOpenEntries: QuickOpenEntriesSource = (body) => <StudioQuickOpenEntries body={body} />;
