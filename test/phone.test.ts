import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePhone } from '../src/phone.ts';

test('chuẩn hoá số di động Việt Nam', () => {
  assert.equal(normalizePhone('0912345678'), '84912345678');
  assert.equal(normalizePhone('+84 912 345 678'), '84912345678');
  assert.equal(normalizePhone('84-912.345.678'), '84912345678');
  assert.equal(normalizePhone('0312345678'), '84312345678');
});

test('từ chối số sai định dạng', () => {
  for (const bad of ['', '091234567', '09123456789', '0212345678', '0412345678', 'abc', '+1 912345678']) {
    assert.equal(normalizePhone(bad), null, bad);
  }
});
