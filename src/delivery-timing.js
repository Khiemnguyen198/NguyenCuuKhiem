// The factory works Monday–Saturday. Dates are calendar days, not timestamps.
const DAY_MS = 86_400_000;

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function leadTimeDays(value) {
  const text = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').trim().toUpperCase();
  const matched = /^(\d+)\s*(?:NGAY)?$/.exec(text);
  const days = matched ? Number(matched[1]) : NaN;
  return Number.isSafeInteger(days) && days > 0 && days < Number.MAX_SAFE_INTEGER ? days : null;
}

// Start counting on the day after receipt, skip Sundays, and add one extra workday
// to every supported lead time. Unknown inputs never become a fabricated date.
export function expectedDeliveryDate(receiptDate, leadTime) {
  const date = calendarDate(receiptDate);
  const leadDays = leadTimeDays(leadTime);
  if (!date || leadDays == null) return null;
  let remaining = leadDays + 1;
  // Count the first workday explicitly, which also handles receipt on Sunday.
  date.setTime(date.getTime() + DAY_MS);
  if (date.getUTCDay() === 0) date.setTime(date.getTime() + DAY_MS);
  remaining -= 1;
  const weeks = Math.floor(remaining / 6);
  date.setTime(date.getTime() + weeks * 7 * DAY_MS);
  remaining %= 6;
  while (remaining > 0 && Number.isFinite(date.getTime())) {
    date.setTime(date.getTime() + DAY_MS);
    if (date.getUTCDay() !== 0) remaining -= 1;
  }
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) return null;
  return date.toISOString().slice(0, 10);
}

const validDate = (value) => calendarDate(value) ? value : null;

// Only use row-level dates established by the receipt / delivery matching flow.
// The warehouse file's date remains evidence distinct from the calculated forecast.
export function deliveryTiming(row, order = {}) {
  const receiptDate = validDate(row.receiptDate);
  const leadTime = row.leadTime || '';
  const expectedDate = expectedDeliveryDate(receiptDate, leadTime);
  const fileDate = validDate(row.fileDeliveryDate);
  const contractDate = validDate(row.outputDate || (row === order ? row.dueDate : null));
  const mismatched = Boolean(fileDate && expectedDate && fileDate !== expectedDate);
  const expectedLate = Boolean(expectedDate && contractDate && expectedDate > contractDate);
  const fileLate = Boolean(fileDate && contractDate && fileDate > contractDate);
  const warnings = [];
  if (!receiptDate) warnings.push('Chưa xác định ngày nhận BTP');
  else if (leadTimeDays(leadTime) == null) warnings.push('Leadtime không hợp lệ');
  else if (!expectedDate) warnings.push('Không tính được ngày giao dự kiến');
  if (receiptDate && row.receiptDateBasis === 'FIFO theo phiếu') warnings.push('Ngày nhận phân bổ FIFO theo phiếu');
  if (!fileDate) warnings.push('Chưa có ngày giao theo file');
  if (mismatched) warnings.push('Ngày file giao khác ngày dự kiến');
  if (expectedLate) warnings.push('Dự kiến trễ hạn hợp đồng');
  if (fileLate) warnings.push('Ngày file giao trễ hạn hợp đồng');
  return { receiptDate, expectedDate, fileDate, contractDate, mismatched, expectedLate, fileLate, warnings };
}
