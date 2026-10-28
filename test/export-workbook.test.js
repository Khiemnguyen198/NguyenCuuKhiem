import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { buildExportWorkbook } from '../src/export-workbook.js';
import { summarizeLots } from '../src/lots.js';

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
  const booking = { filename: 'b.xlsx', rows, days };
  const { items } = summarizeLots({ bookingRows: rows });
  const workbook = buildExportWorkbook({ booking, lots: items });
  assert.deepEqual(workbook.SheetNames, ['TH', 'CAN DOI']);
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

test('fills the progress columns from the FIFO allocation', () => {
  const rows = [{ line: '1', ref: 'R', color: '1234567 X', modelCode: '1234567', season: 'SS27', po: 'P', lineQuantity: 100, outputDate: '2026-11-01', ticketNumber: '0', leadTime: '1 ngày', allocations: {} }];
  const deliveryLines = [{ po: 'x', ticket: '', model: 'R', color: '1234567 X', season: 'SS27', print: '', customer: 'C', contractQuantity: 0, contractTotal: 0, received: 80, delivered: 60, good: 55, printDefects: 5, fabricDefects: 0, samples: 0, fabricShort: 0 }];
  const { items } = summarizeLots({ bookingRows: rows, deliveryLines });
  const table = XLSX.utils.sheet_to_json(buildExportWorkbook({ booking: { rows, days: [] }, lots: items }).Sheets.TH, { header: 1, defval: null, raw: true, blankrows: true });
  const header = table[0];
  const value = (title) => table[5][header.indexOf(title)];
  assert.deepEqual([value('Model'), value('Màu'), value('Nhận BTP'), value('Đã in (giao)'), value('Còn thiếu'), value('SLHĐ tổng (lô)'), value('Nối bằng')], ['1234567', 'X', 80, 60, 45, 100, 'FIFO']);
});
