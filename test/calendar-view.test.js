import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarOrders, filterCalendar, renderCalendar, renderOrderDetail, weekColumns } from '../src/calendar-view.js';

const days = [
  { date: '2026-10-24' },
  { date: '2026-10-26' },
  { date: '2026-10-27' },
  { date: '2026-10-29' }
];
const week = { key: '2026-10-26', dayIndexes: [1, 2, 3], label: 'Tuần 26/10 – 29/10/2026' };
const lot = (overrides) => ({
  key: overrides.model, customer: 'Decathlon', model: 'A', modelCode: '1234567', color: '1234567 BLUE', season: 'SS27',
  contract: 100, received: 0, delivered: 0, good: 0, defects: 0, printDefects: 0, fabricDefects: 0, remaining: 100, onHand: 0, inputShortage: 100,
  status: 'waiting', dueDate: null, daysToDue: 3, overdue: false, poCount: 1, matchedBy: 'FIFO',
  ...overrides
});

test('weekColumns lays out Monday to Sunday with booking day indexes', () => {
  const columns = weekColumns(week, days);
  assert.equal(columns.length, 7);
  assert.deepEqual(columns.map((column) => column.index), [1, 2, null, 3, null, null, null]);
  assert.equal(columns[0].weekday, 'Thứ 2');
  assert.equal(columns[6].sunday, true);
});

test('calendarOrders spans planned days and stretches to a later due date', () => {
  const columns = weekColumns(week, days);
  const orders = calendarOrders([
    lot({ model: 'LATER', dueDate: '2026-10-29', rows: [{ po: 'P2', allocations: { 2: 40 } }] }),
    lot({ model: 'FIRST', dueDate: '2026-10-27', rows: [{ po: 'P1', allocations: { 0: 5, 1: 60, 2: 'X' } }] }),
    lot({ model: 'NONE', rows: [{ po: 'P3', allocations: { 0: 9 } }] }),
    lot({ model: 'OUT', outsideBooking: true, rows: [] })
  ], columns);
  assert.deepEqual(orders.map((order) => order.item.model), ['FIRST', 'LATER']);
  assert.deepEqual(orders[0].cells.slice(0, 2), [60, 0]);
  assert.deepEqual([orders[0].start, orders[0].end, orders[0].due], [0, 1, 1]);
  assert.deepEqual([orders[1].start, orders[1].end, orders[1].due], [1, 3, 3]);
  const html = renderCalendar({ columns, orders, shownOrders: orders, today: '2026-10-27' });
  assert.match(html, /grid-column:3 \/ 6/);
  assert.match(html, /cal-day--today/);
});

test('filterCalendar narrows by status and text', () => {
  const orders = [
    { item: lot({ model: 'DONE', status: 'done', rows: [{ po: 'X1' }] }) },
    { item: lot({ model: 'LATE', status: 'printing', overdue: true, rows: [{ po: 'X2' }] }) }
  ];
  assert.deepEqual(filterCalendar(orders, { status: 'open' }).map((order) => order.item.model), ['LATE']);
  assert.deepEqual(filterCalendar(orders, { status: 'overdue' }).map((order) => order.item.model), ['LATE']);
  assert.deepEqual(filterCalendar(orders, { query: 'x1' }).map((order) => order.item.model), ['DONE']);
});

test('order detail lists every PO row with its planned days', () => {
  const full = lot({ model: 'A', rows: [{ po: 'PO-9', ticketNumber: '0', line: '85', lineQuantity: 60, allocations: { 0: 20, 1: 40 } }] });
  const weekItem = { ...full, contract: 40, rows: [{ ...full.rows[0], allocations: { 1: 40 } }] };
  const html = renderOrderDetail({ lot: full, weekItem, days, weekLabel: week.label });
  assert.match(html, /PO-9/);
  assert.match(html, /Chưa có số phiếu/);
  assert.match(html, /order-day order-day--week">26\/10: 40/);
  assert.match(html, /order-day">24\/10: 20/);
});
