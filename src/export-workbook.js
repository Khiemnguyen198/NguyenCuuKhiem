import * as XLSX from 'xlsx';
import { STATUS_COPY, colorName } from './models-view.js';
import { dailyLoad } from './booking-import.js';

const pad = (value) => String(value).padStart(2, '0');

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
// Appended after the daily plan so columns A onward stay exactly as in TH. Row figures come
// from the FIFO allocation of each lot down to its PO rows; lot figures repeat on each row.
const PROGRESS_COLUMNS = [
  // COLOR in TH mixes the model code and the color name; split for Excel filters.
  ['Model', (row) => row.modelCode, 9],
  ['Màu', (row) => colorName(row.color), 26],
  ['SL trong đợt', (row) => numberCell(row.lineQuantity), 10, true],
  ['Nhận BTP', (row) => numberCell(row.receivedFifo ?? 0), 10],
  ['Đã in (giao)', (row) => numberCell(row.deliveredFifo ?? 0), 10],
  ['Còn thiếu', (row) => numberCell(row.remainingFifo ?? (row.bookedLineQuantity ?? row.lineQuantity)), 10],
  ['SLHĐ tổng (lô)', (row, lot) => numberCell(lot?.contract ?? ''), 11],
  ['Lỗi (lô)', (row, lot) => numberCell(lot?.defects ?? 0), 8],
  ['Trạng thái lô', (row, lot) => (lot ? STATUS_COPY[lot.status].label : 'Chưa nhận BTP'), 13],
  ['Hạn còn (ngày)', (row, lot) => lot?.daysToDue ?? '', 9],
  ['Nối bằng', (row, lot) => lot?.matchedBy ?? '', 11]
];

const isSunday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;

// The customer's TH layout: header on row 1 and again on row 5, PXI TRẢ / TỔNG TUẦN /
// TỔNG NGÀY on rows 2–4 under the PXC CHUYỂN label, data from row 6. TỔNG TUẦN is the
// Monday–Saturday sum, merged across those days.
function thSheet({ booking, lots }) {
  const { rows = [], days = [] } = booking;
  const lotsByKey = new Map(lots.map((lot) => [lot.key, lot]));
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
    const lot = lotsByKey.get(row.lotKey);
    table.push([
      ...TH_COLUMNS.map(([, read]) => read(row)),
      null,
      ...days.map((day, index) => {
        const value = row.allocations?.[index];
        return value == null ? null : numberCell(value, '#,##0');
      }),
      ...progress.map(([, read]) => read(row, lot))
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

// The export is one sheet in the customer's TH layout; planners take it from there.
export function buildExportWorkbook({ booking, lots = [] }) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, thSheet({ booking, lots }), 'TH');
  return workbook;
}

export function downloadWorkbook(workbook, filename) {
  XLSX.writeFile(workbook, filename, { compression: true });
}
