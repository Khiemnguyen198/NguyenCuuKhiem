// Forecasts use calendar days, including Sundays.
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

// Actual delivery date plus leadtime and one calendar day.
export function expectedDeliveryDate(fileDeliveryDate, leadTime) {
  const date = calendarDate(fileDeliveryDate);
  const leadDays = leadTimeDays(leadTime);
  if (!date || leadDays == null) return null;
  date.setTime(date.getTime() + (leadDays + 1) * DAY_MS);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) return null;
  return date.toISOString().slice(0, 10);
}

const validDate = (value) => calendarDate(value) ? value : null;

// Only use row-level dates established by the receipt / delivery matching flow.
// The warehouse file's date remains evidence distinct from the calculated forecast.
export function deliveryTiming(row, order = {}) {
  const receiptDate = validDate(row.receiptDate);
  const leadTime = row.leadTime || '';
  const fileDate = validDate(row.fileDeliveryDate);
  const expectedDate = expectedDeliveryDate(fileDate, leadTime);
  const bookingReceiptDate = validDate(row.inputDate);
  const contractDate = validDate(row.bookingOutputDate ?? row.outputDate ?? (row === order ? row.dueDate : null));
  const expectedLate = Boolean(expectedDate && contractDate && expectedDate > contractDate);
  const fileLate = Boolean(fileDate && contractDate && fileDate > contractDate);
  const warnings = [];
  if (!receiptDate) warnings.push('Chưa xác định ngày nhận BTP');
  if (leadTimeDays(leadTime) == null) warnings.push('Leadtime không hợp lệ');
  else if (fileDate && !expectedDate) warnings.push('Không tính được ngày giao dự kiến');
  if (receiptDate && validDate(row.inputDate) && receiptDate < row.inputDate) warnings.push('Ngày nhận trước INPUT booking: cần kiểm tra');
  if (!fileDate) warnings.push('Chưa có ngày giao theo file');
  else if (row.fileDeliveryDateBasis === 'Ngày xuất file nhận') warnings.push('Ngày giao từ cột NGÀY XUẤT file nhận');
  if (expectedLate) warnings.push('Dự kiến trễ hạn hợp đồng');
  if (fileLate) warnings.push('Ngày file giao trễ hạn hợp đồng');
  return { bookingReceiptDate, receiptDate, expectedDate, fileDate, contractDate, expectedLate, fileLate, warnings };
}
