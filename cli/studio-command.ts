// studio-command.ts: the `studio` command tree, every verb in cli/commands/<verb>.ts loaded lazily. Apart from
// studio.ts, which runs it, so a spec can walk the tree without running a command.
import { defineCommand } from 'citty';
import { refuseOptionsBeforeSubcommand } from './command-flags.ts';
import type { StudioVerbGroups } from './command-help.ts';

/** Every verb, under the heading the root index lists it by; the index refuses a registered verb missing here. */
export const STUDIO_VERB_GROUPS = {
  make: ['new', 'library', 'grade', 'capture', 'voice', 'audition', 'music', 'sfx', 'gen', 'paint', 'brushes', 'still', 'stills', 'render'],
  inspect: ['look', 'check', 'clock', 'mix', 'probe', 'transcribe', 'study', 'repeatable', 'profile', 'trace', 'api', 'gpu'],
  review: ['review', 'preview', 'app'],
  setup: ['freeze', 'thaw', 'workspace', 'hosts', 'remote', 'home', 'recorder', 'camera', 'light'],
} as const satisfies StudioVerbGroups;

export const studioCommand = defineCommand({
  meta: {
    name: 'studio',
    description: 'Make videos and stills in code. See `studio <verb> --help` for modes, outputs, errors and flags. Progress uses stderr.',
    about: '<project> accepts a name, substring or path. Projects, brands and styles live in work/ under `studio home`.',
  },
  setup: refuseOptionsBeforeSubcommand,
  subCommands: {
    freeze: () => import('./commands/freeze.ts').then((m) => m.freeze),
    thaw: () => import('./commands/freeze.ts').then((m) => m.thaw),
    stills: () => import('./commands/still.ts').then((m) => m.default),
    workspace: () => import('./commands/workspace.ts').then((m) => m.default),
    recorder: () => import('./commands/recorder.ts').then((m) => m.default),
    camera: () => import('./commands/camera.ts').then((m) => m.default),
    light: () => import('./commands/light.ts').then((m) => m.default),
    library: () => import('./commands/library.ts').then((m) => m.default),
    grade: () => import('./commands/grade.ts').then((m) => m.default),
    app: () => import('./commands/app.ts').then((m) => m.default),
    brushes: () => import('./commands/brushes.ts').then((m) => m.default),
    new: () => import('./commands/new.ts').then((m) => m.default),
    capture: () => import('./commands/capture.ts').then((m) => m.default),
    probe: () => import('./commands/probe.ts').then((m) => m.default),
    transcribe: () => import('./commands/transcribe.ts').then((m) => m.default),
    voice: () => import('./commands/voice.ts').then((m) => m.default),
    audition: () => import('./commands/audition.ts').then((m) => m.default),
    music: () => import('./commands/music.ts').then((m) => m.default),
    sfx: () => import('./commands/sfx.ts').then((m) => m.default),
    preview: () => import('./commands/preview.ts').then((m) => m.default),
    look: () => import('./commands/look.ts').then((m) => m.default),
    clock: () => import('./commands/clock.ts').then((m) => m.default),
    still: () => import('./commands/still.ts').then((m) => m.default),
    check: () => import('./commands/check.ts').then((m) => m.default),
    mix: () => import('./commands/mix.ts').then((m) => m.default),
    gen: () => import('./commands/gen.ts').then((m) => m.default),
    render: () => import('./commands/render.ts').then((m) => m.default),
    remote: () => import('./commands/remote.ts').then((m) => m.default),
    repeatable: () => import('./commands/repeatable.ts').then((m) => m.default),
    profile: () => import('./commands/profile.ts').then((m) => m.default),
    trace: () => import('./commands/trace.ts').then((m) => m.default),
    study: () => import('./commands/study.ts').then((m) => m.default),
    paint: () => import('./commands/paint.ts').then((m) => m.default),
    review: () => import('./commands/review.ts').then((m) => m.default),
    home: () => import('./commands/home.ts').then((m) => m.default),
    gpu: () => import('./commands/gpu.ts').then((m) => m.default),
    hosts: () => import('./commands/hosts.ts').then((m) => m.default),
    api: () => import('./commands/api.ts').then((m) => m.default),
  },
});
