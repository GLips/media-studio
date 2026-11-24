// camera-remote-config.ts: this Mac's settings for reaching the camera, ~/Library/Application Support/StudioCamera/
// config.json, beside the recorder's. Pure. Machine-local, never in git: it holds the camera's Wi-Fi password.
import { Schema } from 'effect';
import { DEFAULT_CALIBRATION_TARGETS, type CalibrationTargets } from './camera-calibration.ts';

export const CameraRemoteConfig = Schema.Struct({
  wifi: Schema.Struct({
    /** The camera's own network, shown on its screen under Ctrl w/ Smartphone (`DIRECT-xxxx:ILCE-6400`). */
    ssid: Schema.String,
    /** In the camera's QR code (`P:` field), or its Connect with Password screen. */
    password: Schema.String,
    /** The network service and its device that join the camera (Wi-Fi, en0); Ethernet keeps the internet meanwhile. */
    service: Schema.optionalKey(Schema.String),
    device: Schema.optionalKey(Schema.String),
    /**
     * The address the Mac takes on the camera's network. Fixed, since the camera's DHCP hands out 192.168.0.1/16,
     * which overlaps most home networks. 192.168.122.10 unless set.
     */
    address: Schema.optionalKey(Schema.String),
  }),
  /** The camera's HDMI feed, by its capture device's name in AVFoundation; Cam Link 4K unless set. */
  hdmiDevice: Schema.optionalKey(Schema.String),
  calibration: Schema.optionalKey(Schema.Struct({
    skinLuma: Schema.optionalKey(Schema.Finite),
    skinWarmth: Schema.optionalKey(Schema.Finite),
    maxIso: Schema.optionalKey(Schema.Finite),
  })),
});

/** config.json's text, parsed and decoded as written; `cameraRemoteSettings` fills in what it leaves out. */
export const CameraRemoteConfigText = Schema.fromJsonString(CameraRemoteConfig);

/** The settings `studio camera` runs with: config.json's, and the defaults for what it leaves out. */
export type CameraRemoteSettings = {
  readonly wifi: { readonly ssid: string; readonly password: string; readonly service: string; readonly device: string; readonly address: string };
  readonly hdmiDevice: string;
  readonly calibration: CalibrationTargets;
};

export function cameraRemoteSettings(config: Schema.Schema.Type<typeof CameraRemoteConfig>): CameraRemoteSettings {
  return {
    wifi: { service: 'Wi-Fi', device: 'en0', address: '192.168.122.10', ...config.wifi },
    hdmiDevice: config.hdmiDevice ?? 'Cam Link 4K',
    calibration: { ...DEFAULT_CALIBRATION_TARGETS, ...config.calibration },
  };
}
