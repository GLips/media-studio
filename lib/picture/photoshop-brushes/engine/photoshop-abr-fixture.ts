// photoshop-abr-fixture.ts: a licence-free .abr's contents for tests, written by writePhotoshopAbr.

import type { PhotoshopDescriptor } from '../models/photoshop-descriptor.ts';
import type { PhotoshopBrushFile } from './photoshop-abr.ts';

const pct = (value: number) => ({ _unit: '#Prc', value });
const px = (value: number) => ({ _unit: '#Pxl', value });

/** A licence-free pack: a drawn gradient tip, a drawn stripe pattern, a textured sampled brush and a soft round Mixer Brush. */
export function photoshopAbrFixture(): Omit<PhotoshopBrushFile, 'kind'> {
  const tip = { width: 24, height: 16, pixels: Uint8Array.from({ length: 24 * 16 }, (_, i) => (i % 24) * 10) };
  const stripes = { width: 8, height: 8, pixels: Uint8Array.from({ length: 64 }, (_, i) => (i % 8 < 4 ? 40 : 220)) };
  const textured: PhotoshopDescriptor = {
    _class: 'brushPreset', 'Nm  ': '$$$/Presets/Brushes/Chalk=Chalk',
    Brsh: { _class: 'sampledBrush', Dmtr: px(48), Angl: { _unit: '#Ang', value: 30 }, Rndn: pct(80), Spcn: pct(15), Intr: true, flipX: false, flipY: true, sampledData: 'tip-1' },
    useTexture: true, Txtr: { _class: 'Ptrn', 'Nm  ': 'Stripes', Idnt: 'pattern-1' }, textureScale: pct(50), textureBlendMode: { _enum: 'BlnM', value: 'Hght' },
    textureDepth: pct(60), TxtC: false, InvT: true, textureBrightness: { _long: -10 },
  };
  const mixer: PhotoshopDescriptor = {
    _class: 'brushPreset', 'Nm  ': 'Chalk',
    Brsh: { _class: 'computedBrush', Dmtr: px(30), Hrdn: pct(0), Angl: { _unit: '#Ang', value: 0 }, Rndn: pct(100), Spcn: pct(25), Intr: true },
    toolOptions: { _class: 'MixB', flow: { _long: 80 }, wetness: 50, dryness: 100, mix: 50, sampleAllLayers: false },
  };
  return {
    presets: [{ descriptor: textured, group: 'Dry' }, { descriptor: mixer, group: 'Wet' }],
    tips: new Map([['tip-1', tip]]),
    patterns: new Map([['pattern-1', { name: 'Stripes', image: stripes }]]),
  };
}
