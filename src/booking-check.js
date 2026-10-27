import * as XLSX from 'xlsx';
import { findHeaderRow, label, readDayColumns, toIsoDate } from './booking-import.js';

// Cell-level check of the booking's TH sheet: every problem points at a sheet cell with the
// value found there and, where it can be computed, the value that should be there.
export const ISSUE_TYPES = {
  contract_missing: { title: 'SLHĐ TỔNG trống', severity: 'warning' },
  contract_wrong: { title: 'SLHĐ TỔNG sai', severity: 'danger' },
  daily_total_wrong: { title: 'TỔNG NGÀY sai', severity: 'warning' },
  return_before_pickup: { title: 'PXI TRẢ sớm hơn PXC', severity: 'warning' },
  output_before_input: { title: 'OUTPUT sớm hơn INPUT', severity: 'danger' },
  output_sunday: { title: 'OUTPUT rơi vào Chủ Nhật', severity: 'warning' },
  missing_po: { title: 'Thiếu PO', severity: 'danger' },
  bad_quantity: { title: 'LINE QTY không hợp lệ', severity: 'danger' },
  bad_print_count: { title: 'HÌNH IN không hợp lệ', severity: 'warning' },
  bad_lead_time: { title: 'Leadtime không chuẩn', severity: 'warning' },
  duplicate_row: { title: 'Dòng trùng', severity: 'warning' }
};

const MAX_ISSUES = 3000;
const LEAD_TIMES = new Set(['1 NGÀY', '2 NGÀY', '3 NGÀY', '5 NGÀY']);
const text = (value) => String(value ?? '').trim();
const viDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const isSunday = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) && new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;
const round = (value) => Math.round(value * 100) / 100;

export function checkBookingSheet(workbook, sheetName = 'TH') {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { sheet: sheetName, checked: false, issues: [] };
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true });
  const headerIndex = findHeaderRow(table, 4);
  const headers = (table[headerIndex] || []).map(label);
  const at = (name) => headers.indexOf(name);
  const columns = {
    line: at('LINE'), ref: at('REF'), color: at('COLOR'), po: at('PO'), quantity: at('LINE QTY'),
    input: at('INPUT'), output: at('OUTPUT'), ticket: at('SỐ PHIẾU'), contract: at('SLHĐ TỔNG'),
    printCount: at('HÌNH IN'), leadTime: at('LEADTIME')
  };
  const cellName = (row, column) => `${XLSX.utils.encode_col(column)}${row + 1}`;
  const issues = [];
  const add = (type, row, column, fields) => {
    if (issues.length < MAX_ISSUES) issues.push({ type, sheet: sheetName, cell: column >= 0 ? cellName(row, column) : `dòng ${row + 1}`, row: row + 1, ...fields });
  };

  // Data rows, as the booking formula sees them.
  const rows = [];
  table.slice(headerIndex + 1).forEach((cells, offset) => {
    const value = (column) => (column >= 0 ? cells[column] : null);
    if (value(columns.line) == null || value(columns.line) === '' || label(value(columns.line)) === 'LINE') return;
    rows.push({
      index: headerIndex + 1 + offset,
      cells,
      line: text(value(columns.line)), ref: text(value(columns.ref)), color: text(value(columns.color)), po: text(value(columns.po)),
      quantity: value(columns.quantity), input: toIsoDate(value(columns.input)), output: toIsoDate(value(columns.output)),
      ticket: text(value(columns.ticket)), contract: value(columns.contract), printCount: value(columns.printCount),
      leadTime: text(value(columns.leadTime))
    });
  });
  const where = (row) => ({ po: row.po, ref: row.ref, color: row.color, line: row.line });

  // SLHĐ TỔNG = Σ LINE QTY of the same SỐ PHIẾU, or of the same LINE + REF + COLOR + INPUT
  // while the ticket is 0 — the formula in column M of the booking.
  const lotOf = (row) => (row.ticket && row.ticket !== '0' ? `T:${row.ticket}` : `L:${row.line}|${row.ref}|${row.color}|${row.input}`);
  const lotTotals = new Map();
  for (const row of rows) lotTotals.set(lotOf(row), (lotTotals.get(lotOf(row)) || 0) + (Number(row.quantity) || 0));

  const seen = new Set();
  for (const row of rows) {
    const quantity = Number(row.quantity);
    const printCount = Number(row.printCount);
    if (!row.po) add('missing_po', row.index, columns.po, { ...where(row), value: '' });
    if (!Number.isFinite(quantity) || quantity <= 0) add('bad_quantity', row.index, columns.quantity, { ...where(row), value: text(row.quantity) });
    if (columns.printCount >= 0 && (!Number.isFinite(printCount) || printCount <= 0)) add('bad_print_count', row.index, columns.printCount, { ...where(row), value: text(row.printCount) });
    if (columns.leadTime >= 0 && !LEAD_TIMES.has(row.leadTime.toUpperCase())) add('bad_lead_time', row.index, columns.leadTime, { ...where(row), value: row.leadTime, expected: '1 / 2 / 3 / 5 ngày' });
    if (row.input && row.output && row.output < row.input) add('output_before_input', row.index, columns.output, { ...where(row), value: viDate(row.output), expected: `sau INPUT ${viDate(row.input)}` });
    if (isSunday(row.output)) add('output_sunday', row.index, columns.output, { ...where(row), value: `${viDate(row.output)} (Chủ Nhật)`, expected: 'Thứ Hai – Thứ Bảy' });
    if (columns.contract >= 0) {
      const expected = round(lotTotals.get(lotOf(row)));
      const contract = Number(row.contract);
      if (!(contract > 0)) add('contract_missing', row.index, columns.contract, { ...where(row), value: text(row.contract) || 'trống', expected });
      else if (Math.abs(contract - expected) > 0.5) {
        const basis = row.ticket && row.ticket !== '0' ? `tổng LINE QTY của phiếu ${row.ticket}` : 'tổng LINE QTY cùng LINE + REF + COLOR + INPUT';
        const typed = !sheet[cellName(row.index, columns.contract)]?.f;
        add('contract_wrong', row.index, columns.contract, { ...where(row), value: contract, expected, note: typed ? `${basis} · ô gõ tay, không có công thức` : basis });
      }
    }
    const duplicateKey = [row.line, row.po, row.ref, row.color, row.quantity, row.input, row.output, row.ticket, row.printCount].map((item) => text(item).toUpperCase()).join('|');
    if (seen.has(duplicateKey)) add('duplicate_row', row.index, -1, { ...where(row), value: `LINE QTY ${text(row.quantity)}`, note: 'giống hệt một dòng phía trên' });
    else seen.add(duplicateKey);
  }

  // Daily plan header: TỔNG NGÀY must equal Σ HÌNH IN × allocation; PXI TRẢ follows PXC.
  for (const day of readDayColumns(table)) {
    if (day.totalRow != null && day.fileTotal != null) {
      const load = rows.reduce((sum, row) => {
        const allocation = row.cells[day.column];
        return typeof allocation === 'number' ? sum + allocation * (Number(row.printCount) || 0) : sum;
      }, 0);
      if (Math.abs(load - day.fileTotal) > 1) {
        const formula = sheet[cellName(day.totalRow, day.column)]?.f;
        add('daily_total_wrong', day.totalRow, day.column, {
          date: day.date, value: Math.round(day.fileTotal), expected: Math.round(load),
          note: `PXC ${viDate(day.date)}${formula ? ` · công thức =${formula}` : ''}`
        });
      }
    }
    if (day.returnRow != null && day.returnDate && day.returnDate < day.date) {
      add('return_before_pickup', day.returnRow, day.column, { date: day.date, value: viDate(day.returnDate), expected: `sau PXC ${viDate(day.date)}`, note: 'có thể gõ nhầm năm' });
    }
  }

  const counts = issues.reduce((map, issue) => ({ ...map, [issue.type]: (map[issue.type] || 0) + 1 }), {});
  return { sheet: sheetName, checked: true, issues, counts, truncated: issues.length >= MAX_ISSUES };
}
