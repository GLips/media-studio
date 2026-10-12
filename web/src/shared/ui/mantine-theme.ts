import { ActionIcon, Button, createTheme, Menu, Text, Tooltip, type CSSVariablesResolver } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { colors, fonts, radius, spacing, typography } from './theme.stylex.ts';

const styles = stylex.create({
  // Mantine's dark scheme draws tooltips light: a glaring box over a dark screen. Ours sit on it as a panel.
  tooltip: {
    backgroundColor: colors.panel, color: colors.cream, borderWidth: '1px', borderStyle: 'solid', borderColor: colors.line,
    borderRadius: radius.control, paddingBlock: spacing.hairline, paddingInline: spacing.gap,
  },
  // A menu lifts off the ground like any panel; left on the ground, it melts into the screen under it.
  dropdown: { backgroundColor: colors.panel, borderColor: colors.line },
});

/** Mantine's components in the studio's look: its faces, its ground and panel, the accent as the primary action. */
export const mantineTheme = createTheme({
  primaryColor: 'orange',
  primaryShade: 7,
  defaultRadius: 'xs',
  radius: { xs: radius.control },
  cursorType: 'pointer',
  fontFamily: fonts.display,
  fontFamilyMonospace: fonts.mono,
  lineHeights: { xs: typography.lineHeight, sm: typography.lineHeight, md: typography.lineHeight },
  fontSizes: { xs: typography.readout, sm: typography.chrome, md: typography.body, lg: typography.script, xl: typography.display },
  // The studio's spacing steps by name beside Mantine's xs–xl, so `gap="tight"` is the theme's step, not a number.
  spacing: { hairline: spacing.hairline, tight: spacing.tight, gap: spacing.gap, inset: spacing.inset },
  headings: {
    fontFamily: fonts.display,
    fontWeight: '900',
    sizes: { h1: { fontSize: typography.display, lineHeight: typography.lineHeight } },
  },
  components: {
    Button: Button.extend({ defaultProps: { size: 'xs', variant: 'default' } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { size: 'sm', variant: 'subtle', color: 'gray' } }),
    Text: Text.extend({ defaultProps: { size: 'sm' } }),
    Tooltip: Tooltip.extend({ classNames: { tooltip: stylex.props(styles.tooltip).className } }),
    Menu: Menu.extend({ classNames: { dropdown: stylex.props(styles.dropdown).className } }),
  },
});

export const themeVariables: CSSVariablesResolver = () => ({
  variables: {},
  light: {},
  dark: {
    '--mantine-color-body': colors.ground,
    '--mantine-color-default': colors.panel,
    '--mantine-color-default-hover': colors.raised,
    '--mantine-color-default-border': colors.line,
    // Also the focus ring's colour (styles.css), which can't name a StyleX token itself.
    '--mantine-color-text': colors.cream,
    '--mantine-color-dimmed': colors.dim,
    // Whatever Mantine still fills with its primary takes the accent token, not its own orange.
    '--mantine-primary-color-filled': colors.accent,
  },
});
