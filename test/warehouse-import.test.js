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

test('joins dated shipment transactions to matching summary PO and exports that PO only', async () => {
  const { readWarehouseWorkbook } = await import('../src/warehouse-import.js');
  const { summarizeLots } = await import('../src/lots.js');
  const { buildExportWorkbook } = await import('../src/export-workbook.js');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['PO', 'MÃ HÀNG', 'MÀU', 'MÙA', 'TỔNG NHẬN', 'TỔNG GIAO', 'GIAO ĐẠT', 'FULL PO'],
    ['P1-OB', 'R1', '1234567 BLUE', 'SS27', 10, 10, 10, 'P1'],
    ['P2-OB', 'R1', '1234567 BLUE', 'SS27', 10, 0, 0, 'P2']
  ]), 'TỔNG HỢP');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['NGÀY', 'PO-SLHĐ', 'MÃ HÀNG', 'MÀU', 'TOTAL XUẤT'],
    [46320, 'P1-OB', 'R1', '1234567 BLUE', 5],
    [46323, 'P1-OB', 'R1', '1234567 BLUE', 5],
    [46324, 'P2-OB', 'R1', '1234567 BLUE', 0]
  ]), 'NHẬP XUẤT');
  const lines = readWarehouseWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
  assert.equal(lines[0].actualDeliveryDate, '2026-10-28');
  assert.equal(lines[1].actualDeliveryDate, null);
  const rows = ['P1', 'P2'].map(po => ({ ref:'R1', color:'1234567 BLUE', modelCode:'1234567', season:'SS27', po, lineQuantity:10, outputDate:'2026-11-01', leadTime:'1 ngày', allocations:{} }));
  const { items } = summarizeLots({ bookingRows: rows, deliveryLines: lines });
  const book = buildExportWorkbook({ booking: { rows, days: [] }, lots: items });
  assert.equal(book.Sheets['KE HOACH GIAO HANG'].L2.v, 46323);
  assert.equal(book.Sheets['KE HOACH GIAO HANG'].L3, undefined);
  assert.equal(lines.length, 2, 'transactions must not double-count delivery quantities');
});

test('does not assign an ambiguous or undated transaction to a contract', async () => {
  const { attachTransactionDates } = await import('../src/warehouse-import.js');
  const lines = [
    { po:'P1', model:'R', color:'1234567 BLUE', season:'SS26', fullPo:'P1' },
    { po:'P1', model:'R', color:'1234567 BLUE', season:'SS27', fullPo:'P1' },
    { po:'P2', model:'R', color:'1234567 BLUE', season:'SS27', fullPo:'P2' }
  ];
  const sheet = XLSX.utils.aoa_to_sheet([
    ['NGÀY', 'PO-SLHĐ', 'MÃ HÀNG', 'MÀU', 'TOTAL XUẤT'],
    [46320, 'P1', 'R', '1234567 BLUE', 1],
    [46320, 'P2', 'R', '1234567 BLUE', 1],
    [null, 'P2', 'R', '1234567 BLUE', 1]
  ]);
  attachTransactionDates(lines, sheet);
  assert.deepEqual(lines.map(line => line.actualDeliveryDate), [undefined, undefined, undefined]);
});

test('checks the SLTL ticket when the warehouse reuses a PO across lots', async () => {
  const { summarizeLots } = await import('../src/lots.js');
  const sheet = XLSX.utils.aoa_to_sheet([
    ['PO', 'MÃ HÀNG', 'MÀU', 'MÙA', 'TỔNG NHẬN', 'TỔNG GIAO', 'GIAO ĐẠT', 'SLTL', 'FULL PO', 'NGÀY GIAO'],
    ['P1', 'R1', '1234567 BLUE', 'SS26', 10, 10, 10, 73094, 'P1', 46320]
  ]);
  const lines = readWarehouseSheet(sheet);
  assert.equal(lines[0].dateTicket, '73094');
  assert.equal(lines[0].ticket, '');
  const rows = [{ ref:'R1', color:'1234567 BLUE', modelCode:'1234567', season:'SS26', po:'P1', ticketNumber:'73628', lineQuantity:10, outputDate:'2026-11-01', leadTime:'1 ngày', allocations:{} }];
  summarizeLots({ bookingRows: rows, deliveryLines: lines });
  assert.equal(rows[0].fileDeliveryDate, null);
});
