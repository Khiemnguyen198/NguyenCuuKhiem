import * as XLSX from 'xlsx';
import { STATUS_COPY, colorName } from './models-view.js';
import { dailyLoad } from './booking-import.js';
import { ISSUE_GROUPS, sheetIssueList } from './check-view.js';
import { deliveryTiming } from './delivery-timing.js';
import { confirmedReceiptDate } from './lots.js';

const pad = (value) => String(value).padStart(2, '0');

// Most urgent first: overdue, then nearest due date, then largest remaining quantity.
export function sortByUrgency(items) {
  return [...items].sort((a, b) => (b.overdue - a.overdue)
    || ((a.daysToDue ?? Infinity) - (b.daysToDue ?? Infinity))
    || (b.remaining - a.remaining));
}

export function exportFilename(now = new Date(), batch = null) {
  const ddmm = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;
  // One picked day of the week, or the whole week.
  const week = !batch ? '' : batch.range ? `_TU_${batch.from.replaceAll('-', '')}_DEN_${batch.to.replaceAll('-', '')}` : batch.from === batch.to ? `_NGAY_${ddmm(batch.from)}` : `_TUAN_${ddmm(batch.from)}-${ddmm(batch.to)}`;
  return `TONG_HOP_GIAO_HANG${week}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const serial = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? (Date.parse(`${iso}T00:00:00Z`) - EXCEL_EPOCH) / 86_400_000 : null);
const dateCell = (iso, format) => {
  const value = serial(iso);
  return value == null ? null : { t: 'n', v: value, z: format };
};
const numberCell = (value, format = '#,##0.##') => (typeof value === 'number' && Number.isFinite(value) ? { t: 'n', v: value, z: format } : value ?? null);

// Columns A–P of the customer's TH sheet, in the same order and spelling.
const TH_COLUMNS = [
  ['LINE', (row) => row.line, 6], ['CUS', (row) => row.customer, 13], ['BRAND', (row) => row.brand, 14],
  ['REF', (row) => row.ref, 9], ['COLOR', (row) => row.color, 30], ['PO', (row) => row.po, 13], ['SS', (row) => row.season, 6],
  ['LINE QTY', (row) => numberCell(row.bookedLineQuantity ?? row.lineQuantity), 9],
  [' INPUT ', (row) => dateCell(row.inputDate, 'd-mmm'), 8], [' OUTPUT ', (row) => dateCell(row.bookingOutputDate ?? row.outputDate, 'd-mmm'), 8],
  [' MODEL CODE ', (row) => row.modelCode, 10], [' SỐ PHIẾU ', (row) => row.ticketNumber, 9],
  // SLHĐ TỔNG is the lot's total LINE QTY (same SỐ PHIẾU, or LINE + REF + COLOR + INPUT).
  [' SLHĐ TỔNG ', (row, lot) => numberCell(lot?.contract ?? row.contractQuantity ?? 0), 10], ['KẾ HOẠCH', (row) => row.planner, 9],
  ['HÌNH IN', (row) => numberCell(row.printCount, '0'), 7], ['Leadtime', (row) => row.leadTime, 8]
];
// Appended after the daily plan so columns A onward stay exactly as in TH. Row figures come
// from the FIFO allocation of each lot down to its PO rows; lot figures repeat on each row.
const PROGRESS_COLUMNS = [
  // COLOR in TH mixes the model code and the color name; split for Excel filters.
  ['Model', (row) => row.modelCode, 9],
  ['Màu', (row) => colorName(row.color), 26],
  ['SL trong tuần', (row) => numberCell(row.lineQuantity), 10, true],
  ['Nhận BTP', (row) => numberCell(row.receivedFifo ?? 0), 10],
  ['Ngày nhận BTP (booking)', (row) => dateCell(row.inputDate, 'dd/mm/yyyy'), 18],
  ['Ngày giao BTP (booking)', (row) => dateCell(row.bookingOutputDate ?? row.outputDate, 'dd/mm/yyyy'), 18],
  ['Ngày nhận BTP thực tế', (row) => dateCell(row.receiptDate, 'dd/mm/yyyy'), 18],
  ['Ngày giao BTP thực tế', (row) => dateCell(row.fileDeliveryDate, 'dd/mm/yyyy'), 18],
  ['Nguồn ngày nhận BTP', (row) => [row.receiptDateBasis || (row.receivedFifo > 0 ? 'Chưa xác định' : ''), row.receiptDate && row.inputDate && row.receiptDate < row.inputDate ? 'Ngày nhận trước INPUT: cần kiểm tra' : ''].filter(Boolean).join(' · '), 35],
  ['Đã in (giao)', (row) => numberCell(row.deliveredFifo ?? 0), 10],
  ['Còn thiếu', (row) => numberCell(row.remainingFifo ?? (row.bookedLineQuantity ?? row.lineQuantity)), 10],
  ['SLHĐ tổng (lô)', (row, lot) => numberCell(lot?.contract ?? ''), 11],
  ['Lỗi (lô)', (row, lot) => numberCell(lot?.defects ?? 0), 8],
  ['Trạng thái lô', (row, lot) => (lot ? STATUS_COPY[lot.status].label : 'Chưa nhận BTP'), 13],
  ['Hạn còn (ngày)', (row, lot) => lot?.daysToDue ?? '', 9],
  ['Nối bằng', (row, lot) => lot?.matchedBy ?? '', 11]
];

const addYear = (iso) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
const daysBetween = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
const cellAddress = (row, column) => XLSX.utils.encode_cell({ r: row, c: column });

const isSunday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;

// The customer's TH layout: header on row 1 and again on row 5, PXI TRẢ / TỔNG TUẦN /
// TỔNG NGÀY on rows 2–4 under the PXC CHUYỂN label, data from row 6. TỔNG TUẦN is the
// Monday–Saturday sum, merged across those days.
// TH in the customer's layout: header on rows 1 and 5, PXI TRẢ / TỔNG TUẦN / TỔNG NGÀY on rows
// 2–4 under the PXC CHUYỂN label, data from row 6. Totals are computed here, not copied; a PXI
// date typed with the wrong year is corrected with a comment holding the old value.
function thSheet({ booking, lots, sheetCheck }) {
  const { rows = [], days = [] } = booking;
  const pxiIssues = new Map((sheetCheck?.cells?.issues || []).filter((issue) => issue.type === 'return_before_pickup').map((issue) => [issue.date, issue]));
  const comments = [];
  const lotsByKey = new Map(lots.map((lot) => [lot.key, lot]));
  const progress = PROGRESS_COLUMNS.filter((column) => booking.batch || !column[3])
    .map((column) => booking.batch?.range && column[0] === 'SL trong tuần' ? ['SL trong khoảng', ...column.slice(1)] : column);
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
  days.forEach((day, index) => {
    const issue = pxiIssues.get(day.date);
    if (!issue) return;
    // Usually a year typed wrong (02/01/2026 for 02/01/2027): fix only when that lands just after PXC.
    const candidate = addYear(day.returnDate);
    const gap = daysBetween(day.date, candidate);
    if (gap < 0 || gap > 14) return;
    table[1][firstDay + index] = dateCell(candidate, 'dd/mm');
    comments.push([1, firstDay + index, `Đã sửa: file booking ghi ${issue.value} (sai năm)`]);
  });
  let previousLeadTime = null;
  for (const row of rows) {
    // TH leaves one empty row between lead-time groups.
    if (previousLeadTime != null && row.leadTime !== previousLeadTime) table.push([]);
    previousLeadTime = row.leadTime;
    const lot = lotsByKey.get(row.lotKey);
    const cells = TH_COLUMNS.map(([, read]) => read(row, lot));
    table.push([
      ...cells,
      null,
      ...days.map((day, index) => {
        const value = row.allocations?.[index];
        return value == null ? null : numberCell(value, '#,##0.##');
      }),
      ...progress.map(([, read]) => read(row, lot))
    ]);
  }
  if (!rows.length) table.push(['Chưa có dữ liệu booking chi tiết. Nhập lại file booking để có sheet này.']);
  const sheet = XLSX.utils.aoa_to_sheet(table);
  const endRow = Math.max(6, table.length);
  const col = XLSX.utils.encode_col;
  days.forEach((day, index) => {
    const c = col(firstDay + index);
    sheet[`${c}4`] = { t: 'n', v: load[index], z: '#,##0.##', f: `SUMPRODUCT(SUBTOTAL(109,OFFSET(${c}6,ROW(${c}6:${c}${endRow})-ROW(${c}6),0,1)),$O$6:$O$${endRow})` };
  });
  for (const span of merges) {
    sheet[cellAddress(2, firstDay + span.start)] = { t: 'n', v: span.total, z: '#,##0.##', f: `SUM(${col(firstDay + span.start)}4:${col(firstDay + span.end)}4)` };
  }
  sheet['!merges'] = merges
    .filter((span) => span.end > span.start)
    .map((span) => ({ s: { r: 2, c: firstDay + span.start }, e: { r: 2, c: firstDay + span.end } }));
  sheet['!cols'] = [...TH_COLUMNS.map(([, , width]) => ({ wch: width })), { wch: 12 }, ...days.map(() => ({ wch: 7 })), ...progress.map(([, , width]) => ({ wch: width }))];
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: table.length - 1, c: progressStart + progress.length - 1 } }) };
  for (const [row, column, textValue] of comments) {
    const address = cellAddress(row, column);
    sheet[address] ??= { t: 'z' };
    sheet[address].c = [{ a: 'Kế hoạch', t: textValue }];
    sheet[address].c.hidden = true;
  }
  return sheet;
}

const viDay = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

function isoWeek(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((date - firstThursday) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

// CAN DOI, as the planners build it from TH: one row per lot (REF · MODEL CODE · Mùa ·
// SLHĐ TỔNG · HÌNH IN · Leadtime), the week's quantity per day, and the receiving / printing /
// delivery figures — filled here from the receiving and warehouse files instead of by hand.
const CAN_DOI_COLUMNS = [
  ['', 18], ['REF', 10], ['MODEL CODE', 11], ['Mùa', 7], ['SLHĐ TỔNG', 10], ['HÌNH IN', 8], [' Leadtime ', 9],
  ['W', 9], ['Ngày nhận', 10], ['Thực Nhận', 10], ['Đã In', 10], ['Đã Giao', 10], ['GAP', 10]
];

function canDoiSheet({ booking, lots }) {
  const { rows = [] } = booking;
  // Monday–Saturday like the planners' sheet; a Sunday column stays only if something is planned on it.
  const kept = (booking.days || [])
    .map((day, index) => ({ day, index }))
    .filter(({ day, index }) => !isSunday(day.date) || rows.some((row) => typeof row.allocations?.[index] === 'number'));
  const days = kept.map(({ day }) => day);
  const lotsByKey = new Map(lots.map((lot) => [lot.key, lot]));
  const thRows = new Map();
  let thIndex = 6;
  let previousLead = null;
  for (const row of rows) {
    if (previousLead != null && previousLead !== row.leadTime) thIndex++;
    previousLead = row.leadTime;
    thRows.set(row, thIndex++);
  }
  const groups = new Map();
  for (const row of rows) {
    const key = [row.lotKey, row.printCount, row.leadTime].join('|');
    const group = groups.get(key) || { row, lot: lotsByKey.get(row.lotKey), days: days.map(() => 0), rows: [], received: 0, delivered: 0, good: 0 };
    kept.forEach(({ index }, position) => {
      const value = row.allocations?.[index];
      if (typeof value === 'number') group.days[position] += value;
    });
    group.rows.push(row);
    group.received += row.receivedFifo || 0;
    group.delivered += row.deliveredFifo || 0;
    group.good += row.goodFifo || 0;
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => String(a.row.ref).localeCompare(String(b.row.ref), 'vi', { numeric: true })
    || String(a.row.modelCode).localeCompare(String(b.row.modelCode), 'vi', { numeric: true })
    || String(a.row.season).localeCompare(String(b.row.season)));

  const first = 4;
  const last = Math.max(first, first + ordered.length - 1);
  const firstDay = CAN_DOI_COLUMNS.length;
  const letter = (column) => XLSX.utils.encode_col(column);
  const formulaCell = (formula, value, format = '#,##0.##') => ({ t: 'n', v: value, f: formula, z: format });
  const weekLabel = booking.batch?.range ? 'Khoảng ngày' : days.length ? `W${isoWeek(days[0].date)}` : 'W';
  const header = [...CAN_DOI_COLUMNS.map(([title]) => (title === 'W' ? weekLabel : title)), ...days.map((day) => `Sum of ${viDay(day.date).slice(0, 5)}`)];
  const sum = (field) => ordered.reduce((total, group) => total + group[field], 0);
  const column = (name) => CAN_DOI_COLUMNS.findIndex(([title]) => title === name);
  const totalsRow = Array(header.length).fill(null);
  for (const name of ['W', 'Thực Nhận', 'Đã In', 'Đã Giao', 'GAP']) {
    const index = column(name);
    const value = name === 'W' ? ordered.reduce((total, group) => total + group.days.reduce((a, b) => a + b, 0), 0) : name === 'GAP' ? sum('good') - ordered.reduce((total, group) => total + group.days.reduce((a, b) => a + b, 0), 0) : sum({ 'Thực Nhận': 'received', 'Đã In': 'delivered', 'Đã Giao': 'good' }[name]);
    totalsRow[index] = formulaCell(`SUBTOTAL(109,${letter(index)}${first + 1}:${letter(index)}${last + 1})`, value);
  }
  days.forEach((day, index) => {
    const dayColumn = letter(firstDay + index);
    const load = ordered.reduce((total, group) => total + group.days[index] * (Number(group.row.printCount) || 0), 0);
    totalsRow[firstDay + index] = formulaCell(`SUMPRODUCT(SUBTOTAL(109,OFFSET(${dayColumn}${first + 1},ROW(${dayColumn}${first + 1}:${dayColumn}${last + 1})-ROW(${dayColumn}${first + 1}),0,1)),$F$${first + 1}:$F$${last + 1})`, load);
  });

  const table = [[], [], totalsRow, header];
  ordered.forEach((group, offset) => {
    const excelRow = first + offset + 1;
    const weekTotal = group.days.reduce((a, b) => a + b, 0);
    const contract = group.lot?.contract ?? group.row.contractQuantity ?? 0;
    table.push([
      `${group.row.ref}${group.row.modelCode}${contract}`,
      group.row.ref, group.row.modelCode, group.row.season, numberCell(contract), formulaCell(`'TH'!O${thRows.get(group.row)}`, Number(group.row.printCount) || 0, '0'), group.row.leadTime,
      formulaCell(`SUM(${letter(firstDay)}${excelRow}:${letter(firstDay + Math.max(days.length, 1) - 1)}${excelRow})`, weekTotal),
      dateCell(confirmedReceiptDate(group.rows), 'dd/mm'),
      numberCell(Math.round(group.received)), numberCell(Math.round(group.delivered)), numberCell(Math.round(group.good)),
      formulaCell(`L${excelRow}-H${excelRow}`, group.good - weekTotal),
      ...group.days.map((value, index) => formulaCell(`SUM(${group.rows.map(row => `'TH'!${letter(17 + kept[index].index)}${thRows.get(row)}`).join(',')})`, value))
    ]);
  });
  if (!ordered.length) table.push(['Không có lô nào trong tuần đã chọn.']);
  const sheet = XLSX.utils.aoa_to_sheet(table);
  // Keep the planner's used range starting with totals on row 3. Newer
  // SheetJS versions include the leading empty arrays in aoa_to_sheet's range.
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: table.length - 1, c: header.length - 1 } });
  sheet['!cols'] = [...CAN_DOI_COLUMNS.map(([, wch]) => ({ wch })), ...days.map(() => ({ wch: 11 }))];
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 1 }, e: { r: Math.max(3, table.length - 1), c: header.length - 1 } }) };
  return sheet;
}

const ISSUE_COLUMNS = [
  ['STT', 5], ['Mức độ', 9], ['Loại lỗi', 26], ['Ô (sheet TH)', 12], ['LINE', 6], ['CUS', 12], ['PO', 14], ['SỐ PHIẾU', 9],
  ['REF', 10], ['COLOR', 30], ['LINE QTY', 9], ['INPUT', 11], ['OUTPUT', 11], ['Giá trị trong file', 22],
  ['Đúng ra / đề xuất', 22], ['Khi xuất file', 16], ['Lý do chi tiết', 90], ['Đề xuất', 45], ['Cách kiểm tra', 45]
];

// Every problem of the booking file for the planner to work through: a summary by kind, then
// one row per problem with the full row context, values, reasoning and where to look.
export function buildIssuesWorkbook(sheetCheck, filename = '') {
  const issues = sheetIssueList(sheetCheck);
  const groups = Object.entries(ISSUE_GROUPS).map(([type, info]) => ({ info, items: issues.filter((item) => item.type === type) })).filter((group) => group.items.length);
  const severity = { danger: 'Cao', warning: 'Trung bình', info: 'Thấp' };
  const rows = [
    [`LỖI DỮ LIỆU SHEET TH — ${filename}`],
    [`${issues.length} lỗi · ${groups.filter((group) => group.info.autoFix).reduce((total, group) => total + group.items.length, 0)} được sửa khi xuất · còn lại cần người kế hoạch kiểm tra`],
    [],
    ['Loại lỗi', 'Số lỗi', 'Khi xuất file'],
    ...groups.map(({ info, items }) => [info.title, items.length, info.autoFix ? 'Tự sửa' : 'Cần kiểm tra']),
    [],
    ISSUE_COLUMNS.map(([name]) => name)
  ];
  const headerRow = rows.length - 1;
  groups.flatMap(({ info, items }) => items.map((item) => ({ item, info }))).forEach(({ item, info }, index) => {
    rows.push([
      index + 1, severity[info.severity] || '', info.title, item.cell, item.line || '', item.customer || '', item.po || '',
      item.ticket && item.ticket !== '0' ? item.ticket : '', item.ref || '', item.color || '', item.quantity || '',
      viDay(item.input), viDay(item.output), item.value ?? '', item.expected ?? '', info.autoFix ? 'Tự sửa' : 'Cần kiểm tra',
      item.reason || '', item.suggestion || '', item.howToCheck || ''
    ]);
  });
  if (!issues.length) rows.push(['Không có lỗi nào.']);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = ISSUE_COLUMNS.map(([, wch]) => ({ wch }));
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: Math.max(headerRow, rows.length - 1), c: ISSUE_COLUMNS.length - 1 } }) };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'LỖI FILE BOOKING');
  return workbook;
}

const DELIVERY_PLAN_COLUMNS = [
  ['MÃ HÀNG', 14], ['MÀU', 26], ['PO', 15], ['SS', 8], ['SLHĐ', 10], ['SLHĐ TỔNG', 12],
  ['SL BTP NHẬN', 13], ['LEADTIME', 10], ['NGÀY NHẬN BTP (BOOKING)', 20], ['NGÀY GIAO BTP (BOOKING)', 20],
  ['NGÀY NHẬN BTP THỰC TẾ', 20], ['NGÀY GIAO BTP THỰC TẾ', 20], ['NGÀY GIAO DỰ KIẾN', 20], ['CẢNH BÁO', 48]
];
const actualDateStyle = { fill: { fgColor: { rgb: 'FFF2CC' } }, font: { bold: true, color: { rgb: '7F6000' } } };
const lateDateStyle = { fill: { fgColor: { rgb: 'F4CCCC' } }, font: { bold: true, color: { rgb: '9C0006' } } };

function deliveryPlanSheet({ booking, lots = [] }) {
  const rows = booking.rows || [];
  const lotsByKey = new Map(lots.map((lot) => [lot.key, lot]));
  const ordered = rows.map((row, index) => ({ row, index, lot: lotsByKey.get(row.lotKey) }))
    .sort((a, b) => String(a.row.outputDate || '9999-99-99').localeCompare(String(b.row.outputDate || '9999-99-99'))
      || String(a.row.leadTime || '').localeCompare(String(b.row.leadTime || ''), 'vi', { numeric: true })
      || String(a.row.ref || '').localeCompare(String(b.row.ref || ''), 'vi', { numeric: true })
      || String(a.row.po || '').localeCompare(String(b.row.po || ''), 'vi', { numeric: true }));
  const table = [DELIVERY_PLAN_COLUMNS.map(([title]) => title)];
  ordered.forEach(({ row, lot }) => {
    const timing = deliveryTiming(row, lot);
    const warning = timing.warnings.join(' · ') || 'Không có cảnh báo';
    table.push([
      row.ref || '', colorName(row.color) || row.color || '', row.po || '', row.season || '',
      numberCell(row.lineQuantity), numberCell(lot?.contract ?? row.contractQuantity ?? 0),
      numberCell(row.receivedFifo ?? 0), row.leadTime || '', dateCell(timing.bookingReceiptDate, 'dd/mm/yyyy'),
      dateCell(timing.contractDate, 'dd/mm/yyyy'), dateCell(timing.receiptDate, 'dd/mm/yyyy'), dateCell(timing.fileDate, 'dd/mm/yyyy'),
      dateCell(timing.expectedDate, 'dd/mm/yyyy'), warning
    ]);
  });
  if (!ordered.length) table.push(['Không có dữ liệu booking trong phạm vi đã chọn.']);
  const sheet = XLSX.utils.aoa_to_sheet(table);
  sheet['!cols'] = DELIVERY_PLAN_COLUMNS.map(([, wch]) => ({ wch }));
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, table.length - 1), c: DELIVERY_PLAN_COLUMNS.length - 1 } }) };
  ordered.forEach(({ row, lot }, index) => {
    const timing = deliveryTiming(row, lot);
    const fileAddress = cellAddress(index + 1, 11);
    const expectedAddress = cellAddress(index + 1, 12);
    if (sheet[expectedAddress]) sheet[expectedAddress].s = timing.expectedLate ? lateDateStyle : actualDateStyle;
    if (sheet[fileAddress]) sheet[fileAddress].s = timing.fileLate ? lateDateStyle : actualDateStyle;
  });
  return sheet;
}

// The export is what the planners hand over: the new delivery-plan sheet plus the legacy sheets.
export function buildExportWorkbook({ booking, lots = [], sheetCheck = null }) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, deliveryPlanSheet({ booking, lots }), 'KE HOACH GIAO HANG');
  XLSX.utils.book_append_sheet(workbook, thSheet({ booking, lots, sheetCheck }), 'TH');
  XLSX.utils.book_append_sheet(workbook, canDoiSheet({ booking, lots }), 'CAN DOI');
  return workbook;
}

export async function downloadWorkbook(workbook, filename) {
  const { serializeWorkbook } = await import('./excel-presentation.js');
  const bytes = await serializeWorkbook(workbook);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
