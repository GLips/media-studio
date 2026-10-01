// photoshop-abr-fixture.ts: a licence-free .abr's contents for tests, written by writePhotoshopAbr.

import type { PhotoshopDescriptor } from '../models/photoshop-descriptor.ts';
import type { PhotoshopBrushFile } from './photoshop-abr.ts';

const pct = (value: number) => ({ _unit: '#Prc', value });
const px = (value: number) => ({ _unit: '#Pxl', value });

/** An erodible tip's worn shape: a 5 x 5 grid of heights, as the .abr holds it (little-endian float32s). */
export const PHOTOSHOP_FIXTURE_ERODIBLE_HEIGHTS = Buffer.from(Float32Array.from({ length: 25 }, (_, i) => (i % 5) / 4 + (i < 5 ? 0.5 : 0)).buffer);

/**
 * A licence-free pack: a drawn gradient tip, a drawn stripe pattern, a textured sampled brush, a soft round Mixer Brush
 * and an erodible pencil.
 */
export function photoshopAbrFixture(): Omit<PhotoshopBrushFile, 'kind'> {
  const tip = { width: 24, height: 16, pixels: Uint8Array.from({ length: 24 * 16 }, (_, i) => (i % 24) * 10) };
  const stripes = { width: 8, height: 8, pixels: Uint8Array.from({ length: 64 }, (_, i) => (i % 8 < 4 ? 40 : 220)) };
  const textured = {
    _class: 'brushPreset', 'Nm  ': '$$$/Presets/Brushes/Chalk=Chalk',
    Brsh: { _class: 'sampledBrush', Dmtr: px(48), Angl: { _unit: '#Ang', value: 30 }, Rndn: pct(80), Spcn: pct(15), Intr: true, flipX: false, flipY: true, sampledData: 'tip-1' },
    useTexture: true, Txtr: { _class: 'Ptrn', 'Nm  ': 'Stripes', Idnt: 'pattern-1' }, textureScale: pct(50), textureBlendMode: { _enum: 'BlnM', value: 'Hght' },
    textureDepth: pct(60), TxtC: false, InvT: true, textureBrightness: { _long: -10 },
  } satisfies PhotoshopDescriptor;
  const mixer = {
    _class: 'brushPreset', 'Nm  ': 'Chalk',
    Brsh: { _class: 'computedBrush', Dmtr: px(30), Hrdn: pct(0), Angl: { _unit: '#Ang', value: 0 }, Rndn: pct(100), Spcn: pct(25), Intr: true },
    toolOptions: { _class: 'MixB', flow: { _long: 80 }, wetness: 50, dryness: 100, mix: 50, sampleAllLayers: false },
  } satisfies PhotoshopDescriptor;
  const erodible = {
    _class: 'brushPreset', 'Nm  ': 'Pencil',
    Brsh: {
      _class: 'dTips', Dmtr: px(12), Angl: { _unit: '#Ang', value: 0 }, Rndn: pct(100), Spcn: pct(10), Intr: true, 'Shp ': { _long: 2 }, dtipsType: { _long: 0 },
      dtipsHardness: pct(80), dtipsGridSize: { _long: 5 }, dtipsErodibleTipHeightMap: { _raw: 'tdta', hex: PHOTOSHOP_FIXTURE_ERODIBLE_HEIGHTS.toString('hex') },
    },
  } satisfies PhotoshopDescriptor;
  return {
    presets: [{ descriptor: textured, group: 'Dry' }, { descriptor: mixer, group: 'Wet' }, { descriptor: erodible, group: 'Dry' }],
    tips: new Map([['tip-1', tip]]),
    patterns: new Map([['pattern-1', { name: 'Stripes', image: stripes }]]),
  };
}
