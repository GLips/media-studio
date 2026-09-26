import { createFileRoute, redirect } from '@tanstack/react-router';
import { LAB_TABS } from '#models/lab/lab-tabs.ts';

export const Route = createFileRoute('/lab/')({
  beforeLoad: () => {
    throw redirect({ to: '/lab/$tab', params: { tab: LAB_TABS[0].id }, replace: true });
  },
});
