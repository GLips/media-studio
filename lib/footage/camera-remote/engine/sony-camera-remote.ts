// sony-camera-remote.ts: the Sony a6400's Camera Remote API, JSON-RPC over HTTP on the camera's own Wi-Fi, served
// while Ctrl w/ Smartphone is on. USB PC Remote reaches the same settings, but the camera blanks HDMI while it's
// connected, so the studio never uses it. Picture profile and creative style aren't in this API: they're set on the
// camera by hand.
//
// Requests go through /usr/bin/curl, not Node's fetch: macOS's Local Network privacy refuses Node's connections to
// the camera (EHOSTUNREACH) unless the user grants node access, while Apple's own curl is exempt.
import { Effect, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { STUDIO_CHILD_PROCESS } from '#lib/platform/process/engine/studio-child-process.ts';

const CAMERA_HOST = '192.168.122.1';
const CAMERA_ENDPOINT = `http://${CAMERA_HOST}:10000/sony/camera`;
/** The device description the camera serves once its API is up; answering it means the network is ready. */
const CAMERA_DESCRIPTION = `http://${CAMERA_HOST}:64321/dd.xml`;
const CALL_TIMEOUT_SECONDS = 8;
// curl's exit code when the camera took too long: it sometimes stalls on one call and answers the next.
const CURL_TIMED_OUT = 28;

/** The camera refused a call, answered with an error, or didn't answer. */
export class CameraRemoteFailed extends Schema.TaggedError<CameraRemoteFailed>()('CameraRemoteFailed', {
  method: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `the camera's ${this.method} failed: ${this.reason}`;
  }
}

const CameraRequest = Schema.fromJsonString(Schema.Struct({
  method: Schema.String,
  params: Schema.Array(Schema.Json),
  id: Schema.Finite,
  version: Schema.String,
}));

const CameraReply = Schema.Struct({
  result: Schema.optionalKey(Schema.Array(Schema.Json)),
  error: Schema.optionalKey(Schema.Tuple([Schema.Finite, Schema.String])),
});

/** curl's answer: its stdout, and its exit code (0 when the camera answered with any HTTP status). */
const curl = Effect.fn('SonyCameraRemote.curl')(function* (args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner.spawn(ChildProcess.make('/usr/bin/curl', ['--silent', '--show-error', ...args], STUDIO_CHILD_PROCESS));
  const [stdout, stderr, exitCode] = yield* Effect.all([
    handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
    handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
    handle.exitCode,
  ], { concurrency: 'unbounded' });
  return { stdout, stderr: stderr.trim(), exitCode };
}, Effect.scoped);

const callCamera = Effect.fn('SonyCameraRemote.call')(function* <S extends Schema.Top & { readonly DecodingServices: never }>(
  method: string,
  params: readonly Schema.Json[],
  result: S,
) {
  const failed = (reason: string) => new CameraRemoteFailed({ method, reason });
  const body = yield* Schema.encodeEffect(CameraRequest)({ method, params, id: 1, version: '1.0' }).pipe(Effect.mapError((error) => failed(error.message)));
  // Every call reads or sets a value, so asking again after a stall changes nothing the first ask wouldn't have.
  const answer = yield* curl(['--max-time', String(CALL_TIMEOUT_SECONDS), '--fail', '--header', 'content-type: application/json', '--data-binary', body, CAMERA_ENDPOINT]).pipe(
    Effect.mapError((error) => failed(error.message)),
    Effect.repeat({ while: (attempt) => attempt.exitCode === CURL_TIMED_OUT, times: 2 }),
  );
  if (answer.exitCode !== 0) return yield* failed(answer.stderr || `curl exited with ${answer.exitCode}`);
  const reply = yield* Schema.decodeEffect(Schema.fromJsonString(CameraReply))(answer.stdout).pipe(Effect.mapError((error) => failed(error.message)));
  if (reply.error) return yield* failed(`error ${reply.error[0]} ${reply.error[1]}`);
  return yield* Schema.decodeUnknownEffect(result)(reply.result ?? []).pipe(Effect.mapError((error) => failed(error.message)));
});

/** What the camera's exposure and colour are set to. Aperture and shutter are the camera's own strings ("1.4", "1/60"). */
export type CameraExposure = {
  readonly whiteBalanceKelvin: number | undefined;
  readonly whiteBalanceMode: string;
  readonly iso: string;
  readonly fNumber: string;
  readonly shutterSpeed: string;
  readonly exposureMode: string;
};

const OneString = Schema.Tuple([Schema.String]);
const WhiteBalanceResult = Schema.Tuple([Schema.Struct({ whiteBalanceMode: Schema.String, colorTemperature: Schema.optionalKey(Schema.Finite) })]);
/** getAvailable* answers its current value, then the values the camera takes now. */
const AvailableStrings = Schema.Tuple([Schema.String, Schema.Array(Schema.String)]);
const NoResult = Schema.Tuple([Schema.Finite]);

/** Whether the camera's API answers: true once its network is joined and it serves its description. */
export const cameraRemoteReachable = curl(['--max-time', '2', '--output', '/dev/null', '--write-out', '%{http_code}', CAMERA_DESCRIPTION]).pipe(
  Effect.map((answer) => answer.stdout === '200'),
  Effect.orElseSucceed(() => false),
);

export const readCameraExposure = Effect.fn('SonyCameraRemote.readExposure')(function* () {
  const [[whiteBalance], [iso], [fNumber], [shutterSpeed], [exposureMode]] = yield* Effect.all([
    callCamera('getWhiteBalance', [], WhiteBalanceResult),
    callCamera('getIsoSpeedRate', [], OneString),
    callCamera('getFNumber', [], OneString),
    callCamera('getShutterSpeed', [], OneString),
    callCamera('getExposureMode', [], OneString),
  ]);
  return {
    whiteBalanceKelvin: whiteBalance.colorTemperature,
    whiteBalanceMode: whiteBalance.whiteBalanceMode,
    iso, fNumber, shutterSpeed, exposureMode,
  } satisfies CameraExposure;
});

/** The values a setting takes on the camera now, in its own strings: ISO ("800", "AUTO"), aperture, shutter. */
export const availableCameraValues = (setting: 'IsoSpeedRate' | 'FNumber' | 'ShutterSpeed') =>
  callCamera(`getAvailable${setting}`, [], AvailableStrings).pipe(Effect.map(([, values]) => values));

/** White balance as a colour temperature, in 100K steps. */
export const setCameraWhiteBalance = (kelvin: number) => callCamera('setWhiteBalance', ['Color Temperature', true, kelvin], NoResult).pipe(Effect.asVoid);

/** A setting in the camera's own string, one `availableCameraValues` lists; the camera refuses any other. */
export const setCameraValue = (setting: 'IsoSpeedRate' | 'FNumber' | 'ShutterSpeed', value: string) =>
  callCamera(`set${setting}`, [value], NoResult).pipe(Effect.asVoid);
