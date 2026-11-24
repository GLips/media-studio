import { Box } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import * as stylex from '@stylexjs/stylex';
import { useNavigate } from '@tanstack/react-router';
import type { ReviewSearch } from '../controllers/review-search.ts';
import { ReviewFilmstrip } from './review-filmstrip.tsx';
import { useReviewScreen } from './review-screen-context.tsx';
import { ReviewStage } from './review-stage.tsx';
import { ReviewStillGrid } from './review-still-grid.tsx';
import { useReviewStillPixels, useReviewStillSiblings } from './review-still-siblings.ts';
import { ReviewStillsBar } from './review-stills-bar.tsx';

const styles = stylex.create({
  view: { display: 'grid', height: '100%', minHeight: 0, gridTemplateRows: 'minmax(0, 1fr) auto' },
  // The filmstrip takes the dock's place under the bar.
  withStrip: { gridTemplateRows: 'minmax(0, 1fr) auto auto' },
  stage: { minHeight: 0, minWidth: 0 },
});

/** What carries from one still to the next: how the thread is filtered and the zoom. A frame, a note, a range don't. */
const reviewSearchCarriedToStill = ({ filter, z }: ReviewSearch): ReviewSearch => ({ ...(filter && { filter }), ...(z && { z }) });

/**
 * A still, or a folder of them: the grid (`B`), or one fitted on the stage with the folder's filmstrip under it, the
 * arrows stepping through the folder; the stills' bar between. Each still is its own file with its own threads, so
 * stepping opens it.
 */
export function ReviewStillsView() {
  const { project, artifact, search, setSearch } = useReviewScreen();
  const stills = useReviewStillSiblings();
  const pixels = useReviewStillPixels(stills);
  const { ref: stageRef, width, height } = useElementSize();
  const navigate = useNavigate({ from: '/projects/$project/artifacts/$' });
  const open = (path: string) =>
    void navigate({ to: '/projects/$project/artifacts/$', params: { project, _splat: path }, search: reviewSearchCarriedToStill });
  // On the grid, the selection is the open still: the rail's preview, facts, notes and prompt are all that still's.
  // Replacing history, as arrowing through twenty stills is one look, not twenty places to go back through.
  const select = (path: string) => void navigate({
    to: '/projects/$project/artifacts/$', params: { project, _splat: path }, replace: true,
    search: (was) => ({ ...reviewSearchCarriedToStill(was), view: 'grid' }),
  });
  const folder = stills.length > 1;
  const grid = folder && search.view === 'grid';
  const here = stills.findIndex((s) => s.path === artifact.path);
  const clear = new Set(stills.filter((_, i) => pixels[i]?.clear).map((s) => s.path));
  return (
    <Box {...stylex.props(styles.view, folder && !grid && styles.withStrip)}>
      {grid
        ? <ReviewStillGrid stills={stills} selectedPath={artifact.path} clear={clear} onSelect={select} onOpen={() => setSearch({ view: 'stage' })} />
        : <Box ref={stageRef} {...stylex.props(styles.stage)}><ReviewStage /></Box>}
      {/* The grid's sections count its stills, so its bar is there only for the grounds, when a still is clear. */}
      {(!grid || clear.size > 0) && (
        <ReviewStillsBar position={folder && !grid ? { at: here, of: stills.length } : null} grid={grid}
          clear={grid ? clear.size > 0 : clear.has(artifact.path)} frame={pixels[here] ?? null} stage={{ width, height }} />
      )}
      {folder && !grid && <ReviewFilmstrip stills={stills} openPath={artifact.path} clear={clear} onOpen={open} />}
    </Box>
  );
}
