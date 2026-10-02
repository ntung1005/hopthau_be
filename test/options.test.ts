import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/http.ts';
import { optProvince, pickList, PROVINCES, SERVICES } from '../src/options.ts';

test('34 tỉnh / thành, không trùng', () => {
  assert.equal(new Set(PROVINCES).size, 34);
});

test('chỉ nhận tỉnh và hạng mục trong danh sách', () => {
  assert.equal(optProvince({ province: 'Hà Nội' }), 'Hà Nội');
  assert.equal(optProvince({}), null);
  assert.throws(() => optProvince({ province: 'Bình Dương' }), (e: ApiError) => e.code === 'invalid_province');
  assert.deepEqual(pickList({ services: ['Tủ bếp', 'Tủ bếp', 'Sơn bả'] }, 'services', SERVICES), ['Tủ bếp', 'Sơn bả']);
  assert.deepEqual(pickList({}, 'services', SERVICES), []);
  assert.throws(() => pickList({ services: ['Xây biệt thự'] }, 'services', SERVICES), (e: ApiError) => e.code === 'invalid_services');
});
