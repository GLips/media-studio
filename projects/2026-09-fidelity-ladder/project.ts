// What the fidelity ladder's demo is: scenes of fixed length, with no voice, music or sound. check:arch holds this to
// what the project binds (its timeline's grid and voice, its stills), so a project that takes on a part it didn't
// declare changes this line on purpose.
import type { ProjectDeclaration } from '#models/project/capability.ts';

export default { capability: 'silent' } satisfies ProjectDeclaration;
