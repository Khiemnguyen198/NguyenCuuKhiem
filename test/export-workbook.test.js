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
  assert.deepEqual(deliveryPlan[0].slice(0, 11), ['MÃ HÀNG', 'MÀU', 'PO', 'SS', 'SLHĐ', 'SLHĐ TỔNG', 'SL BTP NHẬN', 'LEADTIME', 'NGÀY NHẬN BTP (BOOKING)', 'NGÀY GIAO BTP (BOOKING)', 'NGÀY NHẬN BTP THỰC TẾ']);
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
  const receiptLines = [{ model:'R', color:'1234567 BLUE', season:'SS27', po:'P', received:10, date:'2026-10-26' }];
  const { items } = summarizeLots({ bookingRows:rows, receiptLines });
  const book = buildExportWorkbook({ booking:{ rows, days:[] }, lots:items });
  const sheet = XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellNF:true}).Sheets.TH;
  const header = XLSX.utils.sheet_to_json(sheet,{header:1,range:4,defval:null})[0];
  const column = header.indexOf('Ngày nhận BTP thực tế');
  const basis = header.indexOf('Nguồn ngày nhận BTP');
  assert.ok(column > 0 && basis > 0);
  const cell = sheet[XLSX.utils.encode_cell({r:5,c:column})];
  assert.equal(cell.v, 46321);
  assert.equal(sheet[XLSX.utils.encode_cell({r:5,c:basis})].v, 'khớp trực tiếp');
  assert.equal(sheet.I6.v, 46315, 'Booking INPUT remains intact');
});

test('formatted download preserves data, cached formulas, filters and styles', async () => {
  const { serializeWorkbook } = await import('../src/excel-presentation.js');
  const ExcelJS = (await import('exceljs/dist/exceljs.min.js')).default;
  const rows = [{ line: '1', customer: 'Khách Việt', ref: 'R1', color: '1234567 BLUE', modelCode: '1234567', season: 'SS27', po: 'PO1', lineQuantity: 10, inputDate: '2026-10-29', outputDate: '2026-10-30', leadTime: '1 ngày', allocations: { 0: 10 } }];
  const booking = { rows, days: [{ date: '2026-10-29', returnDate: '2026-10-30' }, { date: '2026-10-30', returnDate: '2026-10-31' }] };
  const { items } = summarizeLots({ bookingRows: rows });
  const input = buildExportWorkbook({ booking, lots: items });
  input.Sheets.TH.R2.c = [{ a: 'Kế hoạch', t: 'Kiểm tra ngày' }];
  const bytes = await serializeWorkbook(input);
  const result = XLSX.read(bytes, { type: 'buffer', cellNF: true });
  assert.deepEqual(result.SheetNames, input.SheetNames);
  assert.equal(result.Sheets['KE HOACH GIAO HANG'].I2.v, 46324);
  assert.equal(result.Sheets['KE HOACH GIAO HANG'].J2.v, 46325);
  assert.equal(result.Sheets['KE HOACH GIAO HANG'].J2.z, 'dd/mm/yyyy');
  assert.equal(result.Sheets['CAN DOI'].H5.f, 'SUM(N5:O5)');
  assert.equal(result.Sheets['CAN DOI'].H5.v, 10);
  assert.equal(result.Sheets.TH.R2.c[0].t, 'Kiểm tra ngày');
  assert.equal(result.Sheets.TH['!autofilter'].ref, input.Sheets.TH['!autofilter'].ref);
  assert.deepEqual(result.Sheets.TH['!merges'], input.Sheets.TH['!merges']);
  const styled = new ExcelJS.Workbook();
  await styled.xlsx.load(bytes);
  const plan = styled.getWorksheet('KE HOACH GIAO HANG');
  assert.equal(plan.getCell('I1').fill.fgColor.argb, 'FF245A86');
  assert.equal(plan.getCell('K1').fill.fgColor.argb, 'FF217163');
  assert.equal(plan.views[0].ySplit, 1);
  assert.equal(plan.getColumn(9).width, 20);
});


test('Excel ignores number-as-text indicators without altering identifiers', async () => {
  const { serializeWorkbook } = await import('../src/excel-presentation.js');
  const JSZip = (await import('jszip')).default;
  const source = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(source, XLSX.utils.aoa_to_sheet([['PO', 'Mã'], ['001234', '12345678901234567']]), 'Dữ liệu');
  const bytes = await serializeWorkbook(source);
  const sheet = XLSX.read(bytes, { type: 'buffer' }).Sheets['Dữ liệu'];
  assert.equal(sheet.A2.v, '001234');
  assert.equal(sheet.B2.v, '12345678901234567');
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(xml, /<ignoredError numberStoredAsText="1" sqref="A1:B2"\/>/);
});

test('old receipt of another PO does not produce actual or expected dates in the export', () => {
  const rows = [{ line:'1', ref:'367450', color:'8975582 WHITE', modelCode:'8975582', season:'SS26', po:'4525013028', ticketNumber:'0', lineQuantity:100, inputDate:'2026-10-23', outputDate:'2026-11-07', printCount:1, leadTime:'1 ngày', allocations:{} }];
  const receiptLines = [{ model:'367450', color:'8975582', season:'SS26', po:'4524643183', received:100, date:'2026-07-04' }];
  const { items } = summarizeLots({ bookingRows:rows, receiptLines });
  const book = buildExportWorkbook({ booking:{ rows, days:[] }, lots:items });
  assert.equal(book.Sheets['KE HOACH GIAO HANG'].K2, undefined);
  assert.equal(book.Sheets['KE HOACH GIAO HANG'].M2, undefined);
  assert.equal(book.Sheets['CAN DOI'].I5, undefined);
  assert.match(book.Sheets['KE HOACH GIAO HANG'].N2.v, /Chưa xác định ngày nhận BTP/);
});
