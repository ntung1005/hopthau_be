import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packagePrice, parseQuoteItems } from '../src/pricing.ts';

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

test('báo giá theo món: giá bằng tổng số lượng × đơn giá, món không có phòng vào "Chung"', () => {
  const { items, total } = parseQuoteItems([
    { room: 'Phòng ngủ', name: 'Giường', qty: 1, unit_price: 6_500_000, note: '1m8' },
    { name: 'Nhân công lắp đặt', qty: 2, unit_price: 1_000_000 },
  ]);
  assert.equal(total, 8_500_000);
  assert.deepEqual(items[1], { room: 'Chung', name: 'Nhân công lắp đặt', qty: 2, unit_price: 1_000_000, note: null });
  assert.deepEqual(parseQuoteItems(undefined), { items: [], total: 0 });
  assert.throws(() => parseQuoteItems([{ name: 'Tủ', qty: 0, unit_price: 1 }]), { code: 'invalid_items_0_qty' });
  assert.throws(() => parseQuoteItems([{ name: 'Tủ', qty: 1, unit_price: -1 }]), { code: 'invalid_items_0_unit_price' });
});
