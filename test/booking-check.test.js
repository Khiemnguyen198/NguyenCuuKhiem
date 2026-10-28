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

test('points each data problem at its cell with reasoning and how to check it', () => {
  const { issues } = checkBookingSheet(workbook());
  assert.deepEqual(issues.map((issue) => [issue.type, issue.cell, issue.value, issue.expected]).sort(), [
    ['output_sunday', 'J7', '01/11/2026 (Chủ Nhật)', 'Thứ Hai – Thứ Bảy'],
    ['return_before_pickup', 'R2', '26/10/2025', '26/10/2026']
  ].sort());
  const sunday = issues.find((issue) => issue.type === 'output_sunday');
  assert.equal(sunday.po, 'PO2');
  assert.match(sunday.suggestion, /Thứ Bảy 31\/10\/2026/);
  assert.match(sunday.howToCheck, /ô J7/);
  const pxi = issues.find((issue) => issue.type === 'return_before_pickup');
  assert.match(pxi.reason, /gõ nhầm năm/);
  assert.match(pxi.howToCheck, /R2.*R5/);
});

test('flags a day plan that does not add up to LINE QTY', () => {
  const header = ['LINE', 'CUS', 'REF', 'COLOR', 'PO', 'LINE QTY', 'HÌNH IN', 'Leadtime', 'PXC CHUYỂN', 46321, 46322];
  const sheet = XLSX.utils.aoa_to_sheet([header, [1, 'DEC', 'R1', 'C1', 'PO1', 100, 1, '1 ngày', null, 30, 40]]);
  const { issues } = checkBookingSheet(readWorkbook(XLSX.write({ SheetNames: ['TH'], Sheets: { TH: sheet } }, { type: 'array', bookType: 'xlsx' })));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, 'plan_mismatch');
  assert.match(issues[0].reason, /J 26\/10: 30 \+ K 27\/10: 40 = 70; LINE QTY 100 — còn thiếu 30/);
});

test('the export holds TH with computed totals and CAN DOI per lot', () => {
  const book = workbook();
  const { rows, days } = readBooking(book);
  const sheetCheck = { checked: true, mismatches: [], cells: checkBookingSheet(book) };
  const out = buildExportWorkbook({ booking: { rows, days }, lots: summarizeLots({ bookingRows: rows }).items, sheetCheck });
  assert.deepEqual(out.SheetNames, ['TH', 'CAN DOI']);
  const th = out.Sheets.TH;
  assert.deepEqual([th.M6.v, th.M7.v, th.S4.v], [150, 150, 50], 'SLHĐ TỔNG is the lot total, TỔNG NGÀY recomputed');
  assert.match(th.R2.c[0].t, /sai năm/);
  assert.equal(new Date(Date.UTC(1899, 11, 30) + th.R2.v * 86_400_000).toISOString().slice(0, 10), '2026-10-26');
  // Like the planners' sheet, CAN DOI starts at row 3 (totals), header on row 4.
  const canDoi = XLSX.utils.sheet_to_json(out.Sheets['CAN DOI'], { header: 1, defval: null, raw: true, blankrows: true });
  assert.equal(out.Sheets['CAN DOI']['!ref'].split(':')[0], 'A3');
  assert.deepEqual(canDoi[1].slice(1, 13), ['REF', 'MODEL CODE', 'Mùa', 'SLHĐ TỔNG', 'HÌNH IN', ' Leadtime ', 'W43', 'Ngày nhận', 'Thực Nhận', 'Đã In', 'Đã Giao', 'GAP']);
  assert.deepEqual(canDoi[2].slice(0, 8), ['3532349046670150', '353234', '9046670', 'SS27', 150, 1, '1 ngày', 150]);
  assert.equal(out.Sheets['CAN DOI'].H5.f, 'SUM(N5:O5)');
});
