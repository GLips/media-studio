// random.ts: randomness that is the same on every render, for generative pieces (grids, particles, scatter). A frame
// must be a pure function of time, so nothing here reads Math.random or the clock: a piece seeds its own stream.

/** A stream of numbers in [0, 1) from `seed` (a number or any string), the same sequence every time (mulberry32). */
export function seededRandom(seed: number | string): () => number {
  let a = randomSeedFromKey(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One number in [0, 1) for a key, e.g. `hashRandom('cell', 12, 4)`: a stable per-item value without a stream. */
export const hashRandom = (...key: (string | number)[]) => seededRandom(key.join('|'))();

/** A 32-bit seed for a number or any string (FNV-1a), e.g. an event id a sound is seeded from. */
export function randomSeedFromKey(key: number | string): number {
  if (typeof key === 'number') return key >>> 0;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}
