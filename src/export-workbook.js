import * as XLSX from 'xlsx';
import { STATUS_COPY, colorName } from './models-view.js';
import { dailyLoad } from './booking-import.js';
import { ISSUE_TYPES } from './booking-check.js';

const pad = (value) => String(value).padStart(2, '0');

// Most urgent first: overdue, then nearest due date, then largest remaining quantity.
export function sortByUrgency(items) {
  return [...items].sort((a, b) => (b.overdue - a.overdue)
    || ((a.daysToDue ?? Infinity) - (b.daysToDue ?? Infinity))
    || (b.remaining - a.remaining));
}

export function exportFilename(now = new Date(), batch = null) {
  const week = batch ? `_TUAN_${batch.from.slice(8, 10)}${batch.from.slice(5, 7)}-${batch.to.slice(8, 10)}${batch.to.slice(5, 7)}` : '';
  return `TONG_HOP_GIAO_HANG${week}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const serial = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? (Date.parse(`${iso}T00:00:00Z`) - EXCEL_EPOCH) / 86_400_000 : null);
const dateCell = (iso, format) => {
  const value = serial(iso);
  return value == null ? null : { t: 'n', v: value, z: format };
};
const numberCell = (value, format = '#,##0') => (typeof value === 'number' && Number.isFinite(value) ? { t: 'n', v: value, z: format } : value ?? null);

// Columns A–P of the customer's TH sheet, in the same order and spelling.
const TH_COLUMNS = [
  ['LINE', (row) => row.line, 6], ['CUS', (row) => row.customer, 13], ['BRAND', (row) => row.brand, 14],
  ['REF', (row) => row.ref, 9], ['COLOR', (row) => row.color, 30], ['PO', (row) => row.po, 13], ['SS', (row) => row.season, 6],
  ['LINE QTY', (row) => numberCell(row.bookedLineQuantity ?? row.lineQuantity), 9],
  [' INPUT ', (row) => dateCell(row.inputDate, 'd-mmm'), 8], [' OUTPUT ', (row) => dateCell(row.outputDate, 'd-mmm'), 8],
  [' MODEL CODE ', (row) => row.modelCode, 10], [' SỐ PHIẾU ', (row) => row.ticketNumber, 9],
  [' SLHĐ TỔNG ', (row) => numberCell(row.contractQuantity ?? 0), 10], ['KẾ HOẠCH', (row) => row.planner, 9],
  ['HÌNH IN', (row) => numberCell(row.printCount, '0'), 7], ['Leadtime', (row) => row.leadTime, 8]
];
// Appended after the daily plan so columns A onward stay exactly as in TH. Row figures come
// from the FIFO allocation of each lot down to its PO rows; lot figures repeat on each row.
const PROGRESS_COLUMNS = [
  // COLOR in TH mixes the model code and the color name; split for Excel filters.
  ['Model', (row) => row.modelCode, 9],
  ['Màu', (row) => colorName(row.color), 26],
  ['SL trong tuần', (row) => numberCell(row.lineQuantity), 10, true],
  ['Nhận BTP', (row) => numberCell(row.receivedFifo ?? 0), 10],
  ['Đã in (giao)', (row) => numberCell(row.deliveredFifo ?? 0), 10],
  ['Còn thiếu', (row) => numberCell(row.remainingFifo ?? (row.bookedLineQuantity ?? row.lineQuantity)), 10],
  ['SLHĐ tổng (lô)', (row, lot) => numberCell(lot?.contract ?? ''), 11],
  ['Lỗi (lô)', (row, lot) => numberCell(lot?.defects ?? 0), 8],
  ['Trạng thái lô', (row, lot) => (lot ? STATUS_COPY[lot.status].label : 'Chưa nhận BTP'), 13],
  ['Hạn còn (ngày)', (row, lot) => lot?.daysToDue ?? '', 9],
  ['Nối bằng', (row, lot) => lot?.matchedBy ?? '', 11]
];

// Which TH column a row-level problem lives in (by header), for the exported cell address.
const ISSUE_COLUMN = {
  contract_missing: ' SLHĐ TỔNG ', contract_wrong: ' SLHĐ TỔNG ', output_before_input: ' OUTPUT ', output_sunday: ' OUTPUT ',
  missing_po: 'PO', bad_quantity: 'LINE QTY', bad_print_count: 'HÌNH IN', bad_lead_time: 'Leadtime'
};
const rowKey = (row) => [row.line, row.po, row.ref, row.color].map((value) => String(value ?? '').trim()).join('|');
const addYear = (iso) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
const daysBetween = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
const cellAddress = (row, column) => XLSX.utils.encode_cell({ r: row, c: column });

const isSunday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;

// The customer's TH layout: header on row 1 and again on row 5, PXI TRẢ / TỔNG TUẦN /
// TỔNG NGÀY on rows 2–4 under the PXC CHUYỂN label, data from row 6. TỔNG TUẦN is the
// Monday–Saturday sum, merged across those days.
// Builds TH and, alongside, the list of problems in its scope: fixable ones are corrected in
// the sheet (with a cell comment holding the old value), the rest are flagged for review.
function thSheet({ booking, lots, sheetCheck }) {
  const { rows = [], days = [] } = booking;
  const issues = sheetCheck?.cells?.issues || [];
  const rowIssues = new Map();
  for (const issue of issues.filter((item) => !item.date)) {
    const key = rowKey(issue);
    const bySheetRow = rowIssues.get(key) || new Map();
    bySheetRow.set(issue.row, [...(bySheetRow.get(issue.row) || []), issue]);
    rowIssues.set(key, bySheetRow);
  }
  const dayIssues = new Map(days.map((day) => [day.date, issues.filter((issue) => issue.date === day.date)]));
  const records = [];
  const comments = [];
  const record = (issue, exportCell, exportValue, fixed, note = issue.note) => records.push({
    title: ISSUE_TYPES[issue.type]?.title || issue.type, bookingCell: issue.cell, exportCell, po: issue.po, ref: issue.ref, color: issue.color,
    before: issue.value, after: exportValue, fixed, note
  });
  const lotsByKey = new Map(lots.map((lot) => [lot.key, lot]));
  const progress = PROGRESS_COLUMNS.filter((column) => booking.batch || !column[3]);
  const labelColumn = TH_COLUMNS.length;
  const firstDay = labelColumn + 1;
  const progressStart = firstDay + days.length;
  const load = dailyLoad(rows, days);
  const header = [...TH_COLUMNS.map(([title]) => title), ' PXC CHUYỂN ', ...days.map((day) => dateCell(day.date, 'dd/mm')), ...progress.map(([title]) => title)];
  const table = [
    header,
    [...TH_COLUMNS.map(() => null), ' PXI TRẢ ', ...days.map((day) => dateCell(day.returnDate, 'dd/mm'))],
    [...TH_COLUMNS.map(() => null), ' TỔNG TUẦN ', ...days.map(() => null)],
    [...TH_COLUMNS.map(() => null), ' TỔNG NGÀY ', ...load.map((value) => numberCell(value))],
    header
  ];
  const merges = [];
  let week = null;
  days.forEach((day, index) => {
    const monday = new Date(`${day.date}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    if (isSunday(day.date)) return;
    if (!week || week.key !== key) {
      week = { key, start: index, end: index, total: 0 };
      merges.push(week);
    }
    week.end = index;
    week.total += load[index];
  });
  for (const span of merges) table[2][firstDay + span.start] = numberCell(span.total);
  days.forEach((day, index) => {
    const column = firstDay + index;
    for (const issue of dayIssues.get(day.date) || []) {
      if (issue.type === 'daily_total_wrong') {
        comments.push([3, column, `Đã sửa: file booking ghi ${issue.value}, tính lại Σ HÌNH IN × phân bổ = ${Math.round(load[index])}`]);
        record(issue, cellAddress(3, column), Math.round(load[index]), true);
      } else if (issue.type === 'return_before_pickup') {
        // Usually a year typed wrong (02/01/2026 for 02/01/2027): fix only when that lands just after PXC.
        const candidate = addYear(day.returnDate);
        const plausible = daysBetween(day.date, candidate) >= 0 && daysBetween(day.date, candidate) <= 14;
        if (plausible) {
          table[1][column] = dateCell(candidate, 'dd/mm');
          comments.push([1, column, `Đã sửa: file booking ghi ${issue.value} (sai năm)`]);
        }
        record(issue, cellAddress(1, column), plausible ? `${candidate.slice(8, 10)}/${candidate.slice(5, 7)}/${candidate.slice(0, 4)}` : issue.value, plausible);
      }
    }
  });
  const columnOf = Object.fromEntries(TH_COLUMNS.map(([title], index) => [title, index]));
  const usedSheetRows = new Map();
  let previousLeadTime = null;
  for (const row of rows) {
    // TH leaves one empty row between lead-time groups.
    if (previousLeadTime != null && row.leadTime !== previousLeadTime) table.push([]);
    previousLeadTime = row.leadTime;
    const lot = lotsByKey.get(row.lotKey);
    const exportRow = table.length;
    const cells = TH_COLUMNS.map(([, read]) => read(row));
    // Rows repeat (duplicates), so each export row takes the next sheet row of its key.
    const bySheetRow = rowIssues.get(rowKey(row));
    const used = usedSheetRows.get(rowKey(row)) || new Set();
    const sheetRow = bySheetRow && [...bySheetRow.keys()].find((rowNumber) => !used.has(rowNumber));
    if (sheetRow != null) {
      used.add(sheetRow);
      usedSheetRows.set(rowKey(row), used);
      for (const issue of bySheetRow.get(sheetRow)) {
        const column = columnOf[ISSUE_COLUMN[issue.type]];
        const exportCell = column == null ? `dòng ${exportRow + 1}` : cellAddress(exportRow, column);
        if (issue.type === 'contract_missing' || issue.type === 'contract_wrong') {
          cells[column] = numberCell(issue.expected);
          comments.push([exportRow, column, `Đã sửa: file booking ghi ${issue.value}`]);
          record(issue, exportCell, issue.expected, true);
        } else {
          record(issue, exportCell, issue.value, false);
        }
      }
    }
    table.push([
      ...cells,
      null,
      ...days.map((day, index) => {
        const value = row.allocations?.[index];
        return value == null ? null : numberCell(value, '#,##0');
      }),
      ...progress.map(([, read]) => read(row, lot))
    ]);
  }
  if (!rows.length) table.push(['Chưa có dữ liệu booking chi tiết. Nhập lại file booking để có sheet này.']);
  const sheet = XLSX.utils.aoa_to_sheet(table);
  sheet['!merges'] = merges
    .filter((span) => span.end > span.start)
    .map((span) => ({ s: { r: 2, c: firstDay + span.start }, e: { r: 2, c: firstDay + span.end } }));
  sheet['!cols'] = [...TH_COLUMNS.map(([, , width]) => ({ wch: width })), { wch: 12 }, ...days.map(() => ({ wch: 7 })), ...progress.map(([, , width]) => ({ wch: width }))];
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: table.length - 1, c: progressStart + progress.length - 1 } }) };
  for (const [row, column, textValue] of comments) {
    const address = cellAddress(row, column);
    sheet[address] ??= { t: 'z' };
    sheet[address].c = [{ a: 'Kế hoạch', t: textValue }];
    sheet[address].c.hidden = true;
  }
  // TH vs LEADTIME differences of the exported POs have no single cell to fix.
  const exportedPos = new Set(rows.map((row) => row.po));
  for (const item of sheetCheck?.mismatches || []) {
    if (!exportedPos.has(item.po)) continue;
    records.push({ title: 'TH lệch sheet LEADTIME', bookingCell: item.row, exportCell: '', po: item.po, ref: item.ref, color: '', before: item.quantity, after: item.quantity, fixed: false, note: item.note });
  }
  return { sheet, records };
}

// ĐỐI CHIẾU: every problem in the exported scope, side by side with what the export holds.
function reconciliationSheet(records) {
  const rows = [['Lỗi', 'Ô file booking (TH)', 'Ô file xuất (TH)', 'PO', 'Mã hàng', 'Màu', 'Giá trị file booking', 'Giá trị file xuất', 'Kết quả', 'Ghi chú']];
  const ordered = [...records].sort((a, b) => Number(b.fixed) - Number(a.fixed));
  for (const item of ordered) {
    rows.push([item.title, item.bookingCell, item.exportCell, item.po || '', item.ref || '', item.color || '', item.before ?? '', item.after ?? '', item.fixed ? 'Đã sửa' : 'Cần kiểm tra', item.note || '']);
  }
  if (!records.length) rows.push(['Không có lỗi nào trong phạm vi xuất.']);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [24, 16, 14, 14, 10, 30, 18, 18, 13, 60].map((wch) => ({ wch }));
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: 9 } }) };
  return sheet;
}

// TH in the customer's layout (with fixable problems corrected), plus ĐỐI CHIẾU when the
// booking had problems in the exported scope.
export function buildExportWorkbook({ booking, lots = [], sheetCheck = null }) {
  const workbook = XLSX.utils.book_new();
  const { sheet, records } = thSheet({ booking, lots, sheetCheck });
  XLSX.utils.book_append_sheet(workbook, sheet, 'TH');
  if (records.length) XLSX.utils.book_append_sheet(workbook, reconciliationSheet(records), 'ĐỐI CHIẾU');
  return workbook;
}

export function downloadWorkbook(workbook, filename) {
  XLSX.writeFile(workbook, filename, { compression: true });
}
