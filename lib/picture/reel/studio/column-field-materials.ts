// column-field-materials.ts: the three objects the cube field is built from: each column's neighbours and colours,
// the rounded column, and the node materials that raise the tops, occlude the gaps and shadow the ball's pool. Their
// light is three's physical model with the field's own occlusion and ball shadow worked into it
// (ColumnFieldLightingModel).

import {
  BufferGeometry, Color, DataTexture, Float32BufferAttribute, InterpolationSamplingType, LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace,
  MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, PhysicalLightingModel, RepeatWrapping, SpotLightNode, Vector4,
  type LightingModelDirectInput, type Material, type Node, type NodeBuilder, type Texture,
} from 'three/webgpu';
import {
  abs, acos, asin, attribute, clamp as clampNode, dot, exp, float, floor, inverseSqrt, length, max, min, mix, normalWorld, positionLocal, positionWorld,
  select, sqrt, step, uniform, varying, vec3, vec4,
} from 'three/tsl';
import { clamp } from '#lib/picture/motion/models/motion.ts';
import { hashRandom } from '#lib/picture/motion/models/random.ts';
import { cellIndex, type ColumnBall, type ColumnCell } from '../models/column-field.ts';

type ColumnTopology = { neighbours: Int32Array; colors: Float32Array; neighbourColors: Float32Array };
const topologies = new WeakMap<readonly ColumnCell[], Map<string, ColumnTopology>>();
const NEIGHBOUR_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Each column's neighbours (+x, −x, +z, −z; −1 for none) and colours: its own, its value varied by up to `vary` as
 * painted plaster's is, and its neighbours' packed a float each (8 bits a channel: exact in a float's 24-bit mantissa).
 */
export function columnTopology(cells: readonly ColumnCell[], vary: number, seed: number): ColumnTopology {
  const byKey = topologies.get(cells) ?? new Map<string, ColumnTopology>();
  topologies.set(cells, byKey);
  const known = byKey.get(`${vary}|${seed}`);
  if (known) return known;
  const index = cellIndex(cells), n = cells.length;
  const neighbours = new Int32Array(4 * n), colors = new Float32Array(3 * n), packed = new Float32Array(n), neighbourColors = new Float32Array(4 * n);
  const color = new Color();
  const byte = (v: number) => Math.round(clamp(v) * 255);
  for (const [k, cell] of cells.entries()) {
    color.set(cell.color).multiplyScalar(1 + vary * (2 * hashRandom('column-vary', seed, cell.i, cell.j) - 1));
    colors.set([color.r, color.g, color.b], 3 * k);
    packed[k] = byte(color.r) * 65536 + byte(color.g) * 256 + byte(color.b);
    for (const [s, [di, dj]] of NEIGHBOUR_STEPS.entries()) neighbours[4 * k + s] = index.get(`${cell.i + di},${cell.j + dj}`) ?? -1;
  }
  for (let k = 0; k < 4 * n; k++) neighbourColors[k] = neighbours[k] < 0 ? 0 : packed[neighbours[k]];
  const topology = { neighbours, colors, neighbourColors };
  byKey.set(`${vary}|${seed}`, topology);
  return topology;
}

/**
 * A column `width` wide, its rounded-square section (radius `corner`) rounded over at the top by `bevel`, as an offset
 * surface: every ring shares the corner centres. Vertices at y ≥ −0.5 are its top, raised by its height in the shader;
 * the rest is a skirt underground at y = −1, so a column never shows a base.
 */
export function columnGeometry(width: number, corner: number, bevel: number) {
  const a = width / 2, rc = Math.min(corner, a), rb = Math.min(bevel, rc);
  const CORNER = 3, BEVEL = 3, ring = 4 * (CORNER + 1);
  const position: number[] = [], normal: number[] = [], index: number[] = [];
  const addRing = (y: number, radius: number, theta: number) => {
    for (let q = 0; q < 4; q++) {
      const sx = q === 0 || q === 3 ? 1 : -1, sz = q < 2 ? 1 : -1;
      for (let s = 0; s <= CORNER; s++) {
        const phi = ((q + s / CORNER) * Math.PI) / 2, cx = Math.cos(phi), cz = Math.sin(phi);
        position.push(sx * (a - rc) + radius * cx, y, sz * (a - rc) + radius * cz);
        normal.push(cx * Math.cos(theta), Math.sin(theta), cz * Math.cos(theta));
      }
    }
  };
  addRing(-1, rc, 0);
  addRing(-rb, rc, 0);
  for (let b = 1; b <= BEVEL; b++) {
    const theta = ((b / BEVEL) * Math.PI) / 2;
    addRing(-rb + rb * Math.sin(theta), rc - rb + rb * Math.cos(theta), theta);
  }
  const rings = 2 + BEVEL;
  for (let r = 0; r + 1 < rings; r++) {
    for (let k = 0; k < ring; k++) {
      const a0 = r * ring + k, a1 = r * ring + ((k + 1) % ring);
      index.push(a0, a1 + ring, a1, a0, a0 + ring, a1 + ring);
    }
  }
  const centre = position.length / 3, last = (rings - 1) * ring;
  position.push(0, 0, 0);
  normal.push(0, 1, 0);
  for (let k = 0; k < ring; k++) index.push(centre, last + ((k + 1) % ring), last + k);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  geometry.setIndex(index);
  return geometry;
}

// ---------- the ball's shadow ----------

/** The ball (world centre, radius; 0 for none) and the pool's lamp (world centre, radius), set every exposure. */
export type ColumnBallShadow = ReturnType<typeof columnBallShadow>;

export function columnBallShadow() {
  return { ball: uniform(new Vector4()), lamp: uniform(new Vector4()) };
}

type FloatNode = Node<'float'>;

/** The area two discs of radii `r1` and `r2`, `d` apart, share. */
function discOverlap(r1: FloatNode, r2: FloatNode, d: FloatNode): FloatNode {
  const r = min(r1, r2);
  const a = r1.mul(r1).mul(acos(clampNode(d.mul(d).add(r1.mul(r1)).sub(r2.mul(r2)).div(d.mul(r1).mul(2)), -1, 1)));
  const b = r2.mul(r2).mul(acos(clampNode(d.mul(d).add(r2.mul(r2)).sub(r1.mul(r1)).div(d.mul(r2).mul(2)), -1, 1)));
  const kite = sqrt(max(r1.add(r2).sub(d).mul(d.add(r1).sub(r2)).mul(d.sub(r1).add(r2)).mul(d.add(r1).add(r2)), 0));
  return select(d.greaterThanEqual(r1.add(r2)), float(0), select(d.lessThanEqual(abs(r1.sub(r2))), r.mul(r).mul(Math.PI), a.add(b).sub(kite.mul(0.5))));
}

/**
 * The share of the lamp's light the ball lets through to `p`. Angles as seen from `p`: the lamp and the ball are discs
 * on its sky, and the ball hides their overlap.
 */
function ballShadowAt({ ball, lamp }: ColumnBallShadow, p: Node<'vec3'>): FloatNode {
  const toBall = ball.xyz.sub(p), toLamp = lamp.xyz.sub(p);
  const db = length(toBall), dl = length(toLamp);
  const ballAngle = asin(min(ball.w.div(db), 1)), lampAngle = asin(min(lamp.w.div(dl), 1));
  const apart = acos(clampNode(dot(toBall, toLamp).div(db.mul(dl)), -1, 1));
  const lit = discOverlap(lampAngle, ballAngle, apart).div(lampAngle.mul(lampAngle).mul(Math.PI)).oneMinus();
  return select(ball.w.lessThanEqual(0), float(1), select(db.lessThanEqual(ball.w), float(0), lit));
}

/** The share of sky the ball leaves `p` (facing `n`): a sphere's cosine-weighted share, Quilez's analytic occlusion. */
function ballOcclusionAt({ ball }: ColumnBallShadow, p: Node<'vec3'>, n: Node<'vec3'>): FloatNode {
  const toBall = ball.xyz.sub(p);
  const d = length(toBall);
  const hidden = max(dot(n, toBall.div(d)), 0).mul(min(ball.w.mul(ball.w).div(d.mul(d)), 1));
  return select(ball.w.lessThanEqual(0), float(1), hidden.oneMinus());
}

// ---------- the gaps' occlusion ----------

/** How much a column's gaps darken (`ao`) and tint (`bleed`) it, 0..1, and how wide a gap is in pitches. */
type ColumnGaps = { ao: number; bleed: number; gap: number };

// Per-instance, so flat: an interpolated packed colour could land an ulp off and unpack to another colour.
const flatVarying = <T>(node: Node<T>) => varying(node).setInterpolation(InterpolationSamplingType.FLAT);

const columnUnpack = (p: FloatNode) => {
  const r = floor(p.div(65536)), g = floor(p.sub(r.mul(65536)).div(256));
  return vec3(r, g, p.sub(r.mul(65536)).sub(g.mul(256))).div(255);
};

/**
 * A face across the gap from a taller neighbour loses the share of sky it hides (the sine of the angle up to its top),
 * plus half the others' share, and more near the ground. That neighbour bounces that share of the ambient light back
 * in its own colour, so a gap is never lit brighter than its stage.
 */
function occludeGaps(light: ReflectedLight, { ao, bleed, gap }: ColumnGaps) {
  const heights = flatVarying(attribute('columnNeighbourHeights', 'vec4'));
  const colors = flatVarying(attribute('columnNeighbourColors', 'vec4'));
  // Instances only move, and the field stands at the origin: world normals are the grid's axes, world y a column's.
  const cn = normalWorld, y = positionWorld.y;
  const facing = max(vec4(cn.x, cn.x.negate(), cn.z, cn.z.negate()), vec4(0)).toVar();
  const sides = max(dot(facing, vec4(1)), 1e-3).toVar();
  const rise = max(heights.sub(y), vec4(0));
  const hidden = rise.mul(inverseSqrt(rise.mul(rise).add(gap * gap))).toVar();
  const upright = clampNode(cn.y.oneMinus(), 0, 1);
  const front = dot(facing, hidden).div(sides), around = dot(hidden, vec4(1)).mul(0.25);
  const open = mix(around.mul(0.25).oneMinus(), front.oneMinus().mul(around.mul(0.5).oneMinus()).mul(exp(y.mul(-3)).mul(0.5).oneMinus()), upright);
  const occlusion = clampNode(open.oneMinus().mul(ao), 0, 0.95).toVar();
  const bounce = columnUnpack(colors.x).mul(facing.x.mul(hidden.x)).add(columnUnpack(colors.y).mul(facing.y.mul(hidden.y)))
    .add(columnUnpack(colors.z).mul(facing.z.mul(hidden.z))).add(columnUnpack(colors.w).mul(facing.w.mul(hidden.w)));
  light.indirectDiffuse.mulAssign(occlusion.oneMinus().add(bounce.mul(bleed).div(sides)));
  light.indirectSpecular.mulAssign(occlusion.oneMinus());
  light.directDiffuse.mulAssign(occlusion.mul(0.4).oneMinus());
}

// ---------- the materials ----------

/** The light a surface reflects, as three's lighting context holds it while it shades: four sums of light. */
type ReflectedLight = Record<'directDiffuse' | 'directSpecular' | 'indirectDiffuse' | 'indirectSpecular', Node<'vec3'>>;

const isReflectedLight = (value: unknown): value is ReflectedLight => typeof value === 'object' && value !== null
  && ['directDiffuse', 'directSpecular', 'indirectDiffuse', 'indirectSpecular'].every((key) => key in value);

/** three's lighting context while it shades, which its types leave unknown: it holds the light reflected so far. */
const isLightingContext = (context: unknown): context is { reflectedLight: ReflectedLight } => typeof context === 'object' && context !== null
  && 'reflectedLight' in context && isReflectedLight(context.reflectedLight);

// A colour node is a vec3 in the shader; three names a Color uniform's type 'color'.
const isVec3Node = (node: Node, builder: NodeBuilder): node is Node<'vec3'> => ['vec3', 'color'].includes(node.getNodeType(builder));

function reflectedLightOf({ context }: NodeBuilder): ReflectedLight {
  if (!isLightingContext(context)) throw new Error('column field: three\'s lighting context holds no reflected light to occlude');
  return context.reflectedLight;
}

/**
 * three's physical light, with the ball's shadow on the pool and its occlusion and the gaps' on the room. Occlusion
 * runs last, once every light and the room are in, so it scales their totals.
 */
class ColumnFieldLightingModel extends PhysicalLightingModel {
  readonly #ballShadow: ColumnBallShadow;
  readonly #gaps: ColumnGaps | null;

  constructor(ballShadow: ColumnBallShadow, gaps: ColumnGaps | null) {
    super();
    this.#ballShadow = ballShadow;
    this.#gaps = gaps;
  }

  override direct(input: LightingModelDirectInput, builder: NodeBuilder) {
    // The pool is the field's one spot light, and its shadow is the ball's alone: it casts no shadow map.
    if (!(input.lightNode instanceof SpotLightNode)) return super.direct(input, builder);
    const { lightColor } = input;
    if (!isVec3Node(lightColor, builder)) throw new Error('column field: three handed the pool\'s light over as something other than a colour');
    return super.direct({ ...input, lightColor: lightColor.mul(ballShadowAt(this.#ballShadow, positionWorld)) }, builder);
  }

  override ambientOcclusion(builder: NodeBuilder) {
    super.ambientOcclusion(builder);
    const light = reflectedLightOf(builder);
    const ball = ballOcclusionAt(this.#ballShadow, positionWorld, normalWorld).toVar();
    light.indirectDiffuse.mulAssign(ball);
    light.indirectSpecular.mulAssign(ball);
    if (this.#gaps) occludeGaps(light, this.#gaps);
  }
}

/** A surface of the field, column or ground, lit by ColumnFieldLightingModel. */
class ColumnFieldSurfaceMaterial extends MeshStandardNodeMaterial {
  readonly #ballShadow: ColumnBallShadow;
  readonly #gaps: ColumnGaps | null;

  constructor(parameters: ConstructorParameters<typeof MeshStandardNodeMaterial>[0], ballShadow: ColumnBallShadow, gaps: ColumnGaps | null) {
    super(parameters);
    this.#ballShadow = ballShadow;
    this.#gaps = gaps;
  }

  // three keys a built shader by the material's nodes, and the lighting model isn't one: without its uniforms in the
  // key, the next frame's surface would be drawn with this frame's ball.
  override customProgramCacheKey() {
    const { ball, lamp } = this.#ballShadow;
    return `${super.customProgramCacheKey()}|column-field ${ball.id} ${lamp.id} ${this.#gaps ? Object.values(this.#gaps).join(' ') : '-'}`;
  }

  override setupLightingModel() {
    return new ColumnFieldLightingModel(this.#ballShadow, this.#gaps);
  }
}

export function columnMaterial(column: { width: number; roughness: number; ao: number; bleed: number }, environment: Texture | null, reflect: number, ballShadow: ColumnBallShadow) {
  const material = new ColumnFieldSurfaceMaterial(
    { roughness: column.roughness, metalness: 0, envMap: environment, envMapIntensity: reflect }, ballShadow, { ao: column.ao, bleed: column.bleed, gap: 1 - column.width },
  );
  // Raises the tops by the column's height, in the shadow pass too, which draws a material's position node.
  material.positionNode = positionLocal.add(vec3(0, step(-0.5, positionLocal.y).mul(attribute('columnHeight', 'float')), 0));
  return material;
}

export function floorMaterial(color: string, environment: Texture | null, reflect: number, ballShadow: ColumnBallShadow) {
  return new ColumnFieldSurfaceMaterial({ color, roughness: 0.92, envMap: environment, envMapIntensity: reflect }, ballShadow, null);
}

export function ballMaterial(kind: NonNullable<ColumnBall['material']>, environment: Texture | null): Material {
  if (typeof kind === 'function') return kind(environment);
  if (kind === 'chrome') return new MeshStandardNodeMaterial({ color: '#ffffff', metalness: 1, roughness: 0.05, envMap: environment });
  if (kind === 'titanium') return columnTitaniumMaterial(environment);
  return new MeshPhysicalNodeMaterial({ color: '#e8461f', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMap: environment });
}

/**
 * Anodized titanium: grey metal coloured by interference in an oxide film `film` nm thick: 75–105 blue (violet
 * where thinner and at the rim), 25–40 bronze, 130–150 gold. Satin, so the softbox spreads rather than burning
 * white; the clear coat keeps a hard glint. Another colour: `(env) => columnTitaniumMaterial(env, [a, b])`.
 */
export function columnTitaniumMaterial(environment: Texture | null, film: readonly [number, number] = [75, 105]) {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const k = 0.5 + 0.4 * Math.sin(2 * Math.PI * (v + 0.08 * Math.sin(2 * Math.PI * u)));
      data.set([0, Math.round(clamp(k) * 255), 0, 255], 4 * (y * size + x));
    }
  }
  const bands = new DataTexture(data, size, size);
  bands.wrapS = bands.wrapT = RepeatWrapping;
  Object.assign(bands, { generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, needsUpdate: true });
  return new MeshPhysicalNodeMaterial({
    color: new Color().setRGB(0.62, 0.58, 0.55, LinearSRGBColorSpace), metalness: 1, roughness: 0.35,
    iridescence: 1, iridescenceIOR: 2.2, iridescenceThicknessRange: [...film], iridescenceThicknessMap: bands,
    clearcoat: 0.5, clearcoatRoughness: 0.05, envMap: environment, envMapIntensity: 2.2,
  });
}
