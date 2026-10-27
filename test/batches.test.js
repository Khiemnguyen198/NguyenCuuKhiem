import assert from 'node:assert/strict';
import test from 'node:test';
import { batchRows, defaultWeekKey, weeksFromDays } from '../src/batches.js';

const days = [
  { date: '2026-10-24', returnDate: '2026-10-26' },
  { date: '2026-10-26', returnDate: '2026-10-27' },
  { date: '2026-10-27', returnDate: '2026-10-28' },
  { date: '2026-11-02', returnDate: '2026-11-03' }
];

test('groups planned days into Monday-based weeks', () => {
  const weeks = weeksFromDays(days);
  assert.deepEqual(weeks.map((week) => [week.key, week.dayIndexes, week.label]), [
    ['2026-10-19', [0], 'Tuần 24/10 – 24/10/2026'],
    ['2026-10-26', [1, 2], 'Tuần 26/10 – 27/10/2026'],
    ['2026-11-02', [3], 'Tuần 02/11 – 02/11/2026']
  ]);
  assert.equal(defaultWeekKey(weeks, new Date(2026, 9, 27)), '2026-10-26');
  assert.equal(defaultWeekKey(weeks, new Date(2026, 9, 29, 23)), '2026-10-26');
  assert.equal(defaultWeekKey(weeks, new Date(2026, 11, 1)), '2026-11-02');
});

test('keeps only rows planned in the week, with the week quantity and return date', () => {
  const rows = [
    { po: 'A', lineQuantity: 500, outputDate: '2026-11-10', allocations: { 1: 120, 2: 80, 3: 300 } },
    { po: 'B', lineQuantity: 50, outputDate: '2026-11-10', allocations: { 0: 50 } },
    { po: 'C', lineQuantity: 10, outputDate: '2026-11-10', allocations: { 2: 'X' } }
  ];
  const week = weeksFromDays(days).find((item) => item.key === '2026-10-26');
  const batch = batchRows(rows, days, week);
  assert.deepEqual(batch.map((row) => [row.po, row.lineQuantity, row.outputDate, row.bookedLineQuantity]), [
    ['A', 200, '2026-10-28', 500],
    ['C', 0, '2026-10-28', 10]
  ]);
});
