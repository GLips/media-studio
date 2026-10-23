// studio voice: voices a project's script as one take and cuts it into lines (lib/timing/voice/engine/voice-project.ts).
import { defineCommand } from 'citty';
import type { VoiceMode } from '#lib/timing/voice/engine/voice-project.ts';
import { studioProjectArg } from '../project-arg.ts';

const VOICE_READS = ['paid', 'draft'] as const satisfies readonly VoiceMode[];

export default defineCommand({
  meta: {
    name: 'voice',
    description: "Voice the lines of the project's storyboard.ts as one take, cut into a .wav per line.",
    about: "Reads storyboard.ts's `voice`, `voiceDirection` and its scenes' lines in plan order. Writes audio/<line>.wav and audio/manifest.ts, which hold real reads only: until a line is read, the storyboard times it from its word count. Every take is kept in audio/takes/, never written over, and audio/current-take.json names the one the lines are cut from. A change to the script, voice or direction reads a new take, unless a kept take already reads it as it is now: that one is used, and nothing is paid. Prints audio/manifest.ts.",
  },
  args: {
    project: studioProjectArg,
    read: {
      type: 'enum',
      options: [...VOICE_READS],
      default: 'paid',
      description: 'paid: Gemini TTS on OpenRouter (needs OPENROUTER_API_KEY in the environment). draft: macOS say, free, offline and flat, for hearing the timing; the next paid run reads a real take',
    },
    take: { type: 'string', valueHint: 'read.m4a', description: 'Keep a recording of the script (a human read) as a new take and make it current. A script change never replaces a recording with TTS; --reread or --choose does' },
    reread: { type: 'boolean', description: 'Pay for a new take of the script even though a kept take reads it, to hear another performance (Gemini reads differently every time). The current take stays kept: --choose goes back to it' },
    takes: { type: 'boolean', description: 'List the kept takes: number, source, when read, length, which is current and which read another script. Reads and cuts nothing' },
    choose: { type: 'string', valueHint: 'n', description: 'Make kept take n current and cut it into lines, without paying. It must read the script as it is now (a recording always may)' },
  },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { resolveStudioProjectWith } = await import('#lib/platform/project/engine/studio-project.ts');
    const { chooseVoiceTake, listVoiceTakes, voiceStudioProject } = await import('#lib/timing/voice/engine/voice-project.ts');
    const { readProjectVoiceScript } = await import('#lib/timing/storyboard/engine/project-storyboard.ts');
    const picked = [args.take && '--take', args.reread && '--reread', args.takes && '--takes', args.choose && '--choose'].filter(Boolean);
    if (picked.length > 1) throw new Error(`${picked.join(' and ')} can't go together`);
    const project = resolveStudioProjectWith(args.project, 'storyboard.ts');
    const script = await readProjectVoiceScript(project);
    if (args.takes) {
      for (const take of listVoiceTakes(project, script)) {
        const notes = [take.current && 'current', !take.readsScript && 'another script'].filter(Boolean).join(', ');
        console.log(`${String(take.number).padStart(3)}  ${take.source.padEnd(9)}  ${new Date(take.madeAt).toLocaleString('sv-SE').slice(0, 16)}  ${take.seconds.toFixed(1).padStart(6)}s  ${notes}`.trimEnd());
      }
      return;
    }
    if (args.choose) {
      const number = Number(args.choose);
      if (!Number.isInteger(number)) throw new Error(`--choose takes a take's number (studio voice --takes lists them), not ${args.choose}`);
      console.log(await chooseVoiceTake(project, script, number));
      return;
    }
    console.log(await voiceStudioProject(project, script, { mode: args.read, recording: args.take && resolve(args.take), reread: args.reread }));
  },
});
