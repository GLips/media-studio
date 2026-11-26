import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

function freezeCommand(action: 'freeze' | 'thaw', description: string) {
  return defineCommand({
    meta: { name: action, description },
    args: { 'project...': { ...studioProjectArg, description: 'One or more project slugs, unique name fragments, or paths' } },
    async run({ args }) {
      const { changeProjectFreeze } = await import('#lib/platform/project/engine/project-freeze.ts');
      const names = changeProjectFreeze(args._, action);
      console.log(`${action === 'freeze' ? 'Frozen' : 'Active'}: ${names.join(', ')}.`);
    },
  });
}
export const freeze = freezeCommand('freeze', 'Pin finished projects to the engine they pass on, checked together; checks then skip them.');
export const thaw = freezeCommand('thaw', 'Put frozen projects back under the checks, and report what fails on today\'s engine.');
