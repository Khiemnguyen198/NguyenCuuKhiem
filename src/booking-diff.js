// Scavi keeps editing the same booking workbook, so each import is compared row by row
// with the previous one to show the reviewer exactly what was added, removed or edited.
export const TRACKED_FIELDS = [
  ['lineQuantity', 'Số lượng'],
  ['inputDate', 'Ngày nhận (INPUT)'],
  ['outputDate', 'Hạn giao (OUTPUT)'],
  ['leadTime', 'Leadtime'],
  ['printCount', 'Số hình in'],
  ['contractQuantity', 'SLHĐ tổng'],
  ['ticketNumber', 'Số phiếu']
];

const KEPT_FIELDS = ['line', 'customer', 'brand', 'po', 'ref', 'color', 'season', 'modelCode', 'planner', 'allocations', ...TRACKED_FIELDS.map(([field]) => field)];
const MAX_LISTED = 500;

const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('vi-VN');
const comparable = (value) => (value == null || value === '' ? '' : String(value).trim());

// Only the fields the comparison needs are kept, to fit browser storage.
export function compactRows(rows) {
  return rows.map((row) => Object.fromEntries(KEPT_FIELDS.map((field) => [field, row[field] ?? null])));
}

// The same PO can repeat for one product; the occurrence number keeps those rows apart.
function keyRows(rows) {
  const seen = new Map();
  return rows.map((row) => {
    const base = [row.po, row.ref, row.color].map(normalize).join('|');
    const occurrence = (seen.get(base) || 0) + 1;
    seen.set(base, occurrence);
    return [`${base}#${occurrence}`, row];
  });
}

// Allocations are stored by day position; compare them by date so new day columns don't
// make every row look edited.
function allocationText(row, days) {
  if (!days?.length) return '';
  const byDate = {};
  for (const [index, value] of Object.entries(row.allocations || {})) {
    const date = days[index]?.date;
    if (!date) continue;
    byDate[date] = typeof value === 'number' && typeof byDate[date] === 'number' ? byDate[date] + value : value;
  }
  return Object.keys(byDate).sort()
    .map((date) => `${date.slice(8, 10)}/${date.slice(5, 7)}: ${typeof byDate[date] === 'number' ? Math.round(byDate[date]) : byDate[date]}`)
    .join('; ');
}

export function diffBookingRows(previousRows = [], currentRows = [], { previousDays = null, currentDays = null } = {}) {
  const previous = new Map(keyRows(previousRows));
  const current = new Map(keyRows(currentRows));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, row] of current) {
    const before = previous.get(key);
    if (!before) {
      added.push(row);
      continue;
    }
    const changes = TRACKED_FIELDS
      .filter(([field]) => comparable(before[field]) !== comparable(row[field]))
      .map(([field, label]) => ({ field, label, before: before[field] ?? null, after: row[field] ?? null }));
    // Only compared when both imports carry their day plan.
    if (previousDays?.length && currentDays?.length) {
      const before = allocationText(previous.get(key), previousDays);
      const after = allocationText(row, currentDays);
      if (before !== after) changes.push({ field: 'allocations', label: 'Phân bổ ngày', before: before || null, after: after || null });
    }
    if (changes.length) changed.push({ row, changes });
  }
  for (const [key, row] of previous) {
    if (!current.has(key)) removed.push(row);
  }

  const quantity = (rows) => rows.reduce((sum, row) => sum + Number(row.lineQuantity || 0), 0);
  const quantityDelta = quantity(currentRows) - quantity(previousRows);
  return {
    hasChanges: Boolean(added.length || removed.length || changed.length),
    counts: { added: added.length, removed: removed.length, changed: changed.length },
    quantityDelta,
    addedQuantity: quantity(added),
    removedQuantity: quantity(removed),
    added: added.slice(0, MAX_LISTED),
    removed: removed.slice(0, MAX_LISTED),
    changed: changed.slice(0, MAX_LISTED),
    truncated: added.length > MAX_LISTED || removed.length > MAX_LISTED || changed.length > MAX_LISTED
  };
}
