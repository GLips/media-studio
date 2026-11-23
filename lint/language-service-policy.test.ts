// The Effect language-service policy (tsconfig.effect.json) against the catalog the installed @effect/tsgo ships. An
// upgrade that adds a rule leaves it at the tool's default, which nobody chose; one that drops a rule leaves a name
// holding nothing. Both fail here until the policy answers for them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Schema } from 'effect';

const STUDIO_ROOT = join(import.meta.dirname, '..');
const POLICY_FILE = 'tsconfig.effect.json';
const PLUGIN_NAME = '@effect/language-service';

const EffectPolicy = Schema.Struct({
  compilerOptions: Schema.Struct({
    plugins: Schema.Array(Schema.Struct({ name: Schema.String, diagnosticSeverity: Schema.Record(Schema.String, Schema.String) })),
  }),
});
const DiagnosticCatalog = Schema.Struct({
  definitions: Schema.Struct({
    effectLanguageServicePluginDiagnosticSeverityDefinition: Schema.Struct({
      properties: Schema.Record(Schema.String, Schema.Struct({ description: Schema.String })),
    }),
  }),
});
const ExtendingConfig = Schema.Struct({ extends: Schema.optional(Schema.String) });

// Whole-line comments only, as every tsconfig here writes them: a comment after a value stays, and the decode refuses
// it rather than this guessing where a string ends.
const readCommentedJson = (path: string): string =>
  readFileSync(join(STUDIO_ROOT, path), 'utf8').split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n');
const decodeEffectPolicy = Schema.decodeUnknownSync(Schema.fromJsonString(EffectPolicy));
const decodeDiagnosticCatalog = Schema.decodeUnknownSync(Schema.fromJsonString(DiagnosticCatalog));
const decodeExtendingConfig = Schema.decodeUnknownSync(Schema.fromJsonString(ExtendingConfig));

const policy = decodeEffectPolicy(readCommentedJson(POLICY_FILE));
const configured = policy.compilerOptions.plugins.find(({ name }) => name === PLUGIN_NAME)?.diagnosticSeverity ?? {};
const catalog = decodeDiagnosticCatalog(readCommentedJson('node_modules/@effect/tsgo/schema.json'))
  .definitions.effectLanguageServicePluginDiagnosticSeverityDefinition.properties;
// tsc warns about a deprecated rule named in a policy, which fails the typecheck, so the policy leaves those out.
const shipped = Object.entries(catalog).filter(([, rule]) => !rule.description.startsWith('Deprecated')).map(([name]) => name);

describe('the Effect language-service policy', () => {
  it('is what the studio and the web app programs extend', () => {
    assert.deepEqual(
      [decodeExtendingConfig(readCommentedJson('tsconfig.json')).extends, decodeExtendingConfig(readCommentedJson('web/tsconfig.json')).extends],
      [`./${POLICY_FILE}`, `../${POLICY_FILE}`],
    );
  });

  it('names every live rule the installed catalog ships, and no other', () => {
    const named = Object.keys(configured);
    assert.deepEqual(
      { missing: shipped.filter((rule) => !named.includes(rule)), unknown: named.filter((rule) => !shipped.includes(rule)) },
      { missing: [], unknown: [] },
    );
  });

  it('holds each rule at error or off, never a severity the typecheck lets pass', () => {
    assert.deepEqual(Object.entries(configured).filter(([, severity]) => severity !== 'error' && severity !== 'off'), []);
  });
});
