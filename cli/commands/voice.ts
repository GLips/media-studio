// studio voice: voices a project's script as one take and cuts it into lines (lib/timing/voice/engine/voice-project.ts).
import { defineCommand } from 'citty';
import type { VoiceMode } from '#lib/timing/voice/engine/voice-project.ts';
import { studioProjectArg } from '../project-arg.ts';

const VOICE_READS = ['paid', 'draft'] as const satisfies readonly VoiceMode[];

export default defineCommand({
  meta: {
    name: 'voice',
    description: "Voice the lines of the project's storyboard.ts as one take, cut into a .wav per line.",
    about: "Reads storyboard.ts's `voice` and its scenes' lines in plan order. Writes audio/<line>.wav and audio/manifest.ts, which hold real reads only: until a line is read, the storyboard times it from its word count. Only a script change re-reads the take. Prints audio/manifest.ts.",
  },
  args: {
    project: studioProjectArg,
    read: {
      type: 'enum',
      options: [...VOICE_READS],
      default: 'paid',
      description: 'paid: Gemini TTS on OpenRouter (needs OPENROUTER_API_KEY in the environment). draft: macOS say, free, offline and flat, for hearing the timing; the next paid run re-reads it',
    },
    take: { type: 'string', valueHint: 'read.m4a', description: 'Use a recording of the script (a human read) as the take. A recording is never replaced by TTS' },
  },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { resolveStudioProjectWith } = await import('#lib/platform/project/engine/studio-project.ts');
    const { voiceStudioProject } = await import('#lib/timing/voice/engine/voice-project.ts');
    const { readProjectVoiceScript } = await import('#lib/timing/storyboard/engine/project-storyboard.ts');
    const project = resolveStudioProjectWith(args.project, 'storyboard.ts');
    console.log(await voiceStudioProject(project, await readProjectVoiceScript(project), { mode: args.read, recording: args.take && resolve(args.take) }));
  },
});
