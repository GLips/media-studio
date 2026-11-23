// studio library: the one store of footage any project draws on (lib/footage/library/).
import { defineCommand } from 'citty';
import { refuseOptionsBeforeSubcommand } from '../command-flags.ts';

const log = (line: string) => process.stderr.write(`${line}\n`);

/** Seconds as `12.5`, `1:02.5` or `1:02:03`. */
function parseClockSeconds(text: string): number {
  const parts = text.trim().split(':');
  if (parts.length > 3 || parts.some((p) => p === '' || Number.isNaN(Number(p)))) throw new Error(`"${text}" isn't a time: give seconds (72.5) or m:ss (1:12.5)`);
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

function trackSeconds(value: string, track: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${track}'s ${value} isn't seconds`);
  return n;
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
    const { addLibraryItem } = await import('#lib/footage/library/engine/add-library-item.ts');
    const { parseTrackValues } = await import('#lib/footage/library/models/library-sources.ts');
    const item = await addLibraryItem({
      paths: args._, title: args.title, move: args.move, proxies: args.proxies, log,
      starts: parseTrackValues(args.starts, trackSeconds), latencies: parseTrackValues(args.latencies, trackSeconds), devices: parseTrackValues(args.devices, (v) => v),
    });
    console.log(JSON.stringify(item, null, 2));
  },
});

const finishCommand = defineCommand({
  meta: {
    name: 'finish',
    description: 'Make what an item lacks from its media: its transcript, its speech levelled for the mix, then its editing proxies.',
    about: 'An add ends with this; run it after an add that failed or was stopped part way, or one run with --no-proxies. Needs the media online.',
  },
  args: { item: libraryItemArg, proxies: { type: 'boolean', default: true, description: 'Make proxies too' } },
  async run({ args }) {
    const { finishLibraryItem } = await import('#lib/footage/library/engine/add-library-item.ts');
    const { resolveLibraryItemId } = await import('#lib/footage/library/engine/library-store.ts');
    console.log(JSON.stringify(await finishLibraryItem(resolveLibraryItemId(args.item), { proxies: args.proxies, log }), null, 2));
  },
});

const listCommand = defineCommand({
  meta: { name: 'list', description: 'Print every item: id, length, tracks, flags and title.', about: 'Reads committed metadata only, so it works with the media offline; it says when the media is.' },
  args: { json: { type: 'boolean', description: 'Print the items as JSON' } },
  async run({ args }) {
    const store = await import('#lib/footage/library/engine/library-store.ts');
    const { formatReviewClock } = await import('#lib/output/review/models/review-timeline-geometry.ts');
    const items = store.listLibraryItemIds().map((id) => ({ item: store.readLibraryItem(id), flags: store.readLibraryFlags(id).flags.length }));
    if (args.json) {
      console.log(JSON.stringify(items.map(({ item }) => item), null, 2));
      return;
    }
    const media = await import('#lib/footage/library-media/engine/library-media-folder.ts');
    if (!media.libraryMediaIsOnline()) log(`media offline: ${media.libraryMediaFolder().path} isn't there; listing from metadata`);
    if (!items.length) log('the library is empty: `studio library add <file>` adds footage');
    for (const { item, flags } of items) {
      const interrupted = item.source.kind === 'studio-recorder' && item.source.status === 'interrupted' ? ' (interrupted)' : '';
      console.log(`${item.id}  ${formatReviewClock(item.durationSeconds)}  ${Object.keys(item.tracks).join('+')}  ${flags ? `${flags} flag${flags > 1 ? 's' : ''}  ` : ''}${item.title}${interrupted}`);
    }
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
    const store = await import('#lib/footage/library/engine/library-store.ts');
    const { searchLibrary } = await import('#lib/footage/library/models/library-search.ts');
    const { formatReviewClockRange } = await import('#lib/output/review/models/review-timeline-geometry.ts');
    const only = args.item && store.resolveLibraryItemId(args.item);
    const hits = searchLibrary(store.readLibraryForSearch().filter(({ item }) => !only || item.id === only), args._.join(' '));
    if (args.json) {
      console.log(JSON.stringify(hits, null, 2));
      return;
    }
    if (!hits.length) log(`nothing in the library says "${args._.join(' ')}"`);
    for (const hit of hits) {
      console.log(`${hit.item}  ${formatReviewClockRange(hit.start, hit.end)}  ${hit.on === 'flag' ? `flag #${hit.flag}: ` : ''}${hit.text}`);
    }
  },
});

const showCommand = defineCommand({
  meta: { name: 'show', description: 'Print an item: its tracks and sync, whether its media is online, the projects using it, its flags and transcript.', about: 'Reads committed metadata; works with the media offline. A project uses an item when its source imports `#library/<id>/item.json` or `transcript.json`.' },
  args: { item: libraryItemArg, json: { type: 'boolean', description: 'Print item.json, the projects that use it (usedBy), the flags file and the transcript as JSON' } },
  async run({ args }) {
    const store = await import('#lib/footage/library/engine/library-store.ts');
    const { transcriptLines } = await import('#lib/footage/transcript/models/footage-transcript.ts');
    const { libraryItemTimeOf } = await import('#lib/footage/library/models/library-item.ts');
    const { formatReviewClock, formatReviewClockRange } = await import('#lib/output/review/models/review-timeline-geometry.ts');
    const id = store.resolveLibraryItemId(args.item), item = store.readLibraryItem(id), flags = store.readLibraryFlags(id), transcript = store.readLibraryTranscript(id);
    const usedBy = store.projectsUsingLibraryItem(id);
    if (args.json) {
      console.log(JSON.stringify({ item, usedBy, flags, transcript }, null, 2));
      return;
    }
    const media = await import('#lib/footage/library-media/engine/library-media-folder.ts');
    const online = media.libraryMediaIsOnline();
    console.log(`${item.id}  ${item.title}\n${formatReviewClock(item.durationSeconds)} long, ${item.recordedAt ? `recorded ${item.recordedAt}, ` : ''}added ${item.addedAt}`);
    console.log(`media: ${online ? media.libraryMediaFolder().path : `offline (${media.libraryMediaFolder().path} isn't there)`}`);
    for (const [name, track] of Object.entries(item.tracks)) {
      const what = [track.video && `${track.video.width}×${track.video.height} ${track.video.codec} ${track.video.fps} fps${track.video.variableRate ? ' variable' : ''}`, track.audio && `${track.audio.codec} ${track.audio.sampleRate} Hz`].filter(Boolean).join(', ');
      const sync = [`starts ${track.startSeconds.toFixed(3)} s`, track.latencySeconds && `latency ${track.latencySeconds} s`, track.hostDriftSeconds && `drift ${(track.hostDriftSeconds * 1000).toFixed(2)} ms`].filter(Boolean).join(', ');
      console.log(`  ${name}: ${track.file}, ${what}; ${sync}${track.device ? `; ${track.device}` : ''}${track.proxy ? `; proxy ${track.proxy.width}×${track.proxy.height}` : ''}`);
    }
    for (const [name, why] of Object.entries({ ...item.leftOut })) console.log(`  ${name}: left out, ${why}`);
    for (const [name, what] of Object.entries({ ...item.problems })) console.log(`  ${name}: ${what}`);
    console.log(usedBy.length ? `used by: ${usedBy.join(', ')}` : 'used by no project');
    if (flags.flags.length) console.log('flags:');
    for (const flag of flags.flags) console.log(`  #${flag.id}  ${formatReviewClockRange(flag.start, flag.end)}  ${flag.note ?? ''}  (${flag.by})`);
    if (transcript) {
      console.log(`transcript (${transcript.track}):`);
      const track = item.tracks[transcript.track];
      for (const line of transcriptLines(transcript)) console.log(`  ${formatReviewClock(libraryItemTimeOf(track, line.start))}  ${line.text}`);
    } else if (item.speech) console.log('no transcript yet: `studio library finish` makes it');
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
    const { changeLibraryFlags, resolveLibraryItemId } = await import('#lib/footage/library/engine/library-store.ts');
    const id = resolveLibraryItemId(args.item);
    if (args.by !== 'agent' && args.by !== 'reviewer') throw new Error(`--by is agent or reviewer, not ${args.by}`);
    const by = args.by;
    const flagId = args.id === undefined ? undefined : Number(args.id.replace(/^#/, ''));
    if (flagId === undefined) {
      if (args.remove) throw new Error('--remove needs --id, the flag to remove');
      if (!args.start) throw new Error('give the range to flag: studio library flag <item> <start> [<end>]');
      const start = parseClockSeconds(args.start);
      console.log(JSON.stringify(changeLibraryFlags(id, { op: 'flag.add', start, end: args.end ? parseClockSeconds(args.end) : start, ...(args.note && { note: args.note }) }, by), null, 2));
      return;
    }
    if (args.start) throw new Error("a flag's range is fixed: remove it and flag the new range");
    if (!args.remove && args.note === undefined) throw new Error('with --id, give --note or --remove');
    console.log(JSON.stringify(changeLibraryFlags(id, args.remove ? { op: 'flag.remove', id: flagId } : { op: 'flag.note', id: flagId, note: args.note ?? '' }, by), null, 2));
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
    const store = await import('#lib/footage/library/engine/library-store.ts');
    const item = store.readLibraryItem(store.resolveLibraryItemId(args.item));
    if (args.track === 'input') {
      if (!item.input) throw new Error(`${item.id} has no input log`);
      console.log(store.libraryMediaPath(item, item.input.file));
      return;
    }
    const name = args.track ?? Object.keys(item.tracks)[0], track = item.tracks[name];
    if (!track) throw new Error(`${item.id} has no ${name} track; it has ${Object.keys(item.tracks).join(', ')}`);
    if (args.proxy && !track.proxy) throw new Error(`${item.id}'s ${name} has no proxy${track.video ? ': it needs none, or `studio library finish` makes it' : ': it has no picture'}`);
    console.log(store.libraryMediaPath(item, args.proxy && track.proxy ? track.proxy.file : track.file));
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
    const media = await import('#lib/footage/library-media/engine/library-media-folder.ts');
    const folder = args['media-folder'];
    if (folder !== undefined) {
      const { resolve } = await import('node:path');
      const { mediaFolder: _, ...rest } = media.readLibraryMachineSettings();
      media.writeLibraryMachineSettings(folder === 'default' ? rest : { ...rest, mediaFolder: resolve(folder) });
    }
    const { path, configured } = media.libraryMediaFolder();
    console.log(JSON.stringify({ mediaFolder: path, default: !configured, online: media.libraryMediaIsOnline() }, null, 2));
  },
});

export default defineCommand({
  meta: {
    name: 'library',
    description: 'The footage library: add, list, search, show and flag footage any project can use.',
    about: "Each item's metadata (item.json, its transcript and flags) is committed in work/library/items/<id>/; its media lives in this machine's media folder (`studio library config`), which may be an external drive. Listing, search, show and flags read the metadata alone and work with the media offline; whatever needs the media says plainly when it's offline. A recording is one item with several tracks on one clock; each track's start, latency and drift are numbers in item.json, applied when read, never baked into the media.",
  },
  setup: refuseOptionsBeforeSubcommand,
  subCommands: { add: addCommand, finish: finishCommand, list: listCommand, search: searchCommand, show: showCommand, flag: flagCommand, path: pathCommand, config: configCommand },
});
