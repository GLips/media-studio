// studio home: where the studio repo is, for scripts and skills that need its files from elsewhere.
import { defineCommand } from 'citty';
import { STUDIO_ROOT } from '../../lib/studio-project.ts';

export default defineCommand({
  meta: { name: 'home', description: 'Print the studio repo root, e.g. cd "$(studio home)".' },
  run() {
    console.log(STUDIO_ROOT);
  },
});
