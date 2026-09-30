// Every structural check `check:arch` runs. A check left off this list is a file nobody loads, so a spec imports this
// list rather than the check directly: an unregistered check fails its spec.

import type { StructuralCheck } from './check-context.ts';
import { brushAssetsCheck } from './checks/brush-assets.ts';
import { capabilityMatchCheck } from './checks/capability-match.ts';
import { barrelDiscoverabilityCheck } from './checks/barrel-discoverability.ts';
import { declaredTreeCheck } from './checks/declared-tree.ts';
import { docBudgetsCheck } from './checks/doc-budgets.ts';
import { featureCyclesCheck } from './checks/feature-cycles.ts';
import { featureVisibilityCheck } from './checks/feature-visibility.ts';
import { fileSizeCheck } from './checks/file-size.ts';
import { testFileMirrorCheck } from './checks/test-file-mirror.ts';
import { trampolinesCheck } from './checks/trampolines.ts';
import { folderWidthCheck } from './checks/folder-width.ts';
import { frameDeterminismCheck } from './checks/frame-determinism.ts';
import { importPolicyCheck } from './checks/import-policy.ts';
import { modelPurityCheck } from './checks/model-purity.ts';
import { noScratchCheck } from './checks/no-scratch.ts';
import { renderSnapshotCheck } from './checks/render-snapshot.ts';
import { retimeRegistrationCheck } from './checks/retime-registration.ts';
import { sceneOwnershipCheck } from './checks/scene-ownership.ts';
import { sdkContainmentCheck } from './checks/sdk-containment.ts';
import { studioTempCheck } from './checks/studio-temp.ts';
import { timingOwnershipCheck } from './checks/timing-ownership.ts';
import { noBroadParametersCheck } from './checks/no-broad-parameters.ts';
import { noKnownValueWideningCheck } from './checks/no-known-value-widening.ts';
import { noOpaqueRecordCheck } from './checks/no-opaque-record.ts';
import { noRuntimeTypeofCheck } from './checks/no-runtime-typeof.ts';
import { noUnknownReturnsCheck } from './checks/no-unknown-returns.ts';
import { noUnknownTypeAliasesCheck } from './checks/no-unknown-type-aliases.ts';
import { noWidenThenAssertCheck } from './checks/no-widen-then-assert.ts';
import { typedTreeCheck } from './checks/typed-tree.ts';
import { noTestImportsCheck } from './checks/no-test-imports.ts';
import { barrelPurityCheck } from './checks/barrel-purity.ts';
import { cssTokensCheck } from './checks/css-tokens.ts';
import { shadowSourceCheck } from './checks/shadow-source.ts';
import { tokenEqualityCheck } from './checks/token-equality.ts';

export const STRUCTURAL_CHECKS: readonly StructuralCheck[] = [
  declaredTreeCheck,
  importPolicyCheck,
  timingOwnershipCheck,
  sceneOwnershipCheck,
  modelPurityCheck,
  frameDeterminismCheck,
  noScratchCheck,
  sdkContainmentCheck,
  studioTempCheck,
  renderSnapshotCheck,
  retimeRegistrationCheck,
  capabilityMatchCheck,
  folderWidthCheck,
  brushAssetsCheck,
  fileSizeCheck,
  trampolinesCheck,
  docBudgetsCheck,
  barrelDiscoverabilityCheck,
  testFileMirrorCheck,
  featureVisibilityCheck,
  featureCyclesCheck,
  typedTreeCheck,
  noOpaqueRecordCheck,
  noWidenThenAssertCheck,
  noKnownValueWideningCheck,
  noBroadParametersCheck,
  noUnknownReturnsCheck,
  noUnknownTypeAliasesCheck,
  noRuntimeTypeofCheck,
  noTestImportsCheck,
  barrelPurityCheck,
  cssTokensCheck,
  shadowSourceCheck,
  tokenEqualityCheck,
];
