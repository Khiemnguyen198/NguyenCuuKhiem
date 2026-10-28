import { escapeHtml, formatNumber } from './format.js';
import { STATUS_COPY, colorName, customerLogo } from './models-view.js';
import { attentionOf } from './plan-results.js';

// Booking calendar on Tổng quan: one week of PXC days as columns, one line per order (lot).
// The days an order is planned on are marked as one region; clicking it opens the order.
const WEEKDAYS = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const DAY_MS = 86_400_000;
const number = (value) => formatNumber.format(Math.round(value || 0));
const shortDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const isoAdd = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const quantityOf = (value) => (typeof value === 'number' ? value : 0);

export const CALENDAR_FILTERS = [
  ['all', 'Tất cả'],
  ['open', 'Chưa giao đủ'],
  ['overdue', 'Trễ hạn'],
  ['done', 'Đã giao đủ']
];

// Monday → Sunday of the week, with the booking's day index of each date that has one.
export function weekColumns(week, days = []) {
  const indexByDate = new Map(week.dayIndexes.map((index) => [days[index]?.date, index]));
  return Array.from({ length: 7 }, (_, offset) => {
    const date = isoAdd(week.key, offset);
    return { date, index: indexByDate.get(date) ?? null, weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()], sunday: offset === 6 };
  });
}

// Each order of the week with its quantity per column and the span of its planned days.
export function calendarOrders(items, columns) {
  const position = new Map(columns.flatMap((column, offset) => (column.index == null ? [] : [[String(column.index), offset]])));
  return items.filter((item) => !item.outsideBooking).map((item) => {
    const cells = Array(7).fill(0);
    for (const row of item.rows) {
      for (const [index, value] of Object.entries(row.allocations || {})) {
        if (position.has(index)) cells[position.get(index)] += quantityOf(value);
      }
    }
    const planned = cells.map((value, column) => (value > 0 ? column : null)).filter((column) => column != null);
    const due = columns.findIndex((column) => column.date === item.dueDate);
    const start = planned[0] ?? null;
    // The region runs from the first planned day to the due date when that falls later in the week.
    const end = planned.length ? Math.max(planned.at(-1), due) : null;
    return { item, cells, start, end, due: due >= 0 ? due : null, quantity: cells.reduce((sum, value) => sum + value, 0) };
  }).filter((order) => order.start != null)
    .sort((a, b) => a.start - b.start || String(a.item.dueDate || '9').localeCompare(String(b.item.dueDate || '9')) || b.quantity - a.quantity);
}

export function filterCalendar(orders, { status = 'all', query = '' } = {}) {
  const text = query.trim().toLocaleLowerCase('vi-VN');
  return orders.filter(({ item }) => {
    if (status === 'open' && item.status === 'done') return false;
    if (status === 'done' && item.status !== 'done') return false;
    if (status === 'overdue' && !item.overdue) return false;
    if (!text) return true;
    return [item.customer, item.model, item.modelCode, item.color, item.season, item.ticket, ...item.rows.map((row) => row.po)]
      .some((value) => String(value ?? '').toLocaleLowerCase('vi-VN').includes(text));
  });
}

const tone = (item) => (item.overdue ? 'late' : item.status);

export function renderCalendar({ columns, orders, shownOrders, selectedDate = null, today = null }) {
  const totals = columns.map((_, column) => orders.reduce((sum, order) => sum + order.cells[column], 0));
  const counts = columns.map((_, column) => orders.filter((order) => order.cells[column] > 0).length);
  const head = columns.map((column, position) => `
    <div class="cal-day${column.sunday ? ' cal-day--sunday' : ''}${column.date === today ? ' cal-day--today' : ''}${column.date === selectedDate ? ' cal-day--selected' : ''}${column.index == null ? ' cal-day--off' : ''}">
      <span>${column.weekday}${column.date === today ? ' · hôm nay' : ''}</span><strong>${shortDate(column.date)}</strong>
      <small>${counts[position] ? `${number(counts[position])} đơn · ${number(totals[position])}` : 'Không có đơn'}</small>
    </div>`).join('');
  // Day columns behind each line, so Sunday, today and the picked day read down the calendar.
  const backdrop = columns.map((column, position) => `<span class="cal-cell${column.sunday ? ' cal-cell--sunday' : ''}${column.date === today ? ' cal-cell--today' : ''}${column.date === selectedDate ? ' cal-cell--selected' : ''}" style="grid-column:${position + 2}"></span>`).join('');
  const rows = shownOrders.map(({ item, cells, start, end, due }) => {
    const segments = cells.slice(start, end + 1).map((value, offset) => {
      const column = start + offset;
      return `<span class="cal-seg${value ? '' : ' cal-seg--gap'}">${value ? number(value) : column === due ? '' : '·'}${column === due ? `<i class="ph-fill ph-flag-pennant" title="Hạn giao"></i>${value ? '' : '<em>Hạn</em>'}` : ''}</span>`;
    }).join('');
    const dueMarker = due != null && (due < start || due > end)
      ? `<span class="cal-due" style="grid-column:${due + 2}" title="Hạn giao ${shortDate(item.dueDate)}"><i class="ph-fill ph-flag-pennant"></i>Hạn</span>`
      : '';
    return `<div class="cal-row">${backdrop}
      <button type="button" class="cal-label" data-order="${escapeHtml(item.key)}">${customerLogo(item.customer)}<span><strong>${escapeHtml(item.model || '—')}</strong><small>${escapeHtml(item.modelCode || '')} · ${escapeHtml(colorName(item.color) || '')}</small></span></button>
      <button type="button" class="cal-bar cal-bar--${tone(item)}" style="grid-column:${start + 2} / ${end + 3}" data-order="${escapeHtml(item.key)}" title="${escapeHtml(`${item.model} · ${STATUS_COPY[item.status].label} · hạn ${shortDate(item.dueDate)}`)}">${segments}</button>
      ${dueMarker}
    </div>`;
  }).join('');
  return `<div class="cal-scroll"><div class="cal-grid">
    <div class="cal-head"><div class="cal-corner">Đơn (mã hàng · model · màu)</div>${head}</div>
    ${rows || '<div class="cal-empty">Không có đơn nào khớp bộ lọc trong tuần này.</div>'}
  </div></div>`;
}

export function renderLegend() {
  return [['waiting', 'Chưa nhận BTP'], ['short-input', 'Thiếu BTP'], ['printing', 'Đang in'], ['done', 'Đã giao đủ'], ['late', 'Trễ hạn']]
    .map(([key, label]) => `<span class="cal-legend cal-legend--${key}">${label}</span>`).join('') + '<span class="cal-legend-flag"><i class="ph-fill ph-flag-pennant"></i>Hạn giao</span>';
}

// The order behind a calendar region: the whole lot, its share in this week, and every PO row
// with all its planned days.
export function renderOrderDetail({ lot, weekItem, days = [], weekLabel = '' }) {
  const item = weekItem || lot;
  // The status pill already says "Chưa nhận BTP"; do not repeat it.
  const notes = attentionOf(item).filter((note) => note.label !== STATUS_COPY[item.status].label);
  const stat = (label, value, extra = '') => `<div><span>${label}</span><strong>${value}</strong>${extra ? `<small>${extra}</small>` : ''}</div>`;
  const dayList = (row) => Object.entries(row.allocations || {})
    .filter(([, value]) => value !== null && value !== '' && value !== 0)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([index, value]) => `<span class="order-day${weekItem?.rows.some((weekRow) => weekRow.po === row.po && String(index) in (weekRow.allocations || {})) ? ' order-day--week' : ''}">${shortDate(days[index]?.date)}: ${typeof value === 'number' ? number(value) : escapeHtml(String(value))}</span>`)
    .join('') || '<span class="muted">—</span>';
  const rows = lot.rows.map((row) => `<tr>
      <td class="delivery-table__left"><strong>${escapeHtml(row.po || '—')}</strong><small>${escapeHtml(row.ticketNumber && row.ticketNumber !== '0' ? `Phiếu ${row.ticketNumber}` : 'Chưa có số phiếu')}</small></td>
      <td>${escapeHtml(row.line || '—')}</td>
      <td>${number(row.lineQuantity)}</td>
      <td>${shortDate(row.inputDate)}</td>
      <td>${shortDate(row.outputDate)}</td>
      <td>${escapeHtml(row.leadTime || '—')}</td>
      <td>${number(row.receivedFifo)}</td>
      <td>${number(row.deliveredFifo)}</td>
      <td class="delivery-table__left"><span class="order-days">${dayList(row)}</span></td>
    </tr>`).join('');
  return `
    <div class="order-detail__head">
      <span class="customer-chip">${customerLogo(item.customer)}<span>${escapeHtml(item.customer)}</span></span>
      <h3>${escapeHtml(item.model || '—')} · ${escapeHtml(item.modelCode || '—')}</h3>
      <p>${escapeHtml(colorName(item.color) || '—')} · Mùa ${escapeHtml(item.season || '—')} · ${number(lot.poCount)} PO · nối bằng ${escapeHtml(lot.matchedBy)}</p>
      <div class="pill-stack"><span class="result-pill result-pill--${STATUS_COPY[item.status].state}">${STATUS_COPY[item.status].label}</span>${notes.map((note) => `<span class="result-pill result-pill--${note.state}">${escapeHtml(note.label)}</span>`).join('')}</div>
    </div>
    <div class="order-detail__stats">
      ${stat('SLHĐ tổng (lô)', number(lot.contract))}
      ${stat(weekItem ? 'SL trong tuần' : 'SL booking', number(item.contract), weekLabel)}
      ${stat('Đã nhận BTP', number(item.received), `cả lô: ${number(lot.received)}`)}
      ${stat('Đã giao BTP', number(item.delivered), `đạt ${number(item.good)}`)}
      ${stat('Tồn BTP', number(item.onHand), 'nhận − giao')}
      ${stat('Còn phải giao', number(item.remaining))}
      ${stat('Lỗi', number(item.defects), `hỏng in ${number(item.printDefects)} · lỗi vải ${number(item.fabricDefects)}`)}
      ${stat('Hạn giao', shortDate(item.dueDate), `${weekItem ? 'ngày PXI trả trong tuần' : 'OUTPUT'}${item.daysToDue == null || item.status === 'done' ? '' : item.daysToDue < 0 ? ` · trễ ${-item.daysToDue} ngày` : ` · còn ${item.daysToDue} ngày`}`)}
    </div>
    <div class="table-wrap"><table class="delivery-table order-detail__rows">
      <thead><tr><th class="th-left">PO / Số phiếu</th><th>Line</th><th>Line QTY</th><th>INPUT</th><th>OUTPUT</th><th>Leadtime</th><th>Nhận (FIFO)</th><th>Giao (FIFO)</th><th class="th-left">Phân bổ ngày PXC (đậm: trong tuần)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}
