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

const BOOKING_COLUMNS = [
  ['LINE', (row) => row.line, 7], ['CUS', (row) => row.customer, 14], ['BRAND', (row) => row.brand, 14],
  ['REF', (row) => row.ref, 10], ['COLOR', (row) => row.color, 32], ['PO', (row) => row.po, 14], ['SS', (row) => row.season, 7],
  ['LINE QTY', (row) => row.bookedLineQuantity ?? row.lineQuantity, 9], ['INPUT', (row) => viDate(row.inputDate), 11],
  ['OUTPUT', (row) => viDate(row.outputDate), 11], ['MODEL CODE', (row) => row.modelCode, 11], ['SỐ PHIẾU', (row) => row.ticketNumber, 9],
  ['SLHĐ TỔNG', (row) => row.contractQuantity ?? '', 10], ['KẾ HOẠCH', (row) => row.planner, 10], ['HÌNH IN', (row) => row.printCount, 8],
  ['Leadtime', (row) => row.leadTime, 9]
];
const PROGRESS_COLUMNS = [
  ['SL trong đợt', (row) => row.lineQuantity, 10],
  ['Đã nhận BTP (mã)', (row, item) => item?.received ?? '', 12], ['Giao đạt (mã)', (row, item) => item?.good ?? '', 11],
  ['Còn thiếu (mã)', (row, item) => item?.remaining ?? '', 11], ['Trạng thái mã', (row, item) => (item ? STATUS_COPY[item.status].label : 'Chưa nhận BTP'), 13],
  ['Hạn còn (ngày)', (row, item) => item?.daysToDue ?? '', 10]
];
const LABELS = ['PXC CHUYỂN', 'PXI TRẢ', 'TỔNG TUẦN', 'TỔNG NGÀY'];

// Same layout as the customer's TH sheet: booking columns, then the daily plan with
// PXC / PXI / TỔNG TUẦN / TỔNG NGÀY rows above the data. Progress columns sit before the plan.
function bookingSheet({ booking, summary }) {
  const { rows = [], days = [] } = booking;
  const itemsByProduct = new Map();
  for (const item of summary.items) {
    if (!itemsByProduct.has(item.product) || item.contract > itemsByProduct.get(item.product).contract) itemsByProduct.set(item.product, item);
  }
  const progress = booking.batch ? PROGRESS_COLUMNS : PROGRESS_COLUMNS.slice(1);
  const fixed = [...BOOKING_COLUMNS, ...progress];
  const load = dailyLoad(rows, days);
  // TỔNG TUẦN sits on the first day of each Monday-based week, as in the original sheet.
  const weekTotals = days.map(() => '');
  let weekStart = -1;
  let currentWeek = null;
  days.forEach((day, index) => {
    const monday = new Date(`${day.date}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    if (key !== currentWeek) {
      currentWeek = key;
      weekStart = index;
      weekTotals[index] = 0;
    }
    weekTotals[weekStart] += load[index];
  });
  const blank = fixed.map(() => '');
  const shortDay = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
  const sheetRows = [
    [...fixed.map(([title]) => title), LABELS[0], ...days.map((day) => shortDay(day.date))],
    [...blank, LABELS[1], ...days.map((day) => shortDay(day.returnDate))],
    [...blank, LABELS[2], ...weekTotals.map((value) => (value === '' ? '' : Math.round(value)))],
    [...blank, LABELS[3], ...load.map((value) => Math.round(value))]
  ];
  for (const row of rows) {
    const item = itemsByProduct.get(productKey(row.ref, row.color));
    sheetRows.push([...fixed.map(([, read]) => read(row, item)), '', ...days.map((day, index) => row.allocations?.[index] ?? '')]);
  }
  if (!rows.length) sheetRows.push(['Chưa có dữ liệu booking chi tiết. Nhập lại file booking để có sheet này.']);
  return sheetFrom(sheetRows, [...fixed.map(([, , width]) => width), 13, ...days.map(() => 7)]);
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
  XLSX.utils.book_append_sheet(workbook, overviewSheet({ summary, dashboard, sources, generatedAt }), 'TỔNG QUAN');
  XLSX.utils.book_append_sheet(workbook, bookingSheet({ booking, summary }), 'BOOKING');
  XLSX.utils.book_append_sheet(workbook, modelSheet(summary.items), 'THEO MÃ HÀNG');
  XLSX.utils.book_append_sheet(workbook, customerSheet(summary.items), 'THEO KHÁCH HÀNG');
  XLSX.utils.book_append_sheet(workbook, warningSheet(summary.items, aiReport), 'CẢNH BÁO');
  XLSX.utils.book_append_sheet(workbook, changeSheet(change), 'THAY ĐỔI BOOKING');
  return workbook;
}

export function downloadWorkbook(workbook, filename) {
  XLSX.writeFile(workbook, filename, { compression: true });
}
