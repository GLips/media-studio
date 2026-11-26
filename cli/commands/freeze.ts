import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

function freezeCommand(action: 'freeze' | 'thaw', description: string) {
  return defineCommand({
    meta: { name: action, description },
    args: { project: studioProjectArg },
    async run({ args }) {
      const { changeProjectFreeze } = await import('#lib/platform/project/engine/project-freeze.ts');
      changeProjectFreeze(args.project, action);
      console.log(`${args.project} is ${action === 'freeze' ? 'frozen' : 'active'}.`);
    },
  });
}
export const freeze = freezeCommand('freeze', 'Check a finished project and record its engine and shared workspace revisions for rendering.');
export const thaw = freezeCommand('thaw', 'Bring a frozen project back under workspace checks and report what needs fixing.');
