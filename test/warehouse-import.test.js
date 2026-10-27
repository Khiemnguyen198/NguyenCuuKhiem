import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { readWarehouseSheet, summarizeWarehouse } from '../src/warehouse-import.js';

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

test('summarizes each product by its slowest print and counts each PO once', () => {
  const lines = readWarehouseSheet(sheetRows());
  const { items, totals } = summarizeWarehouse(lines, { bookingModels: [{ model: '357446', color: 'BLEU', lastOutput: '2026-10-25', leadTime: '1 ngày' }], today: new Date(2026, 9, 27) });
  const product = items.find((item) => item.model === '357446');

  assert.equal(product.customer, 'Decathlon');
  assert.equal(product.contract, 1000);
  assert.equal(product.poCount, 2);
  assert.equal(product.good, 899);
  assert.equal(product.remaining, 101);
  assert.equal(product.prints.length, 2);
  assert.equal(product.status, 'printing');
  assert.equal(product.daysToDue, -2);
  assert.equal(product.overdue, true);

  const waiting = items.find((item) => item.model === 'AF31116');
  assert.equal(waiting.contract, 300);
  assert.equal(waiting.status, 'waiting');
  assert.equal(totals.statusCounts.waiting, 1);
});

test('adds booked products that the warehouse has not received yet', () => {
  const { items } = summarizeWarehouse([], {
    bookingModels: [{ model: '361367', color: '9057150CORA 1P NOIR', customer: 'DECATHLON', quantity: 1200, lastOutput: '2026-10-29', leadTime: '1 ngày' }],
    today: new Date(2026, 9, 27)
  });
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].contract, items[0].status, items[0].atRisk, items[0].daysToDue], [1200, 'waiting', true, 2]);
});

test('uses the receiving log for received quantities and matches colors loosely', () => {
  const lines = readWarehouseSheet(sheetRows());
  const receipts = new Map([['357446|BLEU', { model: '357446', color: 'BLEU*', received: 1100, shipped: 0, receipts: 3, contractTotal: 1000, lastDate: '2026-10-26' }]]);
  const { items } = summarizeWarehouse(lines, { receipts });
  const product = items.find((item) => item.model === '357446');
  assert.deepEqual([product.received, product.receivedInWarehouseFile, product.lastReceiptDate], [1100, 1000, '2026-10-26']);
});
