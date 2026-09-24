// new-project.ts: starts a video project that opens in the Studio on its first run.
//
//   npm run new -- <slug> --url=https://example.com [--title="Big new thing"]
//
// Writes projects/<yyyy-mm>-<slug>/ with a capture script for the URL's home page, a two-line script, and a video
// built from the kit (a motion title and a glass-card outro). It then captures the page and estimates the lines'
// timing, so video.tsx compiles before anything is voiced. Replace the middle with the story.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith('--'));
const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const url = flag('url');
if (!slug || !url) {
  console.error('usage: npm run new -- <slug> --url=https://example.com [--title="Big new thing"]');
  process.exit(1);
}
const title = flag('title') || slug.replace(/-/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
const month = new Date().toISOString().slice(0, 7);
const dir = join('projects', `${month}-${slug}`);
if (existsSync(dir)) {
  console.error(`${dir} already exists`);
  process.exit(1);
}

const files: Record<string, string> = {
  'capture.ts': `// Photographs every state the ${title} video shows.
//   node ${dir}/capture.ts
import { openCaptureSession } from '../../lib/capture.ts';

const session = await openCaptureSession({ project: import.meta.dirname, viewport: { width: 1440, height: 810 } });
const { page, snap } = session;

await page.goto(${JSON.stringify(url)}, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await snap('home', { height: 1600 });

// Each state the story needs: reach it, then snap it with the rects scenes will point at, e.g.
//   await snap('detail', { rects: { button: '.buy', options: ['.option', { all: true }] }, height: 1200 });

await session.close();
`,

  'voiceover.json': `${JSON.stringify({
    voice: 'Callirrhoe',
    lines: [
      { id: 'intro', text: `Here's a quick look at ${title}.` },
      { id: 'outro', text: 'That’s it. Thanks for watching.', paragraph: true },
    ],
  }, null, 2)}\n`,

  'video.tsx': `// The ${title} video. Scene times are seconds from each scene's start; \`s.line(id).at(f)\` is the moment a fraction
// \`f\` of the way through a voiced line, so beats stay on their words when the voice is re-timed.

import {
  Capture, EndCard, GlassCard, MotionTitle, Wash, W, camTop, defineScene, defineVideo, easeOut, seg, view,
} from '../../lib/studio/api.ts';
import { voice } from './audio/manifest.ts';
import { captures as C } from './captures/index.ts';

const INK = '#1c365e';
const ACCENT = '#b82b2b';

const title = defineScene({
  id: 'title', lines: ['intro'], lead: 1.4, tail: 1.0,
  render: (s) => <MotionTitle s={s} shot={C.home} eyebrow="WALKTHROUGH" title={${JSON.stringify(title)}} accent={ACCENT} />,
});

const outro = defineScene({
  id: 'outro', lines: ['outro'], lead: 0.6, tail: 3.4,
  render: (s) => {
    const blur = seg(s.t, 0, 1.0);
    return (
      <>
        <Capture view={view(C.home, camTop(C.home))} blur={34 * blur} />
        <Wash color="22, 40, 70" from={0.62 * blur} to={0.38 * blur} x0={0} x1={W} />
        <GlassCard k={seg(s.t, 0.4, 1.3, easeOut) * (1 - seg(s.t, s.dur - 2.8, s.dur - 2.1))} eyebrow="IN SHORT"
          points={['The first takeaway', 'The second takeaway']} accent={ACCENT} ink={INK} />
        <EndCard k={seg(s.t, s.dur - 2.4, s.dur - 1.6)} title={${JSON.stringify(title)}} bg={INK} />
      </>
    );
  },
});

export default defineVideo({ title: ${JSON.stringify(title)}, voice, scenes: [title, outro] });
`,
};

mkdirSync(dir, { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
execFileSync('node', [join(dir, 'capture.ts')], { stdio: 'inherit' });
execFileSync('node', ['scripts/tts.ts', dir, '--estimate'], { stdio: 'inherit' });
console.log(`${dir}/ is ready. Next:
  npm run studio -- ${dir}       watch it, with estimated timing and no voice
  npm run tts -- ${dir}          voice it
  npm run video -- ${dir}        render it`);
