import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { readWarehouseSheet } from '../src/warehouse-import.js';

const header = ['PO', 'MÃ HÀNG', 'MÀU', 'MÙA', 'HÌNH IN', 'KHÁCH HÀNG', 'BỘ', ' SLHĐ ', ' SLHĐ\r\nTỔNG ', 'TỔNG NHẬN', 'TỔNG\r\n GIAO', 'CHƯA GIAO', 'HỎNG IN', ' LỖI VẢI ', 'MẪU', 'THIẾU VẢI', ' GIAO ĐẠT ', ' PO ', ' HỆ SỐ ', ' FULL PO ', ' KẾ HOẠCH  ', ' TỔNG NHẬN '];

function sheetRows() {
  return XLSX.utils.aoa_to_sheet([header, [],
    ['67667-OB', 357446, 'BLEU', 'SS26', 'ORBIT', 'Decathlon', null, 416, 1000, 1000, 1000, 0, 4, 24, 0, 2, 970, 73031, null, 4525067667, 'TRUNG', 0],
    ['67667-TB', 357446, 'BLEU', 'SS26', 'TRIBORD', 'Decathlon', null, 416, 1000, 1000, 900, 100, 0, 1, 0, 0, 899, 73031, null, 4525067667, 'TRUNG', 0],
    ['4525133647', 357446, 'BLEU', 'SS26', null, '4525133647', null, 584, 1000, 0, 0, 0, 0, 0, 0, 0, 0, 73031, null, 4525133647, 'TRUNG', 0],
    ['50001', 'AF31116', 'BLACK', 'SS26', null, 'GAO', null, 'BSL', 300, 0, 0, 0, 0, 0, 0, 0, 0, null, null, null, null, 0]
  ]);
}

test('reads the TỔNG HỢP sheet by header names', () => {
  const lines = readWarehouseSheet(sheetRows());
  assert.equal(lines.length, 4);
  assert.deepEqual([lines[0].received, lines[0].good, lines[0].fullPo], [1000, 970, '4525067667']);
  assert.equal(lines[3].contractQuantity, 0);
});

test('reads actual delivery date when the warehouse sheet provides it', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['PO', 'MÃ HÀNG', 'MÀU', 'MÙA', 'TỔNG NHẬN', 'NGÀY GIAO THỰC TẾ'],
    ['PO1', 'R1', 'BLUE', 'SS27', 100, 46266]
  ]);
  assert.equal(readWarehouseSheet(sheet)[0].actualDeliveryDate, '2026-09-01');
});

test('leaves actual delivery date empty when the warehouse sheet has no date column', () => {
  const lines = readWarehouseSheet(sheetRows());
  assert.equal(lines[0].actualDeliveryDate, null);
});

test('groups warehouse lines by ticket and keeps the slowest print', async () => {
  const { groupDeliveries, itemFromDeliveries } = await import('../src/warehouse-import.js');
  const lines = readWarehouseSheet(sheetRows());
  const units = groupDeliveries(lines, new Map(), { keyOf: (line) => `${line.model}|${line.ticket}` }).map(itemFromDeliveries);
  const product = units.find((unit) => unit.model === '357446' && unit.received);
  assert.deepEqual([product.received, product.delivered, product.good, product.prints.length], [1000, 900, 899, 2]);
});

test('reads workbook even if sheet name has trailing spaces or different casing', async () => {
  const { readWarehouseWorkbook } = await import('../src/warehouse-import.js');
  const wb = { SheetNames: [' TỔNG HỢP '], Sheets: { ' TỔNG HỢP ': sheetRows() } };
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const lines = readWarehouseWorkbook(buffer);
  assert.equal(lines.length, 4);
});
