import { createLazyFileRoute, notFound } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import { isLabTabId, type LabTabId } from '#models/lab/lab-tabs.ts';
import { LabCurvesTab } from '#web/features/lab/ui/curves/lab-curves-tab.tsx';
import { LabHoldTab } from '#web/features/lab/ui/hold/lab-hold-tab.tsx';
import { LabKitTab } from '#web/features/lab/ui/kit/lab-kit-tab.tsx';
import { LabMediaTab } from '#web/features/lab/ui/media/lab-media-tab.tsx';
import { LabSoundTab } from '#web/features/lab/ui/sound/lab-sound-tab.tsx';
import { LabStaggerTab } from '#web/features/lab/ui/stagger/lab-stagger-tab.tsx';

const LAB_TAB_SCREENS: Record<LabTabId, ComponentType> = {
  curves: LabCurvesTab,
  stagger: LabStaggerTab,
  kit: LabKitTab,
  hold: LabHoldTab,
  sound: LabSoundTab,
  media: LabMediaTab,
};

export const Route = createLazyFileRoute('/lab/$tab')({ component: LabTabRoute });

function LabTabRoute() {
  const { tab } = Route.useParams();
  // lab.$tab.tsx's beforeLoad has refused any other id already; this narrows the param's type to match.
  if (!isLabTabId(tab)) throw notFound();
  const Screen = LAB_TAB_SCREENS[tab];
  return <Screen key={tab} />;
}
