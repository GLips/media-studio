// motion.ts: easing and progress helpers. Everything a scene draws is a function of its clock, so these are the
// whole vocabulary of change: `seg` turns a stretch of time into eased 0..1 progress.

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export type EaseFn = (k: number) => number;
export const linear: EaseFn = (k) => clamp(k);
export const ease: EaseFn = (k) => { k = clamp(k); return k * k * (3 - 2 * k); };
export const easeOut: EaseFn = (k) => 1 - Math.pow(1 - clamp(k), 3);
export const easeIn: EaseFn = (k) => Math.pow(clamp(k), 3);
export const easeInOut: EaseFn = (k) => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };

/** Progress 0..1 through [a, b], eased. */
export const seg = (t: number, a: number, b: number, fn: EaseFn = easeInOut) => fn(clamp((t - a) / (b - a)));
/** Eased 0→1 starting at `a`: things arriving. */
export const on = (t: number, a: number, len = 0.8) => seg(t, a, a + len);
/** Eased 1→0 starting at `a`: things leaving. */
export const off = (t: number, a: number, len = 0.4) => 1 - seg(t, a, a + len);
