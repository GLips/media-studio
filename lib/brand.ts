// brand.ts: what a client's brand kit is. A kit lives in brands/<name>/ and nowhere else: brand.ts (a Brand, typed
// with `satisfies`), its logos beside it, and its font files in fonts/, which git ignores because most are licensed.
// A project opts in with projects/<p>/brand.json { "name": "<brand>" }, and its stills and scenes import the kit as
// `@brand` (lib/project-brand.ts writes that module; lib/studio/brand.tsx loads its fonts and logos).
//
// A kit filled from a client's product repo is a snapshot of the repo's tokens: `snapshot` says where from and when.
// It is never linked to the repo. Refresh it by reading the repo again.
//
// brand.ts is data only (`import type` alone): Node reads it to check files and prompt `studio gen image`, and the
// Remotion CLI's CommonJS bundle of remotion.config.ts reads it too.

/** A face's font files, each by its path in the kit and the weights and style it covers. */
export type BrandFontFile = { file: string; weight: string; style?: 'normal' | 'italic' };

export type BrandFace = {
  /** The CSS family name it's registered under. */
  family: string;
  /** CSS families after it: what the browser sets while it's missing, never in a render. */
  fallback: string;
  files: readonly BrandFontFile[];
  /** A width axis's range, in percent, when the face has one. FitText narrows only within it. */
  stretch?: readonly [number, number];
  /** Where a file comes from, for the error when one is missing (fonts/ isn't in git). */
  source: string;
};

export type Brand = {
  name: string;
  /** Roles a design reaches for, so it works on any brand. */
  colors: {
    /** The colour the brand is known by. */
    primary: string;
    secondary: string;
    /** What calls attention: a sale, a CTA, a rule. */
    accent: string;
    /** The darkest ground or ink. */
    dark: string;
    /** The lightest ground or ink. */
    light: string;
  };
  /** Every other named swatch in the snapshot, e.g. the tints of each role. */
  palette: Readonly<Record<string, string>>;
  /** Headlines, and body text. They can be the same face. */
  fonts: { display: BrandFace; text: BrandFace };
  /** The logo in a light and a dark version, each one colour, its file an SVG in the kit. BrandLogo picks by the ground. */
  logos: { light: BrandLogoFile; dark: BrandLogoFile };
  /**
   * A few lines on how the brand talks and what it shows, for whoever writes copy and for image prompts (`studio gen
   * image` adds it). Not enforced.
   */
  voice: string;
  snapshot: { from: string; on: string };
};

/** A logo's file and the colour it's drawn in, which BrandLogo sets against the ground. */
export type BrandLogoFile = { file: string; color: string };

/** Every file a kit names, fonts and logos, as paths in the kit. */
export function brandFiles(brand: Brand): { fonts: string[]; logos: string[] } {
  const fonts = [...new Set([brand.fonts.display, brand.fonts.text].flatMap((f) => f.files.map((x) => x.file)))];
  return { fonts, logos: [brand.logos.light.file, brand.logos.dark.file] };
}

/** The kit as a paragraph an image prompt can end with. */
export function brandPromptLines(brand: Brand): string {
  const { primary, secondary, accent, dark, light } = brand.colors;
  return `Brand: ${brand.name}. ${brand.voice.trim()} Palette: primary ${primary}, secondary ${secondary}, accent ${accent}, dark ${dark}, light ${light}.`;
}
