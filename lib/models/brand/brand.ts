// brand.ts: what a client's brand kit is. A kit lives in brands/<name>/ and nowhere else: brand.ts (a Brand, typed
// with `satisfies`), its logos beside it, and its font files in fonts/, which git ignores because most are licensed.
// A project opts in with projects/<p>/brand.ts, a ProjectBrand naming the kit and overriding its colours, palette or
// voice, and its stills and scenes import the result as `@brand` (lib/engine/bundle/project-brand.ts writes that module;
// lib/studio/brand.tsx loads its fonts and logos).
//
// A kit filled from a client's product repo is a snapshot of the repo's tokens: `snapshot` says where from and when.
// It is never linked to the repo. Refresh it by reading the repo again.
//
// A kit's and a project's brand.ts are data only (`import type` alone): Node requires them at bundle time, from the
// Remotion CLI's CommonJS bundle of remotion.config.ts too.

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
  /** A few lines on how the brand talks and what it shows, for whoever writes its copy. Not enforced. */
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


/**
 * A project's brand.ts: the kit it uses, by its folder in brands/, and what it changes for this project. Fonts and logos
 * carry files, so a project that needs others names another kit.
 */
export type ProjectBrand = {
  name: string;
  colors?: Partial<Brand['colors']>;
  /** Merged by key over the kit's: a new swatch, or one changed. The kit's tints don't follow a changed role. */
  palette?: Brand['palette'];
  voice?: string;
};

const PROJECT_BRAND_KEYS = ['name', 'colors', 'palette', 'voice'];
const COLOR_ROLES = ['primary', 'secondary', 'accent', 'dark', 'light'];

/**
 * The kit with a project's overrides. `kitName` is the folder the kit was loaded from: a project that now names another
 * needs a new bundle. Checks the project's fields, which `satisfies` doesn't at runtime. Runs at bundle time and in the
 * bundle, so an edit in an open Studio is checked too.
 */
export function mergeProjectBrand(kit: Brand, project: ProjectBrand, kitName: string): Brand {
  const where = `the project's brand.ts`;
  const unknown = Object.keys(project).filter((k) => !PROJECT_BRAND_KEYS.includes(k));
  if (unknown.length) throw new Error(`brands: ${where} has ${unknown.join(', ')}; it sets ${PROJECT_BRAND_KEYS.join(', ')} (fonts and logos come from the kit)`);
  if (project.name !== kitName) throw new Error(`brands: ${where} names "${project.name}", but this bundle was made for "${kitName}": bundle again (restart the Studio)`);
  const strings = (field: string, values: object | undefined, keys?: string[]) => {
    for (const [k, v] of Object.entries(values ?? {})) {
      if (keys && !keys.includes(k)) throw new Error(`brands: ${where}'s ${field} has "${k}"; its roles are ${keys.join(', ')}`);
      if (typeof v !== 'string') throw new Error(`brands: ${where}'s ${field}.${k} is ${v === undefined ? 'undefined' : typeof v}, not a colour`);
    }
  };
  strings('colors', project.colors, COLOR_ROLES);
  strings('palette', project.palette);
  if (project.voice !== undefined && typeof project.voice !== 'string') throw new Error(`brands: ${where}'s voice isn't a string`);
  return {
    ...kit,
    colors: { ...kit.colors, ...project.colors },
    palette: { ...kit.palette, ...project.palette },
    voice: project.voice ?? kit.voice,
  };
}
