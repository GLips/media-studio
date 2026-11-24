// sony-camera-remote.ts: the Sony a6400's Camera Remote API, JSON-RPC over HTTP on the camera's own Wi-Fi, served
// while Ctrl w/ Smartphone is on. USB PC Remote reaches the same settings, but the camera blanks HDMI while it's
// connected, so the studio never uses it. Picture profile and creative style aren't in this API: they're set on the
// camera by hand.
import { Duration, Effect, Schema } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';

const CAMERA_HOST = '192.168.122.1';
const CAMERA_ENDPOINT = `http://${CAMERA_HOST}:10000/sony/camera`;
/** The device description the camera serves once its API is up; answering it means the network is ready. */
const CAMERA_DESCRIPTION = `http://${CAMERA_HOST}:64321/dd.xml`;
const CALL_TIMEOUT = Duration.seconds(5);

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

const callCamera = Effect.fn('SonyCameraRemote.call')(function* <S extends Schema.Top & { readonly DecodingServices: never }>(
  method: string,
  params: readonly Schema.Json[],
  result: S,
) {
  const failed = (reason: string) => new CameraRemoteFailed({ method, reason });
  const client = yield* HttpClient.HttpClient;
  const body = yield* Schema.encodeEffect(CameraRequest)({ method, params, id: 1, version: '1.0' }).pipe(Effect.mapError((error) => failed(error.message)));
  const reply = yield* client.execute(HttpClientRequest.post(CAMERA_ENDPOINT).pipe(HttpClientRequest.bodyText(body, 'application/json'))).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(CameraReply)),
    Effect.timeoutOrElse({ duration: CALL_TIMEOUT, orElse: () => Effect.fail(failed(`no answer in ${Duration.format(CALL_TIMEOUT)}`)) }),
    Effect.mapError((error) => (error instanceof CameraRemoteFailed ? error : failed(error.message))),
  );
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
export const cameraRemoteReachable = HttpClient.HttpClient.pipe(
  Effect.flatMap((client) => client.get(CAMERA_DESCRIPTION)),
  Effect.map((response) => response.status === 200),
  Effect.timeoutOrElse({ duration: Duration.seconds(2), orElse: () => Effect.succeed(false) }),
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
