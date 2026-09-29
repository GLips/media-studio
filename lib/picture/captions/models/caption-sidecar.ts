// caption-sidecar.ts: caption pages as the files a player loads beside the video. Plain text: a keycap is its key,
// and emphasis is left to the burned-in captions.

import type { CaptionPage } from './caption-pages.ts';

const pageText = (page: CaptionPage) => page.lines.map((line) => line.map((w) => w.text + w.trail).join(' ')).join('\n');

function timestamp(seconds: number, separator: ',' | '.') {
  const ms = Math.round(seconds * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${separator}${pad(ms % 1000, 3)}`;
}

export const captionsToSrt = (pages: readonly CaptionPage[]) =>
  pages.map((page, k) => `${k + 1}\n${timestamp(page.start, ',')} --> ${timestamp(page.end, ',')}\n${pageText(page)}\n`).join('\n');

export const captionsToVtt = (pages: readonly CaptionPage[]) =>
  `WEBVTT\n\n${pages.map((page) => `${timestamp(page.start, '.')} --> ${timestamp(page.end, '.')}\n${pageText(page)}\n`).join('\n')}`;
