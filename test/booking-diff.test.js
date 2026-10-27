import assert from 'node:assert/strict';
import test from 'node:test';
import { diffBookingRows } from '../src/booking-diff.js';

const row = (po, quantity, outputDate = '2026-11-01', extra = {}) => ({ po, ref: '353234', color: 'BLEU', lineQuantity: quantity, outputDate, leadTime: '1 ngày', ...extra });

test('reports added, removed and edited booking rows', () => {
  const previous = [row('PO1', 100), row('PO2', 200), row('PO3', 50)];
  const current = [row('PO1', 100), row('PO2', 260, '2026-11-04'), row('PO4', 80)];
  const diff = diffBookingRows(previous, current);

  assert.equal(diff.hasChanges, true);
  assert.deepEqual(diff.counts, { added: 1, removed: 1, changed: 1 });
  assert.equal(diff.added[0].po, 'PO4');
  assert.equal(diff.removed[0].po, 'PO3');
  assert.deepEqual(diff.changed[0].changes.map((change) => [change.field, change.before, change.after]), [
    ['lineQuantity', 200, 260],
    ['outputDate', '2026-11-01', '2026-11-04']
  ]);
  assert.equal(diff.quantityDelta, 90);
});

test('treats spacing and case differences as the same row', () => {
  const diff = diffBookingRows([row('PO1', 100, '2026-11-01', { color: 'bleu ' })], [row('PO1', 100)]);
  assert.equal(diff.hasChanges, false);
});

test('keeps repeated PO rows apart by occurrence', () => {
  const diff = diffBookingRows([row('PO1', 100), row('PO1', 40)], [row('PO1', 100), row('PO1', 40), row('PO1', 10)]);
  assert.deepEqual(diff.counts, { added: 1, removed: 0, changed: 0 });
});

test('compares daily allocations by date when day columns shift', () => {
  const previousDays = [{ date: '2026-10-26' }, { date: '2026-10-27' }];
  const currentDays = [{ date: '2026-10-25' }, { date: '2026-10-26' }, { date: '2026-10-27' }];
  const before = [row('PO1', 100, '2026-11-01', { allocations: { 0: 60, 1: 40 } })];
  const same = [row('PO1', 100, '2026-11-01', { allocations: { 1: 60, 2: 40 } })];
  const moved = [row('PO1', 100, '2026-11-01', { allocations: { 1: 100 } })];
  assert.equal(diffBookingRows(before, same, { previousDays, currentDays }).hasChanges, false);
  const change = diffBookingRows(before, moved, { previousDays, currentDays }).changed[0].changes[0];
  assert.deepEqual([change.field, change.before, change.after], ['allocations', '26/10: 60; 27/10: 40', '26/10: 100']);
});
