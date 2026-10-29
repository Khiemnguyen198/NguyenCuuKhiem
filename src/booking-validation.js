const MAX_AMOUNT = Number.MAX_SAFE_INTEGER;
const DAY_MS = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const blank = (value) => value == null || (typeof value === 'string' && !value.trim());

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function calendarDate(year, month, day) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > lengths[month - 1]) throw invalid('Ngày không tồn tại trong lịch.');
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Preserve the workbook's calendar day; Excel serials are deliberately interpreted in UTC.
export function normalizeBookingDate(value) {
  if (blank(value)) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value >= 2958466) throw invalid('Ngày Excel nằm ngoài phạm vi hợp lệ.');
    return new Date(EXCEL_EPOCH + Math.floor(value) * DAY_MS).toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw invalid('Ngày không hợp lệ.');
    return calendarDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value !== 'string') throw invalid('Ngày phải là ngày Excel, dd/mm/yyyy hoặc yyyy-mm-dd.');
  const text = value.trim();
  const vietnamese = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (vietnamese) return calendarDate(Number(vietnamese[3]), Number(vietnamese[2]), Number(vietnamese[1]));
  const ymd = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(.*)$/.exec(text);
  if (ymd) {
    if (ymd[4]) {
      const time = /^[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):?(\d{2}))?$/.exec(ymd[4]);
      if (!time || Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] || 0) > 59 || Number(time[4] || 0) > 23 || Number(time[5] || 0) > 59) throw invalid('Phần thời gian của ngày không hợp lệ.');
    }
    return calendarDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  }
  throw invalid('Ngày không hợp lệ; dùng ngày Excel, dd/mm/yyyy hoặc yyyy-mm-dd.');
}

export function bookingNumber(value, name, { optional = false } = {}) {
  if (blank(value)) {
    if (optional) return null;
    throw invalid(`${name} không được để trống.`);
  }
  if (!['number', 'string'].includes(typeof value)
    || (typeof value === 'string' && !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) {
    throw invalid(`${name} phải là số không âm, không chứa dấu phân cách hàng nghìn.`);
  }
  return safeBookingTotal(Number(value), name);
}

export function safeBookingTotal(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) throw invalid(`${name} phải hữu hạn, không âm và trong phạm vi tính toán an toàn.`);
  return value;
}

// Missing identifiers stay available to the existing repair and AI-checking flow. Invalid
// quantities are rejected instead of becoming zero/null during JSON transport or SQLite save.
export function validateBookingRows(rows) {
  if (!Array.isArray(rows)) throw invalid('Dữ liệu booking phải là danh sách dòng.');
  let totalQuantity = 0;
  let totalImpressions = 0;
  const allocationTotals = new Map();
  return Array.from(rows, (row, index) => {
    try {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid('Dòng booking không hợp lệ.');
      const result = { ...row };
      result.lineQuantity = bookingNumber(row.lineQuantity, 'LINE QTY');
      result.printCount = bookingNumber(row.printCount, 'HÌNH IN');
      if ('contractQuantity' in row) result.contractQuantity = bookingNumber(row.contractQuantity, 'SLHĐ TỔNG', { optional: true });
      for (const [field, name] of [['inputDate', 'INPUT'], ['outputDate', 'OUTPUT']]) {
        if (!(field in row)) continue;
        try { result[field] = normalizeBookingDate(row[field]); }
        catch (error) { throw invalid(`${name}: ${error.message}`); }
      }
      if (row.allocations != null) {
        if (typeof row.allocations !== 'object' || Array.isArray(row.allocations)) throw invalid('Phân bổ ngày phải là một bảng giá trị.');
        result.allocations = Object.fromEntries(Object.entries(row.allocations).map(([day, value]) => {
          if (typeof value === 'number') {
            safeBookingTotal(value, `Phân bổ ngày ${day}`);
            const load = safeBookingTotal(value * result.printCount, `Lượt hình ngày ${day}`);
            allocationTotals.set(day, safeBookingTotal((allocationTotals.get(day) || 0) + load, `Tổng lượt hình ngày ${day}`));
          } else if (typeof value !== 'string') {
            throw invalid(`Phân bổ ngày ${day} phải là số hợp lệ hoặc ký hiệu văn bản.`);
          } else if (/^[+-]?(?:Infinity|NaN)$/i.test(value.trim()) || (/^[+\-.\d]/.test(value.trim()) && !Number.isFinite(Number(value)))) {
            // Genuine text markers (X, XN…) remain diagnostics rather than invented numbers.
            if (/^[+\-.\deE]+$/.test(value.trim()) || /Infinity|NaN/i.test(value)) throw invalid(`Phân bổ ngày ${day} không phải số hữu hạn.`);
          }
          return [day, value];
        }));
      }
      const impressions = safeBookingTotal(result.lineQuantity * result.printCount, 'Lượt hình của dòng');
      totalQuantity = safeBookingTotal(totalQuantity + result.lineQuantity, 'Tổng LINE QTY');
      totalImpressions = safeBookingTotal(totalImpressions + impressions, 'Tổng lượt hình');
      return result;
    } catch (error) {
      const where = row?.sheetName ? `Sheet "${row.sheetName}", dòng Excel ${row.sheetRow ?? index + 1}` : `Dòng booking ${index + 1}`;
      error.message = `${where}: ${error.message}`;
      error.rowIndex = index;
      throw error;
    }
  });
}
