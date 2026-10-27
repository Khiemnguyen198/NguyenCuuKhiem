import * as XLSX from 'xlsx';

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
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
}

// Factory workbooks pad headers with spaces (" INPUT ", " MODEL CODE "), so keys are trimmed.
function trimKeys(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key.trim(), value]));
}

// The header row moves between sheets (row 4 in some, row 6 in others) and TH repeats
// it above the data, so use the last header-like row near the top.
function findHeaderRow(sheet, fallback) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, defval: null, raw: true, blankrows: true }).slice(0, 15);
  const index = rows.findLastIndex((cells) => {
    const labels = cells.map((cell) => String(cell ?? '').trim().toUpperCase());
    return labels.includes('LINE') && labels.includes('PO');
  });
  return index === -1 ? fallback : index;
}

function readRowsFromSheet(sheet, fallbackRange, leadTimeOverride = null) {
  const range = findHeaderRow(sheet, fallbackRange);
  const records = XLSX.utils.sheet_to_json(sheet, { range, defval: null, raw: true }).map(trimKeys);
  return records
    .filter((row) => row.LINE != null && [row.PO, row.REF, row['MODEL CODE'], row['LINE QTY']].some((value) => value != null && value !== ''))
    .map((row) => ({
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
      leadTime: String(row.Leadtime ?? leadTimeOverride ?? '')
    }));
}

export function readWorkbook(buffer) {
  return XLSX.read(buffer, { type: 'array' });
}

export function extractBookingRows(workbook) {
  if (workbook.Sheets.TH) return readRowsFromSheet(workbook.Sheets.TH, 4);
  return LEAD_TIME_SHEETS.flatMap(([sheetName, leadTime]) => workbook.Sheets[sheetName]
    ? readRowsFromSheet(workbook.Sheets[sheetName], 3, leadTime)
    : []);
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

const modelKey = (model, color) => `${String(model ?? '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('vi-VN')}|${String(color ?? '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('vi-VN')}`;

// One entry per product (REF + COLOR) so warehouse progress can be matched to its due date.
export function summarizeModels(rows) {
  const models = new Map();
  rows.forEach((row) => {
    if (!row.ref) return;
    const key = modelKey(row.ref, row.color);
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
