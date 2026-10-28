import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionOf, filterOrders, planOrders, planTotals, renderPlanTab, splitPinned } from '../src/plan-results.js';
import { exportFilename } from '../src/export-workbook.js';
import { excelPath } from '../server/sqlite-api.js';

const order = (overrides) => ({
  key: overrides.model, customer: 'Manmade', model: 'A1', modelCode: '1234567', color: '1234567 BLACK', season: 'SS27', ticket: 'T1',
  contract: 100, received: 0, delivered: 0, good: 0, defects: 0, remaining: 100, onHand: 0, inputShortage: 100,
  status: 'waiting', dueDate: '2026-10-30', daysToDue: 2, overdue: false, atRisk: true, poCount: 1,
  rows: [{ po: 'PO-1', inputDate: '2026-10-27', leadTime: '3 ngày' }],
  ...overrides
});

const orders = [
  order({ model: 'DONE', status: 'done', received: 100, delivered: 100, good: 100, remaining: 0, inputShortage: 0, daysToDue: 1 }),
  order({ model: 'LATE', status: 'printing', received: 80, delivered: 30, good: 28, defects: 2, remaining: 72, onHand: 50, inputShortage: 20, daysToDue: -2, overdue: true, atRisk: false }),
  order({ model: 'WAIT', daysToDue: 5, atRisk: false }),
  order({ model: 'OUT', outsideBooking: true })
];

test('planOrders drops warehouse items outside the booking', () => {
  assert.deepEqual(planOrders(orders).map((item) => item.model), ['DONE', 'LATE', 'WAIT']);
});

test('splitPinned keeps delivered orders first and the rest by urgency', () => {
  const { done, open } = splitPinned(planOrders(orders));
  assert.deepEqual(done.map((item) => item.model), ['DONE']);
  assert.deepEqual(open.map((item) => item.model), ['LATE', 'WAIT']);
});

test('attentionOf explains what to look at', () => {
  const late = attentionOf(orders[1]).map((note) => note.label);
  assert.deepEqual(late, ['Trễ hạn 2 ngày', 'Thiếu BTP 20', 'Tồn 50 chưa giao', 'Lỗi 2']);
  assert.deepEqual(attentionOf(orders[0]), []);
  assert.equal(attentionOf(orders[2])[0].label, 'Chưa nhận BTP');
});

test('planTotals adds up each file and the stock left', () => {
  const totals = planTotals(planOrders(orders));
  assert.equal(totals.quantity, 300);
  assert.equal(totals.received, 180);
  assert.equal(totals.delivered, 130);
  assert.equal(totals.onHand, 50);
  assert.equal(totals.done, 1);
  assert.equal(totals.attention, 1);
});

test('filterOrders matches model, colour and PO', () => {
  assert.equal(filterOrders(planOrders(orders), 'late').length, 1);
  assert.equal(filterOrders(planOrders(orders), 'po-1').length, 3);
  assert.equal(filterOrders(planOrders(orders), 'black').length, 3);
});

test('filterOrders filters by status and customer', () => {
  const list = [
    order({ model: 'O1', customer: 'Nike', status: 'printing', pinned: true }),
    order({ model: 'O2', customer: 'Adidas', status: 'waiting', pinned: false })
  ];
  assert.equal(filterOrders(list, '', { status: 'pinned' }).length, 1);
  assert.equal(filterOrders(list, '', { customer: 'Nike' }).length, 1);
  assert.equal(filterOrders(list, '', { customer: 'Puma' }).length, 0);
});

test('combined tab pins delivered orders above the others', () => {
  const html = renderPlanTab('combined', planOrders(orders));
  assert.ok(html.indexOf('plan-pinned') < html.indexOf('>LATE<'));
  assert.ok(html.indexOf('>DONE<') < html.indexOf('>LATE<'));
  for (const tab of ['booking', 'receipts', 'deliveries']) assert.match(renderPlanTab(tab, planOrders(orders)), /<tfoot>/);
});

test('export filename names a single picked day', () => {
  const now = new Date(2026, 9, 28, 9, 5);
  assert.match(exportFilename(now, { from: '2026-10-27', to: '2026-10-27' }), /^TONG_HOP_GIAO_HANG_NGAY_2710_/);
  assert.match(exportFilename(now, { from: '2026-10-26', to: '2026-10-31' }), /^TONG_HOP_GIAO_HANG_TUAN_2610-3110_/);
});

test('excelPath accepts shared-drive workbooks only', () => {
  assert.equal(excelPath('\\\\server\\share\\KHO.xlsm'), '\\\\server\\share\\KHO.xlsm');
  assert.equal(excelPath('"Z:\\Kho\\Nhap.xlsx"'), 'Z:\\Kho\\Nhap.xlsx');
  assert.equal(excelPath('/Volumes/kho/a.xlsb'), '/Volumes/kho/a.xlsb');
  assert.throws(() => excelPath('/etc/passwd'), /file Excel/);
  assert.throws(() => excelPath('kho/a.xlsx'), /đầy đủ/);
});
