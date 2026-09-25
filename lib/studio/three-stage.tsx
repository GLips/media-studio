// three-stage.tsx: a three.js scene drawn onto the frame, once per frame, from props alone, with the lens effects a
// real camera gives (depth of field, bloom). The pattern is blockout.tsx's: nothing but the renderer and its effect
// passes outlives a frame, so any frame renders the same whether or not the one before it did, which is what
// Remotion's parallel tabs need. `draw` builds the frame's scene and camera from scratch; the stage disposes every
// geometry, material and texture in it after rendering.

import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { H, W } from './frame.ts';
import { unmeasuredAttrs } from './motion-tag.ts';

export type ThreeFrame = { scene: THREE.Scene; camera: THREE.PerspectiveCamera };

/**
 * Depth of field: `focus` is the distance in scene units from the camera that's sharp, `aperture` how fast blur grows
 * away from it (0.002–0.02 for a scene a few units deep), `maxBlur` its cap (0.005–0.02).
 */
export type ThreeDepthOfField = { focus: number; aperture: number; maxBlur: number };
/** Bloom: light above `threshold` (0..1 of white) glows, `strength` 0.3–1.5, `radius` 0..1 how far. */
export type ThreeBloom = { strength: number; radius: number; threshold: number };

/**
 * Draws `draw()`'s scene through its camera over the whole frame (or `box`). `dof` and `bloom` add the lens; leave
 * them out for a plain render. `transparent` keeps the canvas clear where nothing is drawn, so a stage can sit over
 * React layers. `environment` lights the scene with a soft studio room, which metal and gloss need to look like
 * anything (a scene that sets its own `scene.environment` keeps it). The motion tracks can't see inside a stage: tag
 * what the viewer must read in React on top.
 */
export function ThreeStage({ draw, dof, bloom, transparent = false, box = { x: 0, y: 0, w: W, h: H }, shadows = false, environment = false }: {
  draw: () => ThreeFrame;
  dof?: ThreeDepthOfField;
  bloom?: ThreeBloom;
  transparent?: boolean;
  box?: { x: number; y: number; w: number; h: number };
  shadows?: boolean;
  environment?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const gl = useRef<{ renderer: THREE.WebGLRenderer; composer: EffectComposer; room?: THREE.Texture } | null>(null);

  useLayoutEffect(() => {
    if (!gl.current) {
      // preserveDrawingBuffer: Remotion screenshots the page after this effect, and a cleared buffer would come out blank.
      const renderer = new THREE.WebGLRenderer({ canvas: canvas.current!, antialias: true, alpha: transparent, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(box.w, box.h, false);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      gl.current = { renderer, composer: new EffectComposer(renderer) };
    }
    const { renderer, composer } = gl.current;
    renderer.shadowMap.enabled = shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const { scene, camera } = draw();
    // The room is prefiltered once per renderer and kept: it's the same every frame, and costly to build.
    if (environment && !scene.environment) {
      if (!gl.current.room) {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const room = new RoomEnvironment();
        gl.current.room = pmrem.fromScene(room, 0.04).texture;
        room.dispose();
        pmrem.dispose();
      }
      scene.environment = gl.current.room;
    }
    camera.aspect = box.w / box.h;
    camera.updateProjectionMatrix();

    // Passes are rebuilt each frame, as the scene is: a pass holds its scene and camera, and both are new.
    for (const pass of [...composer.passes]) {
      composer.removePass(pass);
      pass.dispose();
    }
    composer.addPass(new RenderPass(scene, camera));
    if (dof) composer.addPass(new BokehPass(scene, camera, { focus: dof.focus, aperture: dof.aperture, maxblur: dof.maxBlur }));
    if (bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(box.w, box.h), bloom.strength, bloom.radius, bloom.threshold));
    composer.addPass(new OutputPass());
    composer.setSize(box.w, box.h);
    composer.render();

    disposeScene(scene, gl.current.room);
  });
  // Scrubbing the Studio mounts a stage per scene, and Chrome drops contexts past about 16 live ones.
  useLayoutEffect(() => () => {
    if (!gl.current) return;
    for (const pass of gl.current.composer.passes) pass.dispose();
    gl.current.composer.dispose();
    gl.current.room?.dispose();
    gl.current.renderer.forceContextLoss();
    gl.current.renderer.dispose();
    gl.current = null;
  }, []);

  return <canvas ref={canvas} {...unmeasuredAttrs('three.js scene')} width={box.w} height={box.h} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }} />;
}

function disposeScene(scene: THREE.Scene, keep?: THREE.Texture) {
  const materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line || object instanceof THREE.InstancedMesh) {
      object.geometry.dispose();
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) materials.add(m);
    }
    if ((object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight || object instanceof THREE.PointLight) && object.castShadow) object.shadow.dispose();
  });
  for (const m of materials) {
    for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
    m.dispose();
  }
  if (scene.environment && scene.environment !== keep) scene.environment.dispose();
  if (scene.background instanceof THREE.Texture) scene.background.dispose();
}
