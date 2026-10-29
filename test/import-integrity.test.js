import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as XLSX from 'xlsx';
import { crossCheckSheets, readBooking, readWorkbook, summarizeBooking, toIsoDate } from '../src/booking-import.js';
import { validateBookingRows } from '../src/booking-validation.js';

const header = ['LINE', 'CUS', 'REF', 'COLOR', 'PO', 'MODEL CODE', 'LINE QTY', 'HÌNH IN', 'INPUT', 'OUTPUT', 'SLHĐ TỔNG', 'Leadtime'];
const line = ['L1', 'DEC', '349821', '8901083 BLACK', 'PO1', '8901083', 100, 2, 46321, 46322, null, '1 ngày'];
const booking = (changes = {}) => ({ lineQuantity: 100, printCount: 2, ...changes });
const workbook = (rows, name = 'TH') => ({ SheetNames: [name], Sheets: { [name]: XLSX.utils.aoa_to_sheet(rows) } });

test('invalid numeric booking cells report their actual sheet and Excel row', () => {
  for (const [column, label] of [[6, 'LINE QTY'], [7, 'HÌNH IN']]) {
    for (const value of [null, '', ' ', '-', 'hai', true, '1e309', '1,000', -1, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = [...line];
      invalid[column] = value;
      assert.throws(() => readBooking(workbook([[], [], [], [], header, invalid])), (error) => {
        assert.equal(error.status, 400);
        assert.match(error.message, /Sheet "TH", dòng Excel 6/);
        assert.ok(error.message.includes(label), error.message);
        return true;
      });
    }
  }
});

test('required numeric fields reject null, objects, booleans and unsafe totals on the API boundary', () => {
  for (const field of ['lineQuantity', 'printCount']) {
    for (const value of [undefined, null, '', true, false, {}, [], NaN, Infinity, -Infinity, -1]) {
      assert.throws(() => validateBookingRows([booking({ [field]: value })]), (error) => error.status === 400);
    }
  }
  assert.throws(() => validateBookingRows([booking({ lineQuantity: Number.MAX_SAFE_INTEGER, printCount: 2 })]), /Lượt hình của dòng/);
  assert.throws(() => validateBookingRows([booking({ lineQuantity: Number.MAX_SAFE_INTEGER, printCount: 1 }), booking({ lineQuantity: 1, printCount: 1 })]), /Tổng LINE QTY/);
  assert.throws(() => validateBookingRows([booking({ lineQuantity: 1, printCount: Number.MAX_SAFE_INTEGER }), booking({ lineQuantity: 1, printCount: 1 })]), /Tổng lượt hình/);
  assert.deepEqual(validateBookingRows([]), []);
});

test('repair runs before final validation, preserves missing LINE/PO and retains contracts and extra fields', () => {
  const swapped = [...line];
  [swapped[2], swapped[5]] = [swapped[5], swapped[2]];
  const missing = [...line];
  missing[0] = null;
  missing[4] = null;
  const { rows, repairs } = readBooking(workbook([header, swapped, missing]));
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].ref, rows[0].modelCode], ['349821', '8901083']);
  assert.equal(rows[1].line, '');
  assert.equal(rows[1].po, '');
  assert.equal(repairs.some((repair) => repair.field === 'REF ↔ MODEL CODE' && repair.applied), true);
  assert.equal(repairs.some((repair) => repair.field === 'LINE' && !repair.applied), true);
  assert.equal(rows.some((row) => 'cells' in row || 'sheetRow' in row), false);
  const [normalized] = validateBookingRows([booking({ contractQuantity: '1660', customNote: 'keep me', po: '' })]);
  assert.equal(normalized.contractQuantity, 1660);
  assert.equal(normalized.customNote, 'keep me');
  assert.equal(normalized.po, '');
});

test('a row identified only by PO is retained rather than disappearing because LINE is empty', () => {
  const partial = [...line];
  for (const column of [0, 2, 3, 5]) partial[column] = null;
  const { rows } = readBooking(workbook([header, partial]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].po, 'PO1');
  assert.equal(rows[0].lineQuantity, 100);
});

test('keeps explicit zero quantities for the checker and skips total footer rows', () => {
  const zero = [...line];
  zero[6] = 0;
  zero[7] = 0;
  const { rows } = readBooking(workbook([header, zero, [], ['TỔNG CỘNG', null, null, null, null, null, 0, 0]]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lineQuantity, 0);
  assert.equal(rows[0].printCount, 0);
});

test('validates optional contract quantities without inventing missing amounts', () => {
  for (const value of [null, undefined, '', ' ']) assert.equal(validateBookingRows([booking({ contractQuantity: value })])[0].contractQuantity, null);
  assert.equal(validateBookingRows([booking({ contractQuantity: 0 })])[0].contractQuantity, 0);
  for (const value of ['hai', true, {}, NaN, Infinity, -1]) assert.throws(() => validateBookingRows([booking({ contractQuantity: value })]), /SLHĐ TỔNG/);
});

test('preserves diagnostic allocation markers while rejecting unsafe numeric allocation loads', () => {
  const allocations = { 0: 60, 1: 'X', 2: 'XN', 3: '30 ORBIT', 4: '40' };
  assert.deepEqual(validateBookingRows([booking({ allocations })])[0].allocations, allocations);
  for (const value of [Infinity, NaN, -1, Number.MAX_SAFE_INTEGER + 1, true, {}, null, 'Infinity', '1e309']) {
    assert.throws(() => validateBookingRows([booking({ allocations: { 0: value } })]), /ngày 0/);
  }
  assert.throws(() => validateBookingRows([booking({ allocations: { 0: Number.MAX_SAFE_INTEGER } })]), /Lượt hình ngày 0/);
});

test('invalid dates cannot silently roll into another month or remain unparsed text', () => {
  for (const value of ['31/02/2026', '29-02-2026', '2026-13-01', '2026-02-30T00:00:00Z', '2026-10-28T99:00:00Z', 'not a date', true, {}, Infinity, -1, 2958466, new Date(NaN)]) {
    assert.throws(() => toIsoDate(value), (error) => error.status === 400, String(value));
  }
  assert.equal(toIsoDate('29.02.2024'), '2024-02-29');
  assert.equal(toIsoDate('2026/10/28'), '2026-10-28');
  assert.equal(toIsoDate('2026-10-28T00:00:00.000Z'), '2026-10-28');
  assert.equal(toIsoDate('01/11/2026'), '2026-11-01');
  assert.equal(toIsoDate(46321.75), '2026-10-26');
  const invalid = [...line];
  invalid[9] = '31/02/2026';
  assert.throws(() => readBooking(workbook([header, invalid])), /Sheet "TH", dòng Excel 2: OUTPUT/);
});

test('empty TH falls back to leadtime data and source sheet errors keep their name', () => {
  const book = workbook([header]);
  book.SheetNames.push('LEADTIME 1 NGÀY');
  book.Sheets['LEADTIME 1 NGÀY'] = XLSX.utils.aoa_to_sheet([[], [], [], header, line]);
  assert.equal(readBooking(book).rows.length, 1);
  const invalid = [...line];
  invalid[7] = 'hai';
  book.Sheets['LEADTIME 1 NGÀY'] = XLSX.utils.aoa_to_sheet([[], [], [], header, invalid]);
  assert.throws(() => crossCheckSheets(book), /Sheet "LEADTIME 1 NGÀY", dòng Excel 5: HÌNH IN/);
});

test('summaries normalize legitimate numeric strings and support an empty planning week', () => {
  const summary = summarizeBooking([booking({ lineQuantity: '100', printCount: '2' }), booking({ lineQuantity: '50', printCount: '3' })]);
  assert.equal(summary.totalQuantity, 150);
  assert.equal(summary.totalImpressions, 350);
  assert.equal(summarizeBooking([]).totalQuantity, 0);
});

test('actual workbook date serials stay on the same calendar day in Vietnam and UTC', () => {
  const importUrl = new URL('../src/booking-import.js', import.meta.url).href;
  const source = `
    import * as XLSX from ${JSON.stringify(import.meta.resolve('xlsx'))};
    import { readBooking, readWorkbook, toIsoDate } from ${JSON.stringify(importUrl)};
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['LINE', 'PO', 'REF', 'LINE QTY', 'HÌNH IN', 'INPUT', 'OUTPUT'],
      ['L', 'P', 'R', 100, 2, new Date(2026, 9, 29), new Date(2026, 9, 30)]
    ]), 'TH');
    const parsed = readBooking(readWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' })));
    process.stdout.write(JSON.stringify([parsed.rows[0].inputDate, parsed.rows[0].outputDate, toIsoDate(new Date(2026, 9, 29))]));
  `;
  for (const timezone of ['UTC', 'Asia/Ho_Chi_Minh']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ['2026-10-29', '2026-10-30', '2026-10-29']);
  }
});
