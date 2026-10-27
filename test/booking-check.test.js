import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { readBooking, readWorkbook } from '../src/booking-import.js';
import { checkBookingSheet } from '../src/booking-check.js';
import { buildExportWorkbook } from '../src/export-workbook.js';
import { summarizeLots } from '../src/lots.js';

// TH with: M6 empty, M7 typed wrong (lot total is 150), OUTPUT on a Sunday, TỔNG NGÀY wrong,
// PXI TRẢ typed a year early.
function workbook() {
  const header = ['LINE', 'CUS', 'BRAND', 'REF', 'COLOR', 'PO', 'SS', 'LINE QTY', 'INPUT', 'OUTPUT', 'MODEL CODE', 'SỐ PHIẾU', 'SLHĐ TỔNG', 'KẾ HOẠCH', 'HÌNH IN', 'Leadtime', 'PXC CHUYỂN', 46320, 46321];
  const sheet = XLSX.utils.aoa_to_sheet([
    header,
    [...Array(16).fill(null), 'PXI TRẢ', 45956, 46322],
    [...Array(16).fill(null), 'TỔNG TUẦN', null, null],
    [...Array(16).fill(null), 'TỔNG NGÀY', 100, 999],
    header,
    [77, 'DEC', 'B', '353234', '9046670 1P', 'PO1', 'SS27', 100, 46310, 46321, '9046670', 73611, null, 'T', 1, '1 ngày', null, 100, null],
    [77, 'DEC', 'B', '353234', '9046670 1P', 'PO2', 'SS27', 50, 46310, 46327, '9046670', 73611, 999, 'T', 1, '1 ngày', null, null, 50]
  ]);
  return readWorkbook(XLSX.write({ SheetNames: ['TH'], Sheets: { TH: sheet } }, { type: 'array', bookType: 'xlsx' }));
}

test('points each TH problem at its cell with the value that should be there', () => {
  const { issues } = checkBookingSheet(workbook());
  const found = issues.map((issue) => [issue.type, issue.cell, issue.value, issue.expected]).sort();
  assert.deepEqual(found, [
    ['contract_missing', 'M6', 'trống', 150],
    ['contract_wrong', 'M7', 999, 150],
    ['output_sunday', 'J7', '01/11/2026 (Chủ Nhật)', 'Thứ Hai – Thứ Bảy'],
    ['return_before_pickup', 'R2', '26/10/2025', 'sau PXC 25/10/2026'],
    ['daily_total_wrong', 'S4', 999, 50]
  ].sort());
});

test('the export fixes what it can and lists everything in ĐỐI CHIẾU', () => {
  const book = workbook();
  const { rows, days } = readBooking(book);
  const sheetCheck = { checked: true, mismatches: [], cells: checkBookingSheet(book) };
  const out = buildExportWorkbook({ booking: { rows, days }, lots: summarizeLots({ bookingRows: rows }).items, sheetCheck });
  assert.deepEqual(out.SheetNames, ['TH', 'ĐỐI CHIẾU']);
  const th = out.Sheets.TH;
  assert.deepEqual([th.M6.v, th.M7.v, th.S4.v], [150, 150, 50]);
  assert.match(th.M7.c[0].t, /file booking ghi 999/);
  assert.equal(new Date(Date.UTC(1899, 11, 30) + th.R2.v * 86_400_000).toISOString().slice(0, 10), '2026-10-26');
  const reconciliation = XLSX.utils.sheet_to_json(out.Sheets['ĐỐI CHIẾU']);
  const results = reconciliation.map((item) => [item['Lỗi'], item['Kết quả']]);
  assert.deepEqual([...results].sort(), [
    ['SLHĐ TỔNG trống', 'Đã sửa'], ['SLHĐ TỔNG sai', 'Đã sửa'], ['PXI TRẢ sớm hơn PXC', 'Đã sửa'], ['TỔNG NGÀY sai', 'Đã sửa'], ['OUTPUT rơi vào Chủ Nhật', 'Cần kiểm tra']
  ].sort());
  assert.equal(results.at(-1)[1], 'Cần kiểm tra', 'fixed problems are listed first');
});
