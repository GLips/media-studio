// sha256.ts: SHA-256 (FIPS 180-4), fed bytes a run at a time and synchronously, alike in Node and the browser.
// WebCrypto hashes only a whole buffer and only asynchronously, so an encoding written out as it's made (megabytes of
// marks, stamp-canonical.ts) would have to be held whole first; this hashes it as it comes.

const ROUND_CONSTANTS = Int32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_STATE = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** A SHA-256 being fed: `update` adds `bytes` from `from` up to `to`; `hex` ends it. */
export type Sha256 = { readonly update: (bytes: Uint8Array, from?: number, to?: number) => void; readonly hex: () => string };

/** A SHA-256 of nothing yet. Once `hex` has been read it takes nothing more. */
export function createSha256(): Sha256 {
  const state = Int32Array.from(INITIAL_STATE), words = new Int32Array(64), block = new Uint8Array(128);
  let filled = 0, length = 0, ended = false;

  /** Hashes the 64 bytes of `bytes` at `at`. */
  const compress = (bytes: Uint8Array, at: number) => {
    for (let t = 0, o = at; t < 16; t++, o += 4) words[t] = (bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3];
    for (let t = 16; t < 64; t++) {
      const w15 = words[t - 15], w2 = words[t - 2];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      words[t] = (words[t - 16] + s0 + words[t - 7] + s1) | 0;
    }
    let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + ROUND_CONSTANTS[t] + words[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
    state[5] += f;
    state[6] += g;
    state[7] += h;
  };

  return {
    update: (bytes, from = 0, to = bytes.length) => {
      if (ended) throw new Error('sha256: fed after its hex was read');
      length += to - from;
      let at = from;
      if (filled) {
        const taken = Math.min(64 - filled, to - at);
        block.set(bytes.subarray(at, at + taken), filled);
        filled += taken;
        at += taken;
        if (filled < 64) return;
        compress(block, 0);
        filled = 0;
      }
      // Whole blocks straight from the caller's bytes; what's left waits in `block`.
      for (; at + 64 <= to; at += 64) compress(bytes, at);
      block.set(bytes.subarray(at, to));
      filled = to - at;
    },
    hex: () => {
      if (!ended) {
        ended = true;
        // The padding: a 1 bit, zeros, and the length in bits, big-endian, ending the last block.
        const bits = length * 8, high = Math.floor(bits / 2 ** 32), low = bits >>> 0;
        block[filled++] = 0x80;
        const end = filled <= 56 ? 64 : 128;
        block.fill(0, filled, end - 8);
        for (let i = 0; i < 4; i++) {
          block[end - 8 + i] = (high >>> (24 - 8 * i)) & 0xff;
          block[end - 4 + i] = (low >>> (24 - 8 * i)) & 0xff;
        }
        for (let at = 0; at < end; at += 64) compress(block, at);
      }
      return Array.from(state, (word) => (word >>> 0).toString(16).padStart(8, '0')).join('');
    },
  };
}

const textEncoder = new TextEncoder();

/** `text`'s SHA-256, of its UTF-8 (a lone surrogate as U+FFFD, as TextEncoder writes it), as hex. */
export function textSha256Hex(text: string): string {
  const hash = createSha256();
  hash.update(textEncoder.encode(text));
  return hash.hex();
}
