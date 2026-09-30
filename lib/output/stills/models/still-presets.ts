// still-presets.ts: the sizes stills render at and the names they render under, shared by the browser (stills.tsx,
// Root.tsx) and Node (lib/output/render/engine/render-stills.ts), which can't load .tsx.

/** The sizes a still renders at, by the place it's posted. Print sizes are out of scope (vid-28). */
export const STILL_PRESETS = {
  og: { width: 1200, height: 630 },
  youtube: { width: 1280, height: 720 },
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
} as const;
export type StillPreset = keyof typeof STILL_PRESETS;

/** A part of a preset's frame the platform draws its own UI over, in frame px. */
export type StillUiZone = { name: string; rect: { x: number; y: number; w: number; h: number } };

/**
 * Where each platform covers the image, which no text or logo may sit under. Platforms move these, so they're data.
 * YouTube's duration badge varies in size with the surface, so its corner is generous. A story's top and bottom bands
 * are Instagram's chrome: Meta asks for 250 px and 340 px left clear. The rest are shown whole.
 */
export const STILL_UI_ZONES: Readonly<Record<StillPreset, readonly StillUiZone[]>> = {
  og: [],
  youtube: [{ name: "YouTube's duration badge", rect: { x: 1024, y: 612, w: 256, h: 108 } }],
  square: [],
  portrait: [],
  story: [
    { name: "Instagram's top bar (progress, name, close)", rect: { x: 0, y: 0, w: 1080, h: 250 } },
    { name: "Instagram's reply bar", rect: { x: 0, y: 1580, w: 1080, h: 340 } },
  ],
};

/**
 * The sizes each preset is seen at in a feed, which `studio still --sheet` shows every variant at, 1:1. YouTube's
 * sidebar and search thumbnail, and its home grid's; a social image about 300 px wide, as a link card or a post in a
 * phone's feed shows it.
 */
export const STILL_FEED_SIZES: Readonly<Record<StillPreset, readonly { name: string; w: number; h: number }[]>> = {
  og: [{ name: 'link card', w: 300, h: 158 }],
  youtube: [{ name: 'sidebar', w: 168, h: 94 }, { name: 'home', w: 320, h: 180 }],
  square: [{ name: 'feed', w: 300, h: 300 }],
  portrait: [{ name: 'feed', w: 300, h: 375 }],
  story: [{ name: 'feed', w: 300, h: 534 }],
};

/**
 * Which still a composition is: what Root.tsx passes and `studio still` filters on. `axes` is where the variant sits on
 * each of its design's axes, in axis order; `variant` is those values joined by `-`.
 */
export type StillProps = { design: string; preset: StillPreset; variant: string; axes: Readonly<Record<string, string>> };
/**
 * How `studio still` renders one. `ground` draws every text transparent, leaving the ground under it for the contrast
 * check to read.
 */
export type StillRenderProps = StillProps & { ground?: boolean };

/** The file (and composition, behind `still-`) a still renders to. */
export const stillName = ({ design, preset, variant }: StillProps) => `${design}-${preset}-${variant}`;

/** What FitText settled on, emitted as a still's artifact. `atFloor` means the copy is too long for its box. */
export type StillFitReport = { name: string; text: string; size: number; stretch: number; max: number; min: number; atFloor: boolean; overflows: boolean };
export const stillFitArtifactName = (name: string) => `still-fit-${name}.json`;
export const isStillFitArtifact = (filename: string) => /^still-fit-.+\.json$/.test(filename);
/** The artifact the still probe (still-probe.tsx) emits: what lib/output/stills/models/still-check.ts judges. */
export const STILL_MEASURE_ARTIFACT = 'still-measure.json';
