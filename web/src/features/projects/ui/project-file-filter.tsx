import * as stylex from '@stylexjs/stylex';
import { projectMadeTitleOf } from '#lib/output/review/models/project-made.ts';
import type { ReviewProjectRow } from '#lib/output/review/models/review-dashboard.ts';
import { TextInput } from '#web/shared/ui/text-input.tsx';

const styles = stylex.create({
  field: { width: '200px' },
});

/**
 * True for a file whose path (folder and name) or made name (`theme-sax`, a footage's scene) holds every word of
 * `query`, in any case; every file for an empty query.
 */
export function projectFileMatchesFilter(row: ReviewProjectRow, query: string): boolean {
  if (row.on !== 'file') return false;
  const { path, made } = row.artifact;
  const haystack = `${path} ${made ? projectMadeTitleOf(made, path) : ''}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

type ProjectFileFilterProps = { readonly value: string; readonly onChange: (value: string) => void };

/** A project's files filtered by name or folder; Escape clears it. */
export function ProjectFileFilter({ value, onChange }: ProjectFileFilterProps) {
  return (
    <TextInput size="xs" aria-label="Filter files by name or folder" placeholder="Filter files" value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        onChange('');
        event.currentTarget.blur();
      }}
      {...stylex.props(styles.field)} />
  );
}
