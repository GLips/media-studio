// brand.tsx: a brand kit (lib/models/brand/brand.ts) in the browser, as a project imports it: `import brand from '@brand'`. Its
// faces load through the studio's fonts gate, so FitText and the still probe wait for them, and its logos are sized
// for BrandLogo. generated/brand.ts (lib/project-brand.ts) calls loadStudioBrand with the kit's bundled files.

import { Img } from 'remotion';
import type { Brand, BrandFace } from '#models/brand/brand.ts';
import { contrastRatio } from '#models/still/still-check.ts';
import type { Rect } from '#models/camera/camera.ts';
import { loadStudioFaces } from './fonts.ts';
import { type StudioFace } from '#models/type/faces.ts';
import type { StillImage } from './stills.tsx';

export type StudioBrandLogo = StillImage & { color: string };

/** A kit loaded: its faces as StudioFaces (set `face.family` as a fontFamily, or pass the face to FitText), its logos sized. */
export type StudioBrand = Omit<Brand, 'fonts' | 'logos'> & {
  fonts: { display: StudioFace; text: StudioFace };
  logos: { light: StudioBrandLogo; dark: StudioBrandLogo };
};

const studioFaceOf = (face: BrandFace): StudioFace => ({ family: `"${face.family}", ${face.fallback}`, ...(face.stretch && { stretch: face.stretch }) });

/** Loads a kit's faces and pairs its logos with their bundled files. Keyed by each file's path in the kit. */
export function loadStudioBrand(brand: Brand, fonts: Readonly<Record<string, string>>, logos: Readonly<Record<string, StillImage>>): StudioBrand {
  // The display and text faces can be one face.
  const faces = [...new Map([brand.fonts.display, brand.fonts.text].map((f) => [f.family, f])).values()];
  loadStudioFaces(faces.flatMap((face) => face.files.map((f) => ({
    family: face.family, url: fonts[f.file], weight: f.weight, style: f.style,
    ...(face.stretch && { stretch: `${face.stretch[0]}% ${face.stretch[1]}%` }),
  }))));
  return {
    ...brand,
    fonts: { display: studioFaceOf(brand.fonts.display), text: studioFaceOf(brand.fonts.text) },
    logos: { light: { ...logos[brand.logos.light.file], color: brand.logos.light.color }, dark: { ...logos[brand.logos.dark.file], color: brand.logos.dark.color } },
  };
}

const hexRgb = (hex: string) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`brand: "${hex}" isn't a #rgb or #rrggbb colour`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

/** The kit's logo that stands off `ground` (a hex colour) the more. */
export function brandLogoFor(brand: StudioBrand, ground: string): StudioBrandLogo {
  const { light, dark } = brand.logos, g = hexRgb(ground);
  return contrastRatio(hexRgb(light.color), g) >= contrastRatio(hexRgb(dark.color), g) ? light : dark;
}

/** The logo for `ground`, as large as fits `box`. */
export function BrandLogo({ brand, ground, box, align = 'start' }: {
  brand: StudioBrand; ground: string; box: Rect;
  /** Where it sits in the room it leaves in the box. */
  align?: 'start' | 'center' | 'end';
}) {
  const logo = brandLogoFor(brand, ground);
  const scale = Math.min(box.w / logo.w, box.h / logo.h);
  const w = logo.w * scale, h = logo.h * scale;
  const slack = { start: 0, center: 0.5, end: 1 }[align];
  return <Img src={logo.src} style={{ position: 'absolute', left: box.x + (box.w - w) * slack, top: box.y + (box.h - h) * slack, width: w, height: h }} />;
}
