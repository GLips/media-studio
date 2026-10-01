// stamp-paint-pigment-compositor.ts: the StampPaintCompositor for a style that paints in pigment (vid-83).
//
// A group's layer holds coverage, each palette pigment's amount (stamp-pigment-paint.ts) and, with a wash, last, its
// open share: how much of the paint hasn't set. A wash's deposit lands, wets or lifts as its landing is
// (stamp-wet-landing.ts, stamp-wet-lift.ts), a knockout's into its sheet (knockOut). A group dries as a Kubelka–Munk
// film, glazed or opaque.
//
// Negative space: a deposit's blend and a stamp's tint are colour operations with no pigment meaning, so neither
// applies; a burnt rim only shapes coverage. A plain pass's fill `load` is coverage: over paint it moves the paint
// toward its mixture rather than adding less pigment.

import { PAINT_KUBELKA_MUNK_WGSL } from '#lib/picture/paint/models/paint-kubelka-munk.ts';
import { PAINT_PAPER_WGSL, paintPigmentSeed } from '#lib/picture/paint/models/paint-paper.ts';
import { paintHexToLinear } from '#lib/picture/paint/models/paint-spectrum.ts';
import type { PaintStackedLayering } from '#lib/picture/paint/models/paint-medium.ts';
import { STAMP_PIGMENT_GROUP_SLOTS, stampPigmentAmountsAt, stampPigmentGroupLayers, type StampPigmentPaint, type StampPigmentUnderpaint } from '../models/stamp-pigment-paint.ts';
import { STAMP_LIFT_STAIN_FIBRES, STAMP_LIFT_WET_STAIN_HOLD, STAMP_WET_LIFT_WGSL } from '../models/stamp-wet-lift.ts';
import { STAMP_OPAQUE_COVER, type CompiledStampDeposit, type StampPaintColor } from '../models/stamp-paint-recipe.ts';
import type { StampPaintCompositor } from './stamp-paint-compositor.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';
import { stampUniformLayout, stampUniformWriter, type StampUniformViews } from './stamp-uniform-layout.ts';

/** Words per component in the component buffer: slot, seed, granulation, flocculation. */
const COMPONENT_WORDS = 4;

/**
 * A deposit's components (first and count), its group, where its material grades (StampPigmentGrade), its group's
 * open-share channel and sheet layer (0 for none), 1 if it's in its group's knockout, and each component's amounts at
 * its material's ends, two to a vec4f: written each frame, at its time, so a recolour uploads no more.
 */
const PIGMENT_PAINT_DEPOSIT = stampUniformLayout('PaintDeposit', [
  ['first', 'u32'], ['count', 'u32'], ['group', 'u32'], ['gradeKind', 'i32'], ['grade', 'vec4f'], ['open', 'u32'], ['sheetLayer', 'u32'], ['knockout', 'u32'],
  ['amounts', { vec4fArray: STAMP_PIGMENT_GROUP_SLOTS / 2 }],
]);

/** A number as a WGSL f32 literal, to the precision an f32 holds. */
const f32 = (value: number) => value.toPrecision(9);
const vec4s = (values: ArrayLike<number>, count: number) =>
  Array.from({ length: count }, (_, i) => `vec4f(${[0, 1, 2, 3].map((j) => f32(values[i * 4 + j] ?? 0)).join(', ')})`).join(', ');

/**
 * The wash layer's WGSL for a group of `layers` (StampWashLayer). After a move a pixel's coverage grows by the share
 * of a full stroke's film (`body`) it gained and keeps what it had as it thins, and what moved was loose, wet paint:
 * it arrives open and leaves the giver's set paint behind.
 */
export function stampWashMovedWgsl(layers: number, body: number): string {
  const channel = 4 * layers - 1, at = `[${Math.floor(channel / 4)}][${channel % 4}]`;
  return /* wgsl */ `
fn washPigmentMask(l: u32) -> vec4f {
  let channel = vec4u(4u * l) + vec4u(0u, 1u, 2u, 3u);
  return select(vec4f(1.0), vec4f(0.0), (channel == vec4u(0u)) | (channel == vec4u(${channel}u)));
}
fn washPigmentTotal(v: array<vec4f, ${layers}>) -> f32 {
  var total = 0.0;
  for (var l = 0u; l < ${layers}u; l++) { total += dot(v[l], washPigmentMask(l)); }
  return total;
}
fn washOpen(v: array<vec4f, ${layers}>) -> f32 { return v${at}; }
fn washMoved(now: array<vec4f, ${layers}>, wasPigment: f32) -> array<vec4f, ${layers}> {
  var moved = now;
  let total = washPigmentTotal(now);
  let gained = total - wasPigment;
  moved[0].x = now[0].x + (1.0 - now[0].x) * clamp(gained / ${f32(body)}, 0.0, 1.0);
  // As 1 less the set share, so all-open paint stays exactly open through the half-float store, which truncates.
  let open = clamp(washOpen(now), 0.0, 1.0);
  moved${at} = select(open, clamp(1.0 - (1.0 - open) * wasPigment / total, 0.0, 1.0), total > 0.0 && gained != 0.0);
  return moved;
}`;
}

/**
 * A mixing medium's lay: each stroke moves the paint toward its own, carrying `pickup` of the wet paint under it, so
 * where two washes meet they mix rather than one replacing the other.
 */
const mixedLay = (pickup: number) => /* wgsl */ `
fn layDeposit(pixel: vec2u, coverage: f32, rims: vec2f, tooth: vec2f, at: vec2f, press: f32) {
  let cover = clamp(coverage + max(rims.x, rims.y), 0.0, 1.0);
  if (cover <= 0.0) { return; }
  let incoming = incomingAt(tooth, at, press, 0.0);
  let under = textureLoad(layer, pixel, 0u).x;
  let rate = cover * (1.0 - ${f32(pickup)} * under);
  for (var l = 0u; l < LAYERS; l++) {
    if (isSheet(l)) { continue; }
    let was = textureLoad(layer, pixel, l);
    var now = was + rate * (incoming[l] - was);
    if (l == 0u) { now.x = cover + under * (1.0 - cover); }
    textureStore(layer, pixel, l, now);
  }
}`;

/** How far round a pixel a stacking medium's tooth fills from, in texels of the paper's grain: about a valley across. */
const STACKED_FILL_REACH = 6;

/**
 * A stacking medium's lay (PaintStackedLayering): each layer adds its pigment to what the tooth holds, as crossing
 * crayon layers mix. Past `holds` unit films a stroke trades its wax for what's there, its own on top. Wax held fills
 * the valleys `fill` of the way, so each later layer reaches further into them.
 */
const stackedLay = ({ holds, fill }: PaintStackedLayering) => /* wgsl */ `
// The wax held round \`pixel\` before this deposit, a ring u.beforeReach pixels out and the pixel: a valley fills with
// wax pressed in from the peaks round it, never having caught any itself.
fn heldAround(pixel: vec2u) -> f32 {
  let last = vec2i(textureDimensions(before)) - 1;
  var held = 0.0;
  for (var k = 0; k < 9; k++) {
    let angle = f32(k) * 0.7854;
    let offset = select(vec2i(round(u.beforeReach * vec2f(cos(angle), sin(angle)))), vec2i(0), k == 8);
    let q = vec2u(clamp(vec2i(pixel) + offset, vec2i(0), last));
    for (var l = 0u; l < LAYERS; l++) { if (!isSheet(l)) { held += dot(textureLoad(before, q, l, 0), pigmentMask(l)); } }
  }
  return held / 9.0;
}
fn layDeposit(pixel: vec2u, coverage: f32, rims: vec2f, tooth: vec2f, at: vec2f, press: f32) {
  let cover = clamp(coverage + max(rims.x, rims.y), 0.0, 1.0);
  if (cover <= 0.0) { return; }
  var was: array<vec4f, LAYERS>;
  var held = 0.0;
  for (var l = 0u; l < LAYERS; l++) {
    was[l] = textureLoad(layer, pixel, l);
    if (!isSheet(l)) { held += dot(was[l], pigmentMask(l)); }
  }
  let incoming = incomingAt(tooth, at, press, heldAround(pixel) / ${f32(holds)} * ${f32(fill)});
  var added = 0.0;
  for (var l = 0u; l < LAYERS; l++) { if (!isSheet(l)) { added += cover * dot(incoming[l], pigmentMask(l)); } }
  // What's there gives way only as far as the stroke's own wax overfills the tooth.
  let keep = select(1.0, clamp((${f32(holds)} - added) / max(held, 1e-6), 0.0, 1.0), held + added > ${f32(holds)});
  let under = was[0].x;
  for (var l = 0u; l < LAYERS; l++) {
    if (isSheet(l)) { continue; }
    // The open share isn't wax: a dry stroke sets it, as any paint laid over it does.
    var now = mix(was[l] * (1.0 - cover), was[l] * keep + cover * incoming[l], pigmentMask(l));
    if (l == 0u) { now.x = cover + under * (1.0 - cover); }
    textureStore(layer, pixel, l, now);
  }
}`;

/** The compositor for `paint` on `device`: every deposit's components and every group's palette uploaded once. */
export function stampPigmentCompositor(device: StampPaintDevice, paint: StampPigmentPaint, paperColor: StampPaintColor): StampPaintCompositor {
  const { bands, medium } = paint;
  const V = Math.ceil(bands.count / 4);
  const layers = Math.max(1, ...paint.groups.map(stampPigmentGroupLayers));
  // The paint on each pixel by pigment, in layers past the bands, kept only for a painting where a group knocks out.
  const { underpaint } = paint;
  const underLayers = underpaint ? Math.max(1, Math.ceil(underpaint.pigments.length / 4)) : 0;
  const groupsOrNone = paint.groups.length ? paint.groups : [{ sheetLayer: null, palette: [] }];
  const groupCount = groupsOrNone.length;

  const writers = new Map<CompiledStampDeposit, (views: StampUniformViews, t: number) => void>();
  const componentWords: number[] = [];
  for (const [deposit, { group, components, grade, knockout }] of paint.deposits) {
    const first = componentWords.length / COMPONENT_WORDS;
    const amounts = new Float32Array(STAMP_PIGMENT_GROUP_SLOTS * 2);
    writers.set(deposit, (views, t) => {
      const put = stampUniformWriter(PIGMENT_PAINT_DEPOSIT, views);
      put('first', first);
      put('count', components.length);
      put('group', group);
      put('gradeKind', grade.kind);
      put('grade', [...grade.geometry]);
      put('open', paint.groups[group].open ?? 0);
      put('sheetLayer', paint.groups[group].sheetLayer ?? 0);
      put('knockout', knockout ? 1 : 0);
      components.forEach((component, i) => amounts.set(stampPigmentAmountsAt(component, t), i * 2));
      put('amounts', amounts);
    });
    for (const { slot, seed, granulation, flocculation } of components) componentWords.push(slot, seed, granulation, flocculation);
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

  /**
   * The underpaint's pigments as constants (StampPigmentUnderpaint), and how a knockout's lifts thin them: each
   * pigment's first STAMP_LIFT_STAIN_FIBRES films keep what its staining holds, read between the sheet's three
   * stainings; past them it goes as paint that holds nothing does. The paint there changes by as much as a film of
   * the pigments behind does over the painting's paper.
   */
  const underpaintWgsl = ({ pigments, slots, writes }: StampPigmentUnderpaint) => {
    const count = Math.max(1, pigments.length), bandsOf = (key: 'K' | 'S') => pigments.length
      ? pigments.flatMap((pigment) => Array.from({ length: V }, (_, i) => `vec4f(${[0, 1, 2, 3].map((j) => f32(pigment[key][i * 4 + j] ?? 0)).join(', ')})`)).join(', ')
      : Array.from({ length: V }, () => 'vec4f(0.0)').join(', ');
    const slotWords = groupsOrNone.flatMap((_, g) => Array.from({ length: STAMP_PIGMENT_GROUP_SLOTS }, (__, s) => `${slots[g]?.[s] ?? 0}u`));
    return /* wgsl */ `
const UNDERPAINT = ${pigments.length}u;
const UNDER_LAYERS = ${underLayers}u;
const UNDER_K = array<vec4f, ${count * V}>(${bandsOf('K')});
const UNDER_S = array<vec4f, ${count * V}>(${bandsOf('S')});
const UNDER_STAINS = array<f32, ${count}>(${pigments.length ? pigments.map(({ staining }) => f32(staining)).join(', ') : '0.0'});
const UNDER_SLOTS = array<u32, ${slotWords.length}>(${slotWords.join(', ')});
const UNDER_WRITES = array<u32, ${groupCount}>(${groupsOrNone.map((_, g) => (writes[g] ? '1u' : '0u')).join(', ')});
fn underpaintOver(i: u32, films: array<vec4f, UNDER_LAYERS>, paper: vec4f) -> vec4f {
  var absorb = vec4f(0.0);
  var scatter = vec4f(0.0);
  for (var p = 0u; p < UNDERPAINT; p++) {
    let w = films[p / 4u][p % 4u];
    absorb += w * UNDER_K[p * BAND_VEC4S + i];
    scatter += w * UNDER_S[p * BAND_VEC4S + i];
  }
  return kubelkaMunkOver(kubelkaMunkFilm(absorb, scatter * ${f32(1 + medium.dryingScatter)}), paper);
}
// \`behind\` after lifts leaving \`left\` of a thin film of staining 0, ½ and 1, each staining between them read off the
// parabola through the three.
fn liftedUnderpaint(behind: array<vec4f, UNDER_LAYERS>, left: vec3f) -> array<vec4f, UNDER_LAYERS> {
  var after = behind;
  for (var p = 0u; p < UNDERPAINT; p++) {
    let s = UNDER_STAINS[p];
    let kept = max(0.0, left.x * (2.0 * s - 1.0) * (s - 1.0) + left.y * 4.0 * s * (1.0 - s) + left.z * s * (2.0 * s - 1.0));
    let w = behind[p / 4u][p % 4u];
    let thin = min(w, ${f32(STAMP_LIFT_STAIN_FIBRES)});
    after[p / 4u][p % 4u] = thin * kept + (w - thin) * left.x;
  }
  return after;
}
fn liftedUnder(i: u32, covered: vec4f, behind: array<vec4f, UNDER_LAYERS>, left: array<vec4f, UNDER_LAYERS>, paper: vec4f) -> vec4f {
  return clamp(covered * underpaintOver(i, left, paper) / max(underpaintOver(i, behind, paper), vec4f(1e-4)), vec4f(0.0), vec4f(1.0));
}`;
  };

  // Where the medium meets the paper, from the paper's height `h`, its mean and valley, by a pigment's granulation and
  // load; a dry medium's by how hard it's pressed and how far wax already fills the tooth.
  const { paperContact, layering } = medium;
  const contactOf = (depth: string, granulation: string, load: string, press: string, filled: string) => (paperContact.kind === 'peaks'
    ? `paintDryContact(h, meanHeight, ${f32(paperContact.tooth)}, ${depth}, ${press}, ${filled})`
    : `paintWetSettle(valley, ${depth}, ${granulation}, ${load})`);
  const contact = contactOf('u.paperDepth', 'c.granulation', 'amount', 'press', 'filled');
  const groupOf = (deposit: CompiledStampDeposit) => {
    const group = paint.deposits.get(deposit)?.group;
    if (group === undefined) throw new Error(`stamp paint: ${deposit.id} isn't in the painting its pigment compositor was made for`);
    return group;
  };

  return {
    targets: { layer: { kind: 'array', layers }, painting: { kind: 'array', layers: V + underLayers } },
    readsStampTints: false,
    reads: { press: paperContact.kind === 'peaks', before: layering.kind === 'stacks' ? { reach: STACKED_FILL_REACH } : null },
    deposit: {
      layout: PIGMENT_PAINT_DEPOSIT,
      wgsl: /* wgsl */ `
${PAINT_PAPER_WGSL}
struct PigmentComponent { slot: u32, seed: u32, granulation: f32, flocculation: f32 }
@group(0) @binding(24) var<storage, read> components: array<PigmentComponent>;
const LAYERS = ${layers}u;
// The tooth moves each pigment about in layDeposit, rather than cutting the deposit's coverage.
fn paperKept(tooth: f32, mean: f32, depth: f32) -> f32 { return 1.0; }
fn layerCoverage(pixel: vec2u) -> f32 { return textureLoad(layer, pixel, 0u).x; }
// 1 on a pigment's channel of layer \`l\`: not coverage's, nor the open share's.
fn pigmentMask(l: u32) -> vec4f {
  let channel = vec4u(4u * l) + vec4u(0u, 1u, 2u, 3u);
  return select(vec4f(1.0), vec4f(0.0), (channel == vec4u(0u)) | (channel == vec4u(paint.open)));
}
// A full stroke's pigment amounts here, graded between its material's ends by amount, where the paper's tooth and
// each pigment's habits put them: a dry medium's as hard as it's \`press\`ed, the tooth \`filled\` so far by wax.
fn incomingAt(tooth: vec2f, at: vec2f, press: f32, filled: f32) -> array<vec4f, LAYERS> {
  let h = 1.0 - tooth.x;
  let meanHeight = 1.0 - tooth.y;
  let valley = paintValley(h, meanHeight);
  let graded = paintFieldShare(at, paint.gradeKind, paint.grade);
  var incoming: array<vec4f, LAYERS>;
  for (var i = 0u; i < paint.count; i++) {
    let c = components[paint.first + i];
    let pair = paint.amounts[i / 2u];
    let ends = select(pair.xy, pair.zw, (i & 1u) == 1u);
    let amount = ends.x + (ends.y - ends.x) * graded;
    let share = max(0.0, ${contact} * paintClumps(c.flocculation, at.x, at.y, c.seed));
    let channel = c.slot + 1u;
    incoming[channel / 4u][channel % 4u] += amount * share;
  }
  return incoming;
}
// The layer holding a group's sheet, which only a knockout writes: a group without one has none.
fn isSheet(l: u32) -> bool { return paint.sheetLayer != 0u && l == paint.sheetLayer; }
${layering.kind === 'stacks' ? stackedLay(layering) : mixedLay(medium.pickup)}`,
      wet: /* wgsl */ `
${STAMP_WET_LIFT_WGSL}
@group(0) @binding(25) var<storage, read> stains: array<vec4f>;
// A knockout's sheet: x, where its fluid held its brushes off, the paint behind never reaching (a cover: another
// brush over the same fluid reserves no more); yzw, how much of a thin film behind of staining 0, ½ and 1 its lifts
// took, each blot by wetLift as wet as it lands, taking its share of what the last left and holding its own share of
// the stain. The group reads the pigments behind as it's laid (layGroup).
fn knockOut(pixel: vec2u, cover: f32, reserved: f32, wet: WetLanding) {
  let free = liftFree(wet.workable, 1.0);
  let take = select(0.0, clamp(cover * wet.strength, 0.0, 1.0) * liftLoose(free, ${f32(medium.wetting.rewetting)}), wet.action == WET_LIFT);
  if (max(reserved, take) <= 0.0) { return; }
  let was = textureLoad(layer, pixel, paint.sheetLayer);
  // wetLift's \`was - take * (was - held)\` over \`was\`, its held share of a thin film being its stain's, as held as it's free.
  let keeps = vec3f(1.0) - take * (vec3f(1.0) - mix(1.0, ${f32(STAMP_LIFT_WET_STAIN_HOLD)}, free) * vec3f(0.0, 0.5, 1.0));
  textureStore(layer, pixel, paint.sheetLayer, vec4f(max(was.x, clamp(reserved, 0.0, 1.0)), vec3f(1.0) - (vec3f(1.0) - was.yzw) * keeps));
}
// Water leaves the pigment where it is: moving it is the neighbourhood's (stamp-wet-stages.ts). Every landing first
// sets the open share to none wherever the paper has settled since it last took water, so whatever reads it after
// (this landing, the stages, a later landing) reads the paint there as set.
fn landDeposit(pixel: vec2u, coverage: f32, rims: vec2f, tooth: vec2f, at: vec2f, reserved: f32, wet: WetLanding) {
  let cover = clamp(coverage + max(rims.x, rims.y), 0.0, 1.0);
  if (paint.knockout != 0u) {
    knockOut(pixel, cover, reserved, wet);
    return;
  }
  var was: array<vec4f, LAYERS>;
  for (var l = 0u; l < LAYERS; l++) { was[l] = textureLoad(layer, pixel, l); }
  let o = vec2u(paint.open / 4u, paint.open % 4u);
  // Settled only where every lattice point round it is: a stroke's edge lies between points, and the paint it laid
  // there is as fresh as its body.
  let settled = wet.settled >= ${f32(1 - 1e-4)};
  let open = select(was[o.x][o.y], 0.0, settled);
  if (cover <= 0.0 || wet.action == WET_WATER) {
    if (settled) {
      var kept = was[o.x];
      kept[o.y] = open;
      textureStore(layer, pixel, o.x, kept);
    }
    return;
  }
  let under = was[0].x;
  var had = 0.0;
  var has = 0.0;
  var now: array<vec4f, LAYERS>;
  // A lift thins the film where it is rather than shrinking it, so coverage stays: the group dries what's left over
  // that coverage, and a later stroke there meets paint, however little.
  if (wet.action == WET_LIFT) {
    for (var l = 0u; l < LAYERS; l++) {
      if (isSheet(l)) { continue; }
      now[l] = wetLift(was[l], cover, wet.strength, wet.workable, open, ${f32(medium.wetting.rewetting)}, stains[paint.group * LAYERS + l]);
      had += dot(was[l], pigmentMask(l));
      has += dot(now[l], pigmentMask(l));
    }
    now[0].x = under;
    now[o.x][o.y] = liftOpen(open, wet.workable, ${f32(medium.wetting.rewetting)}, had, has);
    for (var l = 0u; l < LAYERS; l++) { if (!isSheet(l)) { textureStore(layer, pixel, l, now[l]); } }
    return;
  }
  // A wash's paint is drawn at a firm hand's pressure, the tooth as the paper's own.
  let incoming = incomingAt(tooth, at, 1.0, 0.0);
  var kept = 0.0;
  var gained = 0.0;
  for (var l = 0u; l < LAYERS; l++) {
    if (isSheet(l)) { continue; }
    now[l] = wetLand(was[l], incoming[l], cover, under, ${f32(medium.pickup)}, wet.workable);
    let mask = pigmentMask(l);
    let laid = max(now[l] - was[l], vec4f(0.0)) * mask;
    kept += dot(min(was[l], now[l]), mask);
    gained += dot(laid, mask);
    // What it laid, which the flow stage moves (stamp-wet-flow.ts).
    textureStore(fresh, pixel, l, laid);
  }
  now[0].x = cover + under * (1.0 - cover);
  now[o.x][o.y] = wetLandOpen(open, kept, gained);
  for (var l = 0u; l < LAYERS; l++) { if (!isSheet(l)) { textureStore(layer, pixel, l, now[l]); } }
}`,
      writerFor: (deposit) => {
        const writer = writers.get(deposit);
        if (!writer) throw new Error(`stamp paint: ${deposit.id} isn't in the painting its pigment compositor was made for`);
        return writer;
      },
      resources: ({ wet }) => [{ buffer: components }, ...(wet ? [{ buffer: stains }] : [])],
    },
    wash: {
      layersOf: (deposit) => paint.groups[groupOf(deposit)].paintLayers,
      movedWgsl: (washLayers) => stampWashMovedWgsl(washLayers, medium.body),
      holdWgsl: (deposit) => {
        const group = paint.groups[groupOf(deposit)];
        // Per channel of the group's layers: its pigment's granulation, flocculation and seed; none for coverage and the open share.
        const habits = Array.from({ length: group.paintLayers * 4 }, (_, channel) => {
          const pigment = group.palette[channel - 1];
          return pigment && channel > 0 ? [pigment.granulation * medium.granulation, pigment.flocculation, paintPigmentSeed(pigment.id)] : [0, 0, 0];
        });
        return /* wgsl */ `
${PAINT_PAPER_WGSL}
const WASH_HABITS = array<vec3f, ${habits.length}>(${habits.map((habit) => `vec3f(${habit.map(f32).join(', ')})`).join(', ')});
fn washHold(l: u32, at: vec2f, tooth: vec2f, depth: f32, held: vec4f) -> vec4f {
  let h = 1.0 - tooth.x;
  let meanHeight = 1.0 - tooth.y;
  let valley = paintValley(h, meanHeight);
  var hold = vec4f(1.0);
  for (var i = 0u; i < 4u; i++) {
    let habit = WASH_HABITS[4u * l + i];
    hold[i] = max(0.0, ${contactOf('depth', 'habit.x', 'held[i]', '1.0', '0.0')} * paintClumps(habit.y, at.x, at.y, u32(habit.z)));
  }
  return hold;
}`;
      },
    },
    group: {
      wgsl: /* wgsl */ `
${bandWgsl}
@group(0) @binding(3) var photograph: texture_2d<f32>;
@group(0) @binding(4) var photographSampler: sampler;
@group(0) @binding(5) var<storage, read> palettes: array<vec4f>;
const PALETTE = ${STAMP_PIGMENT_GROUP_SLOTS * 2 * V}u;
// Each group's sheet layer, 0 for a group without a knockout, and how many palette slots it fills.
const SHEETS = array<u32, ${groupCount}>(${groupsOrNone.map(({ sheetLayer }) => `${sheetLayer ?? 0}u`).join(', ')});
const PALETTE_SIZES = array<u32, ${groupCount}>(${groupsOrNone.map(({ palette }) => `${palette.length}u`).join(', ')});
${underpaint ? underpaintWgsl(underpaint) : ''}
// A group's film glazed over what's there or, opaque, laid over bare paper. A group that knocks out first takes its
// sheet out of what's there: its reserve covers it with its paper, its lifts thin each pigment behind (liftedUnder).
fn layGroup(pixel: vec2u, glaze: bool, opacity: f32) {
  var amounts: array<vec4f, LAYERS>;
  for (var l = 0u; l < LAYERS; l++) { amounts[l] = textureLoad(layer, pixel, l, 0); }
  let coverage = amounts[0].x;
  let sheet = SHEETS[u.group];
  // Reserved (x) and taken at stainings 0, ½ and 1 (yzw), at the group's opacity as its paint is: a group half there takes half.
  let taken = select(vec4f(0.0), clamp(amounts[sheet], vec4f(0.0), vec4f(1.0)), sheet != 0u) * opacity;
  let lifts = max(taken.y, max(taken.z, taken.w)) > 0.0;
  if (coverage <= 0.0 && taken.x <= 0.0 && !lifts) { return; }
  let thickness = select(1.0 / max(coverage, 0.001), opacity, glaze);
  let cover = min(1.0, coverage * ${STAMP_OPAQUE_COVER.toFixed(1)}) * opacity;
  var bare = vec3f(0.0);
  if (!glaze || taken.x > 0.0) { bare = paperColor(photograph, photographSampler, u.paper, groupPaperAt(pixel), textureDimensions(painting)); }
${underpaint ? `  var behind: array<vec4f, UNDER_LAYERS>;
  for (var r = 0u; r < UNDER_LAYERS; r++) { behind[r] = textureLoad(painting, pixel, BAND_VEC4S + r); }
  var left = behind;
  // The paint behind was laid over the painting's paper, wherever this group's own lies.
  var ground = vec3f(0.0);
  if (lifts) {
    ground = paperColor(photograph, photographSampler, u.paper, vec2f(pixel) + 0.5, textureDimensions(painting));
    left = liftedUnderpaint(behind, vec3f(1.0) - taken.yzw);
  }
` : ''}  let base = u.group * PALETTE;
  for (var i = 0u; i < BAND_VEC4S; i++) {
    var absorb = vec4f(0.0);
    var scatter = vec4f(0.0);
    for (var s = 0u; s < PALETTE_SIZES[u.group]; s++) {
      let channel = s + 1u;
      let amount = amounts[channel / 4u][channel % 4u];
      absorb += amount * palettes[base + s * 2u * BAND_VEC4S + i];
      scatter += amount * palettes[base + (s * 2u + 1u) * BAND_VEC4S + i];
    }
    let film = kubelkaMunkFilm(absorb * thickness, scatter * ${f32(1 + medium.dryingScatter)} * thickness);
    var covered = textureLoad(painting, pixel, i);
${underpaint ? `    if (lifts) { covered = liftedUnder(i, covered, behind, left, paperReflectance(i, ground)); }
` : ''}    // A reserve's edge covers what's there with the group's paper.
    let under = mix(covered, paperReflectance(i, bare), taken.x);
    var laid = kubelkaMunkOver(film, under);
    if (!glaze) { laid = under + (kubelkaMunkOver(film, paperReflectance(i, bare)) - under) * cover; }
    textureStore(painting, pixel, i, clamp(laid, vec4f(0.0), vec4f(1.0)));
  }
${underpaint ? `  if (UNDER_WRITES[u.group] != 0u) {
    // What's behind after the knockout, under this group's film: glazed over it, or covering it as far as it's opaque.
    var own: array<vec4f, UNDER_LAYERS>;
    for (var s = 0u; s < PALETTE_SIZES[u.group]; s++) {
      let p = UNDER_SLOTS[u.group * ${STAMP_PIGMENT_GROUP_SLOTS}u + s];
      let channel = s + 1u;
      own[p / 4u][p % 4u] += amounts[channel / 4u][channel % 4u] * thickness;
    }
    for (var r = 0u; r < UNDER_LAYERS; r++) {
      let kept = left[r] * (1.0 - taken.x);
      textureStore(painting, pixel, BAND_VEC4S + r, select(mix(kept, own[r], cover), kept + own[r], glaze));
    }
  }
` : ''}}`,
      resources: ({ photograph, sampler }) => [photograph, sampler, { buffer: palettes }],
    },
    paper: /* wgsl */ `
${bandWgsl}
fn layPaper(pixel: vec2u, color: vec3f) {
  for (var i = 0u; i < BAND_VEC4S; i++) { textureStore(painting, pixel, i, paperReflectance(i, color)); }
  for (var r = 0u; r < ${underLayers}u; r++) { textureStore(painting, pixel, BAND_VEC4S + r, vec4f(0.0)); }
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
