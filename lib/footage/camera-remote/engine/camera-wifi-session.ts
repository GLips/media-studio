// camera-wifi-session.ts: the Mac's Wi-Fi on the camera's network for the length of a scope, and back on the home
// network after, whatever happened inside. Ethernet carries the internet meanwhile; without it the Mac is offline for
// the session.
//
// The Mac takes a fixed address there: the camera's DHCP hands out 192.168.0.1/16, which overlaps most home networks.
// Leaving, it drops the camera from its known networks (so it never rejoins on its own), returns the service to DHCP
// and cycles Wi-Fi power, which rejoins the home network: macOS hides the current network's name, so there's none
// to rejoin by.
import { Duration, Effect, Option, Schedule, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { STUDIO_CHILD_PROCESS } from '#lib/platform/process/engine/studio-child-process.ts';
import { toolStderrReason } from '#lib/platform/process/models/tool-stderr-reason.ts';
import type { CameraRemoteSettings } from '../models/camera-remote-config.ts';
import { cameraRemoteReachable } from './sony-camera-remote.ts';

/** networksetup refused a step, or the camera's API never answered on its network. */
export class CameraWifiFailed extends Schema.TaggedError<CameraWifiFailed>()('CameraWifiFailed', {
  step: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `couldn't ${this.step}: ${this.reason}`;
  }
}

const SUBNET_MASK = '255.255.255.0';
const CAMERA_ANSWER_TIMEOUT = Duration.seconds(30);

const networksetup = Effect.fn('CameraWifi.networksetup')(function* (step: string, args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const failed = (reason: string) => new CameraWifiFailed({ step, reason });
  const handle = yield* spawner.spawn(ChildProcess.make('networksetup', [...args], STUDIO_CHILD_PROCESS)).pipe(Effect.mapError((error) => failed(error.message)));
  const [stdout, stderr, exitCode] = yield* Effect.all([
    handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
    handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
    handle.exitCode,
  ], { concurrency: 'unbounded' }).pipe(Effect.mapError((error) => failed(error.message)));
  // networksetup reports some refusals on stdout with exit 0 ("Failed to join network", "Could not find network").
  const said = `${stdout}\n${stderr}`;
  if (exitCode !== 0 || /^(?:Error|Could not|Failed)/m.test(said)) return yield* failed(toolStderrReason(said) || `exit ${exitCode}`);
  return stdout;
}, Effect.scoped);

const joinCameraNetwork = Effect.fn('CameraWifi.join')(function* (wifi: CameraRemoteSettings['wifi']) {
  yield* Effect.log(`joining the camera's Wi-Fi (${wifi.ssid}) on ${wifi.device}`);
  yield* networksetup('turn Wi-Fi on', ['-setairportpower', wifi.device, 'on']);
  // The router field is left as the camera itself, but on a /24 the Mac routes only the camera's subnet there;
  // Ethernet, first in the service order, keeps the default route.
  yield* networksetup('set the fixed address', ['-setmanual', wifi.service, wifi.address, SUBNET_MASK, '192.168.122.1']);
  yield* networksetup("join the camera's network", ['-setairportnetwork', wifi.device, wifi.ssid, wifi.password]);
  const answered = yield* cameraRemoteReachable.pipe(
    Effect.repeat({ until: (up) => up, schedule: Schedule.spaced(Duration.seconds(1)) }),
    Effect.timeoutOption(CAMERA_ANSWER_TIMEOUT),
  );
  if (Option.isNone(answered)) {
    yield* new CameraWifiFailed({ step: "reach the camera's API", reason: 'it never answered; is Ctrl w/ Smartphone on and its connection screen showing?' });
  }
});

const leaveCameraNetwork = Effect.fn('CameraWifi.leave')(function* (wifi: CameraRemoteSettings['wifi']) {
  yield* Effect.log('returning Wi-Fi to the home network');
  // Each step runs whatever the one before did: the next one may still be what restores the network.
  yield* networksetup('forget the camera network', ['-removepreferredwirelessnetwork', wifi.device, wifi.ssid]).pipe(Effect.ignore);
  yield* networksetup('return Wi-Fi to DHCP', ['-setdhcp', wifi.service]).pipe(Effect.ignore);
  yield* networksetup('turn Wi-Fi off', ['-setairportpower', wifi.device, 'off']).pipe(Effect.ignore);
  yield* Effect.sleep(Duration.seconds(2));
  yield* networksetup('turn Wi-Fi on', ['-setairportpower', wifi.device, 'on']).pipe(Effect.ignore);
});

/**
 * Runs `inside` with the Mac on the camera's network, and returns it to the home network after, on success,
 * failure or interruption alike. A join that fails halfway is undone too, so it isn't an acquire/release pair.
 */
export const withCameraWifi = <A, E, R>(wifi: CameraRemoteSettings['wifi'], inside: Effect.Effect<A, E, R>) =>
  joinCameraNetwork(wifi).pipe(Effect.andThen(inside), Effect.ensuring(leaveCameraNetwork(wifi)));
