import assert from 'node:assert/strict';
import { test } from 'node:test';
import { presignS3Url } from './s3-upload.ts';

// A wrong signature only shows up as a 403 from the live bucket, so the signer is checked against AWS's own worked
// example ("Authenticating Requests: Using Query Parameters").
test('presigned URLs match AWS\'s published SigV4 example', () => {
  const url = presignS3Url(
    { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' },
    'GET', 'https://examplebucket.s3.amazonaws.com/test.txt', new Date('2013-05-24T00:00:00Z'), 86400,
  );
  assert.equal(new URL(url).searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});
