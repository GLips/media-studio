// Every structural check `check:arch` runs. A check left off this list is a file nobody loads, so a spec imports this
// list rather than the check directly: an unregistered check fails its spec.

import type { StructuralCheck } from './check-context.ts';
import { capabilityMatchCheck } from './checks/capability-match.ts';
import { declaredTreeCheck } from './checks/declared-tree.ts';
import { folderWidthCheck } from './checks/folder-width.ts';
import { importPolicyCheck } from './checks/import-policy.ts';
import { modelPurityCheck } from './checks/model-purity.ts';
import { noScratchCheck } from './checks/no-scratch.ts';
import { renderSnapshotCheck } from './checks/render-snapshot.ts';
import { retimeRegistrationCheck } from './checks/retime-registration.ts';
import { sceneOwnershipCheck } from './checks/scene-ownership.ts';
import { sdkContainmentCheck } from './checks/sdk-containment.ts';
import { timingOwnershipCheck } from './checks/timing-ownership.ts';

export const STRUCTURAL_CHECKS: readonly StructuralCheck[] = [
  declaredTreeCheck,
  importPolicyCheck,
  timingOwnershipCheck,
  sceneOwnershipCheck,
  modelPurityCheck,
  noScratchCheck,
  sdkContainmentCheck,
  renderSnapshotCheck,
  retimeRegistrationCheck,
  capabilityMatchCheck,
  folderWidthCheck,
];
