// library-recorder-latencies.ts: each device's latency, from the recorder's settings, which hold each camera's and
// mic's latency by device name, set once for this machine's devices (RecorderConfig.swift). The library records a
// track's at add time. Node only.
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PlatformError } from 'effect';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { recorderDeviceSetting, StudioRecorderConfigText } from '#lib/footage/recording/models/studio-recorder-config.ts';
import { LibraryFileUnreadable } from '../models/library-errors.ts';

export class RecorderDeviceLatencies extends Context.Service<RecorderDeviceLatencies, {
  /** Seconds `device` delivers late, by the recorder's longest matching setting; none without one, or without settings. */
  readonly latencyOf: (device: string) => Effect.Effect<number | undefined, LibraryFileUnreadable | PlatformError.PlatformError>;
}>()('RecorderDeviceLatencies') {}

/** Latencies from the recorder's config.json at `configPath`, read once, on first asking. */
export const makeRecorderDeviceLatenciesLayer = (configPath: string) => Layer.effect(RecorderDeviceLatencies, Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const latencyMsByDevice = yield* Effect.cached(Effect.gen(function* () {
    if (!(yield* fs.exists(configPath))) return {};
    const config = yield* Schema.decodeUnknownEffect(StudioRecorderConfigText)(yield* fs.readFileString(configPath)).pipe(
      Effect.mapError((error) => new LibraryFileUnreadable({ path: configPath, reason: `isn't the recorder's settings: ${error.message}` })),
    );
    // A device names a camera or a mic, never both, so one table serves either.
    return { ...config.camera?.latencyMsByDevice, ...config.mic?.latencyMsByDevice };
  }));
  return RecorderDeviceLatencies.of({
    latencyOf: Effect.fn('RecorderDeviceLatencies.latencyOf')(function* (device) {
      const ms = recorderDeviceSetting(yield* latencyMsByDevice, device);
      return ms ? ms / 1000 : undefined;
    }),
  });
}));

/** This machine's recorder settings. */
export const recorderDeviceLatenciesLayer = makeRecorderDeviceLatenciesLayer(join(homedir(), 'Library/Application Support/StudioRecorder/config.json'));
