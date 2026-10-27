import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLots, modelCodeOf, restrictToRows, summarizeLots } from '../src/lots.js';

const row = (po, quantity, outputDate, extra = {}) => ({
  line: '77', customer: 'DECATHLON', ref: '353234', color: '9046670 1P BEA', modelCode: '9046670', season: 'SS27',
  po, lineQuantity: quantity, inputDate: '2026-10-20', outputDate, ticketNumber: '0', leadTime: '1 ngày', allocations: {}, ...extra
});
const delivery = (fields) => ({
  po: 'X', fullPo: '', ticket: '', model: '353234', color: '9046670 1P BEA FUNSTRIPES', season: 'SS27', print: '', customer: 'Decathlon',
  contractQuantity: 0, contractTotal: 0, received: 0, delivered: 0, printDefects: 0, fabricDefects: 0, samples: 0, fabricShort: 0, good: 0, ...fields
});

test('takes the model code from the first seven digits of the color', () => {
  assert.equal(modelCodeOf('90466701P BEA'), '9046670');
  assert.equal(modelCodeOf('BLUE'), 'BLUE');
  assert.equal(modelCodeOf('x', '8999235'), '8999235');
});

test('builds lots the way the booking computes SLHĐ TỔNG', () => {
  const lots = buildLots([
    row('PO1', 100, '2026-11-05'),
    row('PO2', 50, '2026-11-03'),
    row('PO3', 30, '2026-11-09', { inputDate: '2026-10-27' }),
    row('PO4', 70, '2026-11-12', { ticketNumber: '73611' }),
    row('PO5', 20, '2026-11-12', { ticketNumber: '73611', line: '78' })
  ]);
  assert.deepEqual(lots.map((lot) => [lot.ticket, lot.contract, lot.rows.map((item) => item.po)]), [
    [null, 150, ['PO2', 'PO1']],
    [null, 30, ['PO3']],
    ['73611', 90, ['PO4', 'PO5']]
  ]);
});

test('matches by ticket first and pours the rest FIFO by due date', () => {
  const bookingRows = [
    row('PO1', 100, '2026-11-05'),
    row('PO2', 50, '2026-11-03'),
    row('PO3', 30, '2026-11-09', { inputDate: '2026-10-27' }),
    row('PO4', 70, '2026-11-12', { ticketNumber: '73611' })
  ];
  const deliveryLines = [
    delivery({ ticket: '73611', received: 70, delivered: 60, good: 58, printDefects: 2 }),
    delivery({ season: 'SS27OW02', received: 170, delivered: 160, good: 160 })
  ];
  const { items, totals } = summarizeLots({ bookingRows, deliveryLines, today: new Date(2026, 9, 27) });
  const byTicket = Object.fromEntries(items.map((item) => [item.ticket || item.rows.map((r) => r.po).join(','), item]));

  assert.deepEqual([byTicket['73611'].good, byTicket['73611'].matchedBy], [58, 'phiếu']);
  assert.deepEqual([byTicket['PO2,PO1'].received, byTicket['PO2,PO1'].good, byTicket['PO2,PO1'].status], [150, 150, 'done']);
  assert.deepEqual([byTicket.PO3.received, byTicket.PO3.good, byTicket.PO3.remaining], [20, 10, 20]);
  assert.deepEqual(bookingRows.filter((r) => r.ticketNumber === '0').map((r) => [r.po, r.goodFifo, r.remainingFifo]), [
    ['PO1', 100, 0], ['PO2', 50, 0], ['PO3', 10, 20]
  ]);
  assert.equal(totals.contract, 250);

  const week = restrictToRows(items, (r) => r.po === 'PO3' || r.po === 'PO1', new Date(2026, 9, 27));
  assert.deepEqual(week.map((item) => [item.contract, item.good]).sort(), [[100, 100], [30, 10]].sort());
});

test('keeps warehouse products without booking lots apart', () => {
  const { items, totals } = summarizeLots({ bookingRows: [row('PO1', 100, '2026-11-05')], deliveryLines: [delivery({ model: '999999', received: 40, delivered: 40, good: 40 })] });
  assert.equal(items.find((item) => item.outsideBooking).good, 40);
  assert.deepEqual([totals.contract, totals.outside], [100, 1]);
});

test('filters lots by Mã hàng, Model and Màu columns', async () => {
  const { matchesFilters } = await import('../src/models-view.js');
  const item = { model: '353234', modelCode: '9046670', color: '9046670 1P BEA FUNSTRIPES', customer: 'Decathlon', status: 'printing', rows: [] };
  assert.equal(matchesFilters(item, { status: 'all', columns: { model: '3532', modelCode: '', color: 'bea' } }), true);
  assert.equal(matchesFilters(item, { status: 'all', columns: { model: '', modelCode: '8999', color: '' } }), false);
  assert.equal(matchesFilters(item, { status: 'all', columns: { color: '9046670' } }), false, 'color filter ignores the model code prefix');
});
