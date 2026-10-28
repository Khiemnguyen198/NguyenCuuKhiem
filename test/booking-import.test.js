import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { crossCheckSheets, extractBookingRows, readWorkbook, summarizeBooking, toIsoDate } from '../src/booking-import.js';

test('converts Excel date serials without a timezone shift', () => {
  assert.equal(toIsoDate(46321), '2026-10-26');
  assert.equal(toIsoDate('28/10/2026'), '2026-10-28');
  assert.equal(toIsoDate('28-10-2026'), '2026-10-28');
  assert.equal(toIsoDate('28.10.2026'), '2026-10-28');
  assert.equal(toIsoDate('2026/10/28'), '2026-10-28');
  assert.equal(toIsoDate('2026-10-28'), '2026-10-28');
  assert.equal(toIsoDate('2026-10-28T00:00:00.000Z'), '2026-10-28');
  assert.equal(toIsoDate(''), null);
});

test('reads sheet with case-insensitive name and trailing spaces', () => {
  const header = ['LINE', 'CUS', 'PO', ' MODEL CODE ', 'LINE QTY', 'HÌNH IN', ' INPUT ', ' OUTPUT ', ' SỐ PHIẾU ', ' SLHĐ TỔNG ', 'Leadtime'];
  const sheet = XLSX.utils.aoa_to_sheet([header, [], ['KẾ HOẠCH BOOK IN'], [], header,
    [1, 'DECATHLON', 'PO1', 'M1', 100, 2, 46321, 46322, 73611, 1660, '2 ngày']
  ]);
  const workbook = { SheetNames: [' TH '], Sheets: { ' TH ': sheet } };
  const rows = extractBookingRows(readWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].modelCode, 'M1');
});

test('reads lead-time sheets and summarizes customers, codes and contracts', () => {
  const header = ['LINE', 'CUS', 'PO', 'MODEL CODE', 'LINE QTY', 'HÌNH IN', 'INPUT', 'OUTPUT'];
  const sheet = XLSX.utils.aoa_to_sheet([[], [], [], header,
    [1, 'DECATHLON', 'PO1', 'M1', 100, 2, 46321, 46322],
    [2, 'DECATHLON', 'PO1', 'M2', 50, 1, 46321, 46322],
    [3, 'NIKE', 'PO2', 'M1', 300, 1, 46322, 46323]
  ]);
  const workbook = { SheetNames: ['LEADTIME 1 NGÀY'], Sheets: { 'LEADTIME 1 NGÀY': sheet } };
  const rows = extractBookingRows(readWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })));
  const summary = summarizeBooking(rows);
  const [group] = summary.leadTimes;

  assert.equal(summary.totalQuantity, 450);
  assert.equal(summary.totalImpressions, 550);
  assert.equal(group.leadTime, '1 ngày');
  assert.equal(group.modelCount, 2);
  assert.equal(group.poCount, 2);
  assert.deepEqual(group.customers.map((customer) => [customer.name, customer.totalQuantity]), [['NIKE', 300], ['DECATHLON', 150]]);
  assert.deepEqual([group.firstInput, group.lastInput, group.firstOutput, group.lastOutput], ['2026-10-26', '2026-10-27', '2026-10-27', '2026-10-28']);
});

test('sorts unknown lead times after numbered ones', () => {
  const { leadTimes } = summarizeBooking([
    { leadTime: '', lineQuantity: 1, printCount: 1 },
    { leadTime: '3 ngày', lineQuantity: 1, printCount: 1 },
    { leadTime: '1 ngày', lineQuantity: 1, printCount: 1 }
  ]);
  assert.deepEqual(leadTimes.map((group) => group.leadTime), ['1 ngày', '3 ngày', 'Chưa xác định']);
});

test('reads padded headers and finds the header row in the TH sheet', () => {
  const header = ['LINE', 'CUS', 'PO', ' MODEL CODE ', 'LINE QTY', 'HÌNH IN', ' INPUT ', ' OUTPUT ', ' SỐ PHIẾU ', ' SLHĐ TỔNG ', 'Leadtime'];
  const sheet = XLSX.utils.aoa_to_sheet([header, [], ['KẾ HOẠCH BOOK IN'], [], header,
    [1, 'DECATHLON', 'PO1', 'M1', 100, 2, 46321, 46322, 73611, 1660, '2 ngày']
  ]);
  const workbook = { SheetNames: ['TH'], Sheets: { TH: sheet } };
  const rows = extractBookingRows(readWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].modelCode, 'M1');
  assert.equal(rows[0].ticketNumber, '73611');
  assert.equal(rows[0].contractQuantity, 1660);
  assert.equal(rows[0].inputDate, '2026-10-26');
  assert.equal(rows[0].leadTime, '2 ngày');
});

test('reports TH rows that disagree with the lead-time sheets', () => {
  const header = ['LINE', 'CUS', 'PO', 'REF', 'COLOR', 'LINE QTY', 'HÌNH IN', 'Leadtime'];
  const th = XLSX.utils.aoa_to_sheet([[], [], [], [], header,
    [1, 'DEC', 'PO1', 'R1', 'C1', 100, 1, '1 ngày'],
    [2, 'DEC', 'PO2', 'R1', 'C1', 50, 1, '1 ngày']
  ]);
  const leadTime = XLSX.utils.aoa_to_sheet([[], [], [], header.slice(0, 7),
    [1, 'DEC', 'PO1', 'R1', 'C1', 120, 1],
    [3, 'DEC', 'PO3', 'R1', 'C1', 10, 1]
  ]);
  const workbook = { SheetNames: ['TH', 'LEADTIME 1 NGÀY'], Sheets: { TH: th, 'LEADTIME 1 NGÀY': leadTime } };
  const { checked, mismatches } = crossCheckSheets(readWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })));

  assert.equal(checked, true);
  assert.deepEqual(mismatches.map((item) => [item.po, item.note]), [
    ['PO1', 'TH 100 ≠ sheet leadtime 120'],
    ['PO2', 'chỉ có trong TH (1 ngày)'],
    ['PO3', 'thiếu trong TH (1 ngày)']
  ]);
});

test('reads the daily plan and flags a wrong TỔNG NGÀY', async () => {
  const { readBooking, crossCheckSheets: check } = await import('../src/booking-import.js');
  const sheet = XLSX.utils.aoa_to_sheet([
    [], [],
    [null, null, null, null, null, null, null, null, 'PXI TRẢ', 46321, 46322],
    [null, null, null, null, null, null, null, null, 'TỔNG NGÀY', 260, 999],
    ['LINE', 'CUS', 'PO', 'REF', 'COLOR', 'LINE QTY', 'HÌNH IN', 'Leadtime', 'PXC CHUYỂN', 46320, 46321],
    [1, 'DEC', 'PO1', 'R1', 'C1', 200, 2, '1 ngày', null, 100, 'X'],
    [2, 'DEC', 'PO2', 'R1', 'C1', 60, 1, '1 ngày', null, 60, 40]
  ]);
  const workbook = readWorkbook(XLSX.write({ SheetNames: ['TH'], Sheets: { TH: sheet } }, { type: 'array', bookType: 'xlsx' }));
  const { rows, days } = readBooking(workbook);
  assert.deepEqual(days, [
    { date: '2026-10-25', returnDate: '2026-10-26', fileTotal: 260 },
    { date: '2026-10-26', returnDate: '2026-10-27', fileTotal: 999 }
  ]);
  assert.deepEqual(rows.map((row) => row.allocations), [{ 0: 100, 1: 'X' }, { 0: 60, 1: 40 }]);
  const { dailyTotals } = check(workbook);
  assert.deepEqual(dailyTotals.map((item) => item.note), ['TỔNG NGÀY trong file 999 ≠ tính lại 40 lượt hình']);
});
