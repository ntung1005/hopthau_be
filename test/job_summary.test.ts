import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobSummary } from '../src/routes/jobs.ts';

const job = { price: 40_000_000, duration_days: 30, warranty_months: 12, completed_at: null };
const milestones = [
  { amount: 12_000_000, status: 'approved', paid_at: '2026-10-01T00:00:00Z' },
  { amount: 16_000_000, status: 'approved', paid_at: null },
  { amount: 10_000_000, status: 'submitted', paid_at: null },
  { amount: 2_000_000, status: 'pending', paid_at: null },
];

test('tổng tiền chỉ cộng phát sinh đã duyệt, kể cả phát sinh âm', () => {
  const s = jobSummary(job, milestones, [
    { amount: 3_000_000, days_delta: 5, status: 'approved' },
    { amount: -1_000_000, days_delta: 0, status: 'approved' },
    { amount: 9_000_000, days_delta: 9, status: 'pending' },
    { amount: 7_000_000, days_delta: 2, status: 'rejected' },
  ]);
  assert.equal(s.total, 42_000_000);
  assert.equal(s.total_days, 35);
  assert.equal(s.approved_amount, 28_000_000);
  assert.equal(s.paid_amount, 12_000_000);
  assert.equal(s.warranty_until, null);
});

test('bảo hành tính từ ngày hoàn thành', () => {
  const s = jobSummary({ ...job, completed_at: '2026-03-15T08:00:00.000Z' }, milestones, []);
  assert.equal(s.warranty_until, '2027-03-15T08:00:00.000Z');
});
