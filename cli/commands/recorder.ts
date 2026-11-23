// studio recorder: the native menu-bar recorder (lib/footage/recording/engine/recorder/).
import { defineCommand } from 'citty';
import { refuseOptionsBeforeSubcommand } from '../command-flags.ts';

const installRecorderCommand = defineCommand({
  meta: {
    name: 'install',
    description: 'Build the recorder, install it as ~/Applications/Studio Recorder.app and start it.',
    about: "Needs Xcode's Swift toolchain and an Apple Development signing identity, which keeps its permissions across rebuilds. Its first start asks for Screen Recording, Input Monitoring, Camera and Microphone; it relaunches itself as each of the first two is granted. Its menu picks the screen, camera and mic for the next recording and shows the mic's level and the camera's picture while it's open. Settings are ~/Library/Application Support/StudioRecorder/config.json (hotkey, recordingsDir, screen display, camera and mic by name, each device's latency and the mic's input by device name, sizes and bitrates), written with defaults on first start; the menu writes its picks there, and the rest is read when the app starts. Its log is ~/Library/Logs/StudioRecorder.log.",
  },
  args: {
    identity: { type: 'string', description: 'The codesigning identity (SHA-1 or name); the first Apple Development one by default' },
    launch: { type: 'boolean', default: true, description: 'Start it once installed' },
  },
  async run({ args }) {
    const { installStudioRecorder } = await import('#lib/footage/recording/engine/install-recorder.ts');
    console.log(installStudioRecorder({ identity: args.identity, launch: args.launch }));
  },
});

export default defineCommand({
  meta: {
    name: 'recorder',
    description: 'The menu-bar recorder: one key records screen, camera, mic and an input log, each its own file.',
    about: 'Each finished recording is added to the footage library on its own (`studio library add --move` on its folder, by the checkout that installed the recorder; see `studio library --help`), leaving the recordings folder an inbox; a take it fails on stays there, named in the menu and the log. A recording is a folder: screen.mp4 (HEVC, the display at full pixel size, variable frame rate), camera.mp4 (HEVC, the size the config names), mic.m4a (mono AAC), input.jsonl, clock.jsonl and recording.json, which gives each track its start offset and latency on the one host clock.',
  },
  setup: refuseOptionsBeforeSubcommand,
  subCommands: { install: installRecorderCommand },
});
