// The Remotion stills' shots: a composition's code in the docs (a React component that is a video) and the home page's
// interactive demo (the Player playing a video that code drew). Filmed at 3×, since a card crops a few hundred page px.
//   studio capture remotion-stills [--only=code,player]
import { captureShots, type Page } from '#engine/capture/capture.ts';

const shots = captureShots({ project: import.meta.dirname, viewport: { width: 1440, height: 810 }, scale: 3 });
const open = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
};

shots.still('code', {
  setup: (page) => open(page, 'https://www.remotion.dev/docs/the-fundamentals'),
  rects: {
    code: 'pre',
    // The import names it first; the hook's call is the second match.
    hooks: ['pre span', { text: '^useCurrentFrame$', all: true }],
  },
  height: 900,
});

shots.still('player', {
  setup: async (page) => {
    await open(page, 'https://www.remotion.dev');
    // The demo mounts its Player when it scrolls into view and rolls the temperature's digits in; pausing the Player
    // once they've landed keeps them still for the photo.
    await page.getByText('Interactive demo', { exact: true }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(5000);
    await page.locator('.__remotion-player').click();
    await page.waitForTimeout(500);
  },
  rects: {
    player: '.__remotion-player',
    temperature: ['.__remotion-player .duration-200', { text: '^Temperature' }],
  },
  height: 2600,
});

export default shots;
