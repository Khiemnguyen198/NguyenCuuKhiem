import * as XLSX from 'xlsx';
import { bookingHeaders, findHeaderRow, label, readDayColumns, toIsoDate } from './booking-import.js';

// Cell-level check of the data planners type into the booking's TH sheet (dates, PO, quantities,
// day plan). Totals the sheet computes itself (SLHĐ TỔNG, TỔNG NGÀY…) are not compared: the
// export recomputes them. Every problem points at a cell and carries what a planner needs to
// verify it by hand: the row, the value found, the value expected, the reasoning and where to look.
//   autoFix: the export corrects it (see export-workbook.js); otherwise it needs review.
export const ISSUE_TYPES = {
  return_before_pickup: { title: 'PXI TRẢ sớm hơn PXC', severity: 'warning', autoFix: true },
  plan_mismatch: { title: 'Phân bổ ngày khác LINE QTY', severity: 'warning', autoFix: false },
  output_before_input: { title: 'OUTPUT sớm hơn INPUT', severity: 'danger', autoFix: false },
  output_sunday: { title: 'OUTPUT rơi vào Chủ Nhật', severity: 'warning', autoFix: false },
  missing_po: { title: 'Thiếu PO', severity: 'danger', autoFix: false },
  bad_quantity: { title: 'LINE QTY không hợp lệ', severity: 'danger', autoFix: false },
  bad_print_count: { title: 'HÌNH IN không hợp lệ', severity: 'warning', autoFix: false },
  bad_lead_time: { title: 'Leadtime không chuẩn', severity: 'warning', autoFix: false },
  duplicate_row: { title: 'Dòng trùng', severity: 'warning', autoFix: false }
};

const MAX_ISSUES = 3000;
const LISTED_DAYS = 12;
const LEAD_TIMES = new Set(['1 NGÀY', '2 NGÀY', '3 NGÀY', '5 NGÀY']);
const WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const DAY_MS = 86_400_000;
const text = (value) => String(value ?? '').trim();
const isIso = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
const viDate = (iso) => (isIso(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const weekday = (iso) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
const shiftDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const isSunday = (iso) => isIso(iso) && new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;
const round = (value) => Math.round(value * 100) / 100;
const number = (value) => new Intl.NumberFormat('vi-VN').format(round(Number(value) || 0));

export function checkBookingSheet(workbook, sheetName = 'TH') {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { sheet: sheetName, checked: false, issues: [] };
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true });
  const headerIndex = findHeaderRow(table, 4);
  const headers = bookingHeaders(table[headerIndex]).map(label);
  const at = (name) => headers.indexOf(name);
  const columns = {
    line: at('LINE'), customer: at('CUS'), ref: at('REF'), color: at('COLOR'), po: at('PO'), quantity: at('LINE QTY'),
    input: at('INPUT'), output: at('OUTPUT'), ticket: at('SỐ PHIẾU'),
    printCount: at('HÌNH IN'), leadTime: at('LEADTIME')
  };
  const letter = (column) => XLSX.utils.encode_col(column);
  const cellName = (row, column) => `${letter(column)}${row + 1}`;
  const issues = [];
  const add = (type, row, column, fields) => {
    if (issues.length >= MAX_ISSUES) return;
    const cell = column >= 0 ? cellName(row, column) : `dòng ${row + 1}`;
    issues.push({
      type, sheet: sheetName, cell, row: row + 1,
      howToCheck: `Mở sheet ${sheetName}, ${column >= 0 ? `ô ${cell}` : `dòng ${row + 1}`}.`,
      ...fields
    });
  };

  // Data rows, as the booking formula sees them.
  const rows = [];
  table.slice(headerIndex + 1).forEach((cells, offset) => {
    const value = (column) => (column >= 0 ? cells[column] : null);
    if (value(columns.line) == null || value(columns.line) === '' || label(value(columns.line)) === 'LINE') return;
    rows.push({
      index: headerIndex + 1 + offset,
      cells,
      line: text(value(columns.line)), customer: text(value(columns.customer)), ref: text(value(columns.ref)),
      color: text(value(columns.color)), po: text(value(columns.po)), quantity: value(columns.quantity),
      input: toIsoDate(value(columns.input)), output: toIsoDate(value(columns.output)), ticket: text(value(columns.ticket)),
      printCount: value(columns.printCount), leadTime: text(value(columns.leadTime))
    });
  });
  // The whole row, so the planner can recognise it without opening the file.
  const context = (row) => ({
    po: row.po, ref: row.ref, color: row.color, line: row.line, customer: row.customer, ticket: row.ticket,
    quantity: Number(row.quantity) || 0, input: row.input, output: row.output, leadTime: row.leadTime,
    printCount: Number(row.printCount) || 0
  });

  const days = readDayColumns(table);
  const seen = new Map();
  for (const row of rows) {
    const quantity = Number(row.quantity);
    const printCount = Number(row.printCount);
    const where = context(row);

    if (!row.po) {
      add('missing_po', row.index, columns.po, { ...where, value: '', reason: `Dòng LINE ${row.line}, REF ${row.ref} không có PO nên không đối chiếu được với file nhận / giao.`, suggestion: 'Điền PO theo đơn của khách.' });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      add('bad_quantity', row.index, columns.quantity, { ...where, value: text(row.quantity) || 'trống', reason: 'LINE QTY phải là số lớn hơn 0; dòng này không được tính vào số lượng booking.', suggestion: 'Nhập lại số lượng của PO.' });
    }
    if (columns.printCount >= 0 && (!Number.isFinite(printCount) || printCount <= 0)) {
      add('bad_print_count', row.index, columns.printCount, { ...where, value: text(row.printCount) || 'trống', reason: 'HÌNH IN phải là số lớn hơn 0; TỔNG NGÀY (lượt hình) của các ngày có dòng này sẽ thiếu.', suggestion: 'Nhập số hình in của mã.' });
    }
    if (columns.leadTime >= 0 && !LEAD_TIMES.has(row.leadTime.toUpperCase())) {
      add('bad_lead_time', row.index, columns.leadTime, { ...where, value: row.leadTime || 'trống', expected: '1 / 2 / 3 / 5 ngày', reason: 'Leadtime phải là 1, 2, 3 hoặc 5 ngày như tên các sheet LEADTIME.', suggestion: 'Kiểm tra dòng này thuộc sheet LEADTIME nào.' });
    }
    if (row.input && row.output && row.output < row.input) {
      add('output_before_input', row.index, columns.output, {
        ...where, value: viDate(row.output), expected: `sau ${viDate(row.input)}`,
        reason: `OUTPUT ${viDate(row.output)} sớm hơn INPUT ${viDate(row.input)} ${daysBetween(row.output, row.input)} ngày — hàng phải giao trước khi nhận.`,
        suggestion: 'Kiểm tra lại INPUT / OUTPUT với khách (thường do gõ nhầm tháng hoặc năm).'
      });
    }
    if (isSunday(row.output)) {
      add('output_sunday', row.index, columns.output, {
        ...where, value: `${viDate(row.output)} (Chủ Nhật)`, expected: 'Thứ Hai – Thứ Bảy',
        reason: `OUTPUT ${viDate(row.output)} là Chủ Nhật; nhà máy làm Thứ Hai – Thứ Bảy.`,
        suggestion: `Giao Thứ Bảy ${viDate(shiftDays(row.output, -1))} hoặc xác nhận với khách dời sang Thứ Hai ${viDate(shiftDays(row.output, 1))}.`
      });
    }
    // The day plan of a row should add up to its LINE QTY; days marked "X" carry no quantity.
    const planned = days.filter((day) => typeof row.cells[day.column] === 'number' && row.cells[day.column] !== 0);
    if (planned.length && Number.isFinite(quantity) && quantity > 0) {
      const total = round(planned.reduce((sum, day) => sum + row.cells[day.column], 0));
      if (Math.abs(total - quantity) > 0.5) {
        const parts = planned.slice(0, LISTED_DAYS).map((day) => `${letter(day.column)} ${viDate(day.date).slice(0, 5)}: ${number(row.cells[day.column])}`);
        if (planned.length > LISTED_DAYS) parts.push(`… ${planned.length - LISTED_DAYS} ngày nữa`);
        add('plan_mismatch', row.index, columns.quantity, {
          ...where, value: `phân bổ ${number(total)}`, expected: number(quantity),
          reason: `Tổng phân bổ theo ngày: ${parts.join(' + ')}${planned.length > 1 ? ` = ${number(total)}` : ''}; LINE QTY ${number(quantity)} — ${total < quantity ? `còn thiếu ${number(quantity - total)} chưa xếp ngày` : `xếp thừa ${number(total - quantity)}`}.`,
          suggestion: total < quantity ? 'Xếp thêm ngày cho phần còn thiếu hoặc sửa LINE QTY.' : 'Bớt số đã xếp hoặc kiểm tra LINE QTY.',
          howToCheck: `Mở sheet ${sheetName}, dòng ${row.index + 1}: so cột LINE QTY (${letter(columns.quantity)}) với các ô ngày ${planned.slice(0, 4).map((day) => letter(day.column)).join(', ')}${planned.length > 4 ? ', …' : ''}.`
        });
      }
    }
    const duplicateKey = [row.line, row.po, row.ref, row.color, row.quantity, row.input, row.output, row.ticket, row.printCount].map((item) => text(item).toUpperCase()).join('|');
    if (seen.has(duplicateKey)) {
      const first = seen.get(duplicateKey);
      add('duplicate_row', row.index, -1, {
        ...where, value: `LINE QTY ${number(row.quantity)}`, expected: `chỉ giữ dòng ${first + 1}`,
        reason: `Giống hệt dòng ${first + 1}: cùng LINE, PO, REF, COLOR, LINE QTY, INPUT, OUTPUT, SỐ PHIẾU, HÌNH IN — số lượng có thể bị tính hai lần.`,
        suggestion: 'Xoá một dòng nếu là nhập trùng, hoặc ghi chú nếu là hai đơn thật.',
        howToCheck: `Mở sheet ${sheetName}, so dòng ${first + 1} với dòng ${row.index + 1}.`
      });
    } else {
      seen.set(duplicateKey, row.index);
    }
  }

  // Daily plan header: PXI TRẢ (return) must not come before PXC (pick-up).
  for (const day of days) {
    if (day.returnRow != null && day.returnDate && day.returnDate < day.date) {
      const nextYear = `${Number(day.returnDate.slice(0, 4)) + 1}${day.returnDate.slice(4)}`;
      const gap = daysBetween(day.date, nextYear);
      add('return_before_pickup', day.returnRow, day.column, {
        date: day.date, value: viDate(day.returnDate), expected: gap >= 0 && gap <= 14 ? viDate(nextYear) : `sau ${viDate(day.date)}`,
        reason: `PXC (chuyển) ${weekday(day.date)} ${viDate(day.date)} nhưng PXI (trả) ${viDate(day.returnDate)} — sớm hơn ${daysBetween(day.returnDate, day.date)} ngày.${gap >= 0 && gap <= 14 ? ` Nếu là năm ${nextYear.slice(0, 4)} thì PXI = ${weekday(nextYear)} ${viDate(nextYear)}, sau PXC ${gap} ngày — hợp lý, có thể gõ nhầm năm.` : ''}`,
        suggestion: gap >= 0 && gap <= 14 ? `Sửa thành ${viDate(nextYear)}.` : 'Kiểm tra lại ngày PXI của cột này.',
        howToCheck: `Mở sheet ${sheetName}, ô ${cellName(day.returnRow, day.column)} (PXI TRẢ), so với ô ${cellName(day.pickupRow, day.column)} (PXC CHUYỂN).`
      });
    }
  }

  const counts = issues.reduce((map, issue) => ({ ...map, [issue.type]: (map[issue.type] || 0) + 1 }), {});
  return { sheet: sheetName, checked: true, issues, counts, rowCount: rows.length, truncated: issues.length >= MAX_ISSUES };
}
