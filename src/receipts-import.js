import * as XLSX from 'xlsx';
import { toIsoDate } from './booking-import.js';
import { productKey } from './keys.js';

// Receiving log ("INKAVA_XUẤT NHẬP BTP", sheet DATA): one row per delivery of
// semi-finished goods into the factory, with received / shipped totals by size.
const PREFERRED_SHEET = 'DATA';

const plain = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
  .replace(/\s+/g, ' ').trim().toUpperCase();
const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const text = (value) => String(value ?? '').trim();

// Headers are matched without accents; the first column whose header matches wins.
const COLUMNS = {
  date: ['NGAY NHAN'],
  customer: ['KHACH HANG'],
  model: ['MA HANG'],
  color: ['MAU'],
  po: ['PO'],
  season: ['SS', 'MUA'],
  contractQuantity: ['SLHD'],
  contractTotal: ['SLHD TONG'],
  table: ['BAN'],
  received: ['TONG NHAN'],
  shipped: ['TONG XUAT']
};

function locateColumns(labels) {
  return Object.fromEntries(Object.entries(COLUMNS).map(([field, aliases]) => [field, labels.findIndex((label) => aliases.includes(label))]));
}

function findHeader(table) {
  return table.slice(0, 20).findIndex((cells) => {
    const labels = cells.map(plain);
    return labels.includes('MA HANG') && labels.includes('TONG NHAN');
  });
}

export function readReceiptsWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const names = [PREFERRED_SHEET, ...workbook.SheetNames.filter((name) => name !== PREFERRED_SHEET)];
  for (const name of names) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const lines = readReceiptsSheet(sheet);
    if (lines.length) return { sheetName: name, lines };
  }
  throw new Error('Không tìm thấy sheet có cột MÃ HÀNG và TỔNG NHẬN (sheet DATA) trong file nhận.');
}

export function readReceiptsSheet(sheet) {
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true });
  const headerIndex = findHeader(table);
  if (headerIndex === -1) return [];
  const position = locateColumns(table[headerIndex].map(plain));
  const cell = (cells, field) => (position[field] === -1 ? null : cells[position[field]]);
  return table.slice(headerIndex + 1)
    .filter((cells) => text(cell(cells, 'model')) && (toNumber(cell(cells, 'received')) || toNumber(cell(cells, 'shipped'))))
    .map((cells) => ({
      date: toIsoDate(cell(cells, 'date')),
      customer: text(cell(cells, 'customer')),
      model: text(cell(cells, 'model')),
      color: text(cell(cells, 'color')),
      po: text(cell(cells, 'po')),
      season: text(cell(cells, 'season')),
      table: text(cell(cells, 'table')),
      contractQuantity: toNumber(cell(cells, 'contractQuantity')),
      contractTotal: toNumber(cell(cells, 'contractTotal')),
      received: toNumber(cell(cells, 'received')),
      shipped: toNumber(cell(cells, 'shipped'))
    }));
}

const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value));

// Totals per product (model + color), keyed like the warehouse summary.
export function summarizeReceipts(lines = []) {
  const products = new Map();
  for (const line of lines) {
    const key = productKey(line.model, line.color);
    const product = products.get(key) || {
      model: line.model, color: line.color, customer: line.customer, season: line.season,
      received: 0, shipped: 0, receipts: 0, contractTotal: 0, firstDate: null, lastDate: null
    };
    product.received += line.received;
    product.shipped += line.shipped;
    product.receipts += line.receipts ?? 1;
    product.contractTotal = Math.max(product.contractTotal, line.contractTotal);
    // Compacted lines (see compactReceiptLines) carry their own first date.
    for (const date of [line.firstDate, line.date]) {
      if (!isIsoDate(date)) continue;
      if (!product.firstDate || date < product.firstDate) product.firstDate = date;
      if (!product.lastDate || date > product.lastDate) product.lastDate = date;
    }
    products.set(key, product);
  }
  return products;
}

// Browser storage is about 5 MB, so the static site keeps one line per product instead of every receipt.
export function compactReceiptLines(lines) {
  return [...summarizeReceipts(lines).values()].map((product) => ({
    date: product.lastDate, firstDate: product.firstDate, customer: product.customer, model: product.model,
    color: product.color, season: product.season, contractTotal: product.contractTotal,
    received: product.received, shipped: product.shipped, receipts: product.receipts
  }));
}
