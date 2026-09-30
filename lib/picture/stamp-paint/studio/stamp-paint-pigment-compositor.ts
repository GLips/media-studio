// stamp-paint-pigment-compositor.ts: the StampPaintCompositor for a style that paints in pigment (vid-83).
//
// A group's layer holds coverage, then each palette pigment's amount (stamp-pigment-paint.ts). A deposit lays its
// components where paper and habits put them, mixing by volume; a wash's lands, wets or lifts as wet as its landing
// is (stamp-wet-landing.ts, stamp-wet-lift.ts). A group dries as a Kubelka–Munk film, glazed over what's there or,
// opaque, on paper kept for it. The painting holds reflectance per band.
//
// Negative space: a deposit's blend and a stamp's tint are colour operations with no pigment meaning, so neither
// applies; a burnt rim only shapes coverage. A plain pass's fill `load` is coverage: over paint it moves the paint
// toward its mixture rather than adding less pigment.

import { PAINT_KUBELKA_MUNK_WGSL } from '#lib/picture/paint/models/paint-kubelka-munk.ts';
import { PAINT_PAPER_WGSL } from '#lib/picture/paint/models/paint-paper.ts';
import { paintHexToLinear } from '#lib/picture/paint/models/paint-spectrum.ts';
import { STAMP_PIGMENT_GROUP_SLOTS, type StampPigmentPaint } from '../models/stamp-pigment-paint.ts';
import { STAMP_WET_LAND_WGSL } from '../models/stamp-wet-landing.ts';
import { STAMP_WET_LIFT_WGSL } from '../models/stamp-wet-lift.ts';
import { STAMP_OPAQUE_COVER, type CompiledStampDeposit, type StampPaintColor } from '../models/stamp-paint-recipe.ts';
import type { StampPaintCompositor } from './stamp-paint-compositor.ts';
import { stampUniformLayout, stampUniformWriter, type StampUniformViews } from './stamp-uniform-layout.ts';

/** Words per component in the component buffer: slot, seed, amount, granulation, flocculation. */
const COMPONENT_WORDS = 5;

const PIGMENT_PAINT_DEPOSIT = stampUniformLayout('PaintDeposit', [['first', 'u32'], ['count', 'u32'], ['group', 'u32']]);

/** A number as a WGSL f32 literal, to the precision an f32 holds. */
const f32 = (value: number) => value.toPrecision(9);
const vec4s = (values: ArrayLike<number>, count: number) =>
  Array.from({ length: count }, (_, i) => `vec4f(${[0, 1, 2, 3].map((j) => f32(values[i * 4 + j] ?? 0)).join(', ')})`).join(', ');

/** The compositor for `paint` on `device`: every deposit's components and every group's palette uploaded once. */
export function stampPigmentCompositor(device: GPUDevice, paint: StampPigmentPaint, paperColor: StampPaintColor): StampPaintCompositor {
  const { bands, medium } = paint;
  const V = Math.ceil(bands.count / 4);
  const layers = Math.max(1, ...paint.groups.map((group) => group.layers));

  const writers = new Map<CompiledStampDeposit, (views: StampUniformViews) => void>();
  const componentWords: number[] = [];
  for (const [deposit, { group, components }] of paint.deposits) {
    const first = componentWords.length / COMPONENT_WORDS;
    writers.set(deposit, (views) => {
      const put = stampUniformWriter(PIGMENT_PAINT_DEPOSIT, views);
      put('first', first);
      put('count', components.length);
      put('group', group);
    });
    for (const { slot, seed, amount, granulation, flocculation } of components) componentWords.push(slot, seed, amount, granulation, flocculation);
  }
  const componentData = new ArrayBuffer(Math.max(COMPONENT_WORDS, componentWords.length) * 4);
  const asWords = new Uint32Array(componentData), asFloats = new Float32Array(componentData);
  componentWords.forEach((v, i) => {
    if (i % COMPONENT_WORDS < 2) asWords[i] = v;
    else asFloats[i] = v;
  });

  // Each group's palette, STAMP_PIGMENT_GROUP_SLOTS slots of K then S, V vec4s each; an empty slot absorbs and scatters nothing.
  const paletteStride = STAMP_PIGMENT_GROUP_SLOTS * 2 * V * 4;
  const paletteData = new Float32Array(Math.max(1, paint.groups.length) * paletteStride);
  paint.groups.forEach(({ palette }, g) => palette.forEach(({ K, S }, slot) => {
    paletteData.set(K, g * paletteStride + slot * 2 * V * 4);
    paletteData.set(S, g * paletteStride + (slot * 2 + 1) * V * 4);
  }));

  const upload = (data: ArrayBuffer | Float32Array) => {
    const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  // Each group's palette's staining, laid out as its layer is: coverage's channel stains nothing.
  const stainData = new Float32Array(Math.max(1, paint.groups.length) * layers * 4);
  paint.groups.forEach(({ palette }, g) => palette.forEach(({ staining }, slot) => { stainData[g * layers * 4 + slot + 1] = staining; }));
  const components = upload(componentData), palettes = upload(paletteData), stains = upload(stainData);

  const paperRgb = paintHexToLinear(paperColor);
  const bandWgsl = /* wgsl */ `
${PAINT_KUBELKA_MUNK_WGSL}
const BAND_VEC4S = ${V}u;
const LAYERS = ${layers}u;
const TO_R = array<vec4f, ${V}>(${vec4s(bands.toLinearRgb[0], V)});
const TO_G = array<vec4f, ${V}>(${vec4s(bands.toLinearRgb[1], V)});
const TO_B = array<vec4f, ${V}>(${vec4s(bands.toLinearRgb[2], V)});
const MOVE_R = array<vec4f, ${V}>(${vec4s(bands.correctionBasis[0], V)});
const MOVE_G = array<vec4f, ${V}>(${vec4s(bands.correctionBasis[1], V)});
const MOVE_B = array<vec4f, ${V}>(${vec4s(bands.correctionBasis[2], V)});
const PAPER = array<vec4f, ${V}>(${vec4s(bands.reflectanceOf(paperRgb), V)});
const PAPER_RGB = vec3f(${paperRgb.map(f32).join(', ')});
fn paperLinear(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
// The paper's reflectance in band vec4 \`i\`: its written colour's, moved as far as a photograph's pixel \`color\` differs (stampPigmentPaper).
fn paperReflectance(i: u32, color: vec3f) -> vec4f {
  let d = paperLinear(color) - PAPER_RGB;
  return clamp(PAPER[i] + MOVE_R[i] * d.r + MOVE_G[i] * d.g + MOVE_B[i] * d.b, vec4f(0.001), vec4f(0.999));
}`;

  const contact = medium.paperContact.kind === 'peaks'
    ? `paintDryContact(h, meanHeight, ${f32(medium.paperContact.tooth)}, u.paperDepth)`
    : 'paintWetSettle(valley, u.paperDepth, c.granulation, c.amount)';

  return {
    targets: { layer: { kind: 'array', layers }, painting: { kind: 'array', layers: V } },
    readsStampTints: false,
    deposit: {
      layout: PIGMENT_PAINT_DEPOSIT,
      wgsl: /* wgsl */ `
${PAINT_PAPER_WGSL}
struct PigmentComponent { slot: u32, seed: u32, amount: f32, granulation: f32, flocculation: f32 }
@group(0) @binding(24) var<storage, read> components: array<PigmentComponent>;
const LAYERS = ${layers}u;
// The tooth moves each pigment about in layDeposit, rather than cutting the deposit's coverage.
fn paperKept(tooth: f32, mean: f32, depth: f32) -> f32 { return 1.0; }
fn layerCoverage(pixel: vec2u) -> f32 { return textureLoad(layer, pixel, 0u).x; }
// A full stroke's pigment amounts here, where the paper's tooth and each pigment's habits put them.
fn incomingAt(tooth: vec2f, at: vec2f) -> array<vec4f, LAYERS> {
  let h = 1.0 - tooth.x;
  let meanHeight = 1.0 - tooth.y;
  let valley = paintValley(h, meanHeight);
  var incoming: array<vec4f, LAYERS>;
  for (var k = paint.first; k < paint.first + paint.count; k++) {
    let c = components[k];
    let share = max(0.0, ${contact} * paintClumps(c.flocculation, at.x, at.y, c.seed));
    let channel = c.slot + 1u;
    incoming[channel / 4u][channel % 4u] += c.amount * share;
  }
  return incoming;
}
// A burnt rim shapes coverage, as a wet one does, the main's and dual's joined.
fn layDeposit(pixel: vec2u, coverage: f32, rims: vec2f, tooth: vec2f, at: vec2f) {
  let cover = clamp(coverage + max(rims.x, rims.y), 0.0, 1.0);
  if (cover <= 0.0) { return; }
  let incoming = incomingAt(tooth, at);
  let under = textureLoad(layer, pixel, 0u).x;
  let rate = cover * (1.0 - ${f32(medium.pickup)} * under);
  for (var l = 0u; l < LAYERS; l++) {
    let was = textureLoad(layer, pixel, l);
    var now = was + rate * (incoming[l] - was);
    if (l == 0u) { now.x = cover + under * (1.0 - cover); }
    textureStore(layer, pixel, l, now);
  }
}`,
      wet: /* wgsl */ `
${STAMP_WET_LAND_WGSL}
${STAMP_WET_LIFT_WGSL}
@group(0) @binding(25) var<storage, read> stains: array<vec4f>;
// Water leaves the pigment where it is: moving it is the neighbourhood's (stamp-wet-stages.ts).
fn landDeposit(pixel: vec2u, coverage: f32, rims: vec2f, tooth: vec2f, at: vec2f, wet: WetLanding) {
  let cover = clamp(coverage + max(rims.x, rims.y), 0.0, 1.0);
  if (cover <= 0.0 || wet.action == WET_WATER) { return; }
  let under = textureLoad(layer, pixel, 0u).x;
  // A lift thins the film where it is rather than shrinking it, so coverage stays: the group dries what's left over
  // that coverage, and a later stroke there meets paint, however little.
  if (wet.action == WET_LIFT) {
    for (var l = 0u; l < LAYERS; l++) {
      var now = wetLift(textureLoad(layer, pixel, l), cover, wet.strength, wet.workable, wet.dried, ${f32(medium.wetting.rewetting)}, stains[paint.group * LAYERS + l]);
      if (l == 0u) { now.x = under; }
      textureStore(layer, pixel, l, now);
    }
    return;
  }
  let incoming = incomingAt(tooth, at);
  for (var l = 0u; l < LAYERS; l++) {
    var now = wetLand(textureLoad(layer, pixel, l), incoming[l], cover, wet.wetness, wet.workable);
    if (l == 0u) { now.x = cover + under * (1.0 - cover); }
    textureStore(layer, pixel, l, now);
  }
}`,
      writerFor: (deposit) => {
        const writer = writers.get(deposit);
        if (!writer) throw new Error(`stamp paint: ${deposit.id} isn't in the painting its pigment compositor was made for`);
        return writer;
      },
      resources: ({ wet }) => [{ buffer: components }, ...(wet ? [{ buffer: stains }] : [])],
    },
    group: {
      wgsl: /* wgsl */ `
${bandWgsl}
@group(0) @binding(3) var photograph: texture_2d<f32>;
@group(0) @binding(4) var photographSampler: sampler;
@group(0) @binding(5) var<storage, read> palettes: array<vec4f>;
const PALETTE = ${STAMP_PIGMENT_GROUP_SLOTS * 2 * V}u;
// The twin of stampPigmentDryGroup: its film glazed over what's there or, opaque, laid over bare paper.
fn layGroup(pixel: vec2u, glaze: bool, opacity: f32) {
  var amounts: array<vec4f, LAYERS>;
  for (var l = 0u; l < LAYERS; l++) { amounts[l] = textureLoad(layer, pixel, l, 0); }
  let coverage = amounts[0].x;
  if (coverage <= 0.0) { return; }
  let thickness = select(1.0 / max(coverage, 0.001), opacity, glaze);
  let cover = min(1.0, coverage * ${STAMP_OPAQUE_COVER.toFixed(1)}) * opacity;
  var bare = vec3f(0.0);
  if (!glaze) { bare = paperColor(photograph, photographSampler, u.paper, pixel, textureDimensions(painting)); }
  let base = u.group * PALETTE;
  for (var i = 0u; i < BAND_VEC4S; i++) {
    var absorb = vec4f(0.0);
    var scatter = vec4f(0.0);
    for (var s = 0u; s < ${STAMP_PIGMENT_GROUP_SLOTS}u; s++) {
      let channel = s + 1u;
      if (channel / 4u >= LAYERS) { break; }
      let amount = amounts[channel / 4u][channel % 4u];
      absorb += amount * palettes[base + s * 2u * BAND_VEC4S + i];
      scatter += amount * palettes[base + (s * 2u + 1u) * BAND_VEC4S + i];
    }
    let film = kubelkaMunkFilm(absorb * thickness, scatter * ${f32(1 + medium.dryingScatter)} * thickness);
    let under = textureLoad(painting, pixel, i);
    var laid = kubelkaMunkOver(film, under);
    if (!glaze) { laid = under + (kubelkaMunkOver(film, paperReflectance(i, bare)) - under) * cover; }
    textureStore(painting, pixel, i, clamp(laid, vec4f(0.0), vec4f(1.0)));
  }
}`,
      resources: ({ photograph, sampler }) => [photograph, sampler, { buffer: palettes }],
    },
    paper: /* wgsl */ `
${bandWgsl}
fn layPaper(pixel: vec2u, color: vec3f) {
  for (var i = 0u; i < BAND_VEC4S; i++) { textureStore(painting, pixel, i, paperReflectance(i, color)); }
}`,
    output: /* wgsl */ `
${bandWgsl}
fn screenColor(pixel: vec2u) -> vec3f {
  var rgb = vec3f(0.0);
  for (var i = 0u; i < BAND_VEC4S; i++) {
    let R = textureLoad(painting, pixel, i, 0);
    rgb += vec3f(dot(TO_R[i], R), dot(TO_G[i], R), dot(TO_B[i], R));
  }
  let c = clamp(rgb, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}`,
  };
}
