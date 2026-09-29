// The one way a harness entry point runs its command, as cli/studio.ts runs studio's: help and usage through citty's
// runMain, any other failure as one line on stderr and exit 1, not a stack.
import { runCommand, runMain, type CommandDef } from 'citty';

export async function runHarnessCommand(command: CommandDef) {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs.some((a) => a === '--help' || a === '-h')) {
    await runMain(command, { rawArgs });
    return;
  }
  try {
    await runCommand(command, { rawArgs });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`, () => process.exit(1));
  }
}
