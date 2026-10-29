import * as XLSX from 'xlsx';
import { customerKey, productKey } from './keys.js';
import { toIsoDate } from './booking-import.js';

const SUMMARY_SHEET = 'TỔNG HỢP';

const normalizeHeader = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const text = (value) => String(value ?? '').trim();
const ACTUAL_DELIVERY_HEADERS = ['NGÀY GIAO THỰC TẾ', 'NGÀY GIAO', 'NGÀY XUẤT', 'DATE'];

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
  actualDeliveryDate: 'NGÀY GIAO THỰC TẾ',
  fullPo: 'FULL PO',
  planner: 'KẾ HOẠCH'
};

export function readWarehouseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const norm = SUMMARY_SHEET.replace(/\s+/g, ' ').trim().toUpperCase();
  const sheetName = (workbook.SheetNames || []).find((name) => String(name).replace(/\s+/g, ' ').trim().toUpperCase() === norm);
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) throw new Error(`Không tìm thấy sheet “${SUMMARY_SHEET}” trong file kho.`);
  const lines = readWarehouseSheet(sheet);
  const transactionName = (workbook.SheetNames || []).find((name) => normalizeHeader(name) === 'NHẬP XUẤT');
  if (transactionName) attachTransactionDates(lines, workbook.Sheets[transactionName]);
  return lines;
}

// TỔNG HỢP contains accumulated quantities but no dates. NHẬP XUẤT records
// each movement against its own PO-SLHĐ; join only exact product/PO keys.
export function attachTransactionDates(lines, sheet) {
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true });
  const headerIndex = table.slice(0, 20).findIndex((row) => {
    const labels = row.map(normalizeHeader);
    return ['PO-SLHĐ', 'MÃ HÀNG', 'MÀU', 'NGÀY', 'TOTAL XUẤT'].every((label) => labels.includes(label));
  });
  if (headerIndex < 0) return;
  const labels = table[headerIndex].map(normalizeHeader);
  const col = (label) => labels.indexOf(label);
  const key = (po, model, color) => `${normalizeHeader(po)}|${productKey(model, color)}`;
  const events = new Map();
  for (const row of table.slice(headerIndex + 1)) {
    const po = text(row[col('PO-SLHĐ')]);
    const model = text(row[col('MÃ HÀNG')]);
    const color = text(row[col('MÀU')]);
    if (!po || po === '0' || !model || !color || !(toNumber(row[col('TOTAL XUẤT')]) > 0)) continue;
    const id = key(po, model, color);
    const event = events.get(id) || { date: null, incomplete: false };
    let date = null;
    try { date = toIsoDate(row[col('NGÀY')]); } catch { /* Invalid dates remain unknown. */ }
    if (!date) event.incomplete = true;
    else if (!event.date || date > event.date) event.date = date;
    events.set(id, event);
  }
  const targets = new Map();
  for (const line of lines) {
    const id = key(line.po, line.model, line.color);
    const group = targets.get(id) || [];
    group.push(line);
    targets.set(id, group);
  }
  for (const [id, event] of events) {
    const group = targets.get(id) || [];
    // A date without season or PO detail cannot distinguish different contracts.
    const identities = new Set(group.map((line) => `${normalizeHeader(line.season)}|${normalizeHeader(line.fullPo || line.po)}`));
    if (event.incomplete || !event.date || identities.size !== 1) continue;
    for (const line of group) if (!line.actualDeliveryDate) line.actualDeliveryDate = event.date;
  }
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
  position.actualDeliveryDate = ACTUAL_DELIVERY_HEADERS
    .map((label) => labels.indexOf(label))
    .find((index) => index !== -1) ?? -1;
  // The second PO column holds the production ticket (SỐ PHIẾU) shared with the booking file.
  position.ticket = position.po === -1 ? -1 : labels.indexOf('PO', position.po + 1);
  position.dateTicket = labels.indexOf('SLTL');
  const cell = (cells, field) => (position[field] === -1 ? null : cells[position[field]]);

  return table.slice(headerIndex + 1)
    .filter((cells) => text(cell(cells, 'po')) && text(cell(cells, 'model')))
    .map((cells) => ({
      po: text(cell(cells, 'po')),
      fullPo: text(cell(cells, 'fullPo')),
      ticket: text(cell(cells, 'ticket')),
      dateTicket: text(cell(cells, 'dateTicket')),
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
      good: toNumber(cell(cells, 'good')),
      actualDeliveryDate: toIsoDate(cell(cells, 'actualDeliveryDate'))
    }));
}

function emptyTotals() {
  return { received: 0, delivered: 0, printDefects: 0, fabricDefects: 0, samples: 0, fabricShort: 0, good: 0 };
}

function addTotals(target, line) {
  for (const key of Object.keys(target)) target[key] += line[key];
  return target;
}

const isCustomerName = (value) => value && !/^\d+$/.test(value) && !/_test$/i.test(value);

export function groupDeliveries(lines, bookingByKey, { keyOf = null } = {}) {
  // Some rows carry a PO or test code in KHÁCH HÀNG; borrow the name from the same product instead.
  const customerByProduct = new Map();
  lines.forEach((line) => {
    if (isCustomerName(line.customer)) customerByProduct.set(productKey(line.model, line.color), line.customer);
  });
  const groups = new Map();
  for (const line of lines) {
    const product = productKey(line.model, line.color);
    const customer = isCustomerName(line.customer)
      ? line.customer
      : customerByProduct.get(product) || bookingByKey.get(product)?.customer || 'Chưa rõ khách hàng';
    const key = keyOf ? keyOf(line, customer) : `${customerKey(customer)}|${product}`;
    const group = groups.get(key) || {
      product, customer, model: line.model, color: line.color, season: line.season, ticket: line.ticket || '',
      contractByPo: new Map(), contractTotal: 0, prints: new Map(), pos: new Set(), actualDeliveryDate: null
    };
    // -OB / -TB rows repeat the same PO for each print, so count each PO's SLHĐ once.
    const poKey = line.fullPo || line.po.replace(/-(OB|TB|[A-Z]{1,3})$/i, '');
    group.contractByPo.set(poKey, Math.max(group.contractByPo.get(poKey) || 0, line.contractQuantity));
    group.contractTotal = Math.max(group.contractTotal, line.contractTotal);
    if (line.actualDeliveryDate && (!group.actualDeliveryDate || line.actualDeliveryDate > group.actualDeliveryDate)) group.actualDeliveryDate = line.actualDeliveryDate;
    group.pos.add(line.fullPo || line.po);
    if (line.received || line.delivered || line.good || line.print) {
      const printName = line.print || 'Không tên';
      group.prints.set(printName, addTotals(group.prints.get(printName) || emptyTotals(), line));
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

// A garment with several prints (ORBIT, TRIBORD…) is only finished when every print is,
// so the delivery numbers come from the slowest print.
export function itemFromDeliveries(group) {
  const contractSum = [...group.contractByPo.values()].reduce((sum, value) => sum + value, 0);
  const active = [...group.prints.entries()]
    .map(([name, totals]) => ({ name, ...totals }))
    .filter((print) => print.received || print.delivered || print.good);
  const slowest = active.length ? active.reduce((worst, print) => (print.good < worst.good ? print : worst)) : emptyTotals();
  return {
    product: group.product,
    customer: group.customer,
    model: group.model,
    color: group.color,
    season: group.season,
    poCount: group.pos.size,
    contract: Math.round(contractSum || group.contractTotal),
    ...slowest,
    actualDeliveryDate: group.actualDeliveryDate,
    prints: active.length > 1 || (active.length === 1 && active[0].name !== 'Không tên') ? active : [],
    sources: { delivery: true }
  };
}
