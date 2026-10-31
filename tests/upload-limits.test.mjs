import assert from 'node:assert/strict';
import test from 'node:test';
import { UPLOAD_PART_BYTES, SERVER_CONVERSION_THRESHOLD, SEGMENT_SECONDS, validateMediaSize } from '../lib/upload-limits.ts';

test('large files of any size are accepted', () => {
  for (const size of [1_500_000_000, 1.5 * 1024 ** 3, 2 * 1024 ** 3 + 1, 12 * 1024 ** 3, 100 * 1024 ** 3]) {
    assert.doesNotThrow(() => validateMediaSize(size));
    assert.ok(size >= SERVER_CONVERSION_THRESHOLD);
  }
  assert.equal(Math.ceil(1.5 * 1024 ** 3 / UPLOAD_PART_BYTES), 192);
});

test('empty and invalid sizes are rejected before upload', () => {
  for (const size of [0, -1, NaN, Infinity, 1.5]) {
    assert.throws(() => validateMediaSize(size));
  }
});

test('a 2-hour 32kbps segment stays under the 45 MiB storage cap', () => {
  assert.ok((SEGMENT_SECONDS * 32_000) / 8 < 45 * 1024 ** 2);
});
