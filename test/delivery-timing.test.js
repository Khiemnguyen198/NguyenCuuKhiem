import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { expectedDeliveryDate, leadTimeDays, deliveryTiming } from '../src/delivery-timing.js';
import { renderDeliveryPlanTable } from '../src/plan-results.js';
import { buildExportWorkbook } from '../src/export-workbook.js';

test('adds one working day for every leadtime, excluding Sundays', () => {
  const expected = { 1: '2026-10-28', 2: '2026-10-29', 3: '2026-10-30', 4: '2026-10-31', 5: '2026-11-02', 7: '2026-11-04' };
  for (const [lead, date] of Object.entries(expected)) assert.equal(expectedDeliveryDate('2026-10-26', `${lead} ngày`), date);
  assert.equal(expectedDeliveryDate('2026-10-30', '1 NGÀY'), '2026-11-02');
  assert.equal(expectedDeliveryDate('2026-10-31', '1 ngày'), '2026-11-03');
  assert.equal(expectedDeliveryDate('2026-11-01', '1 ngày'), '2026-11-03');
  assert.equal(expectedDeliveryDate('2026-12-31', '1 ngày'), '2027-01-02');
  assert.equal(expectedDeliveryDate('2026-12-31', '5 ngày'), '2027-01-07');
});

test('rejects absent/invalid input without generating a fake date', () => {
  for (const value of [null, '', '0 ngày', '-1 ngày', '1.5 ngày', 'x', '9007199254740992']) assert.equal(leadTimeDays(value), null);
  for (const date of [null, '', '2026-02-30', '29/10/2026', '2026-1-02']) assert.equal(expectedDeliveryDate(date, '1 ngày'), null);
  assert.equal(expectedDeliveryDate('9999-12-31', '1 ngày'), null);
  assert.equal(expectedDeliveryDate('2026-10-26', '9007199254740990 ngày'), null);
  assert.equal(leadTimeDays(' 4 NGÀY '), 4);
});

test('distinguishes forecast, actual file date, contract and independent warnings', () => {
  const row = { receiptDate: '2026-10-26', leadTime: '1 ngày', fileDeliveryDate: '2026-10-30', outputDate: '2026-10-29' };
  const result = deliveryTiming(row);
  assert.deepEqual([result.receiptDate, result.expectedDate, result.fileDate, result.contractDate], ['2026-10-26', '2026-10-28', '2026-10-30', '2026-10-29']);
  assert.equal(result.mismatched, true);
  assert.equal(result.expectedLate, false);
  assert.equal(result.fileLate, true);
  assert.deepEqual(result.warnings, ['Ngày file giao khác ngày dự kiến', 'Ngày file giao trễ hạn hợp đồng']);
  const noReceipt = deliveryTiming({ inputDate: '2026-10-26', outputDate: '2026-10-27', leadTime: '1 ngày', fileDeliveryDate: '2026-10-28' }, { lastReceiptDate: '2026-10-26', actualDeliveryDate: '2026-10-29' });
  assert.equal(noReceipt.receiptDate, null);
  assert.equal(noReceipt.expectedDate, null);
  assert.equal(noReceipt.fileDate, '2026-10-28');
  assert.ok(noReceipt.warnings.includes('Chưa xác định ngày nhận BTP'));
  assert.equal(deliveryTiming({ receiptDate: '2026-10-26', leadTime: '1 ngày' }).fileDate, null);
  const fifo = deliveryTiming({ receiptDate: '2026-10-26', leadTime: '1 ngày', receiptDateBasis: 'FIFO theo phiếu' });
  assert.ok(fifo.warnings.includes('Ngày nhận phân bổ FIFO theo phiếu'));
  const missingLead = deliveryTiming({ receiptDate: '2026-10-26' }, { leadTime: '1 ngày', dueDate: '2026-10-28' });
  assert.equal(missingLead.expectedDate, null);
  assert.equal(missingLead.contractDate, null);
  assert.ok(missingLead.warnings.includes('Leadtime không hợp lệ'));
});

test('screen and serialized delivery workbook show the same separate dates and warnings', () => {
  const row = { line: '1', ref: 'R', color: '1234567 RED', modelCode: '1234567', po: 'P', season: 'SS27', lotKey: 'lot', lineQuantity: 10, printCount: 1, inputDate: '2026-10-24', receiptDate: '2026-10-26', outputDate: '2026-10-29', fileDeliveryDate: '2026-10-30', leadTime: '1 ngày', receivedFifo: 10, allocations: {} };
  const lot = { key: 'lot', status: 'waiting', contract: 10, model: 'R', color: row.color, dueDate: row.outputDate, leadTime: row.leadTime, received: 10, rows: [row] };
  const html = renderDeliveryPlanTable([lot]);
  assert.match(html, /Ngày nhận BTP/);
  assert.match(html, /Ngày giao BTP thực tế/);
  assert.match(html, /Ngày giao dự kiến/);
  assert.match(html, /26\/10\/2026/);
  assert.match(html, /30\/10\/2026/);
  assert.match(html, /28\/10\/2026/);
  assert.match(html, /Ngày file giao khác ngày dự kiến/);
  const book = buildExportWorkbook({ booking: { rows: [row], days: [] }, lots: [lot] });
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const sheet = XLSX.read(bytes, { type: 'buffer', cellDates: false }).Sheets['KE HOACH GIAO HANG'];
  assert.deepEqual(['I1','J1','K1','L1','M1','N1'].map((key) => sheet[key].v), ['NGÀY NHẬN BTP (BOOKING)','NGÀY GIAO BTP (BOOKING)','NGÀY NHẬN BTP THỰC TẾ','NGÀY GIAO BTP THỰC TẾ','NGÀY GIAO DỰ KIẾN','CẢNH BÁO']);
  const excelSerial = (iso) => (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899,11,30)) / 86400000;
  assert.deepEqual(['I2','J2','K2','L2','M2'].map((key) => sheet[key].v), ['2026-10-24','2026-10-29','2026-10-26','2026-10-30','2026-10-28'].map(excelSerial));
  assert.match(sheet.N2.v, /Ngày file giao khác ngày dự kiến/);
  assert.match(sheet.N2.v, /Ngày file giao trễ hạn hợp đồng/);
});

test('warns if a matched receipt precedes the booking INPUT date', () => {
  const result = deliveryTiming({receiptDate:'2026-06-19',inputDate:'2026-10-20',leadTime:'1 ngày',receiptDateBasis:'FIFO theo mã/mùa'});
  assert.ok(result.warnings.some(message => message.includes('trước INPUT')));
});

test('weekly export keeps the original booking INPUT and OUTPUT beside actual dates', async () => {
  const {batchRow} = await import('../src/batches.js');
  const row = {line:'1',ref:'R',po:'P',inputDate:'2026-10-20',outputDate:'2026-11-09',receiptDate:'2026-10-30',fileDeliveryDate:'2026-11-04',lineQuantity:10,printCount:1,leadTime:'1 ngày',allocations:{0:10},dayFifo:{0:{received:10,delivered:10,good:10}}};
  const batch = batchRow(row,[{date:'2026-10-26',returnDate:'2026-10-27'}],{dayIndexes:[0]});
  assert.equal(batch.outputDate,'2026-10-27');
  const workbook=buildExportWorkbook({booking:{rows:[batch],days:[]},lots:[]});
  const sheet=workbook.Sheets['KE HOACH GIAO HANG'];
  const serial = date => (Date.parse(date+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000;
  assert.deepEqual(['I2','J2','K2','L2'].map(key=>sheet[key].v),['2026-10-20','2026-11-09','2026-10-30','2026-11-04'].map(serial));
  assert.equal(workbook.Sheets.TH.J6.v,serial('2026-11-09'));
});
