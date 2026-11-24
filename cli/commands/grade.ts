// studio grade: a library item's camera footage colour-corrected and given a look, as before/after stills or a graded
// copy (lib/footage/library/engine/library-grade.ts). Its stdout is the files' paths; progress goes to stderr.
import { defineCommand } from 'citty';
import type { Effect } from 'effect';
import type { NodeServices } from '@effect/platform-node';
import type { LibraryStore } from '#lib/footage/library/engine/library-store.ts';
import type { LibraryMediaFolder } from '#lib/footage/library-media/engine/library-media-folder.ts';
import type { StudioFfmpeg } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import { refuseOptionsBeforeSubcommand } from '../command-flags.ts';

/** Runs a verb's program over the library's services, loaded as the verb runs. */
async function runGradeProgram<A, E>(program: Effect.Effect<A, E, LibraryStore | LibraryMediaFolder | StudioFfmpeg | NodeServices.NodeServices>): Promise<A> {
  const [{ runStudioEffect }, { libraryLayer }] = await Promise.all([
    import('#lib/platform/process/engine/studio-effect-runtime.ts'),
    import('#lib/footage/library/engine/library-layer.ts'),
  ]);
  return runStudioEffect(program, libraryLayer);
}

const gradeArgs = {
  item: { type: 'positional', required: true, description: 'The library item, by its id or a part of it only one id holds' },
  look: { type: 'string', default: 'desk-day', description: 'The look: desk-day (PP3 by day, gentle; the default), film-kodak or film-fuji (desk-day through a print-film LUT at half strength), desk-night (mixed night light, stronger) or desk-night-person (desk-night by the person matte alone)' },
  track: { type: 'string', default: 'camera', description: 'The track to grade' },
} as const;

/** The look named, or a refusal listing them. */
async function gradeLookOf(name: string) {
  const { LIBRARY_GRADE_LOOKS, isLibraryGradeLookName } = await import('#lib/footage/library/models/library-grade.ts');
  if (!isLibraryGradeLookName(name)) throw new Error(`--look is one of ${Object.keys(LIBRARY_GRADE_LOOKS).join(', ')}, not ${name}`);
  return name;
}

async function itemSeconds(text: string) {
  const { Result } = await import('effect');
  const { libraryClockSecondsOf } = await import('#lib/footage/library/models/library-range.ts');
  const read = libraryClockSecondsOf(text);
  if (Result.isFailure(read)) throw read.failure;
  return read.success;
}

const previewCommand = defineCommand({
  meta: {
    name: 'preview',
    description: 'Before and after a look, side by side, at moments of an item\'s camera footage.',
    about: "Measures the track first if it never was (written to its item.json). Each still is the original beside the graded frame, at 720p each, its masks warmed on the second before. Kept in the item's media folder (graded/) and read back when asked again. Prints each still's path; open it with an image viewer or the Read tool. Needs the media online, uv and ffmpeg.",
  },
  args: {
    ...gradeArgs,
    at: { type: 'string', valueHint: '4,12.5,1:02', description: 'Item seconds to show; by default four across the track' },
  },
  async run({ args }) {
    const { Console, Effect } = await import('effect');
    const { previewLibraryGrade } = await import('#lib/footage/library/engine/library-grade.ts');
    const at = args.at ? await Promise.all(args.at.split(',').map(itemSeconds)) : undefined;
    const look = await gradeLookOf(args.look);
    await runGradeProgram(Effect.gen(function* () {
      for (const still of yield* previewLibraryGrade({ item: args.item, track: args.track, look, at })) yield* Console.log(still);
    }));
  },
});

const renderCommand = defineCommand({
  meta: {
    name: 'render',
    description: 'A graded copy of an item\'s camera footage, with its speech in sync.',
    about: "Measures the track first if it never was (written to its item.json), then grades the range in chunks run at once, each warmed on the second before it so the masks don't jump where chunks meet, and lays the item's speech (its levelled copy where it has one) under it on the item's clock, so the copy's first frame is the range's first item second. 29.97 fps, H.264. The original is never touched; the copy is kept in the item's media folder (graded/), named by its look, measurement and size, and read back when asked again. Prints its path. Needs the media online, uv and ffmpeg.",
  },
  args: {
    ...gradeArgs,
    range: { type: 'string', valueHint: '10-20 | 0:10-0:20', description: 'Item seconds from-to; the whole track by default' },
    height: { type: 'string', default: '1080', description: 'Output height in pixels; the width keeps the track\'s shape' },
    chunks: { type: 'string', description: 'Processes run at once (default a third of the cores)' },
  },
  async run({ args }) {
    const { Console, Effect } = await import('effect');
    const { renderLibraryGrade } = await import('#lib/footage/library/engine/library-grade.ts');
    const look = await gradeLookOf(args.look);
    const [from, to] = args.range ? await Promise.all(args.range.split('-').map(itemSeconds)) : [];
    if (args.range && to === undefined) throw new Error(`--range is from-to in item seconds, as 10-20, not ${args.range}`);
    const height = Number(args.height), chunks = args.chunks === undefined ? undefined : Number(args.chunks);
    if (!(Number.isInteger(height) && height >= 144 && height % 2 === 0)) throw new Error(`--height is an even number of pixels from 144, not ${args.height}`);
    if (chunks !== undefined && !(Number.isInteger(chunks) && chunks >= 1)) throw new Error(`--chunks is a whole number from 1, not ${args.chunks}`);
    await runGradeProgram(Effect.gen(function* () {
      yield* Console.log(yield* renderLibraryGrade({ item: args.item, track: args.track, look, from, to, height, chunks }));
    }));
  },
});

export default defineCommand({
  meta: { name: 'grade', description: 'Colour-correct and grade camera footage in the library, measured from its own frames.' },
  setup: refuseOptionsBeforeSubcommand,
  subCommands: { preview: previewCommand, render: renderCommand },
});
