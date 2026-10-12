// studio-command.ts: the `studio` command tree, every verb in cli/commands/<verb>.ts loaded lazily. Apart from
// studio.ts, which runs it, so a spec can walk the tree without running a command.
import { defineCommand } from 'citty';
import type { StudioVerbGroups } from './command-help.ts';

/** Every verb, under the heading the root index lists it by; the index refuses a registered verb missing here. */
export const STUDIO_VERB_GROUPS = {
  make: ['new', 'capture', 'voice', 'audition', 'music', 'sfx', 'gen', 'paint', 'brushes', 'still', 'render'],
  inspect: ['look', 'check', 'clock', 'mix', 'probe', 'study', 'repeatable', 'profile', 'trace', 'api', 'gpu'],
  review: ['review', 'preview'],
  setup: ['workspace', 'hosts', 'remote', 'home'],
} as const satisfies StudioVerbGroups;

export const studioCommand = defineCommand({
  meta: {
    name: 'studio',
    description: 'Videos and stills made in code. `studio <verb> --help` gives a verb\'s modes, outputs, failures and every flag.',
    about: 'A <project> is its slug, part of its name, or a path; projects, brand kits and styles live in the workspace, work/ under `studio home`. A project\'s own paths (out/, music/, review/) are inside it. Payload goes to stdout, progress to stderr.',
  },
  subCommands: {
    workspace: () => import('./commands/workspace.ts').then((m) => m.default),
    brushes: () => import('./commands/brushes.ts').then((m) => m.default),
    new: () => import('./commands/new.ts').then((m) => m.default),
    capture: () => import('./commands/capture.ts').then((m) => m.default),
    probe: () => import('./commands/probe.ts').then((m) => m.default),
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
