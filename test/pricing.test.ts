import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packagePrice } from '../src/pricing.ts';

const items = [
  { id: 'a', qty: 1, unit_price: 12_000_000, is_optional: false },
  { id: 'b', qty: 2.5, unit_price: 1_000_000, is_optional: false },
  { id: 'c', qty: 1, unit_price: 8_000_000, is_optional: true },
];

test('giá gói chỉ tính hạng mục bắt buộc', () => {
  assert.equal(packagePrice(items), 14_500_000);
});

test('cộng hạng mục tuỳ chọn khi được chọn', () => {
  assert.equal(packagePrice(items, new Set(['c'])), 22_500_000);
});

test('qty từ Postgres numeric là chuỗi vẫn tính đúng', () => {
  assert.equal(packagePrice([{ qty: '1.5' as unknown as number, unit_price: 2_000_000, is_optional: false }]), 3_000_000);
});
