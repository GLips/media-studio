// lab-manifest.ts: the page's one load of lab-manifest.json (lab/manifest.ts), shared by every tab. Fetched relative to
// the page, so the lab works served locally and exported to any folder of any host.
import { useEffect, useState } from 'react';
import type { LabManifest } from '../manifest.ts';

let loading: Promise<LabManifest> | undefined;

export function loadLabManifest(): Promise<LabManifest> {
  loading ??= fetch('lab-manifest.json').then((r) => r.json() as Promise<LabManifest>);
  return loading;
}

/** The manifest, or undefined until it has loaded. */
export function useLabManifest(): LabManifest | undefined {
  const [manifest, setManifest] = useState<LabManifest>();
  useEffect(() => {
    void loadLabManifest().then(setManifest);
  }, []);
  return manifest;
}
