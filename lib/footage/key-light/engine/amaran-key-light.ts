// amaran-key-light.ts: the key light, an Aputure Amaran (a Verge on Graham's desk), through `amaran-cli`
// (npm amaran-light-cli), a community tool that reaches Amaran lights over the Mac's Bluetooth or the Amaran Desktop
// app. Unverified against the Verge until it arrives: the tool lists only larger Amaran fixtures as tested.
import { Effect, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { STUDIO_CHILD_PROCESS } from '#lib/platform/process/engine/studio-child-process.ts';
import { toolStderrReason } from '#lib/platform/process/models/tool-stderr-reason.ts';

/** amaran-cli isn't installed, or refused a command. */
export class KeyLightFailed extends Schema.TaggedError<KeyLightFailed>()('KeyLightFailed', { command: Schema.String, reason: Schema.String }) {
  override get message(): string {
    return `amaran-cli ${this.command} failed: ${this.reason} (install it with \`npm install -g amaran-light-cli\`)`;
  }
}

const amaranCli = Effect.fn('KeyLight.amaranCli')(function* (args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const failed = (reason: string) => new KeyLightFailed({ command: args.join(' '), reason });
  const handle = yield* spawner.spawn(ChildProcess.make('amaran-cli', [...args], STUDIO_CHILD_PROCESS)).pipe(Effect.mapError((error) => failed(error.message)));
  const [stdout, stderr, exitCode] = yield* Effect.all([
    handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
    handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
    handle.exitCode,
  ], { concurrency: 'unbounded' }).pipe(Effect.mapError((error) => failed(error.message)));
  if (exitCode !== 0) return yield* failed(toolStderrReason(stderr) || `exit ${exitCode}`);
  return stdout;
}, Effect.scoped);

/** The lights amaran-cli can reach, as it lists them. */
export const listKeyLights = () => amaranCli(['list']);

export type KeyLightSetting = { readonly kelvin: number; readonly intensityPercent: number; readonly light?: string };

/** Sets a light's colour temperature and brightness; every light it reaches when none is named. */
export const setKeyLight = ({ kelvin, intensityPercent, light }: KeyLightSetting) =>
  amaranCli(['cct', String(kelvin), ...(light === undefined ? [] : [light]), '-i', String(intensityPercent)]);
