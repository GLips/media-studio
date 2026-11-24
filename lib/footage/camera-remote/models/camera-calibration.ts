// camera-calibration.ts: how calibration reads a face and what it changes next. Pure. The camera's aperture and
// shutter stay where they are (the look and the frame rate own them); calibration moves ISO and white balance only,
// a step per frame, until the face's brightness and warmth sit on their targets.

/** A face's box in a frame, each value a fraction of the frame, origin top-left. */
export type FaceBox = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** An 8-bit RGB frame, rows top-down, three bytes a pixel. */
export type RgbFrame = { readonly width: number; readonly height: number; readonly pixels: Uint8Array };

/**
 * What calibration reads off the skin: `luma` its Rec.709 brightness (0–255, as encoded), `warmth` how far red
 * sits above blue, (r − b) / (r + g + b), so white balance moves it and exposure barely does.
 */
export type SkinReading = { readonly luma: number; readonly warmth: number };

/** The camera settings calibration moves. */
export type CalibratedSettings = { readonly whiteBalanceKelvin: number; readonly iso: number };

export type CalibrationTargets = {
  readonly skinLuma: number;
  readonly skinWarmth: number;
  /** The highest ISO calibration may choose: past it noise costs more than a dim face. */
  readonly maxIso: number;
};

/**
 * Read off HDMI frames Graham approved (lamp off, monitor light, PP5 Cine1, 4400K, ISO 800): skin luma 122, warmth
 * 0.157. A take read 0.225 looked orange to him; 3000K's 0.024 looked cold and pale.
 */
export const DEFAULT_CALIBRATION_TARGETS: CalibrationTargets = { skinLuma: 120, skinWarmth: 0.16, maxIso: 3200 };

/** Close enough to stop: within this fraction of the luma target and this much warmth. */
const LUMA_TOLERANCE = 0.08;
// Frame to frame, a monitor-lit face's warmth wanders about 0.01 with what's on screen.
const WARMTH_TOLERANCE = 0.02;
// Encoded luma rises about 2^(1/2.2) per stop, so a ratio's stops are its log2 times 2.2.
const ENCODING_GAMMA = 2.2;
const MAX_STOPS_PER_STEP = 2;
// Measured on the a6400 in Cine1 under monitor light: 1000K moved skin warmth 0.11 near 3500K and 0.04 near 5200K.
// The middle slope, with the step held to 1200K, so one reading can't swing far past its target.
const KELVIN_PER_WARMTH = 1000 / 0.07;
const MAX_KELVIN_STEP = 1200;
const KELVIN_RANGE = { min: 2500, max: 9900 } as const;

/**
 * The skin's reading inside `face`: its middle (cheeks, nose, forehead below the brows), away from hair, beard
 * and the box's background corners.
 */
export function readSkin(frame: RgbFrame, face: FaceBox): SkinReading {
  const left = Math.floor((face.x + face.width * 0.25) * frame.width);
  const right = Math.ceil((face.x + face.width * 0.75) * frame.width);
  const top = Math.floor((face.y + face.height * 0.2) * frame.height);
  const bottom = Math.ceil((face.y + face.height * 0.6) * frame.height);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let row = Math.max(0, top); row < Math.min(frame.height, bottom); row++) {
    for (let col = Math.max(0, left); col < Math.min(frame.width, right); col++) {
      const at = (row * frame.width + col) * 3;
      r += frame.pixels[at];
      g += frame.pixels[at + 1];
      b += frame.pixels[at + 2];
      count++;
    }
  }
  if (count === 0) throw new RangeError('the face box holds no pixels of the frame');
  r /= count;
  g /= count;
  b /= count;
  return { luma: 0.2126 * r + 0.7152 * g + 0.0722 * b, warmth: (r - b) / (r + g + b) };
}

/** The skin's reading across several frames, averaged: one frame of a monitor-lit face swings with the screen. */
export function readSkinAcross(frames: readonly RgbFrame[], face: FaceBox): SkinReading {
  const readings = frames.map((frame) => readSkin(frame, face));
  const mean = (pick: (reading: SkinReading) => number) => readings.reduce((sum, reading) => sum + pick(reading), 0) / readings.length;
  return { luma: mean((reading) => reading.luma), warmth: mean((reading) => reading.warmth) };
}

export type CalibrationStep =
  | { readonly kind: 'settled'; readonly settings: CalibratedSettings }
  /** The face wants more light than `maxIso` gives: the room needs light, not the camera. */
  | { readonly kind: 'needs-light'; readonly settings: CalibratedSettings }
  | { readonly kind: 'adjust'; readonly settings: CalibratedSettings };

/**
 * The next settings for a reading taken at `current`. ISO comes from `isoLadder`, the camera's own values, so the
 * camera never refuses one; white balance moves in 100K steps, as the camera takes it.
 */
export function nextCalibrationStep(
  reading: SkinReading,
  current: CalibratedSettings,
  targets: CalibrationTargets,
  isoLadder: readonly number[],
): CalibrationStep {
  const lumaOff = Math.abs(reading.luma - targets.skinLuma) / targets.skinLuma > LUMA_TOLERANCE;
  const warmthOff = Math.abs(reading.warmth - targets.skinWarmth) > WARMTH_TOLERANCE;
  const stops = clamp(Math.log2(targets.skinLuma / Math.max(reading.luma, 1)) * ENCODING_GAMMA, -MAX_STOPS_PER_STEP, MAX_STOPS_PER_STEP);
  const allowed = isoLadder.filter((iso) => iso <= targets.maxIso);
  const iso = lumaOff ? nearestIso(allowed, current.iso * 2 ** stops) : current.iso;
  const kelvinStep = clamp((targets.skinWarmth - reading.warmth) * KELVIN_PER_WARMTH, -MAX_KELVIN_STEP, MAX_KELVIN_STEP);
  const whiteBalanceKelvin = warmthOff
    ? clamp(Math.round((current.whiteBalanceKelvin + kelvinStep) / 100) * 100, KELVIN_RANGE.min, KELVIN_RANGE.max)
    : current.whiteBalanceKelvin;
  const settings = { whiteBalanceKelvin, iso };
  if (!lumaOff && !warmthOff) return { kind: 'settled', settings };
  const stuck = iso === current.iso && whiteBalanceKelvin === current.whiteBalanceKelvin;
  if (stuck && lumaOff && reading.luma < targets.skinLuma && iso === Math.max(...allowed)) return { kind: 'needs-light', settings };
  // A move the camera can't make finer (ISO's ladder, 100K steps) is as close as it gets.
  return stuck ? { kind: 'settled', settings } : { kind: 'adjust', settings };
}

function nearestIso(ladder: readonly number[], wanted: number): number {
  // Compared in stops: 1000 is nearer 800 than 1600 by eye, not by subtraction.
  return ladder.reduce((best, iso) => (Math.abs(Math.log2(iso / wanted)) < Math.abs(Math.log2(best / wanted)) ? iso : best));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
