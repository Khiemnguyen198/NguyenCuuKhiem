import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { compactReceiptLines, readReceiptsSheet } from '../src/receipts-import.js';

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

  assert.equal(lines[1].color, 'BLUE');
});

test('compacts receipts per product, season and ticket', () => {
  const lines = [
    { date: '2026-10-24', model: 'A', color: 'B', season: 'SS27', po: '73377', received: 10, shipped: 0 },
    { date: '2026-10-26', model: 'A', color: 'B', season: 'SS27', po: '73377', received: 15, shipped: 5 },
    { date: '2026-10-26', model: 'A', color: 'B', season: 'SS27', po: '73400', received: 7, shipped: 0 }
  ];
  const compact = compactReceiptLines(lines);
  assert.equal(compact.length, 2);
  assert.deepEqual([compact[0].received, compact[0].shipped, compact[0].receipts, compact[0].firstDate, compact[0].date], [25, 5, 2, '2026-10-24', '2026-10-26']);
});

test('reads the real layout where both totals are labelled TOTAL', () => {
  const header = ['NGÀY NHẬN', 'CODE', 'KHÁCH HÀNG', 'WEB', 'RẬP', 'SỐ CHI TIẾT IN', 'MÃ HÀNG', 'MÀU', 'PO', 'SS', 'SLHĐ', 'SLHĐ TỔNG', 'GROUP SIZE', 'BÀN', 'TOTAL', 'XS', 'S', 'NGÀY XUẤT', 'TOTAL', 'XS', 'S', 'TOTAL'];
  const rows = Array.from({ length: 9 }, () => []);
  rows.push(header, [46322, 'DEC-335516', 'DEC', null, null, null, 335516, 'PAT29784', 73576, null, 1965, 1965, null, 1, 1334, 600, 734, 'OK', 1300, 580, 720, -34]);
  const [line] = readReceiptsSheet(XLSX.utils.aoa_to_sheet(rows));
  assert.deepEqual([line.model, line.po, line.received, line.shipped, line.date], ['335516', '73576', 1334, 1300, '2026-10-27']);
});
