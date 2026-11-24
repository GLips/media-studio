import { Group } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useHotkeys } from '@tanstack/react-hotkeys';
import { LayoutGrid, List } from 'lucide-react';
import { IconButton } from './icon-button.tsx';
import { colors, radius } from './theme.stylex.ts';
import { useStudioCollectionView } from './use-studio-collection-view.ts';

const styles = stylex.create({
  // Edged as one control, so the two read as a choice between views rather than two separate actions.
  segments: { borderWidth: '1px', borderStyle: 'solid', borderColor: colors.line, borderRadius: radius.control, padding: '1px' },
});

/** The registered action both halves' tooltips show the key of. */
const STUDIO_COLLECTION_VIEW_ACTION = 'List or grid';

/**
 * List or grid for every page that shows either: the one global choice (useStudioCollectionView), lit on the view
 * showing. `V` flips it while the toggle is on screen, so the key only exists where it does something.
 */
export function StudioCollectionViewToggle() {
  const { view, setView } = useStudioCollectionView();
  useHotkeys([
    { hotkey: 'V', callback: () => setView(view === 'grid' ? 'list' : 'grid'), options: { meta: { group: 'global', name: STUDIO_COLLECTION_VIEW_ACTION } } },
  ]);
  return (
    <Group gap={0} wrap="nowrap" role="group" aria-label="View" {...stylex.props(styles.segments)}>
      <IconButton name="List" hotkey={STUDIO_COLLECTION_VIEW_ACTION} active={view === 'list'} onClick={() => setView('list')}><List size={14} /></IconButton>
      <IconButton name="Grid" hotkey={STUDIO_COLLECTION_VIEW_ACTION} active={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={14} /></IconButton>
    </Group>
  );
}
