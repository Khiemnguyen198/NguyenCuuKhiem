import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { readBooking } from '../src/booking-import.js';
import { canonicalHeader, isBookingHeader, modelInText } from '../src/booking-columns.js';

test('booking headers are recognised however they are typed', () => {
  assert.equal(canonicalHeader('Mã hàng'), 'REF');
  assert.equal(canonicalHeader(' mã  hàng (REF) '), 'REF');
  assert.equal(canonicalHeader('Model'), 'MODEL CODE');
  assert.equal(canonicalHeader('Màu'), 'COLOR');
  assert.equal(canonicalHeader('Line qty'), 'LINE QTY');
  assert.equal(canonicalHeader('Số phiếu'), 'SỐ PHIẾU');
  assert.equal(canonicalHeader('Lead time'), 'Leadtime');
  assert.equal(canonicalHeader('Ghi chú'), 'Ghi chú');
  assert.ok(isBookingHeader(['Line', 'Mã hàng', 'Màu', 'PO', 'Line qty']));
  assert.ok(!isBookingHeader(['Tổng', 'PO']));
});

test('modelInText finds the 7-digit model at the start or appended', () => {
  assert.equal(modelInText('9046670 1P BEA BLACK'), '9046670');
  assert.equal(modelInText('1P 100 HEVA BLUE PETROL*-8788519'), '8788519');
  assert.equal(modelInText('8903329HEVA JOY'), '8903329');
  assert.equal(modelInText('NAVY'), '');
});

// A TH sheet with renamed headers pushed down by inserted rows, and damaged lines.
function damagedBooking() {
  const header = ['Line', 'Khách hàng', 'Mã hàng', 'Màu', 'PO', 'Mùa', 'Line qty', 'Ngày nhận', 'Hạn giao', 'Model', 'Số phiếu', 'Hình in', 'Lead time'];
  const line = (overrides) => ({ Line: 'L1', 'Khách hàng': 'DECATHLON', 'Mã hàng': '349821', Màu: '8901083 RIME BLACK', PO: 'P', Mùa: 'SS27', 'Line qty': 100, Model: '8901083', 'Hình in': 1, 'Lead time': '1 ngày', ...overrides });
  const rows = [
    line({ PO: 'P1' }),
    line({ PO: 'P2' }),
    line({ PO: 'P3', 'Mã hàng': '8901083', Model: '349821' }),
    line({ PO: 'P4', 'Mã hàng': '357446', Màu: '8903329 HEVA JOY', Model: '' }),
    line({ PO: 'P5', 'Mã hàng': '357446', Màu: '8903329 HEVA JOY', Model: '8903329' }),
    line({ PO: 'P6', 'Mã hàng': '357446', Màu: 'NAVY', Model: '' }),
    line({ PO: 'P7', 'Mã hàng': '', Model: '8901083' }),
    line({ PO: 'P8', 'Mã hàng': '999000', Màu: 'NAVY', Model: '', 'Hình in': 8903329 }),
    line({ PO: 'P9', Line: '', 'Mã hàng': '357446', Màu: '8903329 HEVA JOY', Model: '8903329' }),
    line({ PO: 'P10', 'Mã hàng': '112708', Màu: '8489345 DRY BOXER BLACK', Model: '8489345' }),
    line({ PO: 'P11', 'Mã hàng': '112708', Màu: '8677502 DRY BOXER KHAKI', Model: '8677502' }),
    line({ PO: 'P12', 'Mã hàng': '112708', Màu: 'BLACK', Model: '' })
  ];
  const table = [['KẾ HOẠCH BOOK IN'], [], ['Ghi chú: cập nhật hằng ngày'], ...Array(17).fill([]), header, ...rows.map((row) => header.map((name) => row[name] ?? null))];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(table), 'TH');
  return workbook;
}

test('a damaged booking is read and repaired by Mã hàng + Model', () => {
  const { rows, repairs } = readBooking(damagedBooking());
  const byPo = Object.fromEntries(rows.map((row) => [row.po, row]));
  assert.equal(rows.length, 12, 'header found below inserted rows, and the row without LINE is kept');
  assert.deepEqual([byPo.P3.ref, byPo.P3.modelCode], ['349821', '8901083'], 'REF and MODEL swapped back');
  assert.equal(byPo.P4.modelCode, '8903329', 'model taken from COLOR');
  assert.equal(byPo.P6.modelCode, '8903329', 'the REF has a single model');
  assert.equal(byPo.P7.ref, '349821', 'REF filled from the model');
  assert.equal(byPo.P8.modelCode, '8903329', 'model found in another column of the row');
  assert.equal(byPo.P12.modelCode, '', 'two possible models: not guessed');

  const find = (po, field) => repairs.find((repair) => repair.po === po && repair.field === field);
  assert.equal(find('P3', 'REF ↔ MODEL CODE').applied, true);
  assert.equal(find('P8', 'MODEL CODE').reason.includes('lệch cột'), true);
  assert.equal(find('P8', 'REF').applied, false, 'REF 999000 is flagged, not changed');
  assert.equal(find('P9', 'LINE').applied, false);
  assert.equal(find('P12', 'MODEL CODE').applied, false);
  assert.match(find('P12', 'MODEL CODE').reason, /8489345, 8677502/);
  assert.equal(find('P1', 'MODEL CODE'), undefined, 'clean rows are left alone');
  assert.equal(rows.some((row) => 'cells' in row || 'sheetRow' in row), false, 'helper fields are not stored');
  assert.equal(find('P1', 'REF'), undefined);
  assert.equal(find('P3', 'REF ↔ MODEL CODE').sheetRow, 24);
});
