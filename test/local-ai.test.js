import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBookingRows } from '../src/local-ai.js';

function validRow(index, quantity = 100) {
  return {
    line: String(index), po: `PO-${index}`, ref: `REF-${index}`, color: 'Black',
    lineQuantity: quantity, inputDate: '2026-10-26', outputDate: '2026-10-27',
    modelCode: `M-${index}`, ticketNumber: `T-${index}`, printCount: 1, leadTime: '1 ngày'
  };
}

test('returns a good score for valid booking rows', () => {
  const report = analyzeBookingRows(Array.from({ length: 10 }, (_, index) => validRow(index)));
  assert.equal(report.status, 'good');
  assert.equal(report.score, 100);
  assert.deepEqual(report.findings, []);
});

test('detects critical booking data errors and duplicate rows', () => {
  const broken = {
    line: '1', po: '', ref: 'REF-X', color: 'Black', lineQuantity: 0,
    inputDate: '2026-10-28', outputDate: '2026-10-27', modelCode: 'M-X',
    ticketNumber: 'T-X', printCount: 0, leadTime: '4 ngày'
  };
  const report = analyzeBookingRows([broken, { ...broken }]);
  const codes = new Set(report.findings.map((finding) => finding.code));
  assert.equal(report.status, 'danger');
  assert.ok(codes.has('missing_po'));
  assert.ok(codes.has('invalid_quantity'));
  assert.ok(codes.has('invalid_print_count'));
  assert.ok(codes.has('invalid_lead_time'));
  assert.ok(codes.has('reversed_dates'));
  assert.ok(codes.has('duplicate_rows'));
});

test('flags a statistical quantity outlier without external services', () => {
  const rows = Array.from({ length: 9 }, (_, index) => validRow(index, index === 8 ? 1000 : 10));
  const report = analyzeBookingRows(rows);
  assert.ok(report.findings.some((finding) => finding.code === 'quantity_outlier'));
});

test('flags Sunday due dates, missing contract totals and sheet mismatches', () => {
  const rows = [validRow(0), { ...validRow(1), outputDate: '2026-11-01', contractQuantity: 0 }];
  const report = analyzeBookingRows(rows, { sheetCheck: { mismatches: [{ row: 'LINE 3', po: 'PO3', ref: 'R1', quantity: 10, note: 'thiếu trong TH' }] } });
  const codes = Object.fromEntries(report.findings.map((finding) => [finding.code, finding.count]));
  assert.equal(codes.sunday_output, 1);
  assert.equal(codes.missing_contract, 1);
  assert.equal(codes.sheet_mismatch, 1);
});
