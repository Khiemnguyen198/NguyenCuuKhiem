import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { buildExportWorkbook } from '../src/export-workbook.js';
import { summarizeLots } from '../src/lots.js';

test('exports the booking in the customer TH layout', () => {
  const days = [
    { date: '2026-10-26', returnDate: '2026-10-27' },
    { date: '2026-10-27', returnDate: '2026-10-28' },
    { date: '2026-11-01', returnDate: '2026-11-02' }
  ];
  const rows = [
    { line: '77', customer: 'DECATHLON', ref: '353234', color: 'BLEU', po: 'PO1', lineQuantity: 300, inputDate: '2026-10-26', outputDate: '2026-11-05', printCount: 2, leadTime: '1 ngày', allocations: { 0: 100, 1: 'X' } },
    { line: '111', customer: 'Decathlon WTI', ref: '125621', color: 'NOIR', po: 'PO2', lineQuantity: 50, printCount: 1, leadTime: '2 ngày', allocations: { 2: 50 } }
  ];
  const booking = { filename: 'b.xlsx', rows, days };
  const { items } = summarizeLots({ bookingRows: rows });
  const workbook = buildExportWorkbook({ booking, lots: items });
  assert.deepEqual(workbook.SheetNames, ['KE HOACH GIAO HANG', 'TH', 'CAN DOI']);
  const deliveryPlan = XLSX.utils.sheet_to_json(workbook.Sheets['KE HOACH GIAO HANG'], { header: 1, defval: null, raw: true });
  assert.deepEqual(deliveryPlan[0].slice(0, 11), ['MÃ HÀNG', 'MÀU', 'PO', 'SS', 'SLHĐ', 'SLHĐ TỔNG', 'SL BTP NHẬN', 'LEADTIME', 'NGÀY NHẬN', 'NGÀY GIAO HỢP ĐỒNG', 'NGÀY GIAO THỰC TẾ']);
  // SheetJS 0.20 converts date-formatted numbers to Date in sheet_to_json,
  // even with raw:true. Assert the serialized Excel cell contract directly.
  const contractDate = workbook.Sheets['KE HOACH GIAO HANG'].J2;
  assert.deepEqual({ t: contractDate.t, v: contractDate.v, z: contractDate.z },
    { t: 'n', v: 46331, z: 'dd/mm/yyyy' });
  assert.equal(deliveryPlan[1][10], null);
  const table = XLSX.utils.sheet_to_json(workbook.Sheets.TH, { header: 1, defval: null, raw: true, blankrows: true });

  assert.deepEqual(table[0].slice(0, 2), ['LINE', 'CUS']);
  assert.deepEqual(table[4].slice(0, 2), ['LINE', 'CUS']);
  assert.deepEqual(table.slice(0, 4).map((row) => row[16]), [' PXC CHUYỂN ', ' PXI TRẢ ', ' TỔNG TUẦN ', ' TỔNG NGÀY ']);
  assert.deepEqual(table[3].slice(17, 20), [200, 0, 50]);
  assert.equal(table[2][17], 200);
  assert.deepEqual(table[5].slice(17, 19), [100, 'X']);
  assert.ok(table[6].every((cell) => cell == null), 'empty row between lead-time groups');
  assert.equal(table[7][0], '111');
  assert.deepEqual(workbook.Sheets.TH['!merges'].map((merge) => XLSX.utils.encode_range(merge)), ['R3:S3']);
});

test('fills the progress columns from the FIFO allocation', () => {
  const rows = [{ line: '1', ref: 'R', color: '1234567 X', modelCode: '1234567', season: 'SS27', po: 'P', lineQuantity: 100, outputDate: '2026-11-01', ticketNumber: '0', leadTime: '1 ngày', allocations: {} }];
  const deliveryLines = [{ po: 'x', ticket: '', model: 'R', color: '1234567 X', season: 'SS27', print: '', customer: 'C', contractQuantity: 0, contractTotal: 0, received: 80, delivered: 60, good: 55, printDefects: 5, fabricDefects: 0, samples: 0, fabricShort: 0 }];
  const { items } = summarizeLots({ bookingRows: rows, deliveryLines });
  const table = XLSX.utils.sheet_to_json(buildExportWorkbook({ booking: { rows, days: [] }, lots: items }).Sheets.TH, { header: 1, defval: null, raw: true, blankrows: true });
  const header = table[0];
  const value = (title) => table[5][header.indexOf(title)];
  assert.deepEqual([value('Model'), value('Màu'), value('Nhận BTP'), value('Đã in (giao)'), value('Còn thiếu'), value('SLHĐ tổng (lô)'), value('Nối bằng')], ['1234567', 'X', 80, 60, 45, 100, 'FIFO']);
});

test('builds the delivery slip workbook with totals and signatures', async () => {
  const { buildSlipWorkbook, slipFilename } = await import('../src/export-workbook.js');
  const items = [
    { customer: 'DECATHLON', model: '353234', modelCode: '9046670', color: '9046670 BLEU', season: 'SS27', ticket: '73001', contract: 100, bookedQuantity: 100, received: 100, delivered: 80, good: 75, defects: 5, remaining: 25, dueDate: '2026-11-05', status: 'printing', pinned: true }
  ];
  const workbook = buildSlipWorkbook({ items, batch: { label: 'Tuần 26/10 – 01/11' } });
  assert.deepEqual(workbook.SheetNames, ['PHIEU_GIAO_NHAN_BTP']);
  const table = XLSX.utils.sheet_to_json(workbook.Sheets.PHIEU_GIAO_NHAN_BTP, { header: 1 });
  assert.equal(table[0][0], 'CÔNG TY TNHH INKAVA');
  assert.equal(table[1][0], 'PHIẾU GIAO NHẬN VÀ ĐỐI CHIẾU BÁN THÀNH PHẨM (BTP)');
  assert.equal(slipFilename(new Date(2026, 9, 28)).startsWith('PHIEU_GIAO_NHAN_BTP_20261028'), true);
});


test('serialized exports preserve numeric calendar dates, row offsets and formulas', () => {
  const rows = [{ line: '1', customer: 'Khách Việt', ref: 'R1', color: '1234567 BLUE',
    modelCode: '1234567', season: 'SS27', po: 'PO1', lineQuantity: 10,
    inputDate: '2026-10-29', outputDate: '2026-10-30', printCount: 2, leadTime: '1 ngày',
    allocations: { 0: 10 } }];
  const booking = { rows, days: [{ date: '2026-10-29', returnDate: '2026-10-30' }] };
  const { items } = summarizeLots({ bookingRows: rows });
  const book = buildExportWorkbook({ booking, lots: items });
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const serialized = XLSX.read(bytes, { type: 'buffer', cellDates: false, cellNF: true });
  const date = serialized.Sheets['KE HOACH GIAO HANG'].J2;
  assert.deepEqual({ t: date.t, v: date.v, z: date.z }, { t: 'n', v: 46325, z: 'dd/mm/yyyy' });
  assert.equal(serialized.Sheets.TH.I6.v, 46324);
  assert.equal(serialized.Sheets.TH.J6.v, 46325);
  assert.equal(serialized.Sheets['CAN DOI']['!ref'].split(':')[0], 'A3');
  assert.equal(serialized.Sheets['CAN DOI'].H5.f, 'SUM(N5:N5)');
  assert.equal(serialized.Sheets['CAN DOI'].H5.v, 10);
  assert.equal(serialized.Sheets['KE HOACH GIAO HANG'].A2.v, 'R1');
});

test('contract TH export includes the matched BTP receipt date and its provenance', () => {
  const rows = [{ line:'1', ref:'R', color:'1234567 BLUE', modelCode:'1234567', season:'SS27', po:'P', lineQuantity:10, inputDate:'2026-10-20', outputDate:'2026-10-30', printCount:1, leadTime:'1 ngày', allocations:{} }];
  const receiptLines = [{ model:'R', color:'1234567 BLUE', season:'SS27', po:'', received:10, date:'2026-10-26' }];
  const { items } = summarizeLots({ bookingRows:rows, receiptLines });
  const book = buildExportWorkbook({ booking:{ rows, days:[] }, lots:items });
  const sheet = XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellNF:true}).Sheets.TH;
  const header = XLSX.utils.sheet_to_json(sheet,{header:1,range:4,defval:null})[0];
  const column = header.indexOf('Ngày nhận BTP');
  const basis = header.indexOf('Nguồn ngày nhận BTP');
  assert.ok(column > 0 && basis > 0);
  const cell = sheet[XLSX.utils.encode_cell({r:5,c:column})];
  assert.equal(cell.v, 46321);
  assert.equal(sheet[XLSX.utils.encode_cell({r:5,c:basis})].v, 'FIFO theo mã/mùa');
  assert.equal(sheet.I6.v, 46315, 'Booking INPUT remains intact');
});
