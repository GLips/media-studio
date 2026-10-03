// png-decode.ts: a PNG's pixels as 8-bit RGBA, exactly as written, in the browser and in Node alike (both inflate
// through DecompressionStream). Straight alpha, no colour management: an image's bytes, not how a page would show it.
// Negative space: 8-bit grey, grey-alpha, RGB and RGBA, not interlaced; anything else is refused, not converted.

/** A decoded PNG: `w` × `h` texels of straight-alpha 8-bit RGBA, row by row. */
export type PngRgba = { readonly w: number; readonly h: number; readonly data: Uint8Array };

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Channels a texel by colour type: grey, RGB, grey-alpha, RGBA. */
const PNG_CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };
/** Which channel of a texel is alpha, by colour type; grey and RGB have none. */
const PNG_ALPHA_CHANNEL: Readonly<Record<number, number | undefined>> = { 4: 1, 6: 3 };

async function inflated(compressed: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The Paeth predictor (PNG spec 9.4): whichever of left, above and upper-left lies nearest left + above − upper-left. */
function paeth(a: number, b: number, c: number) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Each row filter's prediction (PNG spec 9.2) from the texel left, above and upper-left, by its number. */
const PNG_FILTERS: readonly ((a: number, b: number, c: number) => number)[] = [() => 0, (a) => a, (_, b) => b, (a, b) => (a + b) >> 1, paeth];

/** `bytes`, a PNG file named `name` (for its errors), decoded. */
export async function decodePngRgba(bytes: Uint8Array, name: string): Promise<PngRgba> {
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) throw new Error(`png: ${name} isn't a PNG`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), idat: Uint8Array[] = [];
  let header: { w: number; h: number; depth: number; colour: number; interlace: number } | null = null;
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at), type = String.fromCharCode(...bytes.subarray(at + 4, at + 8)), body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = { w: view.getUint32(at + 8), h: view.getUint32(at + 12), depth: body[8], colour: body[9], interlace: body[12] };
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!header) throw new Error(`png: ${name} has no header`);
  const { w, h, depth, colour, interlace } = header, channels = PNG_CHANNELS[colour];
  if (depth !== 8 || !channels || interlace) throw new Error(`png: ${name} is ${depth}-bit colour type ${colour}${interlace ? ', interlaced' : ''}; only 8-bit grey, grey-alpha, RGB and RGBA, not interlaced, are read`);
  const compressed = new Uint8Array(idat.reduce((sum, chunk) => sum + chunk.length, 0));
  idat.reduce((offset, chunk) => (compressed.set(chunk, offset), offset + chunk.length), 0);
  const raw = await inflated(compressed), stride = w * channels;
  if (raw.length !== h * (stride + 1)) throw new Error(`png: ${name}'s image data is ${raw.length} bytes, and ${w} × ${h} takes ${h * (stride + 1)}`);
  // Unfiltered in place, row by row: each filter reads the row above as already unfiltered.
  const rows = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)], from = y * (stride + 1) + 1, row = y * stride, above = row - stride, predict = PNG_FILTERS[filter];
    if (!predict) throw new Error(`png: ${name}'s row ${y} has filter ${filter}, which PNG doesn't have`);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? rows[row + x - channels] : 0, b = y ? rows[above + x] : 0, c = x >= channels && y ? rows[above + x - channels] : 0;
      rows[row + x] = raw[from + x] + predict(a, b, c);
    }
  }
  const data = new Uint8Array(w * h * 4), alpha = PNG_ALPHA_CHANNEL[colour];
  for (let t = 0; t < w * h; t++) {
    const s = t * channels, d = t * 4;
    if (channels <= 2) data.fill(rows[s], d, d + 3);
    else data.set(rows.subarray(s, s + 3), d);
    data[d + 3] = alpha === undefined ? 255 : rows[s + alpha];
  }
  return { w, h, data };
}
