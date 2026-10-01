// stamp-wet-bloom.ts: the wet stage for blooms and backruns (models/stamp-wet-bloom.ts). A wash deposit's surplus
// water spreads over the wet paper the wash's paint reaches, stalls at a lobed front, and the paint it loosens inside
// is carried there, over the deposit's box, which the stage's reach widens. Both move by the shared transport (stamp-wet-transport.ts), so
// neither crosses masking fluid, a `within`'s edge or a dry gap.
//
// Carrying is the normalised scatter: a pixel sends what it loosens to the band through the spread, in
// proportion to the band's weight there, so what one gives up is exactly what the band gains, per pigment.
//
// Negative space: the spreading water isn't written back into the wash's wetness; later deposits don't see it.

import { STAMP_BLOOM_BAND_WIDTH, STAMP_BLOOM_CARRY_SPREAD, STAMP_WET_BLOOM_WGSL, stampBloomReach, stampBloomSizing } from '../models/stamp-wet-bloom.ts';
import { STAMP_WET_LIFT_WGSL } from '../models/stamp-wet-lift.ts';
import { STAMP_GRID_AT_WGSL } from '../models/stamp-region.ts';
import type { StampWetWindow } from '../models/stamp-wetness.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe.ts';
import type { StampLoadedWetStage, StampWetDepositMoment, StampWetStage, StampWetStageContext } from './stamp-wet-stages.ts';
import { stampUniformLayout, stampUniformWriter } from './stamp-uniform-layout.ts';
import { encodeStampWetTransportSteps, stampWetSpreads, type StampWetTransportStep } from './stamp-wet-transport.ts';

const WORKGROUP = 8;

/**
 * A pixel gives its paint up fully only as near a front as `STAMP_BLOOM_SEND_FLOOR` of a straight front's reach
 * (the band spread as far as paint is carried), less further out: a pixel with a sliver of front in reach would pour
 * all it loosens into that sliver.
 */
const STAMP_BLOOM_SEND_FLOOR = 0.2;

/**
 * A bloom: its lattice; where its paper before starts in the painting's grids and its wetness after in the stage's;
 * its box; seed; drive; the water's spread (sigma); the medium's damp and shiny (PaintSheen); the send floor.
 */
const BLOOM = stampUniformLayout('Bloom', [
  ['lattice', 'vec4f'], ['size', 'vec2u'], ['first', 'u32'], ['afterFirst', 'u32'],
  ['origin', 'vec2u'], ['extent', 'vec2u'],
  ['seed', 'u32'], ['drive', 'f32'], ['sigma', 'f32'], ['water', 'f32'], ['damp', 'f32'], ['shine', 'f32'], ['sendFloor', 'f32'],
]);

// Scratch textures are indexed from the bloom's origin, so they're only as big as the largest box.
const PRELUDE = /* wgsl */ `
${BLOOM.wgsl}
@group(0) @binding(0) var<uniform> u: Bloom;
// The scratch texel an invocation works on, or none past the bloom's extent.
fn localOf(id: vec3u) -> vec2i { return select(vec2i(-1), vec2i(id.xy), all(id.xy < u.extent)); }
`;

// The paper before the deposit is the painting's grid buffer (\`grid\`); its wetness after, which the painting doesn't
// keep, is the stage's own (\`after\`), laid out alike.
const GRID_WGSL = /* wgsl */ `
@group(0) @binding(1) var<storage, read> grid: array<f32>;
@group(0) @binding(2) var<storage, read> after: array<f32>;
${STAMP_GRID_AT_WGSL}
fn workableAt(p: vec2i) -> f32 { return gridAt(vec2f(p) + 0.5, u.lattice.xyz, u.size, u.first + u.size.x * u.size.y); }
fn wetnessAfterAt(p: vec2i) -> f32 {
  let uv = clamp((vec2f(p) + 0.5 - u.lattice.xy) / u.lattice.z, vec2f(0.0), vec2f(u.size) - 1.0);
  let cell = min(vec2u(floor(uv)), u.size - 2u);
  let f = uv - vec2f(cell);
  let at = u.afterFirst + cell.y * u.size.x + cell.x;
  return mix(mix(after[at], after[at + 1u], f.x), mix(after[at + u.size.x], after[at + u.size.x + 1u], f.x), f.y);
}
// Where the paper round \`p\` stands, at the lattice's own resolution rather than bilinearly: (the wettest it was, of the
// lattice points a cell round p's own cell, and the least workable of p's cell's corners). A cell half under a wet
// brush and half dry averages to "damp", and a bloom read from it would ring every stroke's edge.
fn paperThroughout(p: vec2i) -> vec2f {
  let uv = clamp((vec2f(p) + 0.5 - u.lattice.xy) / u.lattice.z, vec2f(0.0), vec2f(u.size) - 1.0);
  let cell = vec2i(min(vec2u(floor(uv)), u.size - 2u));
  let workableFirst = u.first + u.size.x * u.size.y;
  var wettest = 0.0;
  var workable = 1.0;
  for (var j = -1; j <= 2; j++) {
    for (var i = -1; i <= 2; i++) {
      let at = vec2u(clamp(cell + vec2i(i, j), vec2i(0), vec2i(u.size) - 1));
      wettest = max(wettest, grid[u.first + at.y * u.size.x + at.x]);
      if (i >= 0 && i <= 1 && j >= 0 && j <= 1) { workable = min(workable, grid[workableFirst + at.y * u.size.x + at.x]); }
    }
  }
  return vec2f(wettest, workable);
}
fn wetnessBeforeAt(p: vec2i) -> f32 { return gridAt(vec2f(p) + 0.5, u.lattice.xyz, u.size, u.first); }
`;

// Whether the bloom's water reaches p (bloomContact), by the wash's paint over the 5 x 5 px round it: a grain-fine
// fringe would speckle the front where the wash's own edge stops it.
const CONTACT_WGSL = /* wgsl */ `
fn contactAt(p: vec2i) -> f32 {
  var coverage = 0.0;
  for (var j = -2; j <= 2; j += 2) {
    for (var i = -2; i <= 2; i += 2) { coverage += textureLoad(layer, clamp(p + vec2i(i, j), vec2i(0), vec2i(textureDimensions(layer)) - 1), 0, 0).x; }
  }
  return bloomContact(wetnessBeforeAt(p), coverage / 9.0);
}`;

// The surplus water the deposit left, per pixel, into the transport's values; and the paper it spreads over: how
// readily the water runs there (bloomEase, by the paper before the deposit, only where it reaches: bloomContact), and
// open where paint may land (footprint g: never under fluid, outside \`within\` or the clip).
const SURPLUS_WGSL = /* wgsl */ `${PRELUDE}${GRID_WGSL}
${STAMP_WET_BLOOM_WGSL}
@group(0) @binding(3) var footprint: texture_2d<f32>;
@group(0) @binding(4) var surplus: texture_storage_2d_array<rgba32float, write>;
@group(0) @binding(5) var paper: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var layer: texture_2d_array<f32>;
${CONTACT_WGSL}
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  let p = local + vec2i(u.origin);
  let at = paperThroughout(p);
  let wetness = wetnessAfterAt(p);
  textureStore(surplus, local, 0, vec4f(bloomSurplus(at.x, wetness, at.y, u.damp, u.shine), 0.0, 0.0, 0.0));
  let landed = textureLoad(footprint, p, 0);
  let contact = contactAt(p);
  let ease = bloomEase(wetnessBeforeAt(p), u.damp);
  textureStore(paper, local, vec4f(contact * ease, clamp(landed.g, 0.0, 1.0), 0.0, 0.0));
}`;

// Where each pixel stands to the front: its band weight (x) and the share of its paint loosened (y), as free as it is
// (workable, and open), only where paint may land. The band goes to the transport too, to be spread back (Gᵀ).
const frontWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}${GRID_WGSL}
${STAMP_WET_BLOOM_WGSL}
${STAMP_WET_LIFT_WGSL}
${movedWgsl}
@group(0) @binding(3) var footprint: texture_2d<f32>;
@group(0) @binding(4) var water: texture_2d_array<f32>;
@group(0) @binding(5) var front: texture_storage_2d<rg32float, write>;
@group(0) @binding(6) var layer: texture_2d_array<f32>;
${CONTACT_WGSL}
@group(0) @binding(7) var band: texture_storage_2d_array<rgba32float, write>;
fn waterAt(local: vec2i) -> f32 { return textureLoad(water, clamp(local, vec2i(0), vec2i(u.extent) - 1), 0, 0).r; }
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  let p = local + vec2i(u.origin);
  // Read over two pixels either side: the transport's ladder leaves a pixel-scale ripple in the water, and a gradient
  // read from it would ripple the distance and the lobes' direction.
  let gradient = 0.25 * vec2f(waterAt(local + vec2i(2, 0)) - waterAt(local - vec2i(2, 0)), waterAt(local + vec2i(0, 2)) - waterAt(local - vec2i(0, 2)));
  let before = wetnessBeforeAt(p);
  let at = bloomFront(vec2f(p) + 0.5, waterAt(local), gradient, bloomEase(before, u.damp), u.seed, u.sigma);
  let streak = bloomStreak(at.foot, at.d, u.seed, u.sigma);
  let allowed = clamp(textureLoad(footprint, p, 0).g, 0.0, 1.0);
  var paint: array<vec4f, ${layers}>;
  for (var l = 0; l < ${layers}; l++) { paint[l] = textureLoad(layer, p, l, 0); }
  let line = bloomFrontLine(at.held, bloomMerging(before, u.damp, u.shine));
  let weight = bloomBand(at.d, line, streak) * allowed * contactAt(p);
  let free = liftFree(workableAt(p), washOpen(paint));
  textureStore(front, local, vec4f(weight, bloomLoosened(at.d, free, u.drive, streak) * allowed, 0.0, 0.0));
  textureStore(band, local, 0, vec4f(weight, 0.0, 0.0, 0.0));
}`;

// Each pixel's send (x): the share of its paint it gives up (y), over the band its paint would reach (N, the band
// spread back), so that the band, gathering what's sent through the spread, gains exactly what's given up.
const SEND_WGSL = /* wgsl */ `${PRELUDE}
@group(0) @binding(1) var front: texture_2d<f32>;
@group(0) @binding(2) var reached: texture_2d_array<f32>;
@group(0) @binding(3) var send: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  let reach = textureLoad(reached, local, 0, 0).r;
  let given = textureLoad(front, local, 0).y * smoothstep(0.0, u.sendFloor, reach);
  textureStore(send, local, vec4f(select(0.0, given / reach, reach > 1e-12 && given > 0.0), given, 0.0, 0.0));
}`;

// What each pixel sends of its pigment channels, for the transport to spread.
const sentWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}
${movedWgsl}
@group(0) @binding(1) var layer: texture_2d_array<f32>;
@group(0) @binding(2) var send: texture_2d<f32>;
@group(0) @binding(3) var sent: texture_storage_2d_array<rgba32float, write>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  let p = local + vec2i(u.origin);
  let share = textureLoad(send, local, 0).x;
  for (var l = 0; l < ${layers}; l++) { textureStore(sent, local, l, share * textureLoad(layer, p, l, 0) * washPigmentMask(u32(l))); }
}`;

// The carry, written back: each pixel keeps what it didn't give up and gains what its band weight gathers of what was
// sent and spread, in its pigment channels; the rest of it is the compositor's washMoved.
const landWgsl = (layers: number, movedWgsl: string) => /* wgsl */ `${PRELUDE}
${STAMP_WET_BLOOM_WGSL}
${movedWgsl}
@group(0) @binding(1) var layer: texture_storage_2d_array<rgba16float, read_write>;
@group(0) @binding(2) var front: texture_2d<f32>;
@group(0) @binding(3) var send: texture_2d<f32>;
@group(0) @binding(4) var gathered: texture_2d_array<f32>;
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  let local = localOf(id);
  if (local.x < 0) { return; }
  let band = textureLoad(front, local, 0).x;
  let given = textureLoad(send, local, 0).y;
  if (band <= 0.0 && given <= 0.0) { return; }
  let p = local + vec2i(u.origin);
  var was: array<vec4f, ${layers}>;
  var now: array<vec4f, ${layers}>;
  for (var l = 0; l < ${layers}; l++) {
    was[l] = textureLoad(layer, p, l);
    now[l] = mix(was[l], bloomLand(was[l], given, band, textureLoad(gathered, local, l, 0)), washPigmentMask(u32(l)));
  }
  let moved = washMoved(now, washPigmentTotal(was));
  for (var l = 0; l < ${layers}; l++) { textureStore(layer, p, l, moved[l]); }
}`;

type BloomPipelines = Record<'surplus' | 'front' | 'send' | 'sent' | 'land', GPUComputePipeline>;
/** The transport's three spreads a bloom runs: its water, the band spread back (N), what's sent. */
const WATER = 0, REACHED = 1, SENT = 2;
/** A landing's bloom, sized as the painting loads. */
type BloomPlan = {
  water: number; first: number; afterFirst: number; sigma: number; drive: number; lattice: StampWetWindow; pipelines: BloomPipelines; uniform: GPUBuffer;
  spreads: ReturnType<typeof stampWetSpreads>;
};
/** A pipeline and what it's bound to, as one dispatch of a bloom runs it. */
type BloomStep = StampWetTransportStep;
/**
 * The scratch textures, as big as the largest box reserved, and each plan's steps bound to them: a new set of
 * textures binds afresh.
 */
type BloomScratch = {
  w: number; h: number; textures: GPUTexture[]; steps: Map<BloomPlan, BloomStep[]>;
  paper: GPUTextureView; paths: [GPUTextureView, GPUTextureView]; values: [GPUTextureView, GPUTextureView]; front: GPUTextureView; send: GPUTextureView;
};

function loadBloom({ device, medium, wetness, layer, footprint, grids, wash }: StampWetStageContext): StampLoadedWetStage<StampWetDepositMoment> {
  const { spread } = medium.wetting;
  if (spread <= 0) return { encode: () => null };
  const sized = [...wetness.landings].flatMap(([deposit, landing]) => {
    const bloom = deposit.action.kind === 'lift' ? null : stampBloomSizing(landing, medium.wetting, deposit.diameter);
    return bloom && bloom.sigma >= 0.5 ? [{ deposit, landing, ...bloom }] : [];
  });
  if (!sized.length) return { encode: () => null };

  // Compiled per layer count, the wash layer's WGSL being the group's.
  const pipelinesFor = new Map<number, BloomPipelines>();
  const pipelinesOf = (layers: number) => {
    let found = pipelinesFor.get(layers);
    if (!found) {
      const moved = wash.movedWgsl(layers);
      const pipeline = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'run' } });
      found = {
        surplus: pipeline(SURPLUS_WGSL), front: pipeline(frontWgsl(layers, moved)), send: pipeline(SEND_WGSL),
        sent: pipeline(sentWgsl(layers, moved)), land: pipeline(landWgsl(layers, moved)),
      };
      pipelinesFor.set(layers, found);
    }
    return found;
  };

  const afterValues = new Float32Array(sized.reduce((sum, { landing }) => sum + landing.after.wetness.length, 0));
  let afterFirst = 0;
  const plans = new Map(sized.map(({ deposit, landing, sigma, drive }): [CompiledStampDeposit, BloomPlan] => {
    afterValues.set(landing.after.wetness, afterFirst);
    const uniform = device.createBuffer({ size: BLOOM.words * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const layers = wash.layersOf(deposit), carry = STAMP_BLOOM_CARRY_SPREAD * sigma;
    // The water spreads from values[0]; the band, laid in values[1], spreads back there; what's sent spreads in values[0].
    const spreads = stampWetSpreads(device, [
      { sigma, order: 'forward', layers: 1, from: 0 }, { sigma: carry, order: 'transposed', layers: 1, from: 1 }, { sigma: carry, order: 'forward', layers, from: 0 },
    ]);
    const plan = { water: landing.water, first: grids.firsts.get(deposit)!, afterFirst, sigma, drive, lattice: landing.before.window, pipelines: pipelinesOf(layers), uniform, spreads };
    afterFirst += landing.after.wetness.length;
    return [deposit, plan];
  }));
  const after = device.createBuffer({ size: afterValues.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(after, 0, afterValues);
  const layers = sized.reduce((most, { deposit }) => Math.max(most, wash.layersOf(deposit)), 1);

  let scratch: BloomScratch | null = null;
  const reserve = ({ w, h }: { w: number; h: number }) => {
    if (scratch && w <= scratch.w && h <= scratch.h) return;
    const size = { w: Math.max(w, scratch?.w ?? 0), h: Math.max(h, scratch?.h ?? 0) };
    // Reserved between frames: the frames that bound the old set are submitted, and destroy waits for them.
    for (const texture of scratch?.textures ?? []) texture.destroy();
    const textures: GPUTexture[] = [];
    const view = (format: GPUTextureFormat, depth?: number) => {
      const texture = device.createTexture({ size: [size.w, size.h, depth ?? 1], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
      textures.push(texture);
      return texture.createView({ dimension: depth === undefined ? '2d' : '2d-array' });
    };
    scratch = {
      ...size, textures, steps: new Map(), paper: view('rgba16float'), paths: [view('rgba16float'), view('rgba16float')],
      values: [view('rgba32float', layers), view('rgba32float', layers)], front: view('rg32float'), send: view('rg32float'),
    };
  };

  const encode = (encoder: GPUCommandEncoder, deposit: CompiledStampDeposit, { box, seed }: StampWetDepositMoment): StampPixelBox => {
    const plan = plans.get(deposit)!, { sigma, lattice } = plan;
    if (!scratch || box.w > scratch.w || box.h > scratch.h) throw new Error(`stamp paint: the bloom stage was given ${deposit.id}'s box unreserved`);
    const words = new ArrayBuffer(BLOOM.words * 4);
    const put = stampUniformWriter(BLOOM, { floats: new Float32Array(words), ints: new Int32Array(words), words: new Uint32Array(words) });
    put('lattice', [lattice.x0, lattice.y0, lattice.cell, 0]);
    put('size', [lattice.columns, lattice.rows]);
    put('first', plan.first);
    put('afterFirst', plan.afterFirst);
    put('origin', [box.x, box.y]);
    put('extent', [box.w, box.h]);
    put('seed', seed);
    put('drive', plan.drive);
    put('sigma', sigma);
    put('water', plan.water);
    put('damp', medium.wetting.sheen.damp);
    put('shine', medium.wetting.sheen.shiny);
    put('sendFloor', (STAMP_BLOOM_SEND_FLOOR * STAMP_BLOOM_BAND_WIDTH) / (Math.sqrt(2 * Math.PI) * STAMP_BLOOM_CARRY_SPREAD * sigma));
    device.queue.writeBuffer(plan.uniform, 0, words);
    plan.spreads.write(box);

    let steps = scratch.steps.get(plan);
    if (!steps) {
      steps = bloomSteps(plan, scratch);
      scratch.steps.set(plan, steps);
    }
    encodeStampWetTransportSteps(encoder, steps, box);
    return box;
  };
  // A plan's dispatches, in order, bound to one generation of scratch textures.
  const bloomSteps = (plan: BloomPlan, textures: BloomScratch): BloomStep[] => {
    const { paper, values, front, send } = textures;
    const { pipelines, spreads } = plan, u = { buffer: plan.uniform }, g = { buffer: grids.buffer }, a = { buffer: after };
    // A null leaves its binding out: a pass whose shader never reads it has none in its layout.
    const step = (pipeline: GPUComputePipeline, resources: (GPUBindingResource | null)[]): BloomStep => ({
      pipeline, bindGroup: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: resources.flatMap((resource, binding) => (resource ? [{ binding, resource }] : [])) }),
    });
    return [
      step(pipelines.surplus, [u, g, a, footprint.view, values[0], paper, layer.view]),
      ...spreads.steps(WATER, textures),
      step(pipelines.front, [u, g, null, footprint.view, values[0], front, layer.view, values[1]]),
      ...spreads.steps(REACHED, textures),
      step(pipelines.send, [u, front, values[1], send]),
      step(pipelines.sent, [u, layer.view, send, values[0]]),
      ...spreads.steps(SENT, textures),
      step(pipelines.land, [u, layer.view, front, send, values[0]]),
    ];
  };
  return {
    reserve,
    encode: (encoder, moment) => (plans.has(moment.deposit) ? encode(encoder, moment.deposit, moment) : null),
  };
}

/**
 * Blooms and backruns, after each wash deposit that lands wetter than the damp, workable paint round it: once wholly
 * shown, as its front is worked out from the whole landing's water.
 */
export const STAMP_BLOOM_STAGE = { id: 'bloom', after: 'deposit', reach: stampBloomReach, settled: true, load: loadBloom } satisfies StampWetStage;
