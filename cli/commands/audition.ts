// studio audition: one line in several voices, to pick a project's voice (lib/timing/voice/engine/voice-project.ts).
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'audition',
    description: 'Read one line in each of --voices with Gemini TTS on OpenRouter (paid; needs OPENROUTER_API_KEY), to compare them. Prints each <voice>.wav.',
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
