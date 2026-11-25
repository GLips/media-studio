// studio library: the one store of footage any project draws on (lib/footage/library/). Each verb builds an Effect
// program and runs it with the library's layer; its stdout is the payload, its progress Effect.log lines on stderr.
import { defineCommand, type ArgsDef } from 'citty';
import type { Effect } from 'effect';
import type { LibraryStore } from '#lib/footage/library/engine/library-store.ts';
import type { LibraryMediaFolder } from '#lib/footage/library-media/engine/library-media-folder.ts';
import type { RecorderDeviceLatencies } from '#lib/footage/library/engine/library-recorder-latencies.ts';
import type { FootageTranscriber } from '#lib/footage/transcript/engine/footage-transcriber.ts';
import type { StudioFfmpeg } from '#lib/platform/ffmpeg/engine/studio-ffmpeg.ts';
import type { NodeServices } from '@effect/platform-node';
import { refuseOptionsBeforeSubcommand, refuseUnknownCommandFlags } from '../command-flags.ts';

type LibraryServices = LibraryStore | LibraryMediaFolder | RecorderDeviceLatencies | FootageTranscriber | StudioFfmpeg | NodeServices.NodeServices;

/** Runs a verb's program over the library's services, loaded as the verb runs. */
async function runLibraryProgram<A, E>(program: Effect.Effect<A, E, LibraryServices>): Promise<A> {
  const [{ runStudioEffect }, { libraryLayer }] = await Promise.all([
    import('#lib/platform/process/engine/studio-effect-runtime.ts'),
    import('#lib/footage/library/engine/library-layer.ts'),
  ]);
  return runStudioEffect(program, libraryLayer);
}

const libraryItemArg = { type: 'positional', required: true, description: 'The item, by its id or a part of it only one id holds' } as const;

const addCommand = defineCommand({
  meta: {
    name: 'add',
    description: 'Add footage to the library: a file, a recorder folder, or several files as one item\'s named tracks.',
    about: "One file becomes an item with one track (video, or audio when it has no picture). A Studio Recorder folder becomes one recording, its tracks' starts, latencies and mic drift read from its recording.json; a take the recorder was killed in is added as interrupted. Several files as name=path (screen=display.mp4 camera=camera.mp4 mic=mic.ogg) become one item, every track starting at 0 unless --starts says otherwise. A track whose --devices name matches the recorder's camera or mic setting takes that device's latency (the Elgato's 0.16 s); --latencies overrides. Files are copied into the media folder (free on the same APFS volume), or moved with --move. Then its speech track (the mic, else the first with sound) is transcribed by local whisper, its metadata written to work/library/items/<id>/, and each track that's variable-rate, over HD or not H.264 gets an HD constant-rate proxy. Prints the item as JSON.",
  },
  args: {
    paths: { type: 'positional', required: true, description: 'A file or recorder folder, or tracks as name=path' },
    title: { type: 'string', description: 'What the item is called; its folder or file name by default' },
    starts: { type: 'string', description: 'Each track\'s start in item seconds, as screen=0.033,camera=0' },
    devices: { type: 'string', description: 'Each track\'s device, as camera=Cam Link' },
    latencies: { type: 'string', description: 'Each track\'s latency in seconds, as camera=0.16' },
    move: { type: 'boolean', default: false, description: 'Move the files into the media folder rather than copy them' },
    proxies: { type: 'boolean', default: true, description: 'Make editing proxies (--no-proxies to leave them for `studio library finish`)' },
  },
  async run({ args }) {
    const { Effect, Result } = await import('effect');
    const { addLibraryItem } = await import('#lib/footage/library/engine/add-library-item.ts');
    const { parseTrackValues } = await import('#lib/footage/library/models/library-sources.ts');
    const { LibraryRequestRefused } = await import('#lib/footage/library/models/library-errors.ts');
    const trackSeconds = (value: string, track: string) => {
      const n = Number(value);
      return Number.isFinite(n) ? Result.succeed(n) : Result.fail(new LibraryRequestRefused({ reason: `${track}'s ${value} isn't seconds` }));
    };
    const { printStudioJson } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
    await runLibraryProgram(Effect.gen(function* () {
      const item = yield* addLibraryItem({
        paths: args._, title: args.title, move: args.move, proxies: args.proxies,
        starts: yield* Effect.fromResult(parseTrackValues(args.starts, trackSeconds)),
        latencies: yield* Effect.fromResult(parseTrackValues(args.latencies, trackSeconds)),
        devices: yield* Effect.fromResult(parseTrackValues(args.devices, (v) => Result.succeed(v))),
      });
      yield* printStudioJson(item);
    }));
  },
});

const finishCommand = defineCommand({
  meta: {
    name: 'finish',
    description: 'Make what an item lacks from its media: its transcript, its speech cleaned and levelled, then its editing proxies.',
    about: 'An add ends with this; run it after an add that failed or was stopped part way, or one run with --no-proxies. Needs the media online.',
  },
  args: { item: libraryItemArg, proxies: { type: 'boolean', default: true, description: 'Make proxies too' } },
  async run({ args }) {
    const { Effect } = await import('effect');
    const { finishLibraryItem } = await import('#lib/footage/library/engine/add-library-item.ts');
    const { LibraryStore } = await import('#lib/footage/library/engine/library-store.ts');
    const { printStudioJson } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
    await runLibraryProgram(Effect.gen(function* () {
      const id = yield* (yield* LibraryStore).resolveItemId(args.item);
      yield* printStudioJson(yield* finishLibraryItem(id, { proxies: args.proxies }));
    }));
  },
});

const listCommand = defineCommand({
  meta: { name: 'list', description: 'Print every item: id, length, tracks, flags and title.', about: 'Reads committed metadata only, so it works with the media offline; it says when the media is.' },
  args: { json: { type: 'boolean', description: 'Print the items as JSON' } },
  async run({ args }) {
    const { Console, Effect } = await import('effect');
    const { LibraryStore } = await import('#lib/footage/library/engine/library-store.ts');
    const { LibraryMediaFolder } = await import('#lib/footage/library-media/engine/library-media-folder.ts');
    const { formatReviewClock } = await import('#lib/output/review/models/review-timeline-geometry.ts');
    const { printStudioJson } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
    await runLibraryProgram(Effect.gen(function* () {
      const store = yield* LibraryStore, media = yield* LibraryMediaFolder;
      const items = yield* Effect.forEach(yield* store.itemIds(), (id) => Effect.all({ item: store.readItem(id), flags: Effect.map(store.readFlags(id), (file) => file.flags.length) }));
      if (args.json) {
        yield* printStudioJson(items.map(({ item }) => item));
        return;
      }
      if (!(yield* media.isOnline())) yield* Effect.log(`media offline: ${(yield* media.location()).path} isn't there; listing from metadata`);
      if (!items.length) yield* Effect.log('the library is empty: `studio library add <file>` adds footage');
      for (const { item, flags } of items) {
        const interrupted = item.source.kind === 'studio-recorder' && item.source.status === 'interrupted' ? ' (interrupted)' : '';
        yield* Console.log(`${item.id}  ${formatReviewClock(item.durationSeconds)}  ${Object.keys(item.tracks).join('+')}  ${flags ? `${flags} flag${flags > 1 ? 's' : ''}  ` : ''}${item.title}${interrupted}`);
      }
    }));
  },
});

const searchCommand = defineCommand({
  meta: {
    name: 'search',
    description: 'Find footage by what is said in it, or by a flag\'s note.',
    about: "Matches the words in order, ignoring case and punctuation, in each item's committed transcript, and flag notes that hold the text. Prints each hit's item, range in item time and the line around it. Works with the media offline.",
  },
  args: {
    text: { type: 'positional', required: true, description: 'Words said, or in a flag\'s note' },
    item: { type: 'string', description: 'Search this item only' },
    json: { type: 'boolean', description: 'Print the hits as JSON, times in seconds' },
  },
  async run({ args }) {
    const { Console, Effect } = await import('effect');
    const { LibraryStore } = await import('#lib/footage/library/engine/library-store.ts');
    const { searchLibrary } = await import('#lib/footage/library/models/library-search.ts');
    const { formatReviewClockRange } = await import('#lib/output/review/models/review-timeline-geometry.ts');
    const { printStudioJson } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
    await runLibraryProgram(Effect.gen(function* () {
      const store = yield* LibraryStore, text = args._.join(' ');
      const only = args.item ? yield* store.resolveItemId(args.item) : undefined;
      const hits = yield* Effect.fromResult(searchLibrary((yield* store.readForSearch()).filter(({ item }) => !only || item.id === only), text));
      if (args.json) {
        yield* printStudioJson(hits);
        return;
      }
      if (!hits.length) yield* Effect.log(`nothing in the library says "${text}"`);
      for (const hit of hits) {
        yield* Console.log(`${hit.item}  ${formatReviewClockRange(hit.start, hit.end)}  ${hit.on === 'flag' ? `flag #${hit.flag}: ` : `${hit.track}: `}${hit.text}`);
      }
    }));
  },
});

const showCommand = defineCommand({
  meta: { name: 'show', description: 'Print an item: its tracks and sync, whether its media is online, the projects using it, its flags and transcript.', about: 'Reads committed metadata; works with the media offline. A project uses an item when its source imports `#library/<id>/item.json` or a transcript. Every track with sound is transcribed; with two or more (the far side of a call is on system), the transcript is interleaved in time order, each line labelled by its track.' },
  args: { item: libraryItemArg, json: { type: 'boolean', description: 'Print item.json, the projects that use it (usedBy), the flags file and the transcript (every spoken track, by name) as JSON' } },
  async run({ args }) {
    const { Console, Effect, Option } = await import('effect');
    const { LibraryStore } = await import('#lib/footage/library/engine/library-store.ts');
    const { LibraryMediaFolder } = await import('#lib/footage/library-media/engine/library-media-folder.ts');
    const { libraryFootage, libraryTranscriptLines } = await import('#lib/footage/library/models/library-footage.ts');
    const { librarySpokenTracks } = await import('#lib/footage/library/models/library-item.ts');
    const { formatReviewClock, formatReviewClockRange } = await import('#lib/output/review/models/review-timeline-geometry.ts');
    const { printStudioJson } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
    await runLibraryProgram(Effect.gen(function* () {
      const store = yield* LibraryStore, media = yield* LibraryMediaFolder;
      const id = yield* store.resolveItemId(args.item);
      const item = yield* store.readItem(id), flags = yield* store.readFlags(id);
      const transcript = Option.getOrUndefined(yield* store.readTranscript(id));
      const usedBy = yield* store.projectsUsing(id);
      if (args.json) {
        yield* printStudioJson({ item, usedBy, flags, ...(transcript && { transcript }) });
        return;
      }
      const online = yield* media.isOnline(), { path } = yield* media.location();
      yield* Console.log(`${item.id}  ${item.title}\n${formatReviewClock(item.durationSeconds)} long, ${item.recordedAt ? `recorded ${item.recordedAt}, ` : ''}added ${item.addedAt}`);
      yield* Console.log(`media: ${online ? path : `offline (${path} isn't there)`}`);
      for (const [name, track] of Object.entries(item.tracks)) {
        const what = [track.video && `${track.video.width}×${track.video.height} ${track.video.codec} ${track.video.fps} fps${track.video.variableRate ? ' variable' : ''}`, track.audio && `${track.audio.codec} ${track.audio.sampleRate} Hz`].filter(Boolean).join(', ');
        const sync = [`starts ${track.startSeconds.toFixed(3)} s`, track.latencySeconds && `latency ${track.latencySeconds} s`, track.hostDriftSeconds && `drift ${(track.hostDriftSeconds * 1000).toFixed(2)} ms`].filter(Boolean).join(', ');
        yield* Console.log(`  ${name}: ${track.file}, ${what}; ${sync}${track.device ? `; ${track.device}` : ''}${track.proxy ? `; proxy ${track.proxy.width}×${track.proxy.height}` : ''}`);
      }
      for (const [name, why] of Object.entries({ ...item.leftOut })) yield* Console.log(`  ${name}: left out, ${why}`);
      for (const [name, what] of Object.entries({ ...item.problems })) yield* Console.log(`  ${name}: ${what}`);
      yield* Console.log(usedBy.length ? `used by: ${usedBy.join(', ')}` : 'used by no project');
      if (flags.flags.length) yield* Console.log('flags:');
      for (const flag of flags.flags) yield* Console.log(`  #${flag.id}  ${formatReviewClockRange(flag.start, flag.end)}  ${flag.note ?? ''}  (${flag.by})`);
      const spoken = librarySpokenTracks(item), lines = libraryTranscriptLines(libraryFootage(item, transcript).words);
      if (lines.length) yield* Console.log(`transcript (${spoken.join(', ')}):`);
      // Labelled by track only when the item has two sides to tell apart.
      const label = (track: string) => (spoken.length > 1 ? `${track}: ` : '');
      for (const line of lines) yield* Console.log(`  ${formatReviewClock(line.start)}  ${label(line.track)}${line.text}`);
      const missing = spoken.filter((track) => !transcript?.tracks[track]);
      if (missing.length) yield* Console.log(`no transcript of ${missing.join(', ')} yet: \`studio library finish\` makes it`);
    }));
  },
});

const flagCommand = defineCommand({
  meta: {
    name: 'flag',
    description: 'Flag a range of an item, with an optional note; or change or remove a flag.',
    about: 'A flag marks a selection (a good take, a line to use, a stretch to cut), not a task. Times are item time, as search and show print them: seconds or m:ss.cc. It records who set it (--by; the agent by default). Works with the media offline. Prints the flag as JSON.',
  },
  args: {
    item: libraryItemArg,
    start: { type: 'positional', required: false, description: 'Where the range starts' },
    end: { type: 'positional', required: false, description: 'Where it ends; the start alone flags an instant' },
    note: { type: 'string', description: 'What the range is; with --id, its new note (empty clears it)' },
    id: { type: 'string', description: 'Change this flag (its number) rather than add one' },
    remove: { type: 'boolean', description: 'Remove the flag --id names' },
    by: { type: 'string', default: 'agent', description: 'Who sets it: agent, or reviewer when Graham flags by hand' },
  },
  async run({ args }) {
    const { Effect, Schema } = await import('effect');
    const { LibraryStore } = await import('#lib/footage/library/engine/library-store.ts');
    const { LibraryRequestRefused } = await import('#lib/footage/library/models/library-errors.ts');
    const { LibraryFlagAuthor } = await import('#lib/footage/library/models/library-flags.ts');
    const { libraryClockSecondsOf } = await import('#lib/footage/library/models/library-range.ts');
    const refused = (reason: string) => new LibraryRequestRefused({ reason });
    const clockSeconds = (text: string) => Effect.fromResult(libraryClockSecondsOf(text));
    const { printStudioJson } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
    await runLibraryProgram(Effect.gen(function* () {
      const store = yield* LibraryStore;
      const id = yield* store.resolveItemId(args.item);
      const by = yield* Schema.decodeUnknownEffect(LibraryFlagAuthor)(args.by).pipe(Effect.mapError(() => refused(`--by is agent or reviewer, not ${args.by}`)));
      const flagId = args.id === undefined ? undefined : Number(args.id.replace(/^#/, ''));
      if (flagId === undefined) {
        if (args.remove) return yield* refused('--remove needs --id, the flag to remove');
        if (!args.start) return yield* refused('give the range to flag: studio library flag <item> <start> [<end>]');
        const start = yield* clockSeconds(args.start), end = args.end ? yield* clockSeconds(args.end) : start;
        return yield* printStudioJson(yield* store.changeFlags(id, { op: 'flag.add', start, end, ...(args.note && { note: args.note }) }, by));
      }
      if (args.start) return yield* refused("a flag's range is fixed: remove it and flag the new range");
      if (!args.remove && args.note === undefined) return yield* refused('with --id, give --note or --remove');
      return yield* printStudioJson(yield* store.changeFlags(id, args.remove ? { op: 'flag.remove', id: flagId } : { op: 'flag.note', id: flagId, note: args.note ?? '' }, by));
    }));
  },
});

const recordingsCommand = defineCommand({
  meta: {
    name: 'recordings',
    description: "List Studio Recorder's takes, newest first: those in the library, and with --inbox those still in its recordings folder.",
    about: "A take is named by its folder in the recorder's recordings folder; once added it lives in the library, and its folder is gone. A take the add failed on stays in the recordings folder, and --inbox lists it too; one still being recorded is left out. The recorder's menu lists its recent takes with this.",
  },
  args: {
    inbox: { type: 'string', description: "The recorder's recordings folder, to list the takes still in it" },
    limit: { type: 'string', description: 'List only the newest this many' },
    json: { type: 'boolean', description: 'Print the takes as JSON: folder, recordedAt, durationSeconds, and item (id, mediaFolder) once added' },
  },
  async run({ args }) {
    const { Console, Effect, Path } = await import('effect');
    const { listLibraryRecorderTakes } = await import('#lib/footage/library/engine/library-recorder-takes.ts');
    const { LibraryRequestRefused } = await import('#lib/footage/library/models/library-errors.ts');
    const { formatReviewClock } = await import('#lib/output/review/models/review-timeline-geometry.ts');
    const { printStudioJson } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
    await runLibraryProgram(Effect.gen(function* () {
      const limit = args.limit === undefined ? undefined : Number(args.limit);
      if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) yield* new LibraryRequestRefused({ reason: `--limit is a count, not ${args.limit}` });
      const path = yield* Path.Path;
      const takes = yield* listLibraryRecorderTakes({ inbox: args.inbox && path.resolve(args.inbox), limit });
      if (args.json) {
        yield* printStudioJson(takes);
        return;
      }
      if (!takes.length) yield* Effect.log('no recorder takes yet');
      for (const take of takes) {
        const length = take.durationSeconds === null ? 'interrupted' : formatReviewClock(take.durationSeconds);
        yield* Console.log(`${path.basename(take.folder)}  ${length}  ${take.item ? take.item.id : `not added: ${take.folder}`}`);
      }
    }));
  },
});

const removeCommand = defineCommand({
  meta: {
    name: 'remove',
    description: 'Remove an item, its media and its metadata (transcript and flags too); or a recorder take wherever it went.',
    about: "With --take, the recorder take at that folder in its recordings folder: the item added from it, and the folder if the take is still there. Refused while a project uses the item, while the media is offline (its media would be left behind), and for a take still being recorded. Removes files for good; the item's metadata leaves work/ as an uncommitted deletion.",
  },
  args: {
    item: { type: 'positional', required: false, description: 'The item, by its id or a part of it only one id holds' },
    take: { type: 'string', description: "A recorder take's folder, as the recorder named it" },
  },
  async run({ args }) {
    const { Effect, Path } = await import('effect');
    const { LibraryStore } = await import('#lib/footage/library/engine/library-store.ts');
    const { removeLibraryItem, removeLibraryRecorderTake } = await import('#lib/footage/library/engine/library-recorder-takes.ts');
    const { LibraryRequestRefused } = await import('#lib/footage/library/models/library-errors.ts');
    await runLibraryProgram(Effect.gen(function* () {
      const refused = new LibraryRequestRefused({ reason: 'name an item, or a take with --take, not both' });
      if (args.take) return yield* (args.item ? refused : removeLibraryRecorderTake((yield* Path.Path).resolve(args.take)));
      if (!args.item) return yield* refused;
      return yield* removeLibraryItem(yield* (yield* LibraryStore).resolveItemId(args.item));
    }));
  },
});

const pathCommand = defineCommand({
  meta: { name: 'path', description: "Print the path of an item's track media, its proxy, or its input log.", about: 'Fails with "media offline" when the media folder isn\'t there.' },
  args: {
    item: libraryItemArg,
    track: { type: 'positional', required: false, description: 'The track (screen, camera, mic…), or input for the input log; the first track by default' },
    proxy: { type: 'boolean', description: "The track's editing proxy rather than its original" },
  },
  async run({ args }) {
    const { Console, Effect } = await import('effect');
    const { LibraryStore } = await import('#lib/footage/library/engine/library-store.ts');
    const { LibraryMediaFolder } = await import('#lib/footage/library-media/engine/library-media-folder.ts');
    const { LibraryRequestRefused } = await import('#lib/footage/library/models/library-errors.ts');
    await runLibraryProgram(Effect.gen(function* () {
      const store = yield* LibraryStore, media = yield* LibraryMediaFolder;
      const item = yield* store.readItem(yield* store.resolveItemId(args.item));
      if (args.track === 'input') {
        if (!item.input) return yield* new LibraryRequestRefused({ reason: `${item.id} has no input log` });
        return yield* Console.log(yield* media.itemFile(item.id, item.input.file));
      }
      const name = args.track ?? Object.keys(item.tracks)[0], track = item.tracks[name];
      if (!track) return yield* new LibraryRequestRefused({ reason: `${item.id} has no ${name} track; it has ${Object.keys(item.tracks).join(', ')}` });
      if (args.proxy && !track.proxy) return yield* new LibraryRequestRefused({ reason: `${item.id}'s ${name} has no proxy${track.video ? ': it needs none, or `studio library finish` makes it' : ': it has no picture'}` });
      return yield* Console.log(yield* media.itemFile(item.id, args.proxy && track.proxy ? track.proxy.file : track.file));
    }));
  },
});

const optionalSeconds = (text: string | undefined) => (text === undefined ? undefined : Number(text));

const lookCommand = defineCommand({
  meta: {
    name: 'look',
    description: "Draw contact sheets of an item's track: a frame every few seconds, each labelled with its item time.",
    about: "For skimming a recording without watching it: what's on screen when, when the speaker is on camera, and private data showing (client names, inboxes, keys). A sheet is 1920 px wide: four across (24 frames) shows what's on screen, two across (6) or one (a frame alone) reads its text. Frames come from the track's proxy when it has one; a long stretch makes several sheets. Sheets are kept in the item's media folder and read back when asked again. Prints each sheet's path; open it with an image viewer or the Read tool. Needs the media online.",
  },
  args: {
    item: libraryItemArg,
    track: { type: 'positional', required: false, description: 'The track with a picture (screen, camera…); the first by default' },
    every: { type: 'string', default: '10', description: 'Seconds between frames' },
    columns: { type: 'string', default: '4', description: 'Frames across a sheet, 1 to 8' },
    from: { type: 'string', description: 'Item second to start at (default 0)' },
    to: { type: 'string', description: "Item second to stop at (default the item's end)" },
  },
  async run({ args }) {
    const { Console, Effect } = await import('effect');
    const { lookAtLibraryTrack } = await import('#lib/footage/library/engine/library-look.ts');
    await runLibraryProgram(Effect.gen(function* () {
      const sheets = yield* lookAtLibraryTrack({ item: args.item, track: args.track, every: Number(args.every), from: optionalSeconds(args.from), to: optionalSeconds(args.to), columns: Number(args.columns) });
      for (const sheet of sheets) yield* Console.log(sheet);
    }));
  },
});

const libraryOpenArgs = {
  item: libraryItemArg,
  port: { type: 'string', description: "Port of the studio app: the main checkout's 4317, or one fixed per worktree, by default" },
  open: { type: 'boolean', default: true, description: 'Open it in the browser (--no-open to just serve)' },
} as const satisfies ArgsDef;

const openCommand = defineCommand({
  meta: {
    name: 'open',
    description: "Open an item's page in the studio app, to watch, read and flag it.",
    about: 'Starts the studio app in the background if it isn\'t running (`studio app --help`) and returns; in a worktree it serves the app here until Ctrl-C. Studio Recorder opens a recent take this way. Reads committed metadata, so the page opens with the media offline; it says so where it would play.',
  },
  args: libraryOpenArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs.filter((arg) => arg !== '--no-open'), libraryOpenArgs);
    const { Effect } = await import('effect');
    const { LibraryStore } = await import('#lib/footage/library/engine/library-store.ts');
    const { describeStudioAppPlace, openStudioAppPageInBrowser, reachStudioApp } = await import('#lib/platform/web/engine/studio-app-open.ts');
    // The item is resolved before the app is reached, so a wrong id fails without starting it.
    const id = await runLibraryProgram(Effect.gen(function* () {
      return yield* (yield* LibraryStore).resolveItemId(args.item);
    }));
    const app = await reachStudioApp(args.port === undefined ? {} : { port: Number(args.port) });
    const url = `${app.url}/library/${encodeURIComponent(id)}`;
    if (args.open) openStudioAppPageInBrowser(url);
    process.stderr.write(`${id} on ${url}, ${describeStudioAppPlace(app)}\n`);
    if (app.servingHere) await new Promise(() => {});
  },
});

const configCommand = defineCommand({
  meta: {
    name: 'config',
    description: "Show or set this machine's library settings: where its media folder is.",
    about: "Kept in work/library.local.json, ignored by git, since each machine keeps its media in its own place. The media folder defaults to work/library/media/. Pointing it at a drive is a setting, not a migration: move the folder's contents there yourself, then set it. Device latencies are the recorder's settings (`studio recorder install --help`).",
  },
  args: { 'media-folder': { type: 'string', description: 'Where the media is now: a path, or "default" for work/library/media/' } },
  async run({ args }) {
    const { Effect, Path } = await import('effect');
    const { LibraryMediaFolder } = await import('#lib/footage/library-media/engine/library-media-folder.ts');
    const folder = args['media-folder'];
    const { printStudioJson } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
    await runLibraryProgram(Effect.gen(function* () {
      const media = yield* LibraryMediaFolder, path = yield* Path.Path;
      if (folder !== undefined) {
        const { mediaFolder: _, ...rest } = yield* media.settings();
        yield* media.writeSettings(folder === 'default' ? rest : { ...rest, mediaFolder: path.resolve(folder) });
      }
      const { path: mediaFolder, configured } = yield* media.location();
      yield* printStudioJson({ mediaFolder, default: !configured, online: yield* media.isOnline() });
    }));
  },
});

export default defineCommand({
  meta: {
    name: 'library',
    description: 'The footage library: add, list, search, show, flag and remove footage any project can use.',
    about: "Each item's metadata (item.json, its transcript and flags) is committed in work/library/items/<id>/; its media lives in this machine's media folder (`studio library config`), which may be an external drive. Listing, search, show and flags read the metadata alone and work with the media offline; whatever needs the media says plainly when it's offline. A recording is one item with several tracks on one clock; each track's start, latency and drift are numbers in item.json, applied when read, never baked into the media.",
  },
  setup: refuseOptionsBeforeSubcommand,
  subCommands: { add: addCommand, finish: finishCommand, list: listCommand, search: searchCommand, show: showCommand, flag: flagCommand, recordings: recordingsCommand, remove: removeCommand, path: pathCommand, look: lookCommand, open: openCommand, config: configCommand },
});
