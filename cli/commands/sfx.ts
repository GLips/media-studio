// studio sfx: synthesizes the kit's sound effects (lib/sfx-synth.ts).
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'sfx',
    description: "Synthesize the kit's click and key sounds into lib/studio/sfx/, seeded so a rerun writes the same files. Prints the files.",
  },
  async run() {
    const { writeKitSfx } = await import('../../lib/sfx-synth.ts');
    for (const file of writeKitSfx()) console.log(file);
  },
});
