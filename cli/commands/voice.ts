// studio voice: voices a project's script line by line, each cut from the take chosen for it (lib/timing/voice/engine/voice-project.ts).
import { defineCommand } from 'citty';
import type { VoiceMode } from '#lib/timing/voice/engine/voice-project.ts';
import { studioProjectArg } from '../project-arg.ts';

const VOICE_READS = ['paid', 'draft'] as const satisfies readonly VoiceMode[];

export default defineCommand({
  meta: {
    name: 'voice',
    description: "Voice the lines of the project's storyboard.ts, each cut from the take chosen for it, into a .wav per line.",
    about: "Reads storyboard.ts's `voice`, `voiceDirection` and its scenes' lines in plan order. Writes audio/<line>.wav and audio/manifest.ts, which hold real reads only: until a line is read, the storyboard times it from its word count. A take reads some lines, and every take is kept in audio/takes/, never written over; audio/comp.json names the take each line is cut from. Each line keeps its take while that take reads it as it is now, or takes a kept one that does, and nothing is paid. A line that changed is read again alone, with the line before it read too so it carries on from it (that line keeps its own take), so the lines already approved keep their read and timing. A line cut from a recording is never replaced by TTS. Prints audio/manifest.ts.",
  },
  args: {
    project: studioProjectArg,
    read: {
      type: 'enum',
      options: [...VOICE_READS],
      default: 'paid',
      description: 'paid: Gemini TTS on OpenRouter (needs OPENROUTER_API_KEY in the environment). draft: macOS say, free, offline and flat, for hearing the timing; the next paid run reads those lines again',
    },
    lines: { type: 'string', valueHint: 'id,id', description: 'The lines --reread, --take or --choose act on (all of them, without). Line ids are the keys of the scenes\' `lines` in storyboard.ts' },
    take: { type: 'string', valueHint: 'read.m4a', description: 'Keep a recording (a human read) of the lines as a new take and choose it for them. --reread or --choose replaces a recorded line; a script change never does' },
    reread: { type: 'boolean', description: 'Pay for a new read of the lines even though kept takes read them, to hear another performance (Gemini reads differently every time). The takes they had stay kept: --choose goes back to one' },
    takes: { type: 'boolean', description: 'List the kept takes: number, source, when read, length, the lines each reads (old: an earlier text; after: the line read before them for the lead-in, never chosen) and the lines each is chosen for. Reads and cuts nothing' },
    choose: { type: 'string', valueHint: 'n', description: 'Choose kept take n for the lines (without --lines, every line it reads as the script is now) and cut them, without paying. It must read them as they are now (a recording always may)' },
  },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { resolveStudioProjectWith } = await import('#lib/platform/project/engine/studio-project.ts');
    const { chooseVoiceTake, listVoiceTakes, voiceStudioProject } = await import('#lib/timing/voice/engine/voice-project.ts');
    const { readProjectVoiceScript } = await import('#lib/timing/storyboard/engine/project-storyboard.ts');
    const picked = [args.take && '--take', args.reread && '--reread', args.takes && '--takes', args.choose && '--choose'].filter(Boolean);
    if (picked.length > 1) throw new Error(`${picked.join(' and ')} can't go together`);
    const lines = args.lines?.split(',').map((id) => id.trim()).filter(Boolean);
    const project = resolveStudioProjectWith(args.project, 'storyboard.ts');
    const script = await readProjectVoiceScript(project);
    if (args.takes) {
      if (lines) throw new Error('--takes lists every take: drop --lines');
      for (const take of listVoiceTakes(project, script)) {
        const reads = take.lines.map((line) => (line.now ? line.id : `${line.id} (old)`)).join(' ') || 'nothing in the script';
        const chosen = take.chosenFor.length ? `  chosen for ${take.chosenFor.join(' ')}` : '';
        console.log(`${String(take.number).padStart(3)}  ${take.source.padEnd(9)}  ${new Date(take.madeAt).toLocaleString('sv-SE').slice(0, 16)}  ${take.seconds.toFixed(1).padStart(6)}s  reads ${reads}${take.context ? ` after ${take.context}` : ''}${chosen}`);
      }
      return;
    }
    if (args.choose) {
      const number = Number(args.choose);
      if (!Number.isInteger(number)) throw new Error(`--choose takes a take's number (studio voice --takes lists them), not ${args.choose}`);
      console.log(await chooseVoiceTake(project, script, number, lines));
      return;
    }
    console.log(await voiceStudioProject(project, script, { mode: args.read, lines, recording: args.take && resolve(args.take), reread: args.reread }));
  },
});
