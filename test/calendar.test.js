import assert from 'node:assert/strict';
import test from 'node:test';
import { workWeekLabel } from '../src/calendar.js';

test('labels the Monday to Saturday work week', () => {
  assert.deepEqual(workWeekLabel(new Date(2026, 9, 27)), { dayLabel: 'Thứ Ba, 27/10/2026', weekLabel: 'Tuần 26/10 – 31/10/2026' });
});

test('points Sunday at the coming work week', () => {
  assert.equal(workWeekLabel(new Date(2026, 10, 1)).weekLabel, 'Tuần 02/11 – 07/11/2026');
});
