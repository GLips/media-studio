import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { SceneRung } from '#lib/timing/timeline/models/scene-rung.ts';
import { colors } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  rung: { marginRight: '5px', padding: '0 4px', borderRadius: '2px', fontWeight: 600, textTransform: 'uppercase', color: colors.ground },
  blocking: { backgroundColor: colors.blocking },
  final: { backgroundColor: colors.pass },
});

/** Which scenes are still blocked and which are finished, read along the strip and on the cards. */
export function ReviewSceneRung({ rung }: { readonly rung: SceneRung }) {
  return <Text component="b" inherit {...stylex.props(styles.rung, styles[rung])}>{rung}</Text>;
}
