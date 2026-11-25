// studio recorder: the native menu-bar recorder (lib/footage/recording/engine/recorder/).
import { defineCommand } from 'citty';
import { refuseOptionsBeforeSubcommand } from '../command-flags.ts';

const installRecorderCommand = defineCommand({
  meta: {
    name: 'install',
    description: 'Build the recorder, install it as ~/Applications/Studio Recorder.app and start it.',
    about: "Needs Xcode's Swift toolchain and an Apple Development signing identity, which keeps its permissions across rebuilds. Its first start asks for Screen Recording, Input Monitoring, Camera and Microphone; it relaunches itself as each of the first two is granted. Its menu picks the screen (a display, or one window or display from the system's picker of thumbnails), camera and mic for the next recording and shows the mic's level and the camera's picture while it's open. Settings are ~/Library/Application Support/StudioRecorder/config.json (hotkey, recordingsDir, screen display and picked window, camera and mic by name, each device's latency and the mic's input by device name, sizes and bitrates), written with defaults on first start; the menu writes its picks there, and the rest is read when the app starts. Its log is ~/Library/Logs/StudioRecorder.log.",
  },
  args: {
    identity: { type: 'string', description: 'The codesigning identity (SHA-1 or name); the first Apple Development one by default' },
    launch: { type: 'boolean', default: true, description: 'Start it once installed' },
  },
  async run({ args }) {
    const { installStudioRecorder } = await import('#lib/footage/recording/engine/install-recorder.ts');
    const { runStudioEffect } = await import('#lib/platform/process/engine/studio-effect-runtime.ts');
    const { Layer } = await import('effect');
    console.log(await runStudioEffect(installStudioRecorder({ identity: args.identity, launch: args.launch }), Layer.empty));
  },
});

export default defineCommand({
  meta: {
    name: 'recorder',
    description: 'The menu-bar recorder: one key records screen, camera, mic and an input log, each its own file.',
    about: 'Each finished recording is added to the footage library on its own (`studio library add --move --no-proxies` on its folder; `studio library finish` makes its proxies, by the checkout that installed the recorder; see `studio library --help`), leaving the recordings folder an inbox; a take it fails on stays there, named in the menu and the log. While it records, the menu bar shows how much of the take is written beside its glyph. Its menu lists the last five takes (`studio library recordings`): clicking one opens its page in the studio app (`studio library open`, which starts the app if it\'s down), or shows its folder while it isn\'t in the library; an open that fails is a warning at the top of the menu until one works. Its Studio App section says whether the studio app is running (`studio app status`, asked as the menu opens) and starts, stops or opens it (`studio app start`, `stop`, `open`). A picked window is recorded until it closes; then each take records the display it was on and says so in the menu and recording.json\'s problems. A recording is a folder: screen.mp4 (HEVC, the display at full pixel size, or the window at its size when the take began, variable frame rate), camera.mp4 (HEVC, the size the config names), mic.m4a (mono AAC), system.m4a (the Mac\'s own sound, every app\'s but the recorder\'s, stereo AAC; the menu\'s Record System Audio turns it off), input.jsonl, clock.jsonl, window.jsonl for a window (where it sat on screen and in the picture, as it moved or was resized) and recording.json, which gives each track its start offset and latency on the one host clock.',
  },
  setup: refuseOptionsBeforeSubcommand,
  subCommands: { install: installRecorderCommand },
});
