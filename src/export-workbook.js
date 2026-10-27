import * as XLSX from 'xlsx';
import { STATUS_COPY } from './models-view.js';
import { leadtimeProgress } from './progress-view.js';
import { dailyLoad } from './booking-import.js';
import { productKey } from './keys.js';

const pad = (value) => String(value).padStart(2, '0');
const viDate = (iso) => {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
};
const viDateTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const ratio = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

function sheetFrom(rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  return sheet;
}

// Most urgent first: overdue, then nearest due date, then largest remaining quantity.
export function sortByUrgency(items) {
  return [...items].sort((a, b) => (b.overdue - a.overdue)
    || ((a.daysToDue ?? Infinity) - (b.daysToDue ?? Infinity))
    || (b.remaining - a.remaining));
}

export function exportFilename(now = new Date(), batch = null) {
  const week = batch ? `_DOT_${batch.from.slice(8, 10)}${batch.from.slice(5, 7)}-${batch.to.slice(8, 10)}${batch.to.slice(5, 7)}` : '';
  return `TONG_HOP_GIAO_HANG${week}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const serial = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? (Date.parse(`${iso}T00:00:00Z`) - EXCEL_EPOCH) / 86_400_000 : null);
const dateCell = (iso, format) => {
  const value = serial(iso);
  return value == null ? null : { t: 'n', v: value, z: format };
};
const numberCell = (value, format = '#,##0') => (typeof value === 'number' && Number.isFinite(value) ? { t: 'n', v: value, z: format } : value ?? null);

// Columns A–P of the customer's TH sheet, in the same order and spelling.
const TH_COLUMNS = [
  ['LINE', (row) => row.line, 6], ['CUS', (row) => row.customer, 13], ['BRAND', (row) => row.brand, 14],
  ['REF', (row) => row.ref, 9], ['COLOR', (row) => row.color, 30], ['PO', (row) => row.po, 13], ['SS', (row) => row.season, 6],
  ['LINE QTY', (row) => numberCell(row.bookedLineQuantity ?? row.lineQuantity), 9],
  [' INPUT ', (row) => dateCell(row.inputDate, 'd-mmm'), 8], [' OUTPUT ', (row) => dateCell(row.outputDate, 'd-mmm'), 8],
  [' MODEL CODE ', (row) => row.modelCode, 10], [' SỐ PHIẾU ', (row) => row.ticketNumber, 9],
  [' SLHĐ TỔNG ', (row) => numberCell(row.contractQuantity ?? 0), 10], ['KẾ HOẠCH', (row) => row.planner, 9],
  ['HÌNH IN', (row) => numberCell(row.printCount, '0'), 7], ['Leadtime', (row) => row.leadTime, 8]
];
// Appended after the daily plan so columns A onward stay exactly as in TH.
const PROGRESS_COLUMNS = [
  ['SL trong đợt', (row) => numberCell(row.lineQuantity), 10, true],
  ['Đã nhận BTP (mã)', (row, item) => numberCell(item?.received ?? 0), 11],
  ['Đã in (mã)', (row, item) => numberCell(item?.delivered ?? 0), 10],
  ['Giao đạt (mã)', (row, item) => numberCell(item?.good ?? 0), 10],
  ['Lỗi (mã)', (row, item) => numberCell(item?.defects ?? 0), 8],
  ['Còn thiếu (mã)', (row, item) => numberCell(item?.remaining ?? row.lineQuantity), 10],
  ['Trạng thái mã', (row, item) => (item ? STATUS_COPY[item.status].label : 'Chưa nhận BTP'), 13],
  ['Hạn còn (ngày)', (row, item) => item?.daysToDue ?? '', 9]
];

const isSunday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;

// The customer's TH layout: header on row 1 and again on row 5, PXI TRẢ / TỔNG TUẦN /
// TỔNG NGÀY on rows 2–4 under the PXC CHUYỂN label, data from row 6. TỔNG TUẦN is the
// Monday–Saturday sum, merged across those days.
function thSheet({ booking, summary }) {
  const { rows = [], days = [] } = booking;
  const itemsByProduct = new Map();
  for (const item of summary.items) {
    if (!itemsByProduct.has(item.product) || item.contract > itemsByProduct.get(item.product).contract) itemsByProduct.set(item.product, item);
  }
  const progress = PROGRESS_COLUMNS.filter((column) => booking.batch || !column[3]);
  const labelColumn = TH_COLUMNS.length;
  const firstDay = labelColumn + 1;
  const progressStart = firstDay + days.length;
  const load = dailyLoad(rows, days);
  const header = [...TH_COLUMNS.map(([title]) => title), ' PXC CHUYỂN ', ...days.map((day) => dateCell(day.date, 'dd/mm')), ...progress.map(([title]) => title)];
  const table = [
    header,
    [...TH_COLUMNS.map(() => null), ' PXI TRẢ ', ...days.map((day) => dateCell(day.returnDate, 'dd/mm'))],
    [...TH_COLUMNS.map(() => null), ' TỔNG TUẦN ', ...days.map(() => null)],
    [...TH_COLUMNS.map(() => null), ' TỔNG NGÀY ', ...load.map((value) => numberCell(value))],
    header
  ];
  const merges = [];
  let week = null;
  days.forEach((day, index) => {
    const monday = new Date(`${day.date}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    if (isSunday(day.date)) return;
    if (!week || week.key !== key) {
      week = { key, start: index, end: index, total: 0 };
      merges.push(week);
    }
    week.end = index;
    week.total += load[index];
  });
  for (const span of merges) table[2][firstDay + span.start] = numberCell(span.total);
  let previousLeadTime = null;
  for (const row of rows) {
    // TH leaves one empty row between lead-time groups.
    if (previousLeadTime != null && row.leadTime !== previousLeadTime) table.push([]);
    previousLeadTime = row.leadTime;
    const item = itemsByProduct.get(productKey(row.ref, row.color));
    table.push([
      ...TH_COLUMNS.map(([, read]) => read(row)),
      null,
      ...days.map((day, index) => {
        const value = row.allocations?.[index];
        return value == null ? null : numberCell(value, '#,##0');
      }),
      ...progress.map(([, read]) => read(row, item))
    ]);
  }
  if (!rows.length) table.push(['Chưa có dữ liệu booking chi tiết. Nhập lại file booking để có sheet này.']);
  const sheet = XLSX.utils.aoa_to_sheet(table);
  sheet['!merges'] = merges
    .filter((span) => span.end > span.start)
    .map((span) => ({ s: { r: 2, c: firstDay + span.start }, e: { r: 2, c: firstDay + span.end } }));
  sheet['!cols'] = [...TH_COLUMNS.map(([, , width]) => ({ wch: width })), { wch: 12 }, ...days.map(() => ({ wch: 7 })), ...progress.map(([, , width]) => ({ wch: width }))];
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: table.length - 1, c: progressStart + progress.length - 1 } }) };
  return sheet;
}

function overviewSheet({ summary, dashboard, sources, generatedAt }) {
  const { totals } = summary;
  const rows = [
    ['TỔNG HỢP GIAO BÁN THÀNH PHẨM'],
    ['Thời điểm xuất', viDateTime(generatedAt)],
    ['Phạm vi', dashboard.batch ? `${dashboard.batch.label} (chỉ các dòng booking phân bổ trong đợt)` : 'Toàn bộ booking'],
    [],
    ['NGUỒN DỮ LIỆU', 'File', 'Cập nhật'],
    ...sources.map((source) => [source.title, source.filename || 'Chưa nhập', viDateTime(source.importedAt)]),
    [],
    ['CHỈ SỐ', 'Giá trị', 'Ghi chú'],
    ['Số mã hàng', summary.items.length, `${summary.customers.length} khách hàng`],
    ['Số lượng hợp đồng', totals.contract],
    ['Đã nhận BTP', totals.received, `${ratio(totals.received, totals.contract)}% hợp đồng`],
    ['Đã in (đã giao)', totals.delivered, `Tồn tại xưởng ${totals.onHand}`],
    ['Giao đạt', totals.good, `${ratio(totals.good, totals.contract)}% hợp đồng`],
    ['Lỗi (hỏng in + lỗi vải)', totals.defects, `${ratio(totals.defects, totals.delivered)}% số đã in · hỏng in ${totals.printDefects} · lỗi vải ${totals.fabricDefects}`],
    ['Còn phải giao', totals.remaining],
    ['Mã đã giao đủ', totals.statusCounts.done],
    ['Mã đang in', totals.statusCounts.printing],
    ['Mã thiếu BTP', totals.statusCounts['short-input']],
    ['Mã chưa nhận BTP', totals.statusCounts.waiting],
    ['Mã trễ hạn', totals.overdue],
    ['Mã tới hạn ≤ 3 ngày chưa nhận BTP', totals.atRisk],
    [],
    [`THEO LEADTIME BOOKING · ${dashboard.filename || ''}`],
    ['Leadtime', 'Khách hàng', 'Số mã', 'Số hợp đồng (PO)', 'Tổng đơn hàng', 'Số dòng', 'Ngày nhận (INPUT)', 'Hạn giao (OUTPUT)', 'Đã nhận BTP', 'Giao đạt', 'Mã giao đủ', 'Mã đang làm', 'Mã chưa nhận', 'Mã trễ hạn']
  ];
  for (const group of leadtimeProgress(dashboard, summary)) {
    rows.push([
      group.leadTime,
      (group.customers || []).map((customer) => customer.name).join(', '),
      group.modelCount ?? '', group.poCount ?? '', group.totalQuantity, group.rowCount,
      [viDate(group.firstInput), viDate(group.lastInput)].filter(Boolean).join(' – '),
      [viDate(group.firstOutput), viDate(group.lastOutput)].filter(Boolean).join(' – '),
      group.progress?.received ?? '', group.progress?.good ?? '',
      group.progress?.done ?? '', group.progress?.active ?? '', group.progress?.waiting ?? '', group.progress?.overdue ?? ''
    ]);
  }
  return sheetFrom(rows, [34, 40, 14, 16, 14, 10, 18, 18, 14, 12, 11, 12, 12, 11]);
}

function modelSheet(items) {
  const rows = [[
    'Khách hàng', 'Mã hàng', 'Màu', 'Mùa', 'Số PO', 'Leadtime', 'Hạn giao', 'Còn (ngày)', 'SL hợp đồng', 'SL booking',
    'Đã nhận BTP', 'Nhận gần nhất', 'Đã in (giao)', 'Hỏng in', 'Lỗi vải', 'Giao đạt', 'Còn thiếu', 'Tồn tại xưởng',
    'Thiếu BTP', '% hoàn thành', 'Trạng thái', 'Trễ hạn', 'Nguồn'
  ]];
  for (const item of sortByUrgency(items)) {
    rows.push([
      item.customer, item.model, item.color, item.season || '', item.poCount, item.leadTime || '', viDate(item.dueDate),
      item.daysToDue ?? '', item.contract, item.bookedQuantity ?? '', item.received, viDate(item.lastReceiptDate),
      item.delivered, item.printDefects, item.fabricDefects, item.good, item.remaining, item.onHand, item.inputShortage,
      Math.round(item.completion * 1000) / 10, STATUS_COPY[item.status].label, item.overdue ? 'Trễ hạn' : '',
      [item.sources.booking && 'booking', item.sources.receipt && 'nhận', item.sources.delivery && 'giao'].filter(Boolean).join(', ')
    ]);
  }
  return sheetFrom(rows, [22, 12, 34, 10, 7, 9, 11, 9, 12, 11, 11, 12, 12, 9, 9, 11, 11, 12, 10, 11, 14, 9, 18]);
}

function customerSheet(items) {
  const byCustomer = new Map();
  for (const item of items) {
    const row = byCustomer.get(item.customer) || { models: 0, done: 0, contract: 0, received: 0, delivered: 0, good: 0, defects: 0, remaining: 0, overdue: 0 };
    row.models += 1;
    if (item.status === 'done') row.done += 1;
    if (item.overdue) row.overdue += 1;
    for (const key of ['contract', 'received', 'delivered', 'good', 'defects', 'remaining']) row[key] += item[key];
    byCustomer.set(item.customer, row);
  }
  const rows = [['Khách hàng', 'Số mã', 'Mã giao đủ', 'SL hợp đồng', 'Đã nhận BTP', 'Đã in (giao)', 'Giao đạt', 'Lỗi', 'Còn phải giao', '% hoàn thành', 'Mã trễ hạn']];
  [...byCustomer.entries()].sort((a, b) => b[1].contract - a[1].contract).forEach(([name, row]) => {
    rows.push([name, row.models, row.done, row.contract, row.received, row.delivered, row.good, row.defects, row.remaining, ratio(row.good, row.contract), row.overdue]);
  });
  return sheetFrom(rows, [24, 8, 11, 13, 13, 13, 12, 9, 14, 12, 11]);
}

function warningSheet(items, aiReport) {
  const rows = [['Nhóm', 'Mức độ', 'Nội dung', 'Khách hàng', 'Mã hàng', 'Màu / PO', 'Số lượng', 'Hạn giao', 'Ghi chú']];
  for (const item of sortByUrgency(items.filter((entry) => entry.overdue))) {
    rows.push(['Tiến độ', 'Cao', 'Trễ hạn chưa giao đủ', item.customer, item.model, item.color, item.remaining, viDate(item.dueDate), `Trễ ${-item.daysToDue} ngày`]);
  }
  for (const item of sortByUrgency(items.filter((entry) => entry.atRisk))) {
    rows.push(['Tiến độ', 'Trung bình', 'Tới hạn ≤ 3 ngày chưa nhận BTP', item.customer, item.model, item.color, item.contract, viDate(item.dueDate), `Còn ${item.daysToDue} ngày`]);
  }
  for (const item of items.filter((entry) => entry.status === 'short-input')) {
    rows.push(['Tiến độ', 'Trung bình', 'Nhận BTP ít hơn hợp đồng', item.customer, item.model, item.color, item.inputShortage, viDate(item.dueDate), '']);
  }
  const severity = { danger: 'Cao', warning: 'Trung bình', info: 'Thấp' };
  for (const finding of aiReport?.findings || []) {
    rows.push(['File booking', severity[finding.severity] || '', `${finding.title} (${finding.count} dòng)`, '', '', '', '', '', finding.description]);
    for (const sample of finding.samples || []) {
      rows.push(['', '', '', '', sample.ref || '', `PO ${sample.po}`, sample.quantity ?? '', '', sample.note || `dòng ${sample.row}`]);
    }
  }
  if (rows.length === 1) rows.push(['', '', 'Không có cảnh báo']);
  return sheetFrom(rows, [12, 11, 36, 20, 12, 34, 10, 11, 40]);
}

function changeSheet(change) {
  const rows = [['Loại', 'PO', 'Khách hàng', 'Mã hàng', 'Màu', 'Leadtime', 'Nội dung', 'Trước', 'Sau']];
  if (!change) {
    rows.push(['', '', '', '', '', '', 'Không có thay đổi so với bản booking trước']);
    return sheetFrom(rows, [10, 14, 14, 12, 34, 9, 20, 14, 14]);
  }
  rows.unshift([`So sánh ${change.filename} với bản trước ${change.previousFilename || ''} · ${change.reviewedAt ? `đã kiểm tra ${viDateTime(change.reviewedAt)}` : 'chưa kiểm tra'}`]);
  const base = (row) => [row.po, row.customer, row.ref, row.color, row.leadTime];
  for (const { row, changes } of change.report.changed) {
    for (const field of changes) rows.push(['Sửa', ...base(row), field.label, field.before ?? '', field.after ?? '']);
  }
  for (const row of change.report.added) rows.push(['Thêm', ...base(row), 'Số lượng', '', row.lineQuantity]);
  for (const row of change.report.removed) rows.push(['Xóa', ...base(row), 'Số lượng', row.lineQuantity, '']);
  return sheetFrom(rows, [10, 14, 14, 12, 34, 9, 20, 14, 14]);
}

export function buildExportWorkbook({ summary, dashboard, booking = dashboard, sources, aiReport = null, change = null, generatedAt = new Date() }) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, thSheet({ booking, summary }), 'TH');
  XLSX.utils.book_append_sheet(workbook, overviewSheet({ summary, dashboard, sources, generatedAt }), 'TỔNG QUAN');
  XLSX.utils.book_append_sheet(workbook, modelSheet(summary.items), 'THEO MÃ HÀNG');
  XLSX.utils.book_append_sheet(workbook, customerSheet(summary.items), 'THEO KHÁCH HÀNG');
  XLSX.utils.book_append_sheet(workbook, warningSheet(summary.items, aiReport), 'CẢNH BÁO');
  XLSX.utils.book_append_sheet(workbook, changeSheet(change), 'THAY ĐỔI BOOKING');
  return workbook;
}

export function downloadWorkbook(workbook, filename) {
  XLSX.writeFile(workbook, filename, { compression: true });
}
