// Lets a node:test file, or a command or script reading a video in Node (`studio mix`'s sound check), load .tsx:
// import this first, then the module dynamically (a static import would load before this module runs). Node strips
// types from .ts but can't read JSX, so .tsx is transpiled with esbuild (a pinned dependency) as it loads. What only
// a bundler or a browser does at import stands in: an asset import (a face, a sound) is its file URL, and
// @remotion/fonts' loadFont settles at once.

import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ASSET_FILE = /\.(ttf|otf|woff2?|wav|mp3|png|jpe?g|webp)$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@remotion/fonts') {
      return { url: 'data:text/javascript,export const loadFont = () => Promise.resolve();', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (ASSET_FILE.test(url)) return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url)};` };
    if (!url.endsWith('.tsx')) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), 'utf8');
    return { format: 'module', shortCircuit: true, source: transformSync(source, { loader: 'tsx', jsx: 'automatic', format: 'esm', sourcefile: url }).code };
  },
});
