import { test } from 'node:test';
import { assertTimelineRetimes } from '#models/timeline/retime.ts';
import { timeline } from './timeline.ts';

test('the video retimes: a longer scene moves every later one and its cues, and nothing before', () => {
  assertTimelineRetimes(timeline);
});
