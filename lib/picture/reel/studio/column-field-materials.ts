// column-field-materials.ts: the three objects the cube field is built from: each column's neighbours and colours,
// the rounded column, and the materials whose shaders raise the tops, occlude the gaps and shadow the ball's pool.

import * as THREE from 'three';
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
  const color = new THREE.Color();
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
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setIndex(index);
  return geometry;
}

const COLUMN_RAISE = /* glsl */ 'transformed.y += step( -0.5, transformed.y ) * columnHeight;';

// The neighbour data is flat: an interpolated packed colour could land an ulp off and unpack to another colour.
const COLUMN_VERTEX_HEAD = /* glsl */ `
attribute float columnHeight;
attribute vec4 columnNeighbourHeights;
attribute vec4 columnNeighbourColors;
varying float vColumnY;
flat varying vec4 vColumnNeighbourHeights;
flat varying vec4 vColumnNeighbourColors;
`;

const COLUMN_VERTEX_PASS = /* glsl */ `
vColumnY = transformed.y;
vColumnNeighbourHeights = columnNeighbourHeights;
vColumnNeighbourColors = columnNeighbourColors;
`;

const COLUMN_FRAGMENT_HEAD = /* glsl */ `
uniform float columnAo;
uniform float columnBleed;
uniform float columnGap;
varying float vColumnY;
flat varying vec4 vColumnNeighbourHeights;
flat varying vec4 vColumnNeighbourColors;
vec3 columnUnpack( float p ) {
	float r = floor( p / 65536.0 );
	float g = floor( ( p - r * 65536.0 ) / 256.0 );
	return vec3( r, g, p - r * 65536.0 - g * 256.0 ) / 255.0;
}
`;

// A face across the gap from a taller neighbour loses the share of sky it hides (the sine of the angle up to its
// top), plus half the others' share, and more near the ground. That neighbour bounces that share of the ambient light
// back in its own colour, so a gap is never lit brighter than its stage.
const COLUMN_OCCLUSION = /* glsl */ `
{
	// Instances only move, so world normals are the grid's axes.
	vec3 cn = normalize( vColumnWorldNormal );
	vec4 facing = max( vec4( cn.x, - cn.x, cn.z, - cn.z ), 0.0 );
	float sides = max( dot( facing, vec4( 1.0 ) ), 1e-3 );
	vec4 rise = max( vColumnNeighbourHeights - vColumnY, 0.0 );
	vec4 hidden = rise * inversesqrt( rise * rise + columnGap * columnGap );
	float upright = clamp( 1.0 - cn.y, 0.0, 1.0 );
	float front = dot( facing, hidden ) / sides, around = 0.25 * dot( hidden, vec4( 1.0 ) );
	float open = mix( 1.0 - 0.25 * around, ( 1.0 - front ) * ( 1.0 - 0.5 * around ) * ( 1.0 - 0.5 * exp( -3.0 * vColumnY ) ), upright );
	float occlusion = clamp( columnAo * ( 1.0 - open ), 0.0, 0.95 );
	vec3 bounce = facing.x * hidden.x * columnUnpack( vColumnNeighbourColors.x ) + facing.y * hidden.y * columnUnpack( vColumnNeighbourColors.y )
		+ facing.z * hidden.z * columnUnpack( vColumnNeighbourColors.z ) + facing.w * hidden.w * columnUnpack( vColumnNeighbourColors.w );
	reflectedLight.indirectDiffuse *= 1.0 - occlusion + columnBleed * bounce / sides;
	reflectedLight.indirectSpecular *= 1.0 - occlusion;
	reflectedLight.directDiffuse *= 1.0 - 0.4 * occlusion;
}
`;

export function columnMaterial(column: { width: number; roughness: number; ao: number; bleed: number }, environment: THREE.Texture | null, reflect: number, ballShadow: BallShadowUniforms) {
  const material = new THREE.MeshStandardMaterial({ roughness: column.roughness, metalness: 0, envMap: environment, envMapIntensity: reflect });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { columnAo: { value: column.ao }, columnBleed: { value: column.bleed }, columnGap: { value: 1 - column.width } });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${COLUMN_VERTEX_HEAD}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${COLUMN_RAISE}\n${COLUMN_VERTEX_PASS}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${COLUMN_FRAGMENT_HEAD}`).replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${COLUMN_OCCLUSION}`);
    patchBallShadow(shader, ballShadow);
  };
  material.customProgramCacheKey = () => 'column-field-column';
  return material;
}

export function floorMaterial(color: string, environment: THREE.Texture | null, reflect: number, ballShadow: BallShadowUniforms) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.92, envMap: environment, envMapIntensity: reflect });
  material.onBeforeCompile = (shader) => patchBallShadow(shader, ballShadow);
  material.customProgramCacheKey = () => 'column-field-floor';
  return material;
}

/** The ball (world centre, radius; 0 for none) and the pool's lamp (world centre, radius), set every exposure. */
export type BallShadowUniforms = { columnBall: { value: THREE.Vector4 }; columnLamp: { value: THREE.Vector4 } };

const WORLD_VERTEX_HEAD = /* glsl */ `
varying vec3 vColumnWorld;
varying vec3 vColumnWorldNormal;
`;

const WORLD_VERTEX_PASS = /* glsl */ `
vec4 columnWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
columnWorld = instanceMatrix * columnWorld;
#endif
vColumnWorld = ( modelMatrix * columnWorld ).xyz;
vColumnWorldNormal = mat3( modelMatrix ) * objectNormal;
`;

// Angles as seen from the shaded point: the lamp and the ball are discs on its sky, and the ball hides their overlap.
// The occlusion is a sphere's cosine-weighted share of the sky (Quilez's analytic sphere occlusion).
const BALL_FRAGMENT_HEAD = /* glsl */ `
uniform vec4 columnBall;
uniform vec4 columnLamp;
varying vec3 vColumnWorld;
varying vec3 vColumnWorldNormal;
float columnDiscOverlap( float r1, float r2, float d ) {
	if ( d >= r1 + r2 ) return 0.0;
	float r = min( r1, r2 );
	if ( d <= abs( r1 - r2 ) ) return PI * r * r;
	float a = r1 * r1 * acos( clamp( ( d * d + r1 * r1 - r2 * r2 ) / ( 2.0 * d * r1 ), -1.0, 1.0 ) );
	float b = r2 * r2 * acos( clamp( ( d * d + r2 * r2 - r1 * r1 ) / ( 2.0 * d * r2 ), -1.0, 1.0 ) );
	return a + b - 0.5 * sqrt( max( ( r1 + r2 - d ) * ( d + r1 - r2 ) * ( d - r1 + r2 ) * ( d + r1 + r2 ), 0.0 ) );
}
float columnBallShadow( vec3 p ) {
	if ( columnBall.w <= 0.0 ) return 1.0;
	vec3 toBall = columnBall.xyz - p, toLamp = columnLamp.xyz - p;
	float db = length( toBall ), dl = length( toLamp );
	if ( db <= columnBall.w ) return 0.0;
	float ball = asin( columnBall.w / db ), lamp = asin( min( columnLamp.w / dl, 1.0 ) );
	float apart = acos( clamp( dot( toBall, toLamp ) / ( db * dl ), -1.0, 1.0 ) );
	return 1.0 - columnDiscOverlap( lamp, ball, apart ) / ( PI * lamp * lamp );
}
float columnBallOcclusion( vec3 p, vec3 n ) {
	if ( columnBall.w <= 0.0 ) return 1.0;
	vec3 toBall = columnBall.xyz - p;
	float d = length( toBall );
	return 1.0 - max( dot( n, toBall / d ), 0.0 ) * min( columnBall.w * columnBall.w / ( d * d ), 1.0 );
}
`;

const BALL_OCCLUSION = /* glsl */ `
{
	float ballOcclusion = columnBallOcclusion( vColumnWorld, normalize( vColumnWorldNormal ) );
	reflectedLight.indirectDiffuse *= ballOcclusion;
	reflectedLight.indirectSpecular *= ballOcclusion;
}
`;

// The pool is the scene's one spot light; the ball's shadow darkens only its light.
const SPOT_LIGHT_ANCHOR = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';
const LIGHTS_WITH_BALL_SHADOW = THREE.ShaderChunk.lights_fragment_begin.replace(SPOT_LIGHT_ANCHOR, `${SPOT_LIGHT_ANCHOR}\n\t\tdirectLight.color *= columnBallShadow( vColumnWorld );`);

function patchBallShadow(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: BallShadowUniforms) {
  if (!THREE.ShaderChunk.lights_fragment_begin.includes(SPOT_LIGHT_ANCHOR)) throw new Error('column field: three\'s spot-light loop changed, so the ball\'s shadow has nowhere to go');
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WORLD_VERTEX_HEAD}`).replace('#include <project_vertex>', `${WORLD_VERTEX_PASS}\n#include <project_vertex>`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${BALL_FRAGMENT_HEAD}`)
    .replace('#include <lights_fragment_begin>', LIGHTS_WITH_BALL_SHADOW)
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${BALL_OCCLUSION}`);
}

/** The shadow pass's material, raising the tops as the columns' own does: three draws a custom depth material as is. */
export function columnDepthMaterial() {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float columnHeight;').replace('#include <begin_vertex>', `#include <begin_vertex>\n${COLUMN_RAISE}`);
  };
  material.customProgramCacheKey = () => 'column-field-depth';
  return material;
}

export function ballMaterial(kind: NonNullable<ColumnBall['material']>, environment: THREE.Texture | null): THREE.Material {
  if (typeof kind === 'function') return kind(environment);
  if (kind === 'chrome') return new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 1, roughness: 0.05, envMap: environment });
  if (kind === 'titanium') return columnTitaniumMaterial(environment);
  return new THREE.MeshPhysicalMaterial({ color: '#e8461f', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMap: environment });
}

/**
 * Anodized titanium: grey metal under an oxide film `film` nm thick, whose interference colours it: 75–105 is blue,
 * violet where the film thins and toward the rim, where light crosses it slanting; 25–40 bronze, 130–150 gold. Satin, so the overhead softbox
 * spreads over its crown rather than burning white; the clear coat keeps a hard glint. The film's slow bands show the
 * ball's turn. For another colour, pass it as a ball's `material`: `(env) => columnTitaniumMaterial(env, [a, b])`.
 */
export function columnTitaniumMaterial(environment: THREE.Texture | null, film: readonly [number, number] = [75, 105]) {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const k = 0.5 + 0.4 * Math.sin(2 * Math.PI * (v + 0.08 * Math.sin(2 * Math.PI * u)));
      data.set([0, Math.round(clamp(k) * 255), 0, 255], 4 * (y * size + x));
    }
  }
  const bands = new THREE.DataTexture(data, size, size);
  bands.wrapS = bands.wrapT = THREE.RepeatWrapping;
  Object.assign(bands, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, needsUpdate: true });
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.62, 0.58, 0.55, THREE.LinearSRGBColorSpace), metalness: 1, roughness: 0.35,
    iridescence: 1, iridescenceIOR: 2.2, iridescenceThicknessRange: [...film], iridescenceThicknessMap: bands,
    clearcoat: 0.5, clearcoatRoughness: 0.05, envMap: environment, envMapIntensity: 2.2,
  });
}
