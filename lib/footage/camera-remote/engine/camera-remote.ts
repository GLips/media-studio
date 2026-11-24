// camera-remote.ts: what `studio camera` does: read and set the camera over its Wi-Fi, grab its HDMI picture, and
// calibrate ISO and white balance to the face in that picture. Each Wi-Fi step joins the camera's network for its
// length only (camera-wifi-session.ts); the HDMI picture needs no network.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Duration, Effect, FileSystem, Schema } from 'effect';
import { studioFfmpegLayer } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import { nextCalibrationStep, readSkinAcross, type CalibratedSettings, type CalibrationStep, type SkinReading } from '../models/camera-calibration.ts';
import { CameraRemoteConfigText, cameraRemoteSettings, type CameraRemoteSettings } from '../models/camera-remote-config.ts';
import { withCameraWifi } from './camera-wifi-session.ts';
import { detectFace, grabCameraHdmiFrame } from './camera-hdmi-frame.ts';
import { availableCameraValues, readCameraExposure, setCameraValue, setCameraWhiteBalance } from './sony-camera-remote.ts';

/** The services `studio camera` runs on beneath Node's: ffmpeg, for the HDMI picture. */
export const cameraRemoteLayer = studioFfmpegLayer;

export const CAMERA_REMOTE_CONFIG_PATH = join(homedir(), 'Library', 'Application Support', 'StudioCamera', 'config.json');

/** This Mac has no camera config, or it doesn't decode. */
export class CameraRemoteConfigMissing extends Schema.TaggedError<CameraRemoteConfigMissing>()('CameraRemoteConfigMissing', { reason: Schema.String }) {
  override get message(): string {
    return `no usable camera config at ${CAMERA_REMOTE_CONFIG_PATH} (${this.reason}); write {"wifi":{"ssid":"DIRECT-…:ILCE-6400","password":"…"}}, the password from the camera's QR code`;
  }
}

/** Calibration found no face in the camera's picture. */
export class NoFaceInPicture extends Schema.TaggedError<NoFaceInPicture>()('NoFaceInPicture', { frame: Schema.String }) {
  override get message(): string {
    return `no face in the camera's picture (${this.frame}): sit where you record and try again`;
  }
}

export const readCameraRemoteConfig = Effect.fn('CameraRemote.readConfig')(function* () {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(CAMERA_REMOTE_CONFIG_PATH).pipe(Effect.mapError(() => new CameraRemoteConfigMissing({ reason: 'not found' })));
  const config = yield* Schema.decodeEffect(CameraRemoteConfigText)(text).pipe(Effect.mapError((error) => new CameraRemoteConfigMissing({ reason: error.message })));
  return cameraRemoteSettings(config);
});

export const cameraStatus = Effect.fn('CameraRemote.status')(function* (config: CameraRemoteSettings) {
  return yield* withCameraWifi(config.wifi, readCameraExposure());
});

export type CameraSettingsChange = {
  readonly whiteBalanceKelvin?: number;
  readonly iso?: string;
  readonly fNumber?: string;
  readonly shutterSpeed?: string;
};

/** Sets what `change` names, then reads the camera back, so the answer is what it took, not what was asked. */
export const setCameraSettings = Effect.fn('CameraRemote.set')(function* (config: CameraRemoteSettings, change: CameraSettingsChange) {
  return yield* withCameraWifi(config.wifi, Effect.gen(function* () {
    if (change.whiteBalanceKelvin !== undefined) yield* setCameraWhiteBalance(change.whiteBalanceKelvin);
    if (change.iso !== undefined) yield* setCameraValue('IsoSpeedRate', change.iso);
    if (change.fNumber !== undefined) yield* setCameraValue('FNumber', change.fNumber);
    if (change.shutterSpeed !== undefined) yield* setCameraValue('ShutterSpeed', change.shutterSpeed);
    return yield* readCameraExposure();
  }));
});

/** One HDMI frame, saved at `out` as PNG. */
export const previewCameraPicture = Effect.fn('CameraRemote.preview')(function* (config: CameraRemoteSettings, out: string) {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-camera-' });
  const { png } = yield* grabCameraHdmiFrame(config.hdmiDevice, dir);
  yield* fs.copyFile(png, out);
  return out;
}, Effect.scoped);

export type CameraCalibration = {
  readonly outcome: Exclude<CalibrationStep['kind'], 'adjust'> | 'gave-up';
  readonly settings: CalibratedSettings;
  readonly reading: SkinReading;
  readonly steps: number;
};

const MAX_CALIBRATION_STEPS = 6;
// The camera applies a change at once, but the capture card's picture trails it by a few frames.
const SETTLE_AFTER_CHANGE = Duration.millis(2500);

/**
 * Moves ISO and white balance until the face in the HDMI picture reads at the config's targets, a step at a time,
 * and leaves them set. Aperture and shutter aren't touched. The face is found once: the person sits still for it.
 */
export const calibrateCamera = Effect.fn('CameraRemote.calibrate')(function* (config: CameraRemoteSettings) {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'studio-camera-' });
  return yield* withCameraWifi(config.wifi, Effect.gen(function* () {
    const isoLadder = (yield* availableCameraValues('IsoSpeedRate')).map(Number).filter(Number.isFinite);
    const exposure = yield* readCameraExposure();
    // A camera on a preset or auto white balance starts calibration from a neutral middle.
    let settings: CalibratedSettings = { whiteBalanceKelvin: exposure.whiteBalanceKelvin ?? 4400, iso: Number(exposure.iso) || 800 };
    const first = yield* grabCameraHdmiFrame(config.hdmiDevice, dir);
    const { png } = first;
    let { frames } = first;
    const face = yield* detectFace(png);
    if (face === undefined) return yield* new NoFaceInPicture({ frame: png });
    for (let step = 1; ; step++) {
      const reading = readSkinAcross(frames, face);
      const next = nextCalibrationStep(reading, settings, config.calibration, isoLadder);
      yield* Effect.log(`step ${step}: skin luma ${reading.luma.toFixed(0)}, warmth ${reading.warmth.toFixed(3)} at ${settings.whiteBalanceKelvin}K ISO ${settings.iso} → ${next.kind}`);
      if (next.kind !== 'adjust') return { outcome: next.kind, settings, reading, steps: step } satisfies CameraCalibration;
      if (step === MAX_CALIBRATION_STEPS) return { outcome: 'gave-up', settings, reading, steps: step } satisfies CameraCalibration;
      if (next.settings.whiteBalanceKelvin !== settings.whiteBalanceKelvin) yield* setCameraWhiteBalance(next.settings.whiteBalanceKelvin);
      if (next.settings.iso !== settings.iso) yield* setCameraValue('IsoSpeedRate', String(next.settings.iso));
      settings = next.settings;
      yield* Effect.sleep(SETTLE_AFTER_CHANGE);
      frames = (yield* grabCameraHdmiFrame(config.hdmiDevice, dir)).frames;
    }
  }));
}, Effect.scoped);
