// use-gltf-cue-model.ts: a scene's imported model, loaded once per page and held until it is ready. A ThreeStage draw is
// synchronous, so the frame waits here (delayRender) for the parse, then every frame poses the same loaded model.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDelayRender } from 'remotion';
import type { GltfCueManifest } from '#lib/picture/character/models/gltf-cue-character.ts';
import { gltfCueGlbBytes, loadGltfCueModel, type GltfCueModel, type GltfRootMotion } from './gltf-cue-model.ts';

const loads = new Map<string, Promise<GltfCueModel<GltfCueManifest>>>();
const loaded = new Map<string, GltfCueModel<GltfCueManifest>>();

/** The model in `glbBase64`, checked against `manifest`, or null until it has loaded. `name` keys it on the page. */
export function useGltfCueModel<const M extends GltfCueManifest>(name: string, glbBase64: string, manifest: M, rootMotion: GltfRootMotion = 'keep'): GltfCueModel<M> | null {
  // SAFETY: a name is loaded with one manifest per page, so the model kept under it was checked against M.
  const [model, setModel] = useState(() => (loaded.get(name) as GltfCueModel<M> | undefined) ?? null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  // Held from the first render, not from an effect: an effect runs after the first frame may already have been taken.
  const [handle] = useState(() => (model ? null : delayRender(`loading the model ${name}`)));
  useEffect(() => {
    if (handle === null) return undefined;
    let live = true;
    let load = loads.get(name);
    if (!load) loads.set(name, (load = loadGltfCueModel(name, gltfCueGlbBytes(glbBase64), manifest, rootMotion)));
    load.then((made) => {
      loaded.set(name, made);
      // SAFETY: as above, one manifest per name.
      if (live) setModel(made as GltfCueModel<M>);
      return null;
    }, cancelRender);
    return () => {
      live = false;
    };
  }, [handle, name, glbBase64, manifest, rootMotion, cancelRender]);
  // Released once the model is drawn, not when it loads: the frame must wait for the stage the model mounts, whose own
  // hold starts in its effects, which run before this one.
  const held = useRef(handle !== null);
  const release = useCallback(() => {
    if (held.current && handle !== null) continueRender(handle);
    held.current = false;
  }, [handle, continueRender]);
  useEffect(() => {
    if (model) release();
  }, [model, release]);
  useEffect(() => release, [release]);
  return model;
}
