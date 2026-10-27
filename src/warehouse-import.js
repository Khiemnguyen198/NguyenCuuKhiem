import * as XLSX from 'xlsx';

const SUMMARY_SHEET = 'TỔNG HỢP';
const DAY_MS = 86_400_000;

const normalizeHeader = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const normalizeKey = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('vi-VN');
const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const text = (value) => String(value ?? '').trim();

// Columns are found by header text; the sheet repeats some names (opening balances), so take the first.
const COLUMNS = {
  po: 'PO',
  model: 'MÃ HÀNG',
  color: 'MÀU',
  season: 'MÙA',
  print: 'HÌNH IN',
  customer: 'KHÁCH HÀNG',
  contractQuantity: 'SLHĐ',
  contractTotal: 'SLHĐ TỔNG',
  received: 'TỔNG NHẬN',
  delivered: 'TỔNG GIAO',
  printDefects: 'HỎNG IN',
  fabricDefects: 'LỖI VẢI',
  samples: 'MẪU',
  fabricShort: 'THIẾU VẢI',
  good: 'GIAO ĐẠT',
  fullPo: 'FULL PO',
  planner: 'KẾ HOẠCH'
};

export function readWarehouseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array', sheets: [SUMMARY_SHEET] });
  const sheet = workbook.Sheets[SUMMARY_SHEET];
  if (!sheet) throw new Error(`Không tìm thấy sheet “${SUMMARY_SHEET}” trong file kho.`);
  return readWarehouseSheet(sheet);
}

export function readWarehouseSheet(sheet) {
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true });
  const headerIndex = table.slice(0, 15).findIndex((cells) => {
    const labels = cells.map(normalizeHeader);
    return labels.includes('MÃ HÀNG') && labels.includes('TỔNG NHẬN');
  });
  if (headerIndex === -1) throw new Error('File kho thiếu cột MÃ HÀNG hoặc TỔNG NHẬN.');
  const labels = table[headerIndex].map(normalizeHeader);
  const position = Object.fromEntries(Object.entries(COLUMNS).map(([field, label]) => [field, labels.indexOf(label)]));
  const cell = (cells, field) => (position[field] === -1 ? null : cells[position[field]]);

  return table.slice(headerIndex + 1)
    .filter((cells) => text(cell(cells, 'po')) && text(cell(cells, 'model')))
    .map((cells) => ({
      po: text(cell(cells, 'po')),
      fullPo: text(cell(cells, 'fullPo')),
      model: text(cell(cells, 'model')),
      color: text(cell(cells, 'color')),
      season: text(cell(cells, 'season')),
      print: text(cell(cells, 'print')),
      customer: text(cell(cells, 'customer')),
      planner: text(cell(cells, 'planner')),
      // SLHĐ can be "BSL" (top-up) or "MAU" (sample) instead of a quantity.
      contractQuantity: toNumber(cell(cells, 'contractQuantity')),
      contractTotal: toNumber(cell(cells, 'contractTotal')),
      received: toNumber(cell(cells, 'received')),
      delivered: toNumber(cell(cells, 'delivered')),
      printDefects: toNumber(cell(cells, 'printDefects')),
      fabricDefects: toNumber(cell(cells, 'fabricDefects')),
      samples: toNumber(cell(cells, 'samples')),
      fabricShort: toNumber(cell(cells, 'fabricShort')),
      good: toNumber(cell(cells, 'good'))
    }));
}

function emptyTotals() {
  return { received: 0, delivered: 0, printDefects: 0, fabricDefects: 0, samples: 0, fabricShort: 0, good: 0 };
}

function addTotals(target, line) {
  for (const key of Object.keys(target)) target[key] += line[key];
  return target;
}

export function modelKey(model, color) {
  return `${normalizeKey(model)}|${normalizeKey(color)}`;
}

function statusOf(item) {
  if (item.contract > 0 && item.good >= item.contract) return 'done';
  if (item.received === 0) return 'waiting';
  if (item.delivered < item.received) return 'printing';
  if (item.received < item.contract) return 'short-input';
  return 'printing';
}

// Groups warehouse lines by customer + model + color. A garment with several prints
// (ORBIT, TRIBORD…) is only finished when every print is, so the slowest print is used.
export function summarizeWarehouse(lines, bookingModels = [], today = new Date()) {
  const dueByModel = new Map(bookingModels.map((item) => [modelKey(item.model, item.color), item]));
  const startOfToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  // Some rows carry a PO or test code in KHÁCH HÀNG; borrow the name from the same product instead.
  const isCustomerName = (value) => value && !/^\d+$/.test(value) && !/_test$/i.test(value);
  const customerByModel = new Map();
  lines.forEach((line) => {
    if (isCustomerName(line.customer)) customerByModel.set(modelKey(line.model, line.color), line.customer);
  });
  const groups = new Map();

  for (const line of lines) {
    const customer = isCustomerName(line.customer)
      ? line.customer
      : customerByModel.get(modelKey(line.model, line.color))
        || dueByModel.get(modelKey(line.model, line.color))?.customer
        || 'Chưa rõ khách hàng';
    const key = `${normalizeKey(customer)}|${modelKey(line.model, line.color)}`;
    const group = groups.get(key) || {
      customer, model: line.model, color: line.color, season: line.season,
      contractByPo: new Map(), contractTotal: 0, prints: new Map(), pos: new Set()
    };
    // -OB / -TB rows repeat the same PO for each print, so count each PO's SLHĐ once.
    const poKey = line.fullPo || line.po.replace(/-(OB|TB|[A-Z]{1,3})$/i, '');
    group.contractByPo.set(poKey, Math.max(group.contractByPo.get(poKey) || 0, line.contractQuantity));
    group.contractTotal = Math.max(group.contractTotal, line.contractTotal);
    group.pos.add(line.fullPo || line.po);
    const hasActivity = line.received || line.delivered || line.good;
    if (hasActivity || line.print) {
      const printName = line.print || 'Không tên';
      group.prints.set(printName, addTotals(group.prints.get(printName) || emptyTotals(), line));
    }
    groups.set(key, group);
  }

  const items = [...groups.values()].map((group) => {
    const contractSum = [...group.contractByPo.values()].reduce((sum, value) => sum + value, 0);
    const prints = [...group.prints.entries()].map(([name, totals]) => ({ name, ...totals }));
    const active = prints.filter((print) => print.received || print.delivered || print.good);
    const slowest = active.length
      ? active.reduce((worst, print) => (print.good < worst.good ? print : worst))
      : { ...emptyTotals() };
    const contract = Math.round(contractSum || group.contractTotal);
    const booking = dueByModel.get(modelKey(group.model, group.color));
    const dueDate = booking?.lastOutput || null;
    const item = {
      customer: group.customer,
      model: group.model,
      color: group.color,
      season: group.season,
      poCount: group.pos.size,
      contract,
      received: slowest.received,
      delivered: slowest.delivered,
      printDefects: slowest.printDefects,
      fabricDefects: slowest.fabricDefects,
      samples: slowest.samples,
      fabricShort: slowest.fabricShort,
      good: slowest.good,
      prints: active.length > 1 || (active.length === 1 && active[0].name !== 'Không tên') ? active : [],
      leadTime: booking?.leadTime || null,
      dueDate
    };
    item.defects = item.printDefects + item.fabricDefects;
    item.remaining = Math.max(0, item.contract - item.good);
    item.onHand = Math.max(0, item.received - item.delivered);
    item.inputShortage = Math.max(0, item.contract - item.received);
    item.completion = item.contract > 0 ? Math.min(1, item.good / item.contract) : 0;
    item.status = statusOf(item);
    item.daysToDue = dueDate ? Math.round((Date.parse(`${dueDate}T00:00:00Z`) - startOfToday) / DAY_MS) : null;
    item.overdue = item.status !== 'done' && item.daysToDue != null && item.daysToDue < 0;
    return item;
  });

  items.sort((a, b) => a.customer.localeCompare(b.customer, 'vi') || String(a.model).localeCompare(String(b.model), 'vi', { numeric: true }));
  const totals = items.reduce((sum, item) => {
    for (const key of ['contract', 'received', 'delivered', 'good', 'defects', 'printDefects', 'fabricDefects', 'remaining', 'onHand']) sum[key] += item[key];
    sum.statusCounts[item.status] += 1;
    if (item.overdue) sum.overdue += 1;
    return sum;
  }, {
    contract: 0, received: 0, delivered: 0, good: 0, defects: 0, printDefects: 0, fabricDefects: 0, remaining: 0, onHand: 0,
    overdue: 0, statusCounts: { done: 0, printing: 0, 'short-input': 0, waiting: 0 }
  });
  return { items, totals, customers: [...new Set(items.map((item) => item.customer))] };
}
