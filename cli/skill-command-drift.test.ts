import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { walkStudioCommands } from './command-help.ts';
import { judgeStudioInvocation, studioInvocationsIn } from './skill-command-drift.ts';
import { studioCommand } from './studio-command.ts';

const SKILLS = fileURLToPath(new URL('../skills/', import.meta.url));

test('every studio command a skill writes names a verb, subverbs and flags the CLI has', async (t) => {
  const tree = await walkStudioCommands(studioCommand);
  const docs = readdirSync(SKILLS, { recursive: true, encoding: 'utf8' }).filter((path) => path.endsWith('.md')).toSorted();
  const drift: string[] = [];
  let checked = 0;
  for (const doc of docs) {
    for (const invocation of studioInvocationsIn(readFileSync(join(SKILLS, doc), 'utf8'))) {
      const verdict = judgeStudioInvocation(tree, invocation);
      const where = `skills/${doc}:${invocation.line}  ${invocation.text}`;
      checked++;
      if (verdict.kind === 'drift') drift.push(`${where}\n    ${verdict.reason}`);
      if (verdict.kind === 'unsupported') t.diagnostic(`unchecked: ${where} (${verdict.reason})`);
    }
  }
  assert.ok(checked > 50, `only ${checked} studio commands found in skills/: is the reader still finding them?`);
  assert.deepEqual(drift, []);
});

test('the reader finds commands in spans and fenced blocks, ends them at the shell, and catches what drifted', async () => {
  const tree = await walkStudioCommands(studioCommand);
  const markdown = [
    // Legal: placeholders, an optional group, an enum value, a pipe, a continuation, and `studio` inside $( ).
    'Run `studio render <project> --scene close [--plain]` or `studio review <verb> --help`.',
    '```sh',
    'studio new demo --capability silent | tee log',
    'ls "$(studio home)/work" && studio still <p> \\',
    '  --preset og',
    '```',
    // Obvious: a flag that doesn't exist. Adversarial: a subverb that doesn't exist, an enum value it doesn't take,
    // and a look-alike word (`studio-review`) that isn't a command.
    'Then `studio render <p> --sceen close`, `studio review comment <p>`, `studio new x --capability loud`; see studio-review.',
  ].join('\n');
  const verdicts = studioInvocationsIn(markdown).map((invocation) => `${invocation.line} ${judgeStudioInvocation(tree, invocation).kind}`);
  assert.deepEqual(verdicts, ['1 ok', '1 ok', '3 ok', '4 ok', '4 ok', '7 drift', '7 drift', '7 drift']);
});
