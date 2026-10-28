import * as XLSX from 'xlsx';
import { productKey } from './keys.js';
import { canonicalHeader, isBookingHeader, repairBookingRows } from './booking-columns.js';

const LEAD_TIME_SHEETS = [
  ['LEADTIME 1 NGÀY', '1 ngày'],
  ['LEADTIME 2 NGÀY', '2 ngày'],
  ['LEADTIME 3 NGÀY', '3 ngày'],
  ['LEADTIME 5 NGÀY', '5 ngày']
];

const pad = (value) => String(value).padStart(2, '0');

const DAY_MS = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

// Excel dates arrive as day serials. Converting them in UTC avoids the
// timezone shift of SheetJS `cellDates`, which moves dates back one day in UTC+7.
export function toIsoDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const date = new Date(EXCEL_EPOCH + Math.round(value * DAY_MS));
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const text = String(value).trim();
  const vietnamese = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (vietnamese) return `${vietnamese[3]}-${pad(vietnamese[2])}-${pad(vietnamese[1])}`;
  const ymd = text.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[T\s].*)?$/);
  if (ymd) return `${ymd[1]}-${pad(ymd[2])}-${pad(ymd[3])}`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const label = (cell) => String(cell ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

// The header row moves between sheets (row 4 in some, row 6 in others, lower when rows are
// inserted above) and TH repeats it above the data, so use the last header-like row near the
// top. Headers are recognised however they are spelled (see booking-columns.js).
export function findHeaderRow(table, fallback) {
  const index = table.slice(0, 30).findLastIndex((cells) => isBookingHeader(cells));
  return index === -1 ? fallback : index;
}

// Header cells under the names the readers use (REF, MODEL CODE, LINE QTY…).
export const bookingHeaders = (cells = []) => cells.map(canonicalHeader);

const DAY_LABELS = { pickup: 'PXC CHUYỂN', return: 'PXI TRẢ', week: 'TỔNG TUẦN', day: 'TỔNG NGÀY' };

// Total print load per planned day, as the TỔNG NGÀY row computes it: Σ HÌNH IN × allocation.
export function dailyLoad(rows, days) {
  const totals = days.map(() => 0);
  for (const row of rows) {
    for (const [index, value] of Object.entries(row.allocations || {})) {
      if (typeof value === 'number') totals[index] += value * Number(row.printCount || 0);
    }
  }
  return totals;
}

// Daily plan columns: a label column holds PXC CHUYỂN / PXI TRẢ / TỔNG TUẦN / TỔNG NGÀY on
// separate rows (above or below the header, depending on the sheet); every column to its
// right whose PXC cell is a date is one planned day.
export function readDayColumns(table) {
  const rows = {};
  let labelColumn = -1;
  table.slice(0, 15).forEach((cells, rowIndex) => cells.forEach((cell, column) => {
    for (const [key, text] of Object.entries(DAY_LABELS)) {
      if (label(cell) === text) {
        rows[key] = rowIndex;
        labelColumn = column;
      }
    }
  }));
  if (rows.pickup == null) return [];
  const days = [];
  for (let column = labelColumn + 1; column < table[rows.pickup].length; column += 1) {
    const pickup = table[rows.pickup][column];
    if (typeof pickup !== 'number') continue;
    const fileTotal = rows.day == null ? null : table[rows.day][column];
    days.push({
      column,
      date: toIsoDate(pickup),
      returnDate: rows.return == null ? null : toIsoDate(table[rows.return][column]) || null,
      fileTotal: typeof fileTotal === 'number' ? fileTotal : null,
      // Sheet rows of the PXI TRẢ and TỔNG NGÀY labels, for pointing at a wrong cell.
      pickupRow: rows.pickup,
      returnRow: rows.return ?? null,
      totalRow: rows.day ?? null
    });
  }
  return days;
}

function readRowsFromSheet(sheet, fallbackRange, leadTimeOverride = null, sheetName = '') {
  // Array mode keeps every row aligned with the daily plan columns.
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true });
  const headerIndex = findHeaderRow(table, fallbackRange);
  const headers = bookingHeaders(table[headerIndex]);
  const days = readDayColumns(table);
  const dayColumns = new Set(days.map((day) => day.column));
  const rows = [];
  for (const [offset, cells] of table.slice(headerIndex + 1).entries()) {
    const row = {};
    headers.forEach((header, column) => {
      if (header && !(header in row)) row[header] = cells[column];
    });
    const filled = (value) => value != null && value !== '';
    if (label(row.LINE) === 'LINE' || label(row.PO) === 'PO') continue;
    // A booking line has a REF or a model next to a PO or a quantity. A missing LINE alone
    // no longer drops the row (it used to vanish from the booking without a word).
    if (!filled(row.LINE) && !(filled(row.REF) || filled(row['MODEL CODE']))) continue;
    if (![row.PO, row.REF, row['MODEL CODE'], row['LINE QTY']].some(filled)) continue;
    // Keyed by day position, not date: the sheet sometimes repeats a date in two columns.
    const allocations = {};
    days.forEach((day, index) => {
      const value = cells[day.column];
      if (value != null && value !== '' && value !== 0) allocations[index] = typeof value === 'number' ? Math.round(value * 100) / 100 : String(value).trim();
    });
    rows.push({
      line: String(row.LINE ?? ''),
      customer: String(row.CUS ?? ''),
      brand: String(row.BRAND ?? ''),
      ref: String(row.REF ?? ''),
      color: String(row.COLOR ?? ''),
      po: String(row.PO ?? ''),
      season: String(row.SS ?? ''),
      lineQuantity: Number(row['LINE QTY'] || 0),
      inputDate: toIsoDate(row.INPUT),
      outputDate: toIsoDate(row.OUTPUT),
      modelCode: String(row['MODEL CODE'] ?? ''),
      ticketNumber: String(row['SỐ PHIẾU'] ?? ''),
      contractQuantity: Number(row['SLHĐ TỔNG']) || null,
      planner: String(row['KẾ HOẠCH'] ?? ''),
      printCount: Number(row['HÌNH IN'] || 0),
      leadTime: String(row.Leadtime ?? leadTimeOverride ?? ''),
      allocations,
      // Where the row sits, for repair notes; the plain cells let a repair find a value that
      // slid into the wrong column. Both are dropped before the rows are stored.
      sheetName,
      sheetRow: headerIndex + 2 + offset,
      cells: cells.filter((_, column) => !dayColumns.has(column))
    });
  }
  return { rows, days: days.map(({ date, returnDate, fileTotal }) => ({ date, returnDate, fileTotal })) };
}

export function readWorkbook(buffer) {
  return XLSX.read(buffer, { type: 'array' });
}

export function getSheetByName(workbook, targetName) {
  if (!workbook?.Sheets) return null;
  if (workbook.Sheets[targetName]) return workbook.Sheets[targetName];
  const target = String(targetName).trim().toUpperCase();
  const key = Object.keys(workbook.Sheets).find((name) => name.trim().toUpperCase() === target);
  return key ? workbook.Sheets[key] : null;
}

export function getSheetKey(workbook, targetName) {
  if (!workbook?.Sheets) return null;
  if (workbook.Sheets[targetName]) return targetName;
  const target = String(targetName).trim().toUpperCase();
  return Object.keys(workbook.Sheets).find((name) => name.trim().toUpperCase() === target) || null;
}

// TH is assembled by hand from the four lead-time sheets, so compare them before trusting TH.
export function crossCheckSheets(workbook) {
  const thSheet = getSheetByName(workbook, 'TH');
  const leadTimeSheets = LEAD_TIME_SHEETS
    .map(([sheetName, leadTime]) => [getSheetByName(workbook, sheetName), leadTime])
    .filter(([sheet]) => Boolean(sheet));
  if (!thSheet) return { checked: false, mismatches: [], dailyTotals: [] };
  if (!leadTimeSheets.length) return { checked: true, mismatches: [], dailyTotals: checkDailyTotals(readRowsFromSheet(thSheet, 4)) };
  const key = (row) => [row.po, row.ref, row.color, row.leadTime].map((value) => String(value ?? '').trim().toUpperCase()).join('|');
  const totals = (rows) => rows.reduce((map, row) => {
    const entry = map.get(key(row)) || { row, quantity: 0 };
    entry.quantity += Number(row.lineQuantity || 0);
    map.set(key(row), entry);
    return map;
  }, new Map());
  const summary = totals(readRowsFromSheet(thSheet, 4).rows);
  const sources = totals(leadTimeSheets.flatMap(([sheet, leadTime]) => readRowsFromSheet(sheet, 3, leadTime).rows));
  const mismatches = [];
  const label = (entry, note) => ({ row: entry.row.line ? `LINE ${entry.row.line}` : '—', po: entry.row.po || 'Chưa có PO', ref: entry.row.ref, quantity: entry.quantity, note });
  for (const [rowKey, entry] of summary) {
    const source = sources.get(rowKey);
    if (!source) mismatches.push(label(entry, `chỉ có trong TH (${entry.row.leadTime})`));
    else if (source.quantity !== entry.quantity) mismatches.push(label(entry, `TH ${entry.quantity} ≠ sheet leadtime ${source.quantity}`));
  }
  for (const [rowKey, entry] of sources) {
    if (!summary.has(rowKey)) mismatches.push(label(entry, `thiếu trong TH (${entry.row.leadTime})`));
  }
  return { checked: true, mismatches, dailyTotals: checkDailyTotals(readRowsFromSheet(thSheet, 4)) };
}

const shortDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

// TỔNG NGÀY is a SUMPRODUCT formula typed by hand; ranges copied from another sheet drift.
export function checkDailyTotals({ rows, days }) {
  const computed = dailyLoad(rows, days);
  return days
    .map((day, index) => ({ day, computed: computed[index] }))
    .filter(({ day, computed: value }) => day.fileTotal != null && Math.abs(day.fileTotal - value) > 1)
    .map(({ day, computed: value }) => ({
      row: `PXC ${shortDate(day.date)}`,
      po: '—',
      quantity: Math.round(value),
      note: `TỔNG NGÀY trong file ${Math.round(day.fileTotal)} ≠ tính lại ${Math.round(value)} lượt hình`
    }));
}

// Booking rows plus the planned days (PXC pick-up / PXI return dates) they are allocated to.
// Rows are repaired by Mã hàng + Model (booking-columns.js); `repairs` lists every change.
export function readBooking(workbook) {
  const { rows, days } = readBookingSheets(workbook);
  const repairs = repairBookingRows(rows);
  for (const row of rows) {
    delete row.sheetName;
    delete row.sheetRow;
  }
  return { rows, days, repairs };
}

function readBookingSheets(workbook) {
  const thKey = getSheetKey(workbook, 'TH');
  if (thKey) return readRowsFromSheet(workbook.Sheets[thKey], 4, null, thKey);
  const parts = LEAD_TIME_SHEETS
    .map(([sheetName, leadTime]) => [getSheetKey(workbook, sheetName), leadTime])
    .filter(([sheetKey]) => Boolean(sheetKey))
    .map(([sheetKey, leadTime]) => readRowsFromSheet(workbook.Sheets[sheetKey], 3, leadTime, sheetKey));
  // Each lead-time sheet has its own return dates, so the combined view keeps one column per
  // pick-up date and re-keys every row's allocations to it.
  const dates = [...new Set(parts.flatMap((part) => part.days.map((day) => day.date)))].sort();
  const position = new Map(dates.map((date, index) => [date, String(index)]));
  const rows = parts.flatMap((part) => part.rows.map((row) => {
    const allocations = {};
    for (const [index, value] of Object.entries(row.allocations)) {
      const key = position.get(part.days[index].date);
      allocations[key] = typeof value === 'number' && typeof allocations[key] === 'number' ? allocations[key] + value : value;
    }
    return { ...row, allocations };
  }));
  return { rows, days: dates.map((date) => ({ date, returnDate: null, fileTotal: null })) };
}

export function extractBookingRows(workbook) {
  return readBooking(workbook).rows;
}

const minDate = (current, value) => (value && (!current || value < current) ? value : current);
const maxDate = (current, value) => (value && (!current || value > current) ? value : current);

export function summarizeLeadTimes(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const leadTime = String(row.leadTime || 'Chưa xác định').trim() || 'Chưa xác định';
    const group = groups.get(leadTime) || {
      leadTime, rowCount: 0, totalQuantity: 0, totalImpressions: 0,
      models: new Set(), pos: new Set(), customers: new Map(),
      firstInput: null, lastInput: null, firstOutput: null, lastOutput: null
    };
    const quantity = Number(row.lineQuantity || 0);
    group.rowCount += 1;
    group.totalQuantity += quantity;
    group.totalImpressions += quantity * Number(row.printCount || 0);
    const model = row.modelCode || row.ref;
    if (model) group.models.add(model);
    if (row.po) group.pos.add(row.po);
    const customerName = String(row.customer || row.brand || '').trim() || 'Chưa rõ khách hàng';
    // "DECATHLON" and "Decathlon" are the same customer typed differently.
    const customerKey = customerName.toLocaleUpperCase('vi-VN');
    const customer = group.customers.get(customerKey) || { name: customerName, rowCount: 0, totalQuantity: 0 };
    customer.rowCount += 1;
    customer.totalQuantity += quantity;
    group.customers.set(customerKey, customer);
    group.firstInput = minDate(group.firstInput, row.inputDate);
    group.lastInput = maxDate(group.lastInput, row.inputDate);
    group.firstOutput = minDate(group.firstOutput, row.outputDate);
    group.lastOutput = maxDate(group.lastOutput, row.outputDate);
    groups.set(leadTime, group);
  });
  // Unparseable lead times (e.g. "Chưa xác định") go last instead of sorting as NaN.
  const order = (group) => Number.parseInt(group.leadTime, 10) || Number.MAX_SAFE_INTEGER;
  return [...groups.values()]
    .sort((a, b) => order(a) - order(b))
    .map(({ models, pos, customers, ...group }) => ({
      ...group,
      modelCount: models.size,
      poCount: pos.size,
      customers: [...customers.values()].sort((a, b) => b.totalQuantity - a.totalQuantity)
    }));
}


// One entry per product (REF + COLOR) so warehouse progress can be matched to its due date.
export function summarizeModels(rows) {
  const models = new Map();
  rows.forEach((row) => {
    if (!row.ref) return;
    const key = productKey(row.ref, row.color);
    const model = models.get(key) || { model: row.ref, color: row.color, customer: row.customer, quantity: 0, firstOutput: null, lastOutput: null, leadTime: row.leadTime };
    model.quantity += Number(row.lineQuantity || 0);
    model.firstOutput = minDate(model.firstOutput, row.outputDate);
    model.lastOutput = maxDate(model.lastOutput, row.outputDate);
    models.set(key, model);
  });
  return [...models.values()];
}

export function summarizeBooking(rows) {
  return {
    rowCount: rows.length,
    totalQuantity: rows.reduce((sum, row) => sum + row.lineQuantity, 0),
    totalImpressions: rows.reduce((sum, row) => sum + row.lineQuantity * row.printCount, 0),
    uniquePo: new Set(rows.map((row) => row.po)).size,
    leadTimes: summarizeLeadTimes(rows),
    models: summarizeModels(rows)
  };
}
