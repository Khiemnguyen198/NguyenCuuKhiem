import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { extractBookingRows, readWorkbook, summarizeBooking, toIsoDate } from '../src/booking-import.js';

test('converts Excel date serials without a timezone shift', () => {
  assert.equal(toIsoDate(46321), '2026-10-26');
  assert.equal(toIsoDate('28/10/2026'), '2026-10-28');
  assert.equal(toIsoDate(''), null);
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
