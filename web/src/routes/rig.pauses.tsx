import { createFileRoute } from '@tanstack/react-router';
import { PauseRigPage } from '#web/features/pause-rig/index.ts';

/** A scratch rig for tuning how recorded lines pace their pauses: `/rig/pauses`. */
export const Route = createFileRoute('/rig/pauses')({ component: PauseRigPage });
