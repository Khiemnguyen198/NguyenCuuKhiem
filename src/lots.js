import { customerKey } from './keys.js';
import { groupDeliveries, itemFromDeliveries } from './warehouse-import.js';

// Tracking unit: one booking lot = Mã hàng (REF) + Model + Mùa with its SLHĐ TỔNG.
// The booking's own formula defines the lot: rows sharing a SỐ PHIẾU, or — before a ticket
// exists — rows sharing LINE + REF + COLOR + INPUT. Received / delivered goods are matched
// to a lot by ticket when possible; the rest of each product is poured into its lots in
// due-date order (FIFO), and inside a lot down to the PO rows the same way.

const DAY_MS = 86_400_000;
const up = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hasTicket = (ticket) => Boolean(ticket) && String(ticket).trim() !== '0';

// Decathlon colors start with the 7-digit model code ("9046670 1P BEA…").
export function modelCodeOf(color, modelCode = '') {
  const explicit = up(modelCode);
  if (explicit) return explicit;
  return (String(color ?? '').match(/^\s*(\d{7})/) || [])[1] || up(color);
}

const productOf = (ref, model) => `${up(ref)}|${model}`;

export function buildLots(rows = []) {
  const lots = new Map();
  for (const row of rows) {
    const ticket = hasTicket(row.ticketNumber) ? String(row.ticketNumber).trim() : null;
    const key = ticket ? `T:${ticket}|${productOf(row.ref, modelCodeOf(row.color, row.modelCode))}` : `L:${up(row.line)}|${up(row.ref)}|${up(row.color)}|${row.inputDate || ''}`;
    const lot = lots.get(key) || {
      key, ticket, ref: row.ref, modelCode: modelCodeOf(row.color, row.modelCode), color: row.color,
      season: row.season, customer: row.customer, leadTime: row.leadTime, rows: [], contract: 0,
      contractInFile: 0, firstDue: null, dueDate: null
    };
    lot.rows.push(row);
    lot.contract += Number(row.lineQuantity || 0);
    lot.contractInFile = Math.max(lot.contractInFile, Number(row.contractQuantity || 0));
    if (row.outputDate && (!lot.firstDue || row.outputDate < lot.firstDue)) lot.firstDue = row.outputDate;
    if (row.outputDate && (!lot.dueDate || row.outputDate > lot.dueDate)) lot.dueDate = row.outputDate;
    lots.set(key, lot);
  }
  for (const lot of lots.values()) {
    lot.product = productOf(lot.ref, lot.modelCode);
    lot.rows.sort((a, b) => String(a.outputDate || '9').localeCompare(String(b.outputDate || '9')));
  }
  return [...lots.values()];
}

// Season is part of the key, but warehouse files type it differently ("SS27OW02", blank…):
// when a product has booking lots in a single season, any season of that product matches it.
function seasonResolver(lots) {
  const seasons = new Map();
  for (const lot of lots) {
    const set = seasons.get(lot.product) || new Set();
    set.add(up(lot.season));
    seasons.set(lot.product, set);
  }
  return (product, season) => {
    const set = seasons.get(product);
    if (!set) return null;
    if (set.has(up(season))) return up(season);
    return set.size === 1 ? [...set][0] : null;
  };
}

const ZERO = () => ({ received: 0, delivered: 0, good: 0, printDefects: 0, fabricDefects: 0, samples: 0, fabricShort: 0 });
const MEASURES = ['received', 'delivered', 'good', 'printDefects', 'fabricDefects', 'samples', 'fabricShort'];

function add(target, source, factor = 1) {
  for (const key of MEASURES) target[key] += (source[key] || 0) * factor;
  return target;
}

function receiptUnits(receiptLines) {
  const units = new Map();
  for (const line of receiptLines) {
    const model = modelCodeOf(line.color);
    const key = `${up(line.model)}|${model}|${up(line.season)}|${line.po || ''}`;
    const unit = units.get(key) || { product: productOf(line.model, model), season: line.season, ticket: String(line.po || '').trim(), ref: line.model, color: line.color, customer: line.customer, received: 0, shipped: 0, receipts: 0, firstDate: null, lastDate: null };
    unit.received += line.received || 0;
    unit.shipped += line.shipped || 0;
    unit.receipts += line.receipts ?? 1;
    for (const date of [line.firstDate, line.date]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) continue;
      if (!unit.firstDate || date < unit.firstDate) unit.firstDate = date;
      if (!unit.lastDate || date > unit.lastDate) unit.lastDate = date;
    }
    units.set(key, unit);
  }
  return [...units.values()];
}

// Dates are evidence about individual source rows, unlike quantities that may
// be pooled by product and distributed FIFO. A pooled date cannot establish
// which PO was received or delivered, so only unique identifiers are used.
function assignRowDates(lots, receiptLines, deliveryLines) {
  const byProduct = new Map();
  const resolveSeason = seasonResolver(lots);
  for (const lot of lots) {
    for (const row of lot.rows) {
      row.receiptDate = null;
      row.receiptDateBasis = null;
      row.fileDeliveryDate = null;
      const key = productOf(row.ref, modelCodeOf(row.color, row.modelCode));
      const rows = byProduct.get(key) || [];
      rows.push(row);
      byProduct.set(key, rows);
    }
  }
  const compatibleRows = (line) => {
    const key = productOf(line.model, modelCodeOf(line.color));
    const season = resolveSeason(key, line.season);
    return season == null ? [] : (byProduct.get(key) || []).filter((row) => up(row.season) === season);
  };
  const latest = (previous, candidate) => !previous || candidate > previous ? candidate : previous;
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
  const directReceipts = new Map();
  for (const line of receiptLines) {
    if (!(Number(line.received) > 0) || !hasTicket(line.po)) continue;
    // Older compact snapshots lack provenance for multiple receipt/shipment
    // dates. Reimport the receiving file instead of guessing from its max date.
    const date = line.lastReceivedDate || ((line.receipts ?? 1) === 1 ? line.date : null);
    const token = up(line.po);
    const candidates = compatibleRows(line).filter((row) =>
      up(row.po) === token || (hasTicket(row.ticketNumber) && up(row.ticketNumber) === token));
    if (candidates.length !== 1 || !(candidates[0].receivedFifo > 0)) continue;
    const row = candidates[0];
    const result = directReceipts.get(row) || { date: null, complete: true };
    const eventTotal = Array.isArray(line.receiptDates) ? line.receiptDates.reduce((sum, item) => sum + item.received, 0) : null;
    if (line.undatedReceived || !validDate(date) || (eventTotal != null && eventTotal !== Number(line.received))) result.complete = false;
    else result.date = latest(result.date, date);
    directReceipts.set(row, result);
  }
  for (const [row, result] of directReceipts) {
    if (!result.complete || !result.date) continue;
    row.receiptDate = result.date;
    row.receiptDateBasis = 'khớp trực tiếp';
  }
  // Several POs can share one ticket. When all receipt quantities have dates,
  // reproduce the same PO FIFO allocation chronologically, noting that the date
  // is inferred from the ticket rather than explicitly recorded against a PO.
  const shared = new Map();
  for (const line of receiptLines) {
    if (!(Number(line.received) > 0) || !hasTicket(line.po)) continue;
    const key = `${productOf(line.model, modelCodeOf(line.color))}|${up(line.po)}`;
    const group = shared.get(key) || { lines: [], rows: [] };
    group.lines.push(line);
    shared.set(key, group);
  }
  for (const group of shared.values()) {
    const first = group.lines[0];
    const token = up(first.po);
    const productRows = byProduct.get(productOf(first.model, modelCodeOf(first.color))) || [];
    const candidates = productRows.filter((row) => hasTicket(row.ticketNumber) && up(row.ticketNumber) === token);
    if (candidates.length < 2 || new Set(candidates.map((row) => row.lotKey)).size !== 1) continue;
    if (group.lines.some((line) => {
      const matching = compatibleRows(line).filter((row) => hasTicket(row.ticketNumber) && up(row.ticketNumber) === token);
      return matching.length !== candidates.length;
    })) continue;
    const events = [];
    let complete = true;
    for (const line of group.lines) {
      if (!Number.isSafeInteger(Number(line.received))) { complete = false; break; }
      if (Array.isArray(line.receiptDates)) {
        if (line.undatedReceived || line.receiptDates.some((item) => !validDate(item.date) || !Number.isSafeInteger(item.received) || item.received <= 0)
          || line.receiptDates.reduce((sum, item) => sum + item.received, 0) !== Number(line.received)) { complete = false; break; }
        events.push(...line.receiptDates);
      } else if ((line.receipts ?? 1) === 1 && validDate(line.date)) {
        events.push({ date: line.date, received: Number(line.received) });
      } else { complete = false; break; }
    }
    const needed = candidates.reduce((sum, row) => sum + row.receivedFifo, 0);
    if (!complete || events.reduce((sum, item) => sum + item.received, 0) < needed) continue;
    events.sort((a, b) => a.date.localeCompare(b.date));
    let eventIndex = 0;
    let eventLeft = events[0]?.received || 0;
    for (const row of candidates) {
      let need = row.receivedFifo;
      while (need > 0 && eventIndex < events.length) {
        const used = Math.min(need, eventLeft);
        if (used > 0) {
          row.receiptDate = events[eventIndex].date;
          row.receiptDateBasis = 'FIFO theo phiếu';
        }
        need -= used;
        eventLeft -= used;
        if (!eventLeft) {
          eventIndex++;
          eventLeft = events[eventIndex]?.received || 0;
        }
      }
    }
  }
  // When the receipt has no matching ticket, quantities are already distributed
  // by product/season FIFO above. Apply the same order to dated receipt events.
  const pooledReceipts = new Map();
  for (const line of receiptLines) {
    if (!(Number(line.received) > 0)) continue;
    const product = productOf(line.model, modelCodeOf(line.color));
    const token = up(line.po);
    const rows = compatibleRows(line);
    // Directly matched tickets belong to the ticket path; explicit PO matches
    // can conflict with quantity FIFO and must not be guessed as a pool.
    if (token && rows.some(row => hasTicket(row.ticketNumber) && up(row.ticketNumber) === token)) continue;
    const season = resolveSeason(product, line.season);
    if (season == null) continue;
    const key = `${product}|${season}`;
    const group = pooledReceipts.get(key) || { lines: [], ambiguous: false };
    if (token && rows.some(row => up(row.po) === token)) group.ambiguous = true;
    group.lines.push(line);
    pooledReceipts.set(key, group);
  }
  for (const [key, group] of pooledReceipts) {
    if (group.ambiguous) continue;
    const targets = lots.filter(lot => `${lot.product}|${up(lot.season)}` === key && !lot.ticketFields.has('received'))
      .sort((a, b) => (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))) || String(a.firstDue || '9').localeCompare(String(b.firstDue || '9')));
    const rows = targets.flatMap(lot => lot.rows).filter(row => row.receivedFifo > 0);
    if (!rows.length || rows.some(row => row.receiptDate || !Number.isSafeInteger(row.receivedFifo))) continue;
    const events = [];
    let complete = true;
    for (const line of group.lines) {
      if (!Number.isSafeInteger(Number(line.received))) { complete = false; break; }
      if (Array.isArray(line.receiptDates)) {
        if (line.undatedReceived || line.receiptDates.some(item => !validDate(item.date) || !Number.isSafeInteger(item.received) || item.received <= 0)
          || line.receiptDates.reduce((sum, item) => sum + item.received, 0) !== Number(line.received)) { complete = false; break; }
        events.push(...line.receiptDates);
      } else if ((line.receipts ?? 1) === 1 && validDate(line.date)) {
        events.push({ date: line.date, received: Number(line.received) });
      } else { complete = false; break; }
    }
    if (!complete || events.reduce((sum, item) => sum + item.received, 0) < rows.reduce((sum, row) => sum + row.receivedFifo, 0)) continue;
    events.sort((a, b) => a.date.localeCompare(b.date));
    let index = 0, left = events[0]?.received || 0;
    for (const row of rows) {
      let needed = row.receivedFifo;
      while (needed > 0 && index < events.length) {
        const share = Math.min(needed, left);
        if (share > 0) { row.receiptDate = events[index].date; row.receiptDateBasis = 'FIFO theo mã/mùa'; }
        needed -= share;
        left -= share;
        if (!left) { index++; left = events[index]?.received || 0; }
      }
    }
  }
  for (const line of deliveryLines) {
    if (!(Number(line.delivered) > 0 || Number(line.good) > 0) || !validDate(line.actualDeliveryDate)) continue;
    const compatible = compatibleRows(line).filter((row) => !hasTicket(line.ticket) || !hasTicket(row.ticketNumber) || up(line.ticket) === up(row.ticketNumber));
    const tokens = [line.fullPo, line.po, String(line.po ?? '').replace(/-(?:OB|TB)$/i, '')].map(up).filter(Boolean);
    let candidates = [];
    for (const token of tokens) {
      candidates = compatible.filter((row) => up(row.po) === token);
      if (candidates.length) break;
    }
    if (candidates.length !== 1) continue;
    candidates[0].fileDeliveryDate = latest(candidates[0].fileDeliveryDate, line.actualDeliveryDate);
  }
}

function statusOf(item) {
  if (item.contract > 0 && item.good >= item.contract) return 'done';
  if (item.received === 0 && item.delivered === 0) return 'waiting';
  if (item.delivered < item.received) return 'printing';
  if (item.received < item.contract) return 'short-input';
  return 'printing';
}

export function finish(item, startOfToday) {
  for (const key of MEASURES) item[key] = Math.round(item[key] || 0);
  item.defects = item.printDefects + item.fabricDefects;
  item.remaining = Math.max(0, item.contract - item.good);
  item.onHand = Math.max(0, item.received - item.delivered);
  item.inputShortage = Math.max(0, item.contract - item.received);
  item.completion = item.contract > 0 ? Math.min(1, item.good / item.contract) : 0;
  item.status = statusOf(item);
  item.daysToDue = item.dueDate ? Math.round((Date.parse(`${item.dueDate}T00:00:00Z`) - startOfToday) / DAY_MS) : null;
  item.overdue = item.status !== 'done' && item.daysToDue != null && item.daysToDue < 0;
  item.atRisk = item.status === 'waiting' && item.daysToDue != null && item.daysToDue >= 0 && item.daysToDue <= 3;
  item.pinned = Boolean(item.pinned);
  return item;
}

// A row's FIFO figures continue down to its planned days, earliest day first, so a week only
// gets the part of the row planned in it. Days marked "X" carry no quantity.
function pourIntoDays(row) {
  const days = Object.entries(row.allocations || {})
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  const result = Object.fromEntries(days.map(([index]) => [index, { received: 0, delivered: 0, good: 0 }]));
  for (const field of ['received', 'delivered', 'good']) {
    let left = Math.round(row[`${field}Fifo`] || 0);
    for (const [index, quantity] of days) {
      const share = Math.min(left, Math.round(quantity));
      result[index][field] = share;
      left -= share;
    }
  }
  return result;
}

export function summarizeLots({ bookingRows = [], deliveryLines = [], receiptLines = [], today = new Date(), pinnedLots = new Set() } = {}) {
  const startOfToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const lots = buildLots(bookingRows);
  const lotsByTicket = new Map();
  for (const lot of lots) {
    if (!lot.ticket) continue;
    const matches = lotsByTicket.get(lot.ticket) || [];
    matches.push(lot);
    lotsByTicket.set(lot.ticket, matches);
  }
  const directLot = (unit) => {
    if (!unit.ticket) return null;
    const candidates = lotsByTicket.get(unit.ticket) || [];
    return candidates.find((lot) => lot.product === unit.product) || (candidates.length === 1 ? candidates[0] : null);
  };
  const resolveSeason = seasonResolver(lots);
  const lotsByProductSeason = new Map();
  for (const lot of lots) {
    const key = `${lot.product}|${up(lot.season)}`;
    lotsByProductSeason.set(key, [...(lotsByProductSeason.get(key) || []), lot]);
    const isPinned = pinnedLots.has(lot.key);
    Object.assign(lot, ZERO(), {
      pinned: isPinned,
      prints: [],
      matched: isPinned ? new Set(['ghim']) : new Set(),
      ticketFields: new Set(),
      actualDeliveryDate: null,
      pos: new Set(lot.rows.map((row) => row.po))
    });
  }

  // Warehouse units: one per product + season + ticket, reduced to the slowest print.
  const unitKey = (line, customer) => `${customerKey(customer)}|${productOf(line.model, modelCodeOf(line.color))}|${up(line.season)}|${line.ticket || ''}`;
  const deliveryUnits = groupDeliveries(deliveryLines, new Map(), { keyOf: unitKey })
    .map((group) => ({ ...itemFromDeliveries(group), ticket: group.ticket, season: group.season, product: productOf(group.model, modelCodeOf(group.color)) }));
  const pools = new Map();
  const outside = new Map();
  const poolOf = (key) => pools.get(key) || pools.set(key, { ...ZERO(), customer: null, lastReceiptDate: null, actualDeliveryDate: null, receipts: 0 }).get(key);

  for (const unit of deliveryUnits) {
    const direct = directLot(unit);
    if (direct) {
      add(direct, unit);
      if (unit.actualDeliveryDate && (!direct.actualDeliveryDate || unit.actualDeliveryDate > direct.actualDeliveryDate)) direct.actualDeliveryDate = unit.actualDeliveryDate;
      direct.prints.push(...unit.prints);
      direct.matched.add('phiếu');
      direct.ticketFields.add('delivered');
      if (!receiptLines.length) direct.ticketFields.add('received');
      continue;
    }
    const season = resolveSeason(unit.product, unit.season);
    if (season == null) {
      const extra = outside.get(unit.product) || { ...ZERO(), unit, contract: 0, poCount: 0 };
      add(extra, unit);
      extra.contract += unit.contract;
      extra.poCount += unit.poCount;
      outside.set(unit.product, extra);
      continue;
    }
    const pool = poolOf(`${unit.product}|${season}`);
    add(pool, unit);
    if (unit.actualDeliveryDate && (!pool.actualDeliveryDate || unit.actualDeliveryDate > pool.actualDeliveryDate)) pool.actualDeliveryDate = unit.actualDeliveryDate;
    pool.customer ??= unit.customer;
  }

  // Receiving log: matched by ticket, else pooled like the warehouse file. When both files
  // are loaded, received quantities come from the receiving log only.
  const receipts = receiptUnits(receiptLines);
  if (receipts.length) {
    for (const lot of lots) lot.received = 0;
    for (const pool of pools.values()) pool.received = 0;
    for (const extra of outside.values()) extra.received = 0;
  }
  for (const unit of receipts) {
    const direct = directLot(unit);
    const target = direct || (() => {
      const season = resolveSeason(unit.product, unit.season);
      return season == null ? null : poolOf(`${unit.product}|${season}`);
    })();
    if (!target) continue;
    target.received += unit.received;
    if (!deliveryLines.length) {
      target.delivered += unit.shipped;
      target.good += unit.shipped;
    }
    if (unit.lastDate && (!target.lastReceiptDate || unit.lastDate > target.lastReceiptDate)) target.lastReceiptDate = unit.lastDate;
    if (direct) {
      direct.matched.add('phiếu');
      direct.ticketFields.add('received');
      if (!deliveryLines.length) direct.ticketFields.add('delivered');
    }
  }

  // FIFO: each product's pool fills its lots in due-date order, up to the lot's contract.
  // Pinned lots lead and receive inventory before other unpinned lots.
  for (const [key, pool] of pools) {
    const targets = (lotsByProductSeason.get(key) || [])
      .slice()
      .sort((a, b) => (Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
        || String(a.firstDue || '9').localeCompare(String(b.firstDue || '9')));
    if (!targets.length) continue;
    // A lot matched by ticket in one file keeps that file's figure; goods without a ticket
    // go to the lots that file did not match. Good follows delivered.
    const fill = (field) => {
      const source = field === 'good' ? 'delivered' : field;
      const room = (lot) => Math.max(0, lot.contract - lot[field]);
      let left = pool[field];
      for (const lot of targets.filter((item) => !item.ticketFields.has(source))) {
        const share = Math.min(left, room(lot));
        lot[field] += share;
        left -= share;
        if (share > 0) lot.matched.add('FIFO');
      }
      return left;
    };
    const overflow = { received: fill('received'), delivered: fill('delivered'), good: fill('good') };
    // Defects follow the delivered quantity they belong to.
    const deliveredTotal = targets.reduce((sum, lot) => sum + lot.delivered, 0) || 1;
    for (const field of ['printDefects', 'fabricDefects', 'samples', 'fabricShort']) {
      for (const lot of targets) lot[field] += pool[field] * (lot.delivered / deliveredTotal);
    }
    for (const lot of targets) {
      if (pool.lastReceiptDate && (!lot.lastReceiptDate || pool.lastReceiptDate > lot.lastReceiptDate)) lot.lastReceiptDate = pool.lastReceiptDate;
      if (pool.actualDeliveryDate && (!lot.actualDeliveryDate || pool.actualDeliveryDate > lot.actualDeliveryDate)) lot.actualDeliveryDate = pool.actualDeliveryDate;
    }
    targets.at(-1).overflow = overflow;
  }

  // Inside each lot, PO rows are filled in their own due-date order.
  for (const lot of lots) {
    for (const field of ['received', 'delivered', 'good']) {
      let left = Math.round(lot[field] || 0);
      for (const row of lot.rows) {
        const share = Math.min(left, Math.round(Number(row.lineQuantity || 0)));
        row[`${field}Fifo`] = share;
        left -= share;
      }
    }
    for (const row of lot.rows) {
      row.remainingFifo = Math.max(0, Number(row.lineQuantity || 0) - row.goodFifo);
      row.lotKey = lot.key;
      row.dayFifo = pourIntoDays(row);
    }
  }
  assignRowDates(lots, receiptLines, deliveryLines);

  const customerNames = new Map(deliveryUnits.map((unit) => [customerKey(unit.customer), unit.customer]));
  const items = lots.map((lot) => finish({
    key: lot.key,
    product: lot.product,
    customer: customerNames.get(customerKey(lot.customer)) || lot.customer || 'Chưa rõ khách hàng',
    model: lot.ref,
    modelCode: lot.modelCode,
    color: lot.color,
    season: lot.season,
    ticket: lot.ticket,
    poCount: lot.pos.size,
    rowCount: lot.rows.length,
    contract: Math.round(lot.contract),
    contractInFile: lot.contractInFile,
    bookedQuantity: Math.round(lot.contract),
    ...Object.fromEntries(MEASURES.map((key) => [key, lot[key]])),
    prints: lot.prints,
    leadTime: lot.leadTime,
    dueDate: lot.dueDate,
    firstDue: lot.firstDue,
    lastReceiptDate: lot.lastReceiptDate || null,
    actualDeliveryDate: lot.actualDeliveryDate || null,
    pinned: Boolean(lot.pinned),
    matchedBy: [...lot.matched].join(' + ') || 'chưa có',
    sources: { booking: true, receipt: Boolean(receiptLines.length), delivery: Boolean(deliveryLines.length) },
    rows: lot.rows
  }, startOfToday));

  // Warehouse products that no booking lot claims stay visible as "ngoài booking".
  for (const [product, extra] of outside) {
    items.push(finish({
      key: `X:${product}`,
      product,
      customer: extra.unit.customer,
      model: extra.unit.model,
      modelCode: modelCodeOf(extra.unit.color),
      color: extra.unit.color,
      season: extra.unit.season,
      ticket: null,
      poCount: extra.poCount,
      rowCount: 0,
      contract: Math.round(extra.contract),
      ...Object.fromEntries(MEASURES.map((key) => [key, extra[key]])),
      prints: [],
      leadTime: null,
      dueDate: null,
      outsideBooking: true,
      matchedBy: 'ngoài booking',
      sources: { booking: false, receipt: false, delivery: true },
      rows: []
    }, startOfToday));
  }

  items.sort((a, b) => a.customer.localeCompare(b.customer, 'vi') || String(a.model).localeCompare(String(b.model), 'vi', { numeric: true }));
  return { items, ...totalsOf(items) };
}

const startOf = (today) => Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

// One batch (week) of the booking: each lot keeps only its rows planned in that week, with the
// week's quantity and the FIFO figures of those days. Defects follow the delivered share.
// `toRow` returns the row as seen in the view (e.g. its part in one week) or null to drop it.
export function restrictToRows(items, toRow, today = new Date()) {
  const restricted = [];
  for (const item of items) {
    if (item.outsideBooking) continue;
    const rows = item.rows.map(toRow).filter(Boolean);
    if (!rows.length) continue;
    const sum = (field) => rows.reduce((total, row) => total + (row[field] || 0), 0);
    const share = item.delivered ? sum('deliveredFifo') / item.delivered : 0;
    restricted.push(finish({
      ...item,
      rows,
      rowCount: rows.length,
      poCount: new Set(rows.map((row) => row.po)).size,
      contract: Math.round(sum('lineQuantity')),
      bookedQuantity: Math.round(sum('lineQuantity')),
      received: sum('receivedFifo'),
      delivered: sum('deliveredFifo'),
      good: sum('goodFifo'),
      printDefects: item.printDefects * share,
      fabricDefects: item.fabricDefects * share,
      samples: item.samples * share,
      fabricShort: item.fabricShort * share,
      dueDate: rows.map((row) => row.outputDate).filter(Boolean).sort().at(-1) || item.dueDate
    }, startOf(today)));
  }
  return restricted;
}

export function totalsOf(allItems) {
  const items = allItems.filter((item) => !item.outsideBooking);
  const totals = items.reduce((sum, item) => {
    for (const key of ['contract', 'received', 'delivered', 'good', 'defects', 'printDefects', 'fabricDefects', 'remaining', 'onHand']) sum[key] += item[key];
    sum.statusCounts[item.status] += 1;
    if (item.overdue) sum.overdue += 1;
    if (item.atRisk) sum.atRisk += 1;
    return sum;
  }, {
    contract: 0, received: 0, delivered: 0, good: 0, defects: 0, printDefects: 0, fabricDefects: 0, remaining: 0, onHand: 0,
    overdue: 0, atRisk: 0, outside: allItems.length - items.length, statusCounts: { done: 0, printing: 0, 'short-input': 0, waiting: 0 }
  });
  return { totals, customers: [...new Set(allItems.map((item) => item.customer))] };
}
