import * as XLSX from 'xlsx';
import { toIsoDate } from './booking-import.js';

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

// The real file labels both totals "TOTAL": the first one (after BÀN) is received, the one
// right after NGÀY XUẤT is shipped; a third TOTAL further right is the difference.
function locateColumns(labels) {
  const position = Object.fromEntries(Object.entries(COLUMNS).map(([field, aliases]) => [field, labels.findIndex((label) => aliases.includes(label))]));
  if (position.received === -1) position.received = labels.indexOf('TOTAL');
  if (position.shipped === -1) {
    const shippedDate = labels.indexOf('NGAY XUAT');
    position.shipped = shippedDate === -1 ? -1 : labels.indexOf('TOTAL', shippedDate + 1);
  }
  return position;
}

function findHeader(table) {
  return table.slice(0, 20).findIndex((cells) => {
    const labels = cells.map(plain);
    return labels.includes('MA HANG') && (labels.includes('TONG NHAN') || labels.includes('TOTAL'));
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
  throw new Error('Không tìm thấy sheet có cột MÃ HÀNG và TOTAL / TỔNG NHẬN (sheet DATA) trong file nhận.');
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

// Browser storage is about 5 MB, so the static site keeps one line per product, season and
// ticket (PO column) instead of every receipt.
export function compactReceiptLines(lines) {
  const groups = new Map();
  for (const line of lines) {
    const key = [line.model, line.color, line.season, line.po].map((value) => String(value ?? '').trim().toUpperCase()).join('|');
    const group = groups.get(key) || { ...line, received: 0, shipped: 0, receipts: 0, firstDate: null, date: null };
    group.received += line.received || 0;
    group.shipped += line.shipped || 0;
    group.receipts += line.receipts ?? 1;
    for (const date of [line.firstDate, line.date]) {
      if (!isIsoDate(date)) continue;
      if (!group.firstDate || date < group.firstDate) group.firstDate = date;
      if (!group.date || date > group.date) group.date = date;
    }
    groups.set(key, group);
  }
  return [...groups.values()].map(({ table, contractQuantity, ...line }) => line);
}
