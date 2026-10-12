import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_MEDIA_BYTES, UPLOAD_PART_BYTES, SERVER_CONVERSION_THRESHOLD, validateMediaSize } from '../lib/upload-limits.ts';

test('1.5 GB and 1.5 GiB are accepted and default to server conversion', () => {
  for (const size of [1_500_000_000, 1.5 * 1024 ** 3]) {
    assert.doesNotThrow(() => validateMediaSize(size));
    assert.ok(size >= SERVER_CONVERSION_THRESHOLD);
  }
  assert.equal(Math.ceil(1.5 * 1024 ** 3 / UPLOAD_PART_BYTES), 192);
});

test('empty, oversized and invalid sizes are rejected before upload', () => {
  for (const size of [0, -1, NaN, Infinity, 1.5, MAX_MEDIA_BYTES + 1]) {
    assert.throws(() => validateMediaSize(size));
  }
  assert.doesNotThrow(() => validateMediaSize(MAX_MEDIA_BYTES));
});
