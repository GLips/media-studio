// studio light: the key light, an Amaran, through amaran-cli (lib/footage/key-light/engine/amaran-key-light.ts).
import { defineCommand } from 'citty';
import type { Effect } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { refuseOptionsBeforeSubcommand } from '../command-flags.ts';

const runLightProgram = async <E>(program: Effect.Effect<string, E, ChildProcessSpawner.ChildProcessSpawner>) => {
  const { Layer } = await import('effect');
  const { runStudioEffect } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
  process.stdout.write(await runStudioEffect(program, Layer.empty));
};

const LIGHT_ABOUT = 'Runs amaran-cli (npm amaran-light-cli), which reaches Amaran lights over the Mac\'s Bluetooth or the Amaran Desktop app; install and pair it first (`amaran-cli --help`). Unverified with the Verge so far.';

const listCommand = defineCommand({
  meta: { name: 'list', description: 'List the lights amaran-cli can reach.', about: LIGHT_ABOUT },
  async run() {
    const { listKeyLights } = await import('#lib/footage/key-light/engine/amaran-key-light.ts');
    await runLightProgram(listKeyLights());
  },
});

const setCommand = defineCommand({
  meta: { name: 'set', description: "Set a light's colour temperature and brightness.", about: LIGHT_ABOUT },
  args: {
    k: { type: 'string', required: true, description: 'Colour temperature in K, e.g. 4400' },
    intensity: { type: 'string', required: true, description: 'Brightness in percent, 0–100' },
    light: { type: 'string', description: 'The light, by name or node id; every light when left out' },
  },
  async run({ args }) {
    const { setKeyLight } = await import('#lib/footage/key-light/engine/amaran-key-light.ts');
    const kelvin = Number(args.k);
    const intensityPercent = Number(args.intensity);
    if (!Number.isInteger(kelvin) || !(intensityPercent >= 0 && intensityPercent <= 100)) throw new Error('--k takes kelvin (4400) and --intensity a percent (0–100)');
    await runLightProgram(setKeyLight({ kelvin, intensityPercent, light: args.light }));
  },
});

export default defineCommand({
  meta: { name: 'light', description: 'The key light: list the lights in reach, set colour temperature and brightness.', about: LIGHT_ABOUT },
  setup: refuseOptionsBeforeSubcommand,
  subCommands: { list: listCommand, set: setCommand },
});
