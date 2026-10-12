import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useLocation } from '@tanstack/react-router';
import { colors } from './theme.stylex.ts';

const styles = stylex.create({
  project: { color: colors.dim },
  crumbs: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
});

/**
 * `project / out/video.mp4` read off the URL, as the screen that failed would have shown it. Read from the path, not
 * the route's params: a URL no route matches has none.
 */
export function RouteFailureCrumbs() {
  const { pathname } = useLocation();
  const [root, project, ...rest] = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (root !== 'projects' || project === undefined) return null;
  const place = (rest[0] === 'artifacts' ? rest.slice(1) : rest).join('/');
  return (
    <Text component="span" size="sm" {...stylex.props(styles.crumbs)}>
      <Text component="span" inherit {...stylex.props(styles.project)}>{project}{place && ' / '}</Text>{place}
    </Text>
  );
}
