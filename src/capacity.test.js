import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCapacity } from './capacity.js';

const demand = { totalQuantity: 1000, totalImpressions: 2000, uniquePo: 10 };

test('does not invent a delivery quantity without a valid machine configuration', () => {
  assert.equal(calculateCapacity(demand, { minutesPerImpression: null, machineCount: null }), null);
});

test('reports full delivery when configured capacity covers required minutes', () => {
  const result = calculateCapacity(demand, {
    minutesPerImpression: 1, setupMinutesPerPo: 0, machineCount: 5,
    shiftsPerDay: 1, minutesPerShift: 480, efficiencyPercent: 100, planningDays: 1
  });
  assert.equal(result.deliverableQuantity, 1000);
  assert.equal(result.shortageQuantity, 0);
  assert.equal(result.coverageRate, 1);
});

test('scales printable and deliverable quantities to available capacity', () => {
  const result = calculateCapacity(demand, {
    minutesPerImpression: 1, setupMinutesPerPo: 0, machineCount: 1,
    shiftsPerDay: 1, minutesPerShift: 1000, efficiencyPercent: 100, planningDays: 1
  });
  assert.equal(result.deliverableQuantity, 500);
  assert.equal(result.shortageQuantity, 500);
  assert.equal(result.coverageRate, 0.5);
});
