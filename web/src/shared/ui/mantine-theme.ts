import { ActionIcon, Badge, Button, createTheme, SegmentedControl, Slider, Text, type CSSVariablesResolver } from '@mantine/core';
import { colors, fonts, spacing, typography } from './theme.stylex.ts';

/** Mantine's components in the studio's look: its faces, its ground and panel, red-orange as the primary action. */
export const mantineTheme = createTheme({
  primaryColor: 'orange',
  primaryShade: 7,
  defaultRadius: 'sm',
  cursorType: 'pointer',
  fontFamily: fonts.display,
  fontFamilyMonospace: fonts.mono,
  // `stat` is a figure read at a glance (the lab's spend); `size="stat"` on Text.
  fontSizes: { micro: typography.micro, xs: typography.readout, sm: typography.body, md: typography.body, lg: typography.lede, xl: typography.section, stat: typography.title },
  // The studio's spacing steps by name beside Mantine's xs–xl, so `gap="tight"` is the theme's step, not a number.
  spacing: { hairline: spacing.hairline, tight: spacing.tight, gap: spacing.gap, inset: spacing.inset, sectionGap: spacing.sectionGap, pageMargin: spacing.pageMargin },
  headings: {
    fontFamily: fonts.display,
    fontWeight: '900',
    sizes: {
      h1: { fontSize: typography.brand, lineHeight: '1' },
      h2: { fontSize: typography.title, lineHeight: '1.02' },
      // A part inside a lab tab, under the tab's h2.
      h3: { fontSize: typography.partTitle, lineHeight: '1.05' },
      h4: { fontSize: typography.section, lineHeight: '1.3' },
    },
  },
  components: {
    Button: Button.extend({ defaultProps: { size: 'xs', variant: 'default' } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { size: 'md', variant: 'default' } }),
    Text: Text.extend({ defaultProps: { size: 'sm' } }),
    Badge: Badge.extend({ defaultProps: { size: 'sm', variant: 'light', radius: 'sm' } }),
    SegmentedControl: SegmentedControl.extend({ defaultProps: { size: 'xs' } }),
    Slider: Slider.extend({ defaultProps: { size: 'sm', label: null } }),
  },
});

export const themeVariables: CSSVariablesResolver = () => ({
  variables: {},
  light: {},
  dark: {
    '--mantine-color-body': colors.ground,
    '--mantine-color-default': colors.panel,
    '--mantine-color-default-border': colors.line,
    '--mantine-color-text': colors.cream,
    '--mantine-color-dimmed': colors.dim,
  },
});
