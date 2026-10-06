// text-sha256.ts: SHA-256 (FIPS 180-4) of text as its UTF-8, fed a piece at a time and synchronously, alike in Node
// and the browser. WebCrypto hashes only a whole buffer and only asynchronously, so text written out as it's made (a
// canonical encoding of megabytes of marks) would have to be held whole first; this hashes it as it comes.

const ROUND_CONSTANTS = Int32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_STATE = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** A SHA-256 being fed: `update` adds text's UTF-8 (a lone surrogate as U+FFFD, as TextEncoder writes it); `hex` ends it. */
export type TextSha256 = { readonly update: (text: string) => void; readonly hex: () => string };

/** A SHA-256 of nothing yet. Once `hex` has been read it takes nothing more. */
export function createTextSha256(): TextSha256 {
  const state = Int32Array.from(INITIAL_STATE), block = new Uint8Array(64), words = new Int32Array(64);
  let filled = 0, bytes = 0, ended = false;

  const compress = () => {
    for (let t = 0; t < 16; t++) words[t] = (block[4 * t] << 24) | (block[4 * t + 1] << 16) | (block[4 * t + 2] << 8) | block[4 * t + 3];
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

  const push = (byte: number) => {
    block[filled++] = byte;
    if (filled === 64) {
      compress();
      filled = 0;
    }
  };

  /** A code point above ASCII as its UTF-8, a surrogate standing alone as U+FFFD. */
  const pushWide = (point: number) => {
    const code = point >= 0xd800 && point < 0xe000 ? 0xfffd : point;
    if (code < 0x800) {
      push(0xc0 | (code >> 6));
      push(0x80 | (code & 0x3f));
      bytes += 2;
    } else if (code < 0x10000) {
      push(0xe0 | (code >> 12));
      push(0x80 | ((code >> 6) & 0x3f));
      push(0x80 | (code & 0x3f));
      bytes += 3;
    } else {
      push(0xf0 | (code >> 18));
      push(0x80 | ((code >> 12) & 0x3f));
      push(0x80 | ((code >> 6) & 0x3f));
      push(0x80 | (code & 0x3f));
      bytes += 4;
    }
  };

  // A high surrogate ending one piece waits for the next's first unit: a pair split between pieces is one character.
  let high = -1;

  return {
    update: (text) => {
      if (ended) throw new Error('text sha256: fed after its hex was read');
      const n = text.length;
      let i = 0;
      while (i < n) {
        if (high < 0) {
          // A run of ASCII, the bulk of any canonical text, straight into the block.
          let f = filled;
          const start = i;
          for (let code = text.charCodeAt(i); code < 0x80; code = text.charCodeAt(i)) {
            block[f++] = code;
            if (f === 64) {
              compress();
              f = 0;
            }
            if (++i === n) break;
          }
          filled = f;
          bytes += i - start;
          if (i === n) return;
        }
        const code = text.charCodeAt(i++);
        if (high >= 0) {
          const paired = code >= 0xdc00 && code < 0xe000;
          pushWide(paired ? 0x10000 + ((high - 0xd800) << 10) + (code - 0xdc00) : high);
          high = -1;
          // A unit that doesn't pair is read again, on its own.
          if (!paired) i--;
        } else if (code >= 0xd800 && code < 0xdc00) high = code;
        else pushWide(code);
      }
    },
    hex: () => {
      if (!ended) {
        ended = true;
        if (high >= 0) pushWide(high);
        const bits = bytes * 8;
        push(0x80);
        for (let pad = (120 - filled) % 64; pad > 0; pad--) push(0);
        for (const word of [Math.floor(bits / 2 ** 32), bits >>> 0]) for (let shift = 24; shift >= 0; shift -= 8) push((word >>> shift) & 0xff);
      }
      return Array.from(state, (word) => (word >>> 0).toString(16).padStart(8, '0')).join('');
    },
  };
}

/** `text`'s SHA-256, as hex. */
export function textSha256Hex(text: string): string {
  const hash = createTextSha256();
  hash.update(text);
  return hash.hex();
}
