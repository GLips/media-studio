// studio home: where the studio repo is, for scripts and skills that need its files from elsewhere.
import { defineCommand } from 'citty';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';

export default defineCommand({
  meta: {
    name: 'home',
    description: "Print the studio checkout's root, for `cd \"$(studio home)\"` and absolute paths into it.",
  },
  run() {
    console.log(STUDIO_ROOT);
  },
});
