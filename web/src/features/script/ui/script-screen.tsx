import { ReviewScreenProvider } from '#web/features/review/index.ts';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import type { ReviewScriptRead, ReviewScriptTakeRead } from '../controllers/review-script.ts';
import { ScriptHeader } from './script-header.tsx';
import { ScriptLayout } from './script-layout.tsx';
import { useScriptScreenValue } from './use-script-screen-value.ts';

type ScriptScreenProps = { readonly project: string; readonly script: ReviewScriptRead; readonly take: ReviewScriptTakeRead };

/**
 * The script read along with its take: the review's slots (dock, thread, draft, clock) on the take, so a note on a
 * line is a review thread like any other and an agent's `watch` wakes on it.
 */
export function ScriptScreen({ project, script, take }: ScriptScreenProps) {
  const screen = useScriptScreenValue(project, script, take);
  return (
    <ReviewScreenProvider value={screen}>
      <StudioShell start={<ScriptHeader script={script} take={take} />}>
        <ScriptLayout script={script} take={take} />
      </StudioShell>
    </ReviewScreenProvider>
  );
}
