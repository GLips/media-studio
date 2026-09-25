// still-presets.ts: the sizes stills render at and the names they render under, shared by the browser (stills.tsx,
// Root.tsx) and Node (lib/render-stills.ts), which can't load .tsx.

/** The sizes a still renders at, by the place it's posted. Print sizes are out of scope (vid-28). */
export const STILL_PRESETS = {
  og: { width: 1200, height: 630 },
  youtube: { width: 1280, height: 720 },
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
} as const;
export type StillPreset = keyof typeof STILL_PRESETS;

/** Which still a composition is: what Root.tsx passes and `studio still` filters on. */
export type StillProps = { design: string; preset: StillPreset; variant: string };

/** The file (and composition, behind `still-`) a still renders to. */
export const stillName = ({ design, preset, variant }: StillProps) => `${design}-${preset}-${variant}`;

/** What FitText settled on, emitted as a still's artifact. `atFloor` means the copy is too long for its box. */
export type StillFitReport = { name: string; text: string; size: number; stretch: number; max: number; min: number; atFloor: boolean; overflows: boolean };
export const stillFitArtifactName = (name: string) => `still-fit-${name}.json`;
export const isStillFitArtifact = (filename: string) => /^still-fit-.+\.json$/.test(filename);
