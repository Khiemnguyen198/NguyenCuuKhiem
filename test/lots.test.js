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

  const week = restrictToRows(items, (r) => (r.po === 'PO3' || r.po === 'PO1' ? r : null), new Date(2026, 9, 27));
  assert.deepEqual(week.map((item) => [item.contract, item.good]).sort(), [[100, 100], [30, 10]].sort());
});

test('matches a reused ticket only when its product also matches', () => {
  const bookingRows = [
    row('PO-A', 100, '2026-11-05', { ticketNumber: '73611' }),
    row('PO-B', 80, '2026-11-06', { ticketNumber: '73611', ref: '999999', color: '8111111 1P RED', modelCode: '8111111' })
  ];
  const deliveryLines = [
    delivery({ ticket: '73611', model: '353234', color: '9046670 1P BEA', received: 60, delivered: 60, good: 60 }),
    delivery({ ticket: '73611', model: '999999', color: '8111111 1P RED', received: 40, delivered: 40, good: 40 })
  ];
  const { items } = summarizeLots({ bookingRows, deliveryLines });
  assert.deepEqual(items.map((item) => [item.model, item.received, item.good]).sort(), [
    ['353234', 60, 60],
    ['999999', 40, 40]
  ]);
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

test('pours a row into its planned days so a week only gets its own part', async () => {
  const { batchRow } = await import('../src/batches.js');
  const days = [{ date: '2026-10-24' }, { date: '2026-10-26' }, { date: '2026-10-27' }, { date: '2026-11-02' }];
  const bookingRows = [row('PO1', 300, '2026-11-05', { allocations: { 0: 100, 2: 'X', 3: 200 } })];
  const deliveryLines = [delivery({ received: 250, delivered: 180, good: 150 })];
  const { items } = summarizeLots({ bookingRows, deliveryLines });
  assert.deepEqual(bookingRows[0].dayFifo, { 0: { received: 100, delivered: 100, good: 100 }, 3: { received: 150, delivered: 80, good: 50 } });

  const lastWeek = { dayIndexes: [0] };
  const thisWeek = { dayIndexes: [1, 2] };
  const nextWeek = { dayIndexes: [3] };
  assert.deepEqual(['lineQuantity', 'receivedFifo', 'goodFifo', 'remainingFifo'].map((key) => batchRow(bookingRows[0], days, lastWeek)[key]), [100, 100, 100, 0]);
  assert.deepEqual(['lineQuantity', 'goodFifo'].map((key) => batchRow(bookingRows[0], days, thisWeek)[key]), [0, 0], 'an X-only week has no quantity');
  const week = restrictToRows(items, (r) => batchRow(r, days, nextWeek));
  assert.deepEqual([week[0].contract, week[0].received, week[0].delivered, week[0].good, week[0].remaining], [200, 150, 80, 50, 150]);
});

test('a lot matched by ticket in the receiving file still gets FIFO deliveries', () => {
  const bookingRows = [row('PO1', 100, '2026-11-05', { ticketNumber: '73576' }), row('PO2', 100, '2026-11-08', { line: '78' })];
  const receiptLines = [{ model: '353234', color: 'PAT29784', season: 'SS27', po: '73576', received: 90, shipped: 0, date: '2026-10-26' }];
  const deliveryLines = [delivery({ received: 150, delivered: 150, good: 150 })];
  const { items } = summarizeLots({ bookingRows, deliveryLines, receiptLines });
  const lot = (po) => items.find((item) => item.rows.some((r) => r.po === po));
  assert.deepEqual([lot('PO1').received, lot('PO1').delivered, lot('PO1').matchedBy], [90, 100, 'phiếu + FIFO']);
  assert.deepEqual([lot('PO2').received, lot('PO2').delivered], [0, 50]);
});

test('pinned lot receives FIFO deliveries ahead of earlier due date lot', () => {
  const bookingRows = [
    row('PO_EARLY', 100, '2026-11-01', { line: '10' }),
    row('PO_LATE', 100, '2026-11-20', { line: '20' })
  ];
  const deliveryLines = [delivery({ received: 100, delivered: 100, good: 100 })];
  const initialLots = buildLots(bookingRows);
  const lateLotKey = initialLots.find((l) => l.rows.some((r) => r.po === 'PO_LATE')).key;
  const { items } = summarizeLots({ bookingRows, deliveryLines, pinnedLots: new Set([lateLotKey]) });
  const early = items.find((item) => item.rows.some((r) => r.po === 'PO_EARLY'));
  const late = items.find((item) => item.rows.some((r) => r.po === 'PO_LATE'));
  assert.equal(late.pinned, true);
  assert.equal(late.good, 100);
  assert.equal(early.good, 0);
});

test('records receipt and delivery dates only against the matching PO and product', () => {
  const bookingRows = [
    row('PO-A', 50, '2026-11-05', { ticketNumber: '111' }),
    row('PO-B', 50, '2026-11-06', { ticketNumber: '222' }),
    row('PO-C', 50, '2026-11-07', { ticketNumber: '333' })
  ];
  const receiptLines = [
    { model: '353234', color: '9046670 1P BEA', season: 'SS27', po: '111', received: 50, date: '2026-10-26' },
    { model: '353234', color: '9046670 1P BEA', season: 'SS27', po: '222', received: 50, date: '2026-10-28' }
  ];
  const deliveryLines = [
    delivery({ po: 'PO-A-OB', ticket: '111', delivered: 50, good: 50, actualDeliveryDate: '2026-10-29' }),
    delivery({ po: 'PO-B-TB', ticket: '222', delivered: 50, good: 50, actualDeliveryDate: '2026-10-31' }),
    delivery({ po: 'PO-C', ticket: '333', delivered: 0, good: 0, actualDeliveryDate: '2026-10-28' })
  ];
  summarizeLots({ bookingRows, receiptLines, deliveryLines });
  assert.deepEqual(bookingRows.map(({ po, receiptDate, fileDeliveryDate }) => [po, receiptDate, fileDeliveryDate]), [
    ['PO-A', '2026-10-26', '2026-10-29'],
    ['PO-B', '2026-10-28', '2026-10-31'],
    ['PO-C', null, null]
  ]);
});

test('receipt FIFO assigns a date only to the PO receiving BTP; pooled delivery dates are not copied', () => {
  const bookingRows = [row('PO-A', 30, '2026-11-05', { ticketNumber: '111' }), row('PO-B', 30, '2026-11-06', { ticketNumber: '111' })];
  const receiptLines = [{ model: '353234', color: '9046670 1P BEA', season: 'SS27', po: '111', received: 30, date: '2026-10-26' }];
  const deliveryLines = [delivery({ po: 'UNMATCHED', ticket: '', delivered: 30, good: 30, actualDeliveryDate: '2026-10-29' })];
  summarizeLots({ bookingRows, receiptLines, deliveryLines });
  assert.deepEqual(bookingRows.map(({ receiptDate, receiptDateBasis, fileDeliveryDate }) => [receiptDate, receiptDateBasis, fileDeliveryDate]), [['2026-10-26', 'FIFO theo phiếu', null], [null, null, null]]);
});

test('duplicate PO, mismatched season or ticket, zero quantity, and stale compact receipts cannot imply dates', () => {
  const bookingRows = [
    row('PO-A', 10, '2026-11-05', { ticketNumber: '111' }),
    row('PO-A', 10, '2026-11-06', { ticketNumber: '222' }),
    row('PO-B', 0, '2026-11-07', { ticketNumber: '333' })
  ];
  const receiptLines = [
    { model: '353234', color: '9046670 1P BEA', season: 'SS27', po: '111', received: 10, receipts: 2, date: '2026-10-28' },
    { model: '353234', color: '9046670 1P BEA', season: 'SS27', po: '333', received: 0, date: '2026-10-26' }
  ];
  const deliveryLines = [
    delivery({ po: 'PO-A', delivered: 10, good: 10, actualDeliveryDate: '2026-10-29' }),
    delivery({ po: 'PO-B', ticket: '444', delivered: 10, good: 10, actualDeliveryDate: '2026-10-30' }),
    delivery({ po: 'PO-B', model: 'OTHER', season: 'AW28', ticket: '333', delivered: 10, good: 10, actualDeliveryDate: '2026-10-31' })
  ];
  summarizeLots({ bookingRows, receiptLines, deliveryLines });
  assert.deepEqual(bookingRows.map(({ receiptDate, fileDeliveryDate }) => [receiptDate, fileDeliveryDate]), [[null, null], [null, null], [null, null]]);
});

test('a freshly compacted receipt keeps the latest date with actual received BTP', async () => {
  const { compactReceiptLines } = await import('../src/receipts-import.js');
  const bookingRows = [row('PO-A', 10, '2026-11-05', { ticketNumber: '111' })];
  const receiptLines = compactReceiptLines([
    { model: '353234', color: '9046670 1P BEA', season: 'SS27', po: '111', received: 10, shipped: 0, date: '2026-10-26' },
    { model: '353234', color: '9046670 1P BEA', season: 'SS27', po: '111', received: 0, shipped: 10, date: '2026-10-29' }
  ]);
  summarizeLots({ bookingRows, receiptLines });
  assert.equal(receiptLines[0].date, '2026-10-29');
  assert.equal(receiptLines[0].lastReceivedDate, '2026-10-26');
  assert.equal(bookingRows[0].receiptDate, '2026-10-26');
});

test('FIFO uses chronological dated receipts for multiple PO rows sharing a ticket', async () => {
  const { compactReceiptLines } = await import('../src/receipts-import.js');
  const makeBooking = () => [
    row('PO-A', 40, '2026-11-05', { ticketNumber: '111' }),
    row('PO-B', 60, '2026-11-06', { ticketNumber: '111' })
  ];
  const receiptLines = [
    { model: '353234', color: '9046670 1P BEA', season: 'SS27OW02', po: '111', received: 50, date: '2026-10-28' },
    { model: '353234', color: '9046670 1P BEA', season: 'SS27', po: '111', received: 50, date: '2026-10-26' }
  ];
  // Different source season spellings resolve to the sole booking season.
  const bookingRows = makeBooking();
  summarizeLots({ bookingRows, receiptLines });
  assert.deepEqual(bookingRows.map(({ receiptDate, receiptDateBasis, receivedFifo }) => [receiptDate, receiptDateBasis, receivedFifo]), [
    ['2026-10-26', 'FIFO theo phiếu', 40], ['2026-10-28', 'FIFO theo phiếu', 60]
  ]);
  // Static storage retains the dated quantity events; identical source season permits compaction.
  const compact = compactReceiptLines(receiptLines.map((line) => ({ ...line, season: 'SS27' })));
  assert.deepEqual(compact[0].receiptDates, [{ date: '2026-10-26', received: 50 }, { date: '2026-10-28', received: 50 }]);
  const staticRows = makeBooking();
  summarizeLots({ bookingRows: staticRows, receiptLines: compact });
  assert.deepEqual(staticRows.map((r) => r.receiptDate), ['2026-10-26', '2026-10-28']);
});

test('shared-ticket FIFO leaves dates unknown when any receipt has no date or old compact data lost dates', () => {
  const bookingRows = [row('PO-A', 40, '2026-11-05', { ticketNumber: '111' }), row('PO-B', 60, '2026-11-06', { ticketNumber: '111' })];
  const base = { model: '353234', color: '9046670 1P BEA', season: 'SS27', po: '111' };
  summarizeLots({ bookingRows, receiptLines: [{ ...base, received: 50, date: '2026-10-26' }, { ...base, received: 50, date: null }] });
  assert.deepEqual(bookingRows.map((r) => r.receiptDate), [null, null]);
  summarizeLots({ bookingRows, receiptLines: [{ ...base, received: 100, receipts: 2, date: '2026-10-28' }] });
  assert.deepEqual(bookingRows.map((r) => r.receiptDate), [null, null]);
});

test('date matching accepts alternate season only for a product with one booking season', () => {
  const receipt = { model: '353234', color: '9046670 1P BEA', season: 'SS27OW02', po: '111', received: 10, date: '2026-10-26' };
  const deliveryLine = delivery({ po: 'PO-A', season: 'SS27OW02', ticket: '111', delivered: 10, good: 10, actualDeliveryDate: '2026-10-29' });
  const unique = [row('PO-A', 10, '2026-11-05', { ticketNumber: '111' })];
  summarizeLots({ bookingRows: unique, receiptLines: [receipt], deliveryLines: [deliveryLine] });
  assert.deepEqual([unique[0].receiptDate, unique[0].fileDeliveryDate], ['2026-10-26', '2026-10-29']);
  const multiple = [row('PO-A', 10, '2026-11-05', { ticketNumber: '111' }), row('PO-B', 10, '2026-11-06', { ticketNumber: '222', season: 'AW28' })];
  summarizeLots({ bookingRows: multiple, receiptLines: [receipt], deliveryLines: [deliveryLine] });
  assert.deepEqual([multiple[0].receiptDate, multiple[0].fileDeliveryDate], [null, null]);
});

test('a missing receipt date prevents claiming the latest receipt date even for a uniquely matched PO', async () => {
  const { compactReceiptLines } = await import('../src/receipts-import.js');
  const bookingRows = [row('PO-A', 10, '2026-11-05', { ticketNumber: '111' })];
  const base = { model: '353234', color: '9046670 1P BEA', season: 'SS27', po: '111' };
  const receipts = [{ ...base, received: 5, date: '2026-10-26' }, { ...base, received: 5, date: null }];
  summarizeLots({ bookingRows, receiptLines: receipts });
  assert.equal(bookingRows[0].receiptDate, null);
  assert.equal(bookingRows[0].receiptDateBasis, null);
  const compact = compactReceiptLines(receipts);
  assert.equal(compact[0].undatedReceived, true);
  summarizeLots({ bookingRows, receiptLines: compact });
  assert.equal(bookingRows[0].receiptDate, null);
  assert.equal(bookingRows[0].receiptDateBasis, null);
});

test('dated receipts without a ticket follow the same product FIFO as allocated quantities', async () => {
  const { compactReceiptLines } = await import('../src/receipts-import.js');
  const makeRows = () => [row('PO-A', 40, '2026-11-05', { ticketNumber: '0' }), row('PO-B', 60, '2026-11-06', { ticketNumber: '0' })];
  const receipts = [
    { model: '353234', color: '9046670 1P BEA', season: 'SS27', po: '', received: 50, date: '2026-10-26' },
    { model: '353234', color: '9046670 1P BEA', season: 'SS27', po: '', received: 50, date: '2026-10-28' }
  ];
  for (const lines of [receipts, compactReceiptLines(receipts)]) {
    const rows = makeRows();
    summarizeLots({ bookingRows: rows, receiptLines: lines });
    assert.deepEqual(rows.map(r => [r.receivedFifo, r.receiptDate, r.receiptDateBasis]), [[40, '2026-10-26', 'FIFO theo mã/mùa'], [60, '2026-10-28', 'FIFO theo mã/mùa']]);
  }
  const rows = makeRows();
  summarizeLots({ bookingRows: rows, receiptLines: [receipts[0], { ...receipts[1], date: null }] });
  assert.deepEqual(rows.map(r => r.receiptDate), [null, null]);
});
