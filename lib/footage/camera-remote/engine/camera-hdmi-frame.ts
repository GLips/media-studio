// camera-hdmi-frame.ts: one frame of the camera's HDMI feed, through its capture card, as the recorder sees it: the
// picture calibration judges. And the face in it, by macOS Vision (face-box.swift), built once per source into the
// studio's user cache.
import { join } from 'node:path';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { StudioFfmpeg } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import { textSha256Hex } from '#lib/platform/hash/models/sha256.ts';
import { STUDIO_CHILD_PROCESS } from '#lib/platform/process/engine/studio-child-process.ts';
import { toolStderrReason } from '#lib/platform/process/models/tool-stderr-reason.ts';
import { studioUserCacheDir } from '#lib/platform/temp/engine/studio-user-cache.ts';
import type { FaceBox, RgbFrame } from '../models/camera-calibration.ts';

/** The size calibration reads a frame at: plenty for a face's average colour, and quick to decode. */
const READ_SIZE = { width: 640, height: 360 } as const;
// The capture card's first frames after opening can be black or stale; these are skipped. A live probe read the
// right picture from the first frame, so 8 is margin, a quarter second.
const SETTLE_FRAMES = 8;
/** How many frames calibration averages a reading over, about a third of a second. */
const READ_FRAMES = 8;

/** The face detector couldn't be built or run. */
export class FaceDetectorFailed extends Schema.TaggedError<FaceDetectorFailed>()('FaceDetectorFailed', { reason: Schema.String }) {
  override get message(): string {
    return `the face detector failed: ${this.reason}`;
  }
}

/**
 * Grabs HDMI frames from `device` into `dir`: `frame.png`, one at full size for a person (or the face detector) to
 * look at, and the read-size RGB frames calibration measures.
 */
export const grabCameraHdmiFrame = Effect.fn('CameraHdmi.grab')(function* (device: string, dir: string) {
  const ffmpeg = yield* StudioFfmpeg;
  const fs = yield* FileSystem.FileSystem;
  const png = join(dir, 'frame.png');
  const raw = join(dir, 'frame.rgb');
  yield* ffmpeg.run([
    '-loglevel', 'error', '-y', '-f', 'avfoundation', '-pixel_format', 'uyvy422', '-i', `${device}:none`,
    '-filter_complex', `[0:v]select=gte(n\\,${SETTLE_FRAMES}),split[full][small];[small]scale=${READ_SIZE.width}:${READ_SIZE.height}[read]`,
    '-map', '[full]', '-frames:v', '1', png,
    '-map', '[read]', '-frames:v', String(READ_FRAMES), '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw,
  ]);
  const bytes = yield* fs.readFile(raw);
  const frameBytes = READ_SIZE.width * READ_SIZE.height * 3;
  const frames: RgbFrame[] = Array.from({ length: Math.floor(bytes.length / frameBytes) }, (_, index) => ({
    ...READ_SIZE,
    pixels: bytes.subarray(index * frameBytes, (index + 1) * frameBytes),
  }));
  return { png, frames };
});

const FaceBoxReply = Schema.fromJsonString(Schema.Struct({
  face: Schema.NullOr(Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite })),
}));

const FACE_BOX_SOURCE = join(import.meta.dirname, 'face-box.swift');

const runTool = Effect.fn('CameraHdmi.runTool')(function* (command: string, args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const failed = (reason: string) => new FaceDetectorFailed({ reason });
  const handle = yield* spawner.spawn(ChildProcess.make(command, [...args], STUDIO_CHILD_PROCESS)).pipe(Effect.mapError((error) => failed(error.message)));
  const [stdout, stderr, exitCode] = yield* Effect.all([
    handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
    handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
    handle.exitCode,
  ], { concurrency: 'unbounded' }).pipe(Effect.mapError((error) => failed(error.message)));
  if (exitCode !== 0) return yield* failed(`${command} exited with ${exitCode}: ${toolStderrReason(stderr)}`);
  return stdout;
}, Effect.scoped);

/** The face detector's binary, compiled from face-box.swift the first time this source is used on the machine. */
const faceDetectorBinary = Effect.fn('CameraHdmi.faceDetector')(function* () {
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs.readFileString(FACE_BOX_SOURCE);
  const binary = studioUserCacheDir('face-box', textSha256Hex(source).slice(0, 16), 'face-box');
  if (!(yield* fs.exists(binary))) {
    yield* Effect.log('building the face detector (once)');
    yield* fs.makeDirectory(join(binary, '..'), { recursive: true });
    yield* runTool('swiftc', ['-O', FACE_BOX_SOURCE, '-o', binary]);
  }
  return binary;
});

/** The largest face in the image at `path`, or undefined when Vision finds none. */
export const detectFace = Effect.fn('CameraHdmi.detectFace')(function* (path: string) {
  const stdout = yield* runTool(yield* faceDetectorBinary(), [path]);
  const { face } = yield* Schema.decodeEffect(FaceBoxReply)(stdout.trim()).pipe(Effect.mapError((error) => new FaceDetectorFailed({ reason: error.message })));
  return (face ?? undefined) satisfies FaceBox | undefined;
});
