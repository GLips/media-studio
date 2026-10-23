// studio voice: voices a project's script line by line, each voiced line cut from the take chosen for it
// (lib/timing/voice/engine/voice-project.ts). sync reconciles the script; reread, use and import act on named lines;
// takes lists what's kept.
import { defineCommand, type ArgsDef } from 'citty';
import type { VoiceScript } from '#lib/timing/voice/models/voice-take.ts';
import { refuseOptionsBeforeSubcommand, refuseUnknownCommandFlags } from '../command-flags.ts';
import { studioProjectArg } from '../project-arg.ts';

const linesArg = { type: 'positional', required: false, description: "Line ids, the keys of the scenes' `lines` in storyboard.ts" } as const;
const allArg = { type: 'boolean', description: 'Every line of the script, in place of naming them' } as const;

/** The operands after the project, refusing more than `most`. */
function operandsAfterProject(args: { _: unknown[] }, most = Infinity) {
  const operands = args._.slice(1).map(String);
  if (operands.length > most) throw new Error(`unexpected ${operands.slice(most).join(' ')}: see --help`);
  return operands;
}

/** Named lines or --all, exactly one of them. */
function namedOrAll(lines: readonly string[], all: boolean | undefined, ids: () => string[]) {
  if (all && lines.length) throw new Error('name lines or give --all, not both');
  if (!all && !lines.length) throw new Error('name the lines, or give --all');
  return all ? ids() : lines;
}

async function loadVoiceProject(name: string) {
  const { resolveStudioProjectWith } = await import('#lib/platform/project/engine/studio-project.ts');
  const { readProjectVoiceScript } = await import('#lib/timing/storyboard/engine/project-storyboard.ts');
  const project = resolveStudioProjectWith(name, 'storyboard.ts');
  return { project, script: await readProjectVoiceScript(project) };
}

async function printUnvoiced(project: string, script: VoiceScript) {
  const { unvoicedVoiceLines } = await import('#lib/timing/voice/engine/voice-project.ts');
  const unvoiced = unvoicedVoiceLines(project, script);
  if (unvoiced.length) console.log(`unvoiced: ${unvoiced.join(', ')}`);
}

/** When a take was read, to the minute. */
const when = (madeAt: string) => new Date(madeAt).toLocaleString('sv-SE').slice(0, 16);

const syncArgs = {
  project: studioProjectArg,
  draft: { type: 'boolean', description: 'Read missing lines with macOS say: free, offline and flat, for hearing the timing. A paid take that reads a line as it is now still wins' },
  dry: { type: 'boolean', description: 'Say what it would reuse and read, and why each line is stale, without changing or paying for anything' },
} as const satisfies ArgsDef;

const syncCommand = defineCommand({
  meta: {
    name: 'sync',
    description: "Voice every line of storyboard.ts as it is now, reading only the lines no kept take reads.",
    about: "Reads storyboard.ts's `voice`, `voiceDirection` and its scenes' lines in plan order. Each line keeps the take chosen for it while that take reads it as it is now (its text and paragraph, and the take's model, voice and direction), else uses a kept take that does, and nothing is paid. The rest are read, one pickup per run of lines, each after the line before it, which is read for the lead-in and keeps its own take. A line cut from a recording is kept even when its text changed, with a warning. An unchanged line keeps its own audio, duration and pause before; its place in the video still moves when an earlier line changes length. Writes each line's clip as audio/clips/<line>-<hash>.wav (never written over, so a render under way keeps its clips), audio/manifest.ts and audio/comp.json (the take each line is cut from); a pickup whose join isn't clean is refused, its take kept. Prints audio/manifest.ts.",
  },
  args: syncArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, syncArgs);
    operandsAfterProject(args, 0);
    const { project, script } = await loadVoiceProject(args.project);
    const { syncVoice, voiceSyncDryRun } = await import('#lib/timing/voice/engine/voice-project.ts');
    if (args.dry) {
      for (const line of voiceSyncDryRun(project, script, { draft: !!args.draft })) console.log(line);
      return;
    }
    console.log(await syncVoice(project, script, { draft: !!args.draft }));
  },
});

const rereadArgs = { project: studioProjectArg, lines: linesArg, all: allArg } as const satisfies ArgsDef;

const rereadCommand = defineCommand({
  meta: {
    name: 'reread',
    description: 'Pay for a new read of exactly these lines and choose it for them.',
    about: "Gemini TTS on OpenRouter (needs OPENROUTER_API_KEY), to hear another performance: it reads differently every time. Each run of the lines is read after the line before it, for the lead-in, which keeps its own take. Nothing else changes: other lines keep their takes, and lines still unvoiced stay so. The takes the lines had stay kept: use goes back to one. Prints audio/manifest.ts and any lines still unvoiced.",
  },
  args: rereadArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, rereadArgs);
    const { project, script } = await loadVoiceProject(args.project);
    const lines = namedOrAll(operandsAfterProject(args), args.all, () => script.lines.map((line) => line.id));
    const { rereadVoiceLines } = await import('#lib/timing/voice/engine/voice-project.ts');
    console.log(await rereadVoiceLines(project, script, lines));
    await printUnvoiced(project, script);
  },
});

const useArgs = {
  project: studioProjectArg,
  take: { type: 'positional', required: true, description: "The kept take's number, as takes lists them" },
  lines: linesArg,
} as const satisfies ArgsDef;

const useCommand = defineCommand({
  meta: {
    name: 'use',
    description: 'Choose a kept take for some lines, or every line it reads as it is now, without paying.',
    about: "Without lines, the take is chosen for every line it reads as the script is now, never the line it read only for its lead-in. A named line it can't be used for (another text, voice or direction; a recording: another text) fails before anything changes. Prints audio/manifest.ts, what it chose and skipped, and any lines still unvoiced.",
  },
  args: useArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, useArgs);
    const number = Number(args.take);
    if (!Number.isInteger(number)) throw new Error(`use takes a take's number (studio voice takes lists them), not ${args.take}`);
    const lines = operandsAfterProject(args).slice(1);
    const { project, script } = await loadVoiceProject(args.project);
    const { useVoiceTake } = await import('#lib/timing/voice/engine/voice-project.ts');
    const used = await useVoiceTake(project, script, number, lines.length ? lines : undefined);
    console.log(used.manifest);
    console.log(`take ${number} chosen for ${used.chosen.join(', ')}`);
    for (const { id, reasons } of used.skipped) console.log(`skipped ${id}: ${reasons.join(', ')}`);
    await printUnvoiced(project, script);
  },
});

const importArgs = {
  project: studioProjectArg,
  recording: { type: 'positional', required: true, description: 'The recording, any format ffmpeg reads (read.m4a)' },
  lines: linesArg,
  all: allArg,
} as const satisfies ArgsDef;

const importCommand = defineCommand({
  meta: {
    name: 'import',
    description: 'Keep a recording (a human read) of these lines as a new take and choose it for them.',
    about: "The file must hold exactly these lines, in storyboard order, with nothing before the first: no lead-in. Never pays. A recorded line is judged on its text alone, so a new voice or direction never replaces it; sync keeps it even when its text changes, and reread or use replaces it. Prints audio/manifest.ts and any lines still unvoiced.",
  },
  args: importArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, importArgs);
    const { resolve } = await import('node:path');
    const { project, script } = await loadVoiceProject(args.project);
    const lines = namedOrAll(operandsAfterProject(args).slice(1), args.all, () => script.lines.map((line) => line.id));
    const { importVoiceRecording } = await import('#lib/timing/voice/engine/voice-project.ts');
    console.log(await importVoiceRecording(project, script, resolve(args.recording), lines));
    await printUnvoiced(project, script);
  },
});

const takesArgs = {
  project: studioProjectArg,
  line: { type: 'positional', required: false, description: 'One line id, to see the takes that read it' },
} as const satisfies ArgsDef;

const takesCommand = defineCommand({
  meta: {
    name: 'takes',
    description: "List the kept takes, or the takes of one line. Reads and cuts nothing.",
    about: "Without a line: each take's number, source, when read, length, the lines it reads (old: it reads them as they were, not as they are now; after: the line it read only for its lead-in) and the lines it's chosen for, then the lines still unvoiced. With a line: the take it's cut from, and every take that reads it, with its source, length, when read, its text and whether use can choose it (if not, why).",
  },
  args: takesArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, takesArgs);
    operandsAfterProject(args, 1);
    const { project, script } = await loadVoiceProject(args.project);
    const { listVoiceLineTakes, listVoiceTakes } = await import('#lib/timing/voice/engine/voice-project.ts');
    if (args.line) {
      const { current, takes } = listVoiceLineTakes(project, script, args.line);
      console.log(`${args.line}: ${current === null ? 'unvoiced' : `cut from take ${current}`}`);
      for (const take of takes) {
        const verdict = take.reasons.length ? `can't use: ${take.reasons.join(', ')}` : 'usable';
        console.log(`${String(take.number).padStart(3)}  ${take.source.padEnd(9)}  ${when(take.madeAt)}  ${take.seconds.toFixed(1).padStart(6)}s  "${take.excerpt}"  ${verdict}`);
      }
      return;
    }
    for (const take of listVoiceTakes(project, script)) {
      const reads = take.lines.map((line) => (line.now ? line.id : `${line.id} (old)`)).join(' ') || 'nothing in the script';
      const chosen = take.chosenFor.length ? `  chosen for ${take.chosenFor.join(' ')}` : '';
      console.log(`${String(take.number).padStart(3)}  ${take.source.padEnd(9)}  ${when(take.madeAt)}  ${take.seconds.toFixed(1).padStart(6)}s  reads ${reads}${take.context ? ` after ${take.context}` : ''}${chosen}`);
    }
    await printUnvoiced(project, script);
  },
});

export default defineCommand({
  meta: {
    name: 'voice',
    description: "Voice the lines of a project's storyboard.ts, each cut from the take chosen for it.",
    about: "A take reads some lines, and every take is kept in audio/takes/, never written over; audio/comp.json names the take each voiced line is cut from. Lines not yet voiced are timed from their word count. sync brings every line up to the script, reading only what no kept take reads; reread pays for another performance of named lines; use goes back to a kept take; import keeps a human read; takes lists them.",
  },
  setup: refuseOptionsBeforeSubcommand,
  subCommands: { sync: syncCommand, reread: rereadCommand, use: useCommand, import: importCommand, takes: takesCommand },
});
