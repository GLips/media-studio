// voice-comp.ts: which kept take each line of a script can be cut from, and what a sync would keep, reuse and read.
// Pure; lib/timing/voice/engine/voice-project.ts does the IO.
//
// A take reads a line as it is now when the line's text and paragraph and the take's settings match. A recording is
// judged on its text alone, so a new voice never makes one stale.
import type { VoiceScript, VoiceScriptLine, VoiceTakeContext, VoiceTakeFile, VoiceTakeSettings } from './voice-take.ts';
import { ttsText } from './voice-words.ts';

/** Why a take doesn't read a line as the script has it now. */
export type VoiceStaleReason = 'text' | 'paragraph' | 'voice' | 'direction' | 'model' | 'generation settings unavailable' | 'a draft' | 'not read' | 'context only' | 'never voiced';

/** What would read each way now: the script's Gemini settings, and say's voice for a draft. */
export type VoiceSettingsNow = { tts: Extract<VoiceTakeSettings, { model: string }>; sayVoice: string };

/** A kept take as the comp sees it: its number and its info. */
export type VoiceCompTake = { number: number; info: VoiceTakeFile };

/** A run of consecutive lines to read in one pickup, between the lines around it (when there are), read for context. */
export type VoicePickup = { before?: VoiceScriptLine; lines: VoiceScriptLine[]; after?: VoiceScriptLine };

/** Whether `take` read line `id` only as context around its run. */
export const isVoiceContextLine = (context: VoiceTakeContext | undefined, id: string) => context?.before === id || context?.after === id;

/** "after a and before d": the context a pickup is read in, for messages; empty for none. */
export function voiceContextPhrase(context: VoiceTakeContext | undefined): string {
  const { before, after } = context ?? {};
  if (before && after) return `between ${before} and ${after}`;
  if (before) return `after ${before}`;
  return after ? `before ${after}` : '';
}

/** Every reason `take` doesn't read `line` as it is now; none when it does. A draft counts only with `draft`. */
export function voiceLineStaleReasons(take: VoiceTakeFile, line: VoiceScriptLine, now: VoiceSettingsNow, draft = true): VoiceStaleReason[] {
  if (isVoiceContextLine(take.context, line.id)) return ['context only'];
  const read = take.lines.find((l) => l.id === line.id);
  if (!read) return ['not read'];
  const reasons: VoiceStaleReason[] = [];
  if (ttsText(read.text) !== ttsText(line.text)) reasons.push('text');
  if (take.source === 'recording') return reasons;
  if (read.paragraph !== (line.paragraph ?? false)) reasons.push('paragraph');
  const settings = take.settings;
  if (!settings) return [...reasons, 'generation settings unavailable'];
  if ('sayVoice' in settings) {
    if (settings.sayVoice !== now.sayVoice) reasons.push('voice');
    return draft ? reasons : [...reasons, 'a draft'];
  }
  if (settings.model !== now.tts.model) reasons.push('model');
  if (settings.voice !== now.tts.voice) reasons.push('voice');
  if (settings.direction !== now.tts.direction) reasons.push('direction');
  return reasons;
}

/** Each run of consecutive script lines that `wanted` picks, with the lines before and after it as its context. */
export function voicePickupsOf(script: VoiceScript, wanted: (id: string) => boolean): VoicePickup[] {
  const runs: VoicePickup[] = [];
  script.lines.forEach((line, i) => {
    if (!wanted(line.id)) return;
    const last = runs.at(-1);
    if (last && last.lines.at(-1) === script.lines[i - 1]) last.lines.push(line);
    else runs.push({ before: script.lines[i - 1], lines: [line] });
  });
  for (const run of runs) run.after = script.lines[script.lines.indexOf(run.lines.at(-1)!) + 1];
  return runs;
}

/** What a sync comes to: the take for each line it keeps or reuses, the pickups to read, and why each line moved. */
export type VoiceSyncPlan<T extends VoiceCompTake> = {
  comp: Map<string, T>;
  /** Lines given another kept take than the one chosen for them, by that take. */
  reused: Map<T, string[]>;
  pickups: VoicePickup[];
  /** Each line whose chosen take doesn't read it as it is now, and why. */
  stale: { id: string; reasons: VoiceStaleReason[] }[];
  /** Lines kept on a recording that reads an older text. */
  oldRecordings: { id: string; take: number }[];
};

/**
 * Keeps each line on its chosen take while that take reads it as it is now, else a kept take that does (paid before
 * a draft, the chosen one, then the one chosen last), else reads it. A recorded line is kept whatever its text.
 */
export function planVoiceSync<T extends VoiceCompTake>(script: VoiceScript, kept: readonly T[], chosenBefore: Readonly<Record<string, { take: number }>>, now: VoiceSettingsNow, draft: boolean): VoiceSyncPlan<T> {
  const plan: VoiceSyncPlan<T> = { comp: new Map(), reused: new Map(), pickups: [], stale: [], oldRecordings: [] };
  for (const line of script.lines) {
    const chosen = kept.find((take) => take.number === chosenBefore[line.id]?.take);
    if (chosen?.info.source === 'recording' && !isVoiceContextLine(chosen.info.context, line.id) && chosen.info.lines.some((l) => l.id === line.id)) {
      if (voiceLineStaleReasons(chosen.info, line, now).length) plan.oldRecordings.push({ id: line.id, take: chosen.number });
      plan.comp.set(line.id, chosen);
      continue;
    }
    const reasons = chosen ? voiceLineStaleReasons(chosen.info, line, now, false) : ['never voiced' as const];
    const latest = (withDrafts: boolean) => kept.filter((take) => !voiceLineStaleReasons(take.info, line, now, withDrafts).length)
      .toSorted((a, b) => Number(b === chosen) - Number(a === chosen) || b.info.chosenAt.localeCompare(a.info.chosenAt))[0];
    const reading = latest(false) ?? (draft ? latest(true) : undefined);
    if (!chosen || reading !== chosen) plan.stale.push({ id: line.id, reasons });
    if (!reading) continue;
    if (reading !== chosen) plan.reused.set(reading, [...(plan.reused.get(reading) ?? []), line.id]);
    plan.comp.set(line.id, reading);
  }
  plan.pickups = voicePickupsOf(script, (id) => !plan.comp.has(id));
  return plan;
}
