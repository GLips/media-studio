// Painful Pleasures (painfulpleasures.com): tattoo, piercing and body-jewellery supplies, since 1999. Colours and
// faces are a snapshot of the painful-pleasures-theme repo; the logo is its icon-logo snippet, recoloured for a dark
// ground. The voice is read off the site's copy, not a brand book.
import type { Brand } from '#models/brand/brand.ts';

const proximaNova = {
  family: 'Proxima Nova',
  fallback: '"Open Sans", system-ui, sans-serif',
  files: [
    { file: 'fonts/ProximaNova-Regular.otf', weight: '400' },
    { file: 'fonts/ProximaNova-Medium.otf', weight: '500' },
    { file: 'fonts/ProximaNova-Semibold.otf', weight: '600' },
    { file: 'fonts/ProximaNova-Bold.otf', weight: '700' },
    { file: 'fonts/ProximaNova-Extrabold.otf', weight: '800' },
    { file: 'fonts/ProximaNova-Black.otf', weight: '900' },
  ],
  source: 'Adobe Fonts (the site loads it from Typekit). With it active in Creative Cloud, its files are in ~/Library/Application Support/Adobe/CoreSync/plugins/livetype/.r/ under numeric names; `strings` on each shows its weight.',
} as const;

export default {
  name: 'Painful Pleasures',
  colors: {
    primary: '#1C365E',
    secondary: '#437BBF',
    // The site's alert red: sale prices and savings.
    accent: '#E63636',
    dark: '#191919',
    light: '#FFFFFF',
  },
  palette: {
    'primary-20': '#D2D7DF', 'primary-40': '#A4AFBF', 'primary-60': '#77869E', 'primary-80': '#495E7E', 'primary-120': '#162B4B',
    'secondary-20': '#D9E5F2', 'secondary-40': '#B4CAE5', 'secondary-60': '#8EB0D9', 'secondary-80': '#6995CC', 'secondary-120': '#366299',
    'dark-20': '#CCCCCC', 'dark-40': '#9F9F9F', 'dark-60': '#737373', 'dark-80': '#464646', 'dark-120': '#000000',
    'light-40': '#FCFCFC', 'light-60': '#F9F9F9', 'light-80': '#F4F4F4', 'light-100': '#F0F0F0', 'light-120': '#EEEEEE',
    'accent-20': '#FAD7D7', 'accent-40': '#F5AFAF', 'accent-60': '#F08686', 'accent-80': '#EB5E5E', 'accent-120': '#B82B2B',
  },
  // The site sets everything in Proxima Nova, headings in its heavier weights. It has no width axis.
  fonts: { display: proximaNova, text: proximaNova },
  logos: {
    light: { file: 'logo-light.svg', color: '#FFFFFF' },
    dark: { file: 'logo-dark.svg', color: '#1C365E' },
  },
  voice: 'A supplier talking shop with working tattoo artists and piercers: plain, direct and exact, naming the machine, needle or ink. Confident about range and price, never edgy for its own sake and never clinical. Show real products and real studio work, not stock models.',
  snapshot: { from: 'painful-pleasures-theme src/styles/base/_color.scss, src/styles/base/_font.scss, shopify/snippets/icon-logo.liquid', on: '2026-09-25' },
} satisfies Brand;
