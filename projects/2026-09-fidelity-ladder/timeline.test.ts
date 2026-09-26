import { test } from 'node:test';
import { assertTimelineRetimes } from '#models/timeline/retime.ts';
import { timeline } from './timeline.ts';

test('the demo retimes: a lengthened scene moves every later one, and nothing before', () => {
  assertTimelineRetimes(timeline);
});
