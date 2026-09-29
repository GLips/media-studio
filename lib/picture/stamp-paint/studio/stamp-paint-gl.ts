// stamp-paint-gl.ts: the few WebGL2 pieces the stamp-paint renderer is built from: a checked context, programs,
// half-float render targets, textures from images, and ping-pong pairs for passes that read what they write.
//
// Every target is RGBA16F: a glaze lays each stamp at a few thousandths of its flow, which 8 bits would round away.

export type PaintGlBox = { x: number; y: number; w: number; h: number };

export type PaintGlTarget = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };

/** A target a pass reads (`read`) while it draws into `write`, then copies back within the box it drew. */
export type PaintGlPingPong = { read: PaintGlTarget; write: PaintGlTarget };

export type PaintGlProgram = {
  program: WebGLProgram;
  use: () => void;
  uniform: (name: string) => WebGLUniformLocation | null;
};

/** WebGL2 on `canvas`, with half-float targets, or a thrown error naming what the browser lacks. */
export function createPaintGl(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  // preserveDrawingBuffer: Remotion screenshots the page after the effect, and a cleared buffer would come out blank.
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error('stamp paint: this browser has no WebGL2, which stamp painting needs');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('stamp paint: this browser can\'t render to half-float targets (EXT_color_buffer_float)');
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  return gl;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`stamp paint: a shader didn't compile: ${gl.getShaderInfoLog(shader)}`);
  return shader;
}

export function createPaintGlProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): PaintGlProgram {
  const program = gl.createProgram()!;
  const shaders = [compileShader(gl, gl.VERTEX_SHADER, vertex), compileShader(gl, gl.FRAGMENT_SHADER, fragment)];
  for (const shader of shaders) gl.attachShader(program, shader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`stamp paint: a program didn't link: ${gl.getProgramInfoLog(program)}`);
  for (const shader of shaders) gl.deleteShader(shader);
  const locations = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    use: () => gl.useProgram(program),
    uniform: (name) => {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name)!;
    },
  };
}

/** Covers the viewport with one triangle, no buffers: a fragment pass reads its pixel from gl_FragCoord. */
export const FULL_FRAME_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

export function drawFullFrame(gl: WebGL2RenderingContext) {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function createPaintGlTarget(gl: WebGL2RenderingContext, width: number, height: number): PaintGlTarget {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('stamp paint: a half-float target is incomplete on this GPU');
  return { texture, framebuffer, width, height };
}

export function deletePaintGlTarget(gl: WebGL2RenderingContext, target: PaintGlTarget) {
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
}

export function createPaintGlPingPong(gl: WebGL2RenderingContext, width: number, height: number): PaintGlPingPong {
  return { read: createPaintGlTarget(gl, width, height), write: createPaintGlTarget(gl, width, height) };
}

/** Binds `target` for drawing, its whole area the viewport and `box` (in its pixels) the scissor. */
export function bindPaintGlTarget(gl: WebGL2RenderingContext, target: PaintGlTarget | null, box: PaintGlBox, size?: { width: number; height: number }) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
  const { width, height } = target ?? size!;
  gl.viewport(0, 0, width, height);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(box.x, box.y, box.w, box.h);
}

/** Draws into `pair.write` within `box` by `draw` (which reads `pair.read`), then copies that box back to `pair.read`. */
export function drawPaintGlPingPong(gl: WebGL2RenderingContext, pair: PaintGlPingPong, box: PaintGlBox, draw: () => void) {
  bindPaintGlTarget(gl, pair.write, box);
  draw();
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, pair.write.framebuffer);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, pair.read.framebuffer);
  const x1 = box.x + box.w, y1 = box.y + box.h;
  gl.blitFramebuffer(box.x, box.y, x1, y1, box.x, box.y, x1, y1, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/**
 * An image as a mipmapped texture, tiled or clamped, holding its red channel alone (a tip or grain, which is grey) or
 * its colour (a paper). A tip is sampled across a frame's whole stamp area, so a quarter of the bytes is a large
 * part of a frame's time. A grain's mean is its smallest mip, read in a shader. Tiles are mirrored: the pack's grains
 * aren't all seamless, and a mirrored tile never shows a seam.
 */
export function createPaintGlImageTexture(gl: WebGL2RenderingContext, image: TexImageSource, wrap: 'tile' | 'clamp', channels: 'red' | 'colour'): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (channels === 'red') gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, image);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const mode = wrap === 'tile' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode);
  return texture;
}

/** Binds `texture` to unit `unit` and points the sampler uniform `name` of `program` at it. */
export function bindPaintGlTexture(gl: WebGL2RenderingContext, program: PaintGlProgram, name: string, unit: number, texture: WebGLTexture | null) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(program.uniform(name), unit);
}
