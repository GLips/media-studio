// use-studio-waiting-title.ts: the tab says how much waits on the reviewer, `(3) <project> · studio`, and its icon
// grows a dot while anything does, so an agent blocked on a question is seen from another tab.
//
// Negative space: no browser notification. The count in the title is the whole signal.
import { useEffect } from 'react';
import { colors } from './theme.stylex.ts';

const WAITING_DOT_SIZE = 32;
/** The root's own icon: empty, so a page load never asks for /favicon.ico. */
const NO_ICON = 'data:,';

let waitingDot: string | undefined;

/** The caution colour as the page resolves it: a canvas can't paint a CSS variable. */
function cautionColor(): string {
  const probe = document.createElement('span');
  probe.style.color = colors.caution;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** A dot in the caution colour (what waits on you), drawn once on a canvas: the tab's icon while anything waits. */
function waitingDotIcon(): string {
  if (waitingDot) return waitingDot;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = WAITING_DOT_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return NO_ICON;
  context.fillStyle = cautionColor();
  context.beginPath();
  context.arc(WAITING_DOT_SIZE / 2, WAITING_DOT_SIZE / 2, WAITING_DOT_SIZE * 0.38, 0, Math.PI * 2);
  context.fill();
  waitingDot = canvas.toDataURL('image/png');
  return waitingDot;
}

/** `(n) <project> · studio` on a project's screens, `(n) studio` elsewhere; the `(n) ` only while n > 0. */
export const studioWaitingTitleOf = (waiting: number, project?: string): string =>
  `${waiting > 0 ? `(${waiting}) ` : ''}${project ? `${project} · ` : ''}studio`;

/**
 * Sets the tab's title and icon from `waiting`, the things waiting on the reviewer. The root's head links an icon
 * (`rel="icon"`); this rewrites its href, so there's one icon element.
 */
export function useStudioWaitingTitle(waiting: number, project?: string) {
  useEffect(() => {
    document.title = studioWaitingTitleOf(waiting, project);
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = waiting > 0 ? waitingDotIcon() : NO_ICON;
  }, [waiting, project]);
}
