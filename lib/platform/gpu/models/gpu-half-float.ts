// gpu-half-float.ts: IEEE half floats, as an rgba16float texture holds them, written from and read into numbers.

/** `values` as half floats' bits, rounded to nearest; one past the largest half is infinite, one below the least normal 0. */
export function gpuHalfBitsOf(values: Float32Array): Uint16Array {
  const words = new Uint32Array(values.buffer, values.byteOffset, values.length), halves = new Uint16Array(values.length);
  for (let i = 0; i < words.length; i++) {
    const bits = words[i], sign = (bits >>> 16) & 0x8000, exponent = ((bits >>> 23) & 0xff) - 112, mantissa = bits & 0x7fffff;
    if (exponent <= 0) halves[i] = sign;
    else if (exponent >= 31) halves[i] = sign | 0x7c00;
    // Rounding may carry into the exponent, which the bits then hold correctly.
    else halves[i] = sign + ((exponent << 10) | (mantissa >> 13)) + ((mantissa >> 12) & 1);
  }
  return halves;
}

/** `v` as a half float's bits, as gpuHalfBitsOf rounds it. */
export const gpuHalfBits = (v: number): number => gpuHalfBitsOf(Float32Array.of(v))[0];

/** A half float's bits as a number. */
export function gpuHalfValue(bits: number): number {
  const exponent = (bits >> 10) & 0x1f, fraction = bits & 0x3ff, sign = bits & 0x8000 ? -1 : 1;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}
