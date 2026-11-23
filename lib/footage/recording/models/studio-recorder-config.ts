// studio-recorder-config.ts: the recorder's settings, ~/Library/Application Support/StudioRecorder/config.json, as
// RecorderConfig.swift writes them. Pure. The studio reads it for each device's latency, which the library records
// on a track at add time; the recorder alone writes it.
import { Schema } from 'effect';

/** A setting per device, keyed by part of the device's name (`"Cam Link": 160`). */
const ByDeviceName = <S extends Schema.Top>(value: S) => Schema.Record(Schema.String, value);

export const StudioRecorderConfig = Schema.Struct({
  hotkey: Schema.String,
  recordingsDir: Schema.String,
  screen: Schema.Struct({
    display: Schema.String,
    /** A picked window, recorded instead of `display`, the display it was on, until it closes. */
    window: Schema.optionalKey(Schema.Struct({ id: Schema.Finite, bundleID: Schema.String, title: Schema.String, app: Schema.String })),
    fps: Schema.Finite, bitrateMbps: Schema.Finite, showsCursor: Schema.Boolean,
  }),
  camera: Schema.optionalKey(Schema.Struct({
    device: Schema.String, width: Schema.Finite, height: Schema.Finite, fps: Schema.Finite, bitrateMbps: Schema.Finite,
    latencyMsByDevice: ByDeviceName(Schema.Finite),
  })),
  mic: Schema.optionalKey(Schema.Struct({
    device: Schema.String, channelByDevice: ByDeviceName(Schema.Finite), bitrateKbps: Schema.Finite,
    latencyMsByDevice: ByDeviceName(Schema.Finite),
  })),
});
export interface StudioRecorderConfig extends Schema.Schema.Type<typeof StudioRecorderConfig> {}

/** config.json's text, parsed and decoded. */
export const StudioRecorderConfigText = Schema.fromJsonString(StudioRecorderConfig);

/**
 * The entry of a per-device table for `deviceName`: the longest key the name contains, ignoring case, so
 * `"Scarlett Solo"` beats `"Scarlett"`; none when no key matches. The recorder's settingForDevice, the same rule.
 */
export function recorderDeviceSetting<V>(table: Readonly<Record<string, V>>, deviceName: string): V | undefined {
  const name = deviceName.toLowerCase();
  const keys = Object.keys(table).filter((key) => name.includes(key.toLowerCase()));
  const longest = keys.reduce<string | undefined>((best, key) => (best === undefined || key.length > best.length ? key : best), undefined);
  return longest === undefined ? undefined : table[longest];
}
