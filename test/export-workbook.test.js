import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { buildExportWorkbook } from '../src/export-workbook.js';
import { summarizeWarehouse } from '../src/warehouse-import.js';

test('exports the booking in the customer TH layout', () => {
  const days = [
    { date: '2026-10-26', returnDate: '2026-10-27' },
    { date: '2026-10-27', returnDate: '2026-10-28' },
    { date: '2026-11-01', returnDate: '2026-11-02' }
  ];
  const rows = [
    { line: '77', customer: 'DECATHLON', ref: '353234', color: 'BLEU', po: 'PO1', lineQuantity: 300, inputDate: '2026-10-26', outputDate: '2026-11-05', printCount: 2, leadTime: '1 ngày', allocations: { 0: 100, 1: 'X' } },
    { line: '111', customer: 'Decathlon WTI', ref: '125621', color: 'NOIR', po: 'PO2', lineQuantity: 50, printCount: 1, leadTime: '2 ngày', allocations: { 2: 50 } }
  ];
  const booking = { filename: 'b.xlsx', leadTimes: [], models: [], rows, days };
  const workbook = buildExportWorkbook({ summary: summarizeWarehouse([]), dashboard: booking, booking, sources: [] });
  assert.equal(workbook.SheetNames[0], 'TH');
  const table = XLSX.utils.sheet_to_json(workbook.Sheets.TH, { header: 1, defval: null, raw: true, blankrows: true });

  assert.deepEqual(table[0].slice(0, 2), ['LINE', 'CUS']);
  assert.deepEqual(table[4].slice(0, 2), ['LINE', 'CUS']);
  assert.deepEqual(table.slice(0, 4).map((row) => row[16]), [' PXC CHUYỂN ', ' PXI TRẢ ', ' TỔNG TUẦN ', ' TỔNG NGÀY ']);
  assert.deepEqual(table[3].slice(17, 20), [200, 0, 50]);
  assert.equal(table[2][17], 200);
  assert.deepEqual(table[5].slice(17, 19), [100, 'X']);
  assert.ok(table[6].every((cell) => cell == null), 'empty row between lead-time groups');
  assert.equal(table[7][0], '111');
  assert.deepEqual(workbook.Sheets.TH['!merges'].map((merge) => XLSX.utils.encode_range(merge)), ['R3:S3']);
});
