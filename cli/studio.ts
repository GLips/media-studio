#!/usr/bin/env node
// studio: the one entry point for making videos in this repo. Each verb lives in cli/commands/<verb>.ts and is
// imported only when run, so `studio home` doesn't load Remotion. Payload goes to stdout, progress to stderr.
import { defineCommand, runCommand, runMain } from 'citty';

const studioCommand = defineCommand({
  meta: {
    name: 'studio',
    description: 'Walkthrough and explainer videos: capture, voice, compose, render. `studio <verb> --help` for each.',
  },
  subCommands: {
    new: () => import('./commands/new.ts').then((m) => m.default),
    capture: () => import('./commands/capture.ts').then((m) => m.default),
    voice: () => import('./commands/voice.ts').then((m) => m.default),
    audition: () => import('./commands/audition.ts').then((m) => m.default),
    music: () => import('./commands/music.ts').then((m) => m.default),
    sfx: () => import('./commands/sfx.ts').then((m) => m.default),
    storyboard: () => import('./commands/storyboard.ts').then((m) => m.default),
    preview: () => import('./commands/preview.ts').then((m) => m.default),
    look: () => import('./commands/look.ts').then((m) => m.default),
    check: () => import('./commands/check.ts').then((m) => m.default),
    mix: () => import('./commands/mix.ts').then((m) => m.default),
    render: () => import('./commands/render.ts').then((m) => m.default),
    repeatable: () => import('./commands/repeatable.ts').then((m) => m.default),
    home: () => import('./commands/home.ts').then((m) => m.default),
    hosts: () => import('./commands/hosts.ts').then((m) => m.default),
  },
});

const rawArgs = process.argv.slice(2);
const wantsUsage = rawArgs.length === 0 || rawArgs.some((a) => a === '--help' || a === '-h') || (rawArgs.length === 1 && (rawArgs[0] === '--version' || rawArgs[0] === '-v'));
// runMain prints help and the version, but prints any other error with its stack; a failed command is one line.
if (wantsUsage) {
  await runMain(studioCommand, { rawArgs });
} else {
  try {
    await runCommand(studioCommand, { rawArgs });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`, () => process.exit(1));
  }
}
