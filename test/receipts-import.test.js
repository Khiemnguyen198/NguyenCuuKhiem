import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { readReceiptsSheet, summarizeReceipts } from '../src/receipts-import.js';

test('reads the DATA sheet of the receiving log and totals each product', () => {
  const header = ['NGÀY NHẬN', 'CODE', 'KHÁCH HÀNG', 'WEB', 'RẬP', 'SỐ CHI TIẾT', 'MÃ HÀNG', 'MÀU', 'PO', 'SS', 'SLHĐ', 'SLHĐ TỔNG', 'GROUP SIZE', 'BÀN', 'TỔNG NHẬN', 'S', 'M', 'NGÀY XUẤT', 'TỔNG XUẤT'];
  const rows = Array.from({ length: 9 }, () => []);
  rows.push(header,
    [46321, 'DEC-332690-BLUE-SS27', 'DEC', null, null, '1CT', 332690, 'BLUE', 73377, 'SS27', 4105, 4105, null, 'B1', 600, 300, 300, null, 0],
    [46322, 'DEC-332690-BLUE-SS27', 'DEC', null, null, '1CT', 332690, 'BLUE ', 73377, 'SS27', 4105, 4105, null, 'B2', 400, 200, 200, 'OK', 380],
    [46322, null, 'GAO', null, null, null, 'AF31116', 'BLACK', '7W000321', null, 566, 566, null, null, 0, 0, 0, null, 0]
  );
  const lines = readReceiptsSheet(XLSX.utils.aoa_to_sheet(rows));
  assert.equal(lines.length, 2);
  assert.deepEqual([lines[0].date, lines[0].received, lines[1].shipped], ['2026-10-26', 600, 380]);

  const products = summarizeReceipts(lines);
  assert.deepEqual([...products.keys()], ['332690|BLUE']);
  const product = products.get('332690|BLUE');
  assert.deepEqual([product.received, product.shipped, product.receipts, product.firstDate, product.lastDate], [1000, 380, 2, '2026-10-26', '2026-10-27']);
});

test('compacted receipt lines summarize to the same totals', async () => {
  const { compactReceiptLines } = await import('../src/receipts-import.js');
  const lines = [
    { date: '2026-10-24', model: 'A', color: 'B', received: 10, shipped: 0, contractTotal: 30 },
    { date: '2026-10-26', model: 'A', color: 'B', received: 15, shipped: 5, contractTotal: 30 }
  ];
  const compact = compactReceiptLines(lines);
  assert.equal(compact.length, 1);
  assert.deepEqual(summarizeReceipts(compact).get('A|B'), summarizeReceipts(lines).get('A|B'));
});
