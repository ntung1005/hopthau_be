import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from '../src/routes/admin.ts';

test('slug từ tên dự án tiếng Việt', () => {
  assert.equal(slugify('NOXH Sông Hồng'), 'noxh-song-hong');
  assert.equal(slugify('  Đồng Tàu – Hoàng Mai (Khu A) '), 'dong-tau-hoang-mai-khu-a');
  assert.equal(slugify('!!!'), '');
});
