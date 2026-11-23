import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FfmpegFailed } from './studio-ffmpeg.ts';

test("a failed ffmpeg's message is one line quoting why, past its progress and sign-off", () => {
  const stderr = [
    "Input #0, mov,mov,mp4,m4a,3gp,3g2,mj2, from 'take.mov':",
    'frame=  120 fps= 60 q=28.0 size=     512kB time=00:00:02.00\rframe=  240 fps= 60 q=28.0 size=    1024kB time=00:00:04.00',
    '[aac @ 0x1] Too many bits per frame requested',
    'Error while encoding audio: Invalid argument',
    'Conversion failed!',
    '',
  ].join('\n');
  const failed = new FfmpegFailed({ tool: 'ffmpeg', args: [], exitCode: 1, stderr });
  assert.equal(failed.message, "ffmpeg exited with 1: Input #0, mov,mov,mp4,m4a,3gp,3g2,mj2, from 'take.mov': / [aac @ 0x1] Too many bits per frame requested / Error while encoding audio: Invalid argument");
});
