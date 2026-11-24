// studio camera: the physical camera (a Sony a6400) over its Wi-Fi, and its HDMI picture
// (lib/footage/camera-remote/engine/camera-remote.ts).
import { defineCommand } from 'citty';
import type { NodeServices } from '@effect/platform-node';
import type { Effect, Layer } from 'effect';
import type { cameraRemoteLayer } from '#lib/footage/camera-remote/engine/camera-remote.ts';
import type { CameraRemoteSettings } from '#lib/footage/camera-remote/models/camera-remote-config.ts';
import { refuseOptionsBeforeSubcommand } from '../command-flags.ts';

const WIFI_ABOUT = "Joins the Mac's Wi-Fi to the camera's network for the command's length and returns it to the home network after, even on failure; Ethernet keeps the internet meanwhile. The camera needs Ctrl w/ Smartphone on (Network menu) and USB unplugged: over USB the camera blanks its HDMI. Settings are ~/Library/Application Support/StudioCamera/config.json: wifi.ssid and wifi.password (the camera's QR code), optional wifi.service, wifi.device, wifi.address, hdmiDevice and calibration targets.";

type CameraServices = Layer.Success<typeof cameraRemoteLayer> | NodeServices.NodeServices;
type CameraProgram<A, E> = (config: CameraRemoteSettings) => Effect.Effect<A, E, CameraServices>;

const runCameraProgram = async <A, E>(program: CameraProgram<A, E>) => {
  const { Effect } = await import('effect');
  const { cameraRemoteLayer, readCameraRemoteConfig } = await import('#lib/footage/camera-remote/engine/camera-remote.ts');
  const { runStudioEffect } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
  return runStudioEffect(readCameraRemoteConfig().pipe(Effect.flatMap(program)), cameraRemoteLayer);
};

const statusCommand = defineCommand({
  meta: { name: 'status', description: "Print the camera's white balance, ISO, aperture, shutter and exposure mode as JSON.", about: WIFI_ABOUT },
  async run() {
    const { cameraStatus } = await import('#lib/footage/camera-remote/engine/camera-remote.ts');
    const { printStudioJson } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
    const { Effect } = await import('effect');
    await runCameraProgram((config) => cameraStatus(config).pipe(Effect.flatMap((exposure) => printStudioJson({ ...exposure, whiteBalanceKelvin: exposure.whiteBalanceKelvin ?? null }))));
  },
});

const setCommand = defineCommand({
  meta: {
    name: 'set',
    description: 'Set white balance, ISO, aperture or shutter, then print what the camera took as JSON.',
    about: `ISO, aperture and shutter take the camera's own values (\`studio camera status\` shows them: "800", "1.4", "1/60"); it refuses any other. Picture profile and creative style aren't reachable: set them on the camera. ${WIFI_ABOUT}`,
  },
  args: {
    wb: { type: 'string', description: 'White balance as a colour temperature in K, in 100K steps (2500–9900)' },
    iso: { type: 'string', description: 'ISO, e.g. 800' },
    f: { type: 'string', description: 'Aperture, e.g. 1.4' },
    shutter: { type: 'string', description: 'Shutter speed, e.g. 1/60' },
  },
  async run({ args }) {
    const { setCameraSettings } = await import('#lib/footage/camera-remote/engine/camera-remote.ts');
    const { printStudioJson } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
    const { Effect } = await import('effect');
    if ([args.wb, args.iso, args.f, args.shutter].every((value) => value === undefined)) throw new Error('nothing to set: give --wb, --iso, --f or --shutter');
    const whiteBalanceKelvin = args.wb === undefined ? undefined : Number(args.wb);
    if (whiteBalanceKelvin !== undefined && !Number.isInteger(whiteBalanceKelvin)) throw new Error(`--wb takes kelvin, like 4400, not ${args.wb}`);
    await runCameraProgram((config) => setCameraSettings(config, { whiteBalanceKelvin, iso: args.iso, fNumber: args.f, shutterSpeed: args.shutter }).pipe(
      Effect.flatMap((exposure) => printStudioJson({ ...exposure, whiteBalanceKelvin: exposure.whiteBalanceKelvin ?? null })),
    ));
  },
});

const previewCommand = defineCommand({
  meta: {
    name: 'preview',
    description: "Save one frame of the camera's HDMI picture as PNG and print its path.",
    about: "Reads the capture card (config's hdmiDevice, Cam Link 4K by default), the picture the recorder records. Needs no network, and fails while the camera's USB is plugged in, since the camera blanks HDMI then.",
  },
  args: { out: { type: 'string', default: 'camera-preview.png', description: 'Where to save the PNG' } },
  async run({ args }) {
    const { previewCameraPicture } = await import('#lib/footage/camera-remote/engine/camera-remote.ts');
    const { resolve } = await import('node:path');
    console.log(await runCameraProgram((config) => previewCameraPicture(config, resolve(args.out))));
  },
});

const calibrateCommand = defineCommand({
  meta: {
    name: 'calibrate',
    description: 'Set ISO and white balance so the face in the HDMI picture meets its brightness and skin-tone targets.',
    about: `Sit where you record. Finds the face once (macOS Vision; the first run builds the detector), then reads the skin's brightness and warmth off the HDMI picture and moves ISO and white balance a step at a time, up to six, leaving them set. Aperture and shutter stay as they are. Prints JSON: outcome (settled; needs-light, when the face is too dim at the highest allowed ISO; gave-up), the settings left, the last reading and the steps taken. Targets are the config's calibration (skinLuma, skinWarmth, maxIso), with defaults read off a picture Graham approved in Cine1. ${WIFI_ABOUT}`,
  },
  async run() {
    const { calibrateCamera } = await import('#lib/footage/camera-remote/engine/camera-remote.ts');
    const { printStudioJson } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
    const { Effect } = await import('effect');
    await runCameraProgram((config) => calibrateCamera(config).pipe(Effect.flatMap((calibration) => printStudioJson(calibration))));
  },
});

export default defineCommand({
  meta: {
    name: 'camera',
    description: 'The camera you record with: read and set it over Wi-Fi, grab its HDMI picture, calibrate it to your face.',
    about: 'A Sony a6400 through an HDMI capture card. ISO, white balance, aperture and shutter are set over the camera\'s Wi-Fi; picture profile is set on the camera by hand.',
  },
  setup: refuseOptionsBeforeSubcommand,
  subCommands: { status: statusCommand, set: setCommand, preview: previewCommand, calibrate: calibrateCommand },
});
