// studio audition: one line in several voices, to pick a project's voice (lib/timing/voice/engine/voice-project.ts).
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'audition',
    description: "Read one line in several TTS voices, to pick a project's voice (paid).",
    about: "Gemini TTS on OpenRouter; needs OPENROUTER_API_KEY. Writes <voice>.wav into --out and prints each file.",
  },
  args: {
    line: { type: 'positional', required: true, description: 'The line to read' },
    voices: { type: 'string', required: true, valueHint: 'Kore,Puck', description: 'The voices to read it in' },
    out: { type: 'string', default: 'auditions', description: 'Where to write <voice>.wav' },
  },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { auditionVoices } = await import('#lib/timing/voice/engine/voice-project.ts');
    for (const file of await auditionVoices(args.line, args.voices.split(','), resolve(args.out))) console.log(file);
  },
});
