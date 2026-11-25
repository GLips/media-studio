import { createServerFn } from '@tanstack/react-start';
import { setResponseStatus } from '@tanstack/react-start/server';
import { Schema } from 'effect';
import { editProjectStoryboardLines, editProjectStoryboardText, projectFolderNamed } from '#web/infrastructure/studio-engine.server.ts';

const Index = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)));
const Texts = { was: Schema.String, text: Schema.String };

// Spells out the engine's StoryboardTextEdit; passing the decoded edit to editProjectStoryboardText holds it in step.
const StoryboardTextEditSchema = Schema.Union([
  Schema.Struct({ field: Schema.Literals(['onScreen', 'motion']), scene: Schema.String, ...Texts }),
  Schema.Struct({ field: Schema.Literal('reads'), scene: Schema.String, index: Index, ...Texts }),
  Schema.Struct({ field: Schema.Literal('line'), scene: Schema.String, line: Schema.String, ...Texts }),
  Schema.Struct({ field: Schema.Literal('brief'), section: Schema.String, ...Texts }),
  Schema.Struct({ field: Schema.Literal('leftOut'), index: Index, ...Texts }),
]);

/**
 * Writes one plan text the page edited into the project's storyboard.ts; Vite's hot update then re-times the page.
 * Answers `{ ok: true }`; 409 with `{ conflict: { current } }` when the file no longer holds what the page showed; 422
 * with `{ refused }` when the text isn't a string literal there.
 */
export const editStoryboardTextFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ project: Schema.String, edit: StoryboardTextEditSchema })))
  .handler(({ data }) => {
    const result = editProjectStoryboardText(projectFolderNamed(data.project), data.edit);
    if ('edited' in result) return { ok: true as const };
    setResponseStatus('conflict' in result ? 409 : 422);
    return result;
  });

// Spells out the engine's StoryboardLinesEdit, as above.
const StoryboardLinesEditSchema = Schema.Union([
  Schema.Struct({ op: Schema.Literal('splitLine'), scene: Schema.String, line: Schema.String, was: Schema.String, first: Schema.String, second: Schema.String }),
  Schema.Struct({ op: Schema.Literal('addLine'), scene: Schema.String, after: Schema.NullOr(Schema.String), text: Schema.String }),
]);

/**
 * Splits a spoken line in two or adds one, in the scene's lines in storyboard.ts. Answers `{ ok: true, line }` with
 * the new line's id; 409 and 422 as editStoryboardTextFn.
 */
export const editStoryboardLinesFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ project: Schema.String, edit: StoryboardLinesEditSchema })))
  .handler(({ data }) => {
    const result = editProjectStoryboardLines(projectFolderNamed(data.project), data.edit);
    if ('edited' in result) return { ok: true as const, line: result.line };
    setResponseStatus('conflict' in result ? 409 : 422);
    return result;
  });
