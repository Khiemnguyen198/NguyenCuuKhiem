import test from 'node:test';
import assert from 'node:assert/strict';
import { MACHINE_SUGGESTIONS, normalizeStandardRows } from '../src/config-ai.js';

test('provides the complete factory machine suggestion catalog', () => {
  assert.equal(MACHINE_SUGGESTIONS.length, 19);
  assert.ok(MACHINE_SUGGESTIONS.includes('OVAL18 mới'));
  assert.ok(MACHINE_SUGGESTIONS.includes('Máy Tự Động 5'));
  assert.ok(MACHINE_SUGGESTIONS.includes('Máy in K3 4'));
  assert.ok(MACHINE_SUGGESTIONS.includes('In BÀN 2'));
  assert.ok(MACHINE_SUGGESTIONS.includes('THÊU'));
});

test('maps Vietnamese Excel headings to production standards', () => {
  const result = normalizeStandardRows([{ 'Tên mẫu': 'Oval 18', 'Số phút': '18', 'Số máy': 12, 'Hiệu suất (%)': '85%' }]);
  assert.equal(result.confidence, 'high');
  assert.equal(result.standards[0].name, 'Oval 18');
  assert.equal(result.standards[0].minutesPerImpression, 18);
  assert.equal(result.standards[0].machineCount, 12);
  assert.equal(result.standards[0].efficiencyPercent, 85);
});

test('ignores rows without a usable name and minute value', () => {
  const result = normalizeStandardRows([{ Model: '', Minutes: 10 }, { Model: 'Oval 18', Minutes: '' }]);
  assert.equal(result.standards.length, 0);
  assert.equal(result.ignoredRows, 2);
});
