// photoshop-probe-preset.ts: a probe's settings (photoshop-probes.ts) as the preset an .abr would hold, so a probe
// reaches the renderer through the same importer a pack's brushes do (stamp-paint/models/photoshop-brush.ts), a
// probe's capture checks the importer and the renderer together (vid-97), and the rig sets the same preset on
// Photoshop's brush tool (photoshopPresetScript) that the importer reads.
//
// Negative space: a Brush Pose isn't written. A probe's pose is a mark's, not its settings', and a pose scales size and
// opacity whatever the brush says (docs/photoshop-capture.md), which a renderer is given as the stroke's pressure and
// opacity, not as a preset setting.

import type { PhotoshopDynamic, PhotoshopPreset, PhotoshopPresetTip } from '#lib/picture/stamp-paint/models/photoshop-preset.ts';
import { PHOTOSHOP_PROBE_RAMP, type PhotoshopBrushSettings, type PhotoshopControl, type PhotoshopTip } from './photoshop-probes.ts';

function variation(control: PhotoshopControl | undefined, jitter = 0): PhotoshopDynamic {
  return { control: control?.control ?? 'off', fadeSteps: control?.fadeSteps ?? 25, jitter, minimum: control?.minimum ?? 0 };
}

/** The sampled tip's id: the one sample a probe preset names, which the caller maps to the rig's tip image. */
export const PHOTOSHOP_PROBE_SAMPLE_ID = 'studio-probe-tip';

function presetTip(tip: PhotoshopTip): PhotoshopPresetTip {
  return {
    kind: tip.kind, ...(tip.kind === 'computed' ? { hardness: tip.hardness } : { sampledData: PHOTOSHOP_PROBE_SAMPLE_ID }),
    diameter: tip.diameter, angle: tip.angle, roundness: tip.roundness, spacing: tip.spacing, spaced: true, flipX: tip.flipX, flipY: tip.flipY,
  };
}

/** A probe's settings as a brush preset with its tool's options, named `name`. */
export function photoshopProbePreset(name: string, s: PhotoshopBrushSettings): PhotoshopPreset {
  const { texture, jitter, dual } = s;
  return {
    name,
    tip: presetTip(s.tip),
    ...((s.size || jitter?.size || jitter?.angle || jitter?.roundness) && {
      tipDynamics: {
        size: variation(s.size, jitter?.size), minimumDiameter: s.size?.minimum ?? 0, angle: variation(undefined, jitter?.angle),
        // Photoshop keeps a minimum roundness of at least 1%.
        roundness: variation(undefined, jitter?.roundness), minimumRoundness: Math.max(1, jitter?.minimumRoundness ?? 0),
        flipX: false, flipY: false, projection: false,
      },
    }),
    // Count only takes effect with Scatter on.
    ...(((jitter?.scatter ?? 0) > 0 || (jitter?.count ?? 1) > 1) && {
      scatter: { scatter: variation(undefined, jitter?.scatter), bothAxes: jitter?.bothAxes ?? false, count: jitter?.count ?? 1, countDynamics: variation(jitter?.countControl) },
    }),
    ...(texture && {
      texture: {
        pattern: { name: PHOTOSHOP_PROBE_RAMP.name, id: PHOTOSHOP_PROBE_RAMP.name }, scale: texture.scale, brightness: texture.brightness, contrast: texture.contrast, mode: texture.mode,
        depth: texture.depth, eachTip: texture.eachTip, invert: texture.invert, depthDynamics: variation(undefined), minimumDepth: 0, protect: false,
      },
    }),
    ...(s.transfer && { transfer: { opacity: variation(s.transfer.opacity), flow: variation(s.transfer.flow) } }),
    ...(dual && {
      dual: {
        mode: dual.mode, flip: false, tip: presetTip(dual.tip),
        ...(((dual.scatter ?? 0) > 0 || (dual.count ?? 1) > 1) && {
          scatter: { scatter: variation(undefined, dual.scatter), bothAxes: dual.bothAxes ?? false, count: dual.count ?? 1, countDynamics: variation(undefined) },
        }),
      },
    }),
    wetEdges: s.wetEdges, noise: s.noise, buildUp: false,
    tool: { kind: 'PbTl', mode: 'normal', opacity: s.opacity, flow: s.flow },
  };
}
