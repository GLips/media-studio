// paint-rig-piece-meshes.ts: a posed rig's pieces (paint-rig-pieces.ts) as three.js meshes, drawn on the GPU: each
// piece's picture a half-float texture, its posed triangles a mesh sampling it at their rest points, laid in order
// over those before it. A source places the meshes on its plane; a tool draws them offscreen
// (paint-rig-pieces-draw.ts).
//
// Each mesh moves of itself (lens-three-motion.ts), so a three plane's motion layer follows the posed vertices, not
// only the plane. Its colour leaves the shader unpremultiplied for NormalBlending to premultiply again: the render
// stays premultiplied, as painted-three-sources.ts asks.

import {
  BufferAttribute, BufferGeometry, ClampToEdgeWrapping, DataTexture, DoubleSide, Group, HalfFloatType, LinearFilter, Mesh, MeshBasicNodeMaterial, NormalBlending, RGBAFormat,
} from 'three/webgpu';
import { attribute, max, texture } from 'three/tsl';
import { gpuHalfBitsOf } from '#lib/platform/gpu/models/gpu-half-float.ts';
import { lensThreeMovesOfItself } from '#lib/picture/lens/studio/lens-three-motion.ts';
import type { PaintRigPicture, PaintRigPiece } from '../models/paint-rig-pieces.ts';

/** The attribute a piece's vertices carry their rest point in, as a uv over its picture. */
const REST_UV = 'paintRigRestUv';

export type PaintRigPieceMeshes = {
  /** The meshes, in plane px (x right, y down) at z 0: place it on its plane. */
  readonly object: Group;
  /** Shows `pieces` and no others, each drawn over those before it. A picture appears at most once. */
  readonly show: (pieces: readonly PaintRigPiece[]) => void;
  /** Lets go of every mesh, geometry and material made, and the textures unless they were handed in. */
  readonly dispose: () => void;
};

/** Pictures as textures, each uploaded once however many meshes draw it (a figure and its reflection). */
export type PaintRigPictureTextures = { readonly of: (picture: PaintRigPicture) => DataTexture; readonly dispose: () => void };

/** A texture three samples bilinearly for each picture, clear past its edge (it has a clear texel round its paint). */
export function createPaintRigPictureTextures(): PaintRigPictureTextures {
  const made = new Map<PaintRigPicture, DataTexture>();
  return {
    of: (picture) => {
      let held = made.get(picture);
      if (!held) {
        held = new DataTexture(gpuHalfBitsOf(picture.rgba), picture.w, picture.h, RGBAFormat, HalfFloatType);
        Object.assign(held, { magFilter: LinearFilter, minFilter: LinearFilter, wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping, generateMipmaps: false, flipY: false, needsUpdate: true });
        made.set(picture, held);
      }
      return held;
    },
    dispose: () => {
      for (const held of made.values()) held.dispose();
      made.clear();
    },
  };
}

type PieceMesh = Mesh<BufferGeometry, MeshBasicNodeMaterial>;

/** A mesh drawing `made` through whatever triangles it's given. */
function pieceMesh(made: DataTexture): PieceMesh {
  const sampled = texture(made, attribute(REST_UV, 'vec2'));
  // Unpremultiplied for NormalBlending's own multiply: where nothing is painted the colour is unread.
  const material = new MeshBasicNodeMaterial({ transparent: true, blending: NormalBlending, depthTest: false, depthWrite: false, side: DoubleSide });
  material.colorNode = sampled.rgb.div(max(sampled.a, 1e-4));
  material.opacityNode = sampled.a;
  const mesh: PieceMesh = new Mesh(new BufferGeometry(), material);
  mesh.frustumCulled = false;
  return mesh;
}

/** Writes `triangles` into `mesh`'s geometry: posed points as positions, rest points as uvs over `picture`. */
function setTriangles(mesh: PieceMesh, { x0, y0, w, h }: PaintRigPicture, triangles: Float32Array) {
  const { geometry } = mesh, count = triangles.length / 4;
  if (geometry.getAttribute('position')?.count !== count) {
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute(REST_UV, new BufferAttribute(new Float32Array(count * 2), 2));
    lensThreeMovesOfItself(geometry);
  }
  const position = geometry.getAttribute('position'), rest = geometry.getAttribute(REST_UV);
  const positions = position.array, uvs = rest.array;
  for (let v = 0; v < count; v++) {
    positions[3 * v] = triangles[4 * v];
    positions[3 * v + 1] = triangles[4 * v + 1];
    positions[3 * v + 2] = 0;
    uvs[2 * v] = (triangles[4 * v + 2] - x0) / w;
    uvs[2 * v + 1] = (triangles[4 * v + 3] - y0) / h;
  }
  position.needsUpdate = true;
  rest.needsUpdate = true;
}

/**
 * Meshes for the pieces of a posed rig, one for each picture it's shown, kept for as long as it lives; their
 * pictures' textures from `shared`, else of their own.
 */
export function createPaintRigPieceMeshes(shared?: PaintRigPictureTextures): PaintRigPieceMeshes {
  const object = new Group(), made = new Map<PaintRigPicture, PieceMesh>(), textures = shared ?? createPaintRigPictureTextures();
  return {
    object,
    show: (pieces) => {
      const shown = new Set<PaintRigPicture>();
      pieces.forEach(({ picture, triangles }, order) => {
        if (shown.has(picture)) throw new Error('paint rig: a picture is shown twice in one pose; each piece has its own');
        shown.add(picture);
        // A clear cel (a wing at rest behind the body) draws nothing, and a texture can't be empty.
        if (!picture.w || !picture.h) return;
        let mesh = made.get(picture);
        if (!mesh) {
          mesh = pieceMesh(textures.of(picture));
          made.set(picture, mesh);
          object.add(mesh);
        }
        setTriangles(mesh, picture, triangles);
        mesh.renderOrder = order;
        mesh.visible = true;
      });
      for (const [picture, mesh] of made) if (!shown.has(picture)) mesh.visible = false;
    },
    dispose: () => {
      for (const mesh of made.values()) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      if (!shared) textures.dispose();
      made.clear();
      object.clear();
    },
  };
}
