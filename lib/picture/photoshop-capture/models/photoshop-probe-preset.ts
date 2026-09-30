// photoshop-probe-preset.ts: a probe's settings (photoshop-probes.ts) written as the brush preset an .abr would hold,
// so a probe reaches the renderer through the same importer a pack's brushes do (stamp-paint/models/photoshop-brush.ts)
// and a probe's capture checks the importer and the renderer together (vid-97). Keys are the ones Photoshop writes
// into an .abr's presets: charIDs where it uses them, stringIDs where it doesn't.
//
// Negative space: a Brush Pose isn't written. A probe's pose is a mark's, not its settings', and a pose scales size and
// opacity whatever the brush says (docs/photoshop-capture.md), which a renderer is given as the stroke's pressure and
// opacity, not as a preset setting.

import type { PhotoshopDescriptor } from '#lib/picture/stamp-paint/models/photoshop-descriptor.ts';
import type { PhotoshopControl, PhotoshopTip, PhotoshopBrushSettings } from './photoshop-probes.ts';

const pct = (value: number) => ({ _unit: '#Prc', value });
const px = (value: number) => ({ _unit: '#Pxl', value });
const long = (value: number) => ({ _long: value });
const CONTROL = { off: 0, fade: 1, penPressure: 2 } as const;

/** Photoshop's blend modes as its presets write them (charIDs, or stringIDs for the newer modes). */
const MODE_ENUM: Readonly<Record<string, string>> = {
  multiply: 'Mltp', subtract: 'Sbtr', darken: 'Drkn', overlay: 'Ovrl', colorDodge: 'CDdg', colorBurn: 'CBrn', linearBurn: 'linearBurn', hardMix: 'hardMix',
  linearHeight: 'linearHeight', height: 'Hght',
};
const mode = (name: string) => ({ _enum: 'BlnM', value: MODE_ENUM[name] });

function variation(control: PhotoshopControl | undefined, jitter = 0): PhotoshopDescriptor {
  return { _class: 'brVr', bVTy: long(control ? CONTROL[control.control] : 0), fStp: long(control?.fadeSteps ?? 25), jitter: pct(jitter), 'Mnm ': pct(control?.minimum ?? 0) };
}

/** The sampled tip's id: the one sample a probe preset names, which the caller maps to the rig's tip image. */
export const PHOTOSHOP_PROBE_SAMPLE_ID = 'studio-probe-tip';

function tipDescriptor(tip: PhotoshopTip): PhotoshopDescriptor {
  return {
    _class: tip.kind === 'sampled' ? 'sampledBrush' : 'computedBrush',
    Dmtr: px(tip.diameter),
    ...(tip.kind === 'computed' ? { Hrdn: pct(tip.hardness) } : { sampledData: PHOTOSHOP_PROBE_SAMPLE_ID }),
    Angl: { _unit: '#Ang', value: tip.angle }, Rndn: pct(tip.roundness), Spcn: pct(tip.spacing), Intr: true, flipX: tip.flipX, flipY: tip.flipY,
  };
}

/** A probe's settings as a `brushPreset` descriptor with its tool options, named `name`. */
export function photoshopProbePreset(name: string, s: PhotoshopBrushSettings): PhotoshopDescriptor {
  const texture = s.texture;
  return {
    _class: 'brushPreset', 'Nm  ': name,
    Brsh: tipDescriptor(s.tip),
    useTipDynamics: !!(s.size || s.jitter?.size || s.jitter?.angle || s.jitter?.roundness), flipX: false, flipY: false, minimumDiameter: pct(s.size?.minimum ?? 0),
    szVr: variation(s.size, s.jitter?.size), angleDynamics: variation(undefined, s.jitter?.angle), roundnessDynamics: variation(undefined, s.jitter?.roundness),
    minimumRoundness: pct(Math.max(1, s.jitter?.minimumRoundness ?? 0)),
    useScatter: (s.jitter?.scatter ?? 0) > 0 || (s.jitter?.count ?? 1) > 1, bothAxes: s.jitter?.bothAxes ?? false, 'Cnt ': s.jitter?.count ?? 1,
    scatterDynamics: variation(undefined, s.jitter?.scatter), countDynamics: variation(s.jitter?.countControl),
    useTexture: !!texture,
    ...(texture && {
      Txtr: { _class: 'Ptrn', 'Nm  ': 'studio-probe-ramp', Idnt: 'studio-probe-ramp' }, textureScale: pct(texture.scale), textureBrightness: long(texture.brightness),
      textureContrast: long(texture.contrast), textureBlendMode: mode(texture.mode), textureDepth: pct(texture.depth), TxtC: texture.eachTip, InvT: texture.invert,
      textureDepthDynamics: variation(undefined), minimumDepth: pct(0),
    }),
    usePaintDynamics: !!s.transfer, opVr: variation(s.transfer?.opacity), prVr: variation(s.transfer?.flow),
    useColorDynamics: false,
    dualBrush: {
      _class: 'dualBrush', useDualBrush: !!s.dual,
      ...(s.dual && {
        BlnM: mode(s.dual.mode), Flip: false, useScatter: (s.dual.scatter ?? 0) > 0 || (s.dual.count ?? 1) > 1, bothAxes: s.dual.bothAxes ?? false, 'Cnt ': s.dual.count ?? 1,
        scatterDynamics: variation(undefined, s.dual.scatter), countDynamics: variation(undefined), Brsh: tipDescriptor(s.dual.tip),
      }),
    },
    Wtdg: s.wetEdges, Nose: s.noise, 'Rpt ': false,
    toolOptions: { _class: 'PbTl', Opct: long(s.opacity), flow: long(s.flow), 'Md  ': { _enum: 'BlnM', value: 'Nrml' } },
  };
}
