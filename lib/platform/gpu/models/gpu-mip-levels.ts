// gpu-mip-levels.ts: how many mip levels a texture has, as WebGPU counts them.

/** How many mip levels a `width` × `height` texture has: each half the one above, rounded down, to 1 × 1. */
export const gpuMipLevelCount = (width: number, height: number) => Math.floor(Math.log2(Math.max(width, height))) + 1;
