// studio-child-process.ts: the options every child the studio starts through Effect's ChildProcessSpawner takes.
// Node only.

/**
 * Keeps the child in the studio's process group. Effect's Node spawner detaches children by default off Windows, so
 * a terminal's Ctrl-C would miss them, and only the program's scope could stop them: a `studio` killed without
 * interrupting its Effect would leave ffmpeg or whisper-cli running.
 */
export const STUDIO_CHILD_PROCESS = { detached: false } as const;
