import { escapeHtml, formatNumber } from './format.js';
import { STATUS_COPY, colorName, customerLogo } from './models-view.js';
import { sortByUrgency } from './export-workbook.js';

// Kế hoạch page: the selected booking week (or day) seen from each file on its own, then the
// three put together. One "order" is one booking lot (mã hàng + model + mùa + SLHĐ tổng).
export const PLAN_TABS = [
  ['combined', 'Tổng hợp cả 3 file'],
  ['booking', 'Từ file booking'],
  ['receipts', 'Từ file nhận'],
  ['deliveries', 'Từ file giao']
];

const number = (value) => formatNumber.format(Math.round(value || 0));
const percent = (part, whole) => (whole > 0 ? `${formatNumber.format(Math.round((part / whole) * 1000) / 10)}%` : '—');
const shortDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const contains = (value, text) => String(value ?? '').toLocaleLowerCase('vi-VN').includes(text);

export function planOrders(items = []) {
  return items.filter((item) => !item.outsideBooking);
}

export function filterOrders(orders, query = '') {
  const text = query.trim().toLocaleLowerCase('vi-VN');
  if (!text) return orders;
  return orders.filter((order) => [order.customer, order.model, order.modelCode, order.color, order.season, order.ticket, ...order.rows.map((row) => row.po)]
    .some((value) => contains(value, text)));
}

const firstInput = (order) => order.rows.map((row) => row.inputDate).filter(Boolean).sort()[0] || null;
const leadTimes = (order) => [...new Set(order.rows.map((row) => row.leadTime).filter(Boolean))].join(', ') || '—';

// What the planner should look at for one order, most serious first.
export function attentionOf(order) {
  if (order.status === 'done') return [];
  const notes = [];
  if (order.overdue) notes.push({ label: `Trễ hạn ${Math.abs(order.daysToDue)} ngày`, state: 'danger' });
  else if (order.daysToDue != null && order.daysToDue <= 1) notes.push({ label: order.daysToDue === 0 ? 'Hạn giao hôm nay' : 'Hạn giao ngày mai', state: 'warn' });
  if (order.received === 0) notes.push({ label: 'Chưa nhận BTP', state: order.atRisk || order.overdue ? 'danger' : 'pending' });
  else if (order.inputShortage > 0) notes.push({ label: `Thiếu BTP ${number(order.inputShortage)}`, state: 'warn' });
  if (order.onHand > 0) notes.push({ label: `Tồn ${number(order.onHand)} chưa giao`, state: 'info' });
  if (order.defects > 0) notes.push({ label: `Lỗi ${number(order.defects)}`, state: 'danger' });
  return notes;
}

// Fully delivered orders lead the combined table and stay pinned; the rest follow by urgency.
export function splitPinned(orders) {
  const done = orders.filter((order) => order.status === 'done');
  const open = sortByUrgency(orders.filter((order) => order.status !== 'done'));
  return { done: done.sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || ''))), open };
}

export function planTotals(orders) {
  const sum = (field) => orders.reduce((total, order) => total + (order[field] || 0), 0);
  const dueDates = orders.map((order) => order.dueDate).filter(Boolean).sort();
  return {
    count: orders.length,
    quantity: sum('contract'),
    received: sum('received'),
    receivedCount: orders.filter((order) => order.received > 0).length,
    inputShortage: sum('inputShortage'),
    delivered: sum('delivered'),
    good: sum('good'),
    defects: sum('defects'),
    remaining: sum('remaining'),
    onHand: sum('onHand'),
    done: orders.filter((order) => order.status === 'done').length,
    attention: orders.filter((order) => attentionOf(order).some((note) => note.state === 'danger' || note.state === 'warn')).length,
    firstDue: dueDates[0] || null,
    lastDue: dueDates.at(-1) || null
  };
}

export function renderPlanCards(totals, activeTab) {
  const cards = {
    combined: [`${number(totals.onHand)}`, 'BTP còn tồn', `${number(totals.done)}/${number(totals.count)} đơn giao đủ · ${number(totals.attention)} cần chú ý`],
    booking: [`${number(totals.quantity)}`, 'SL cần làm', `${number(totals.count)} đơn · hạn ${shortDate(totals.firstDue)} → ${shortDate(totals.lastDue)}`],
    receipts: [`${number(totals.received)}`, 'BTP đã nhận', `${percent(totals.received, totals.quantity)} · còn thiếu ${number(totals.inputShortage)}`],
    deliveries: [`${number(totals.delivered)}`, 'BTP đã giao', `đạt ${number(totals.good)} · lỗi ${number(totals.defects)} · còn ${number(totals.remaining)}`]
  };
  return PLAN_TABS.map(([tab, title]) => {
    const [value, unit, meta] = cards[tab];
    return `<button type="button" class="plan-card" data-plan-tab="${tab}" aria-pressed="${tab === activeTab}">
      <span class="plan-card__title">${title}</span><strong>${value}</strong><span class="plan-card__unit">${unit}</span><small>${meta}</small>
    </button>`;
  }).join('');
}

const identity = (order) => `
  <td class="delivery-table__left"><span class="customer-chip">${customerLogo(order.customer)}<span>${escapeHtml(order.customer)}</span></span></td>
  <td class="delivery-table__left"><strong>${escapeHtml(order.model || '—')}</strong></td>
  <td class="delivery-table__left">${escapeHtml(order.modelCode || '—')}</td>
  <td class="delivery-table__left">${escapeHtml(colorName(order.color) || '—')}</td>
  <td>${escapeHtml(order.season || '—')}</td>`;
const IDENTITY_HEAD = '<th class="th-left">Khách hàng</th><th class="th-left">Mã hàng</th><th class="th-left">Model</th><th class="th-left">Màu</th><th>Mùa</th>';

const dueCell = (order) => {
  const late = order.overdue ? ' due--late' : order.daysToDue != null && order.daysToDue <= 1 && order.status !== 'done' ? ' due--soon' : '';
  return `<td class="due${late}">${shortDate(order.dueDate)}${order.daysToDue != null && order.status !== 'done' ? `<small>${order.daysToDue < 0 ? `trễ ${-order.daysToDue} ngày` : order.daysToDue === 0 ? 'hôm nay' : `còn ${order.daysToDue} ngày`}</small>` : ''}</td>`;
};
const pills = (notes) => notes.map((note) => `<span class="result-pill result-pill--${note.state}">${escapeHtml(note.label)}</span>`).join('') || '<span class="muted">—</span>';
const status = (order) => `<span class="result-pill result-pill--${STATUS_COPY[order.status].state}">${STATUS_COPY[order.status].label}</span>`;
const empty = (columns, text) => `<tr><td colspan="${columns}" class="delivery-table__empty">${text}</td></tr>`;

const TABLES = {
  booking: {
    head: `${IDENTITY_HEAD}<th>Số PO</th><th>SL cần làm</th><th>Ngày nhận (INPUT)</th><th>Hạn giao (OUTPUT)</th><th>Leadtime</th>`,
    row: (order) => `${identity(order)}<td>${number(order.poCount)}</td><td><strong>${number(order.contract)}</strong></td><td>${shortDate(firstInput(order))}</td>${dueCell(order)}<td>${escapeHtml(leadTimes(order))}</td>`,
    foot: (totals) => `<td colspan="5" class="delivery-table__left">Tổng ${number(totals.count)} đơn</td><td></td><td><strong>${number(totals.quantity)}</strong></td><td></td><td></td><td></td>`,
    sort: (orders) => [...orders].sort((a, b) => String(a.dueDate || '9').localeCompare(String(b.dueDate || '9')) || b.contract - a.contract)
  },
  receipts: {
    head: `${IDENTITY_HEAD}<th>SL booking</th><th>Đã nhận BTP</th><th>Còn thiếu BTP</th><th>% đã nhận</th><th>Nhận lần cuối</th><th>Hạn giao</th>`,
    row: (order) => `${identity(order)}<td>${number(order.contract)}</td><td><strong>${number(order.received)}</strong></td><td class="${order.inputShortage ? 'num--warn' : ''}">${number(order.inputShortage)}</td><td>${percent(order.received, order.contract)}</td><td>${shortDate(order.lastReceiptDate)}</td>${dueCell(order)}`,
    foot: (totals) => `<td colspan="5" class="delivery-table__left">Tổng ${number(totals.receivedCount)}/${number(totals.count)} đơn đã nhận</td><td>${number(totals.quantity)}</td><td><strong>${number(totals.received)}</strong></td><td>${number(totals.inputShortage)}</td><td>${percent(totals.received, totals.quantity)}</td><td></td><td></td>`,
    sort: (orders) => [...orders].sort((a, b) => b.inputShortage - a.inputShortage || String(a.dueDate || '9').localeCompare(String(b.dueDate || '9')))
  },
  deliveries: {
    head: `${IDENTITY_HEAD}<th>SL booking</th><th>Đã giao BTP</th><th>Giao đạt</th><th>Lỗi</th><th>Còn phải giao</th><th>% hoàn thành</th><th>Trạng thái</th>`,
    row: (order) => `${identity(order)}<td>${number(order.contract)}</td><td><strong>${number(order.delivered)}</strong></td><td>${number(order.good)}</td><td class="${order.defects ? 'num--danger' : ''}">${number(order.defects)}</td><td>${number(order.remaining)}</td><td>${percent(order.good, order.contract)}</td><td>${status(order)}</td>`,
    foot: (totals) => `<td colspan="5" class="delivery-table__left">Tổng ${number(totals.done)}/${number(totals.count)} đơn giao đủ</td><td>${number(totals.quantity)}</td><td><strong>${number(totals.delivered)}</strong></td><td>${number(totals.good)}</td><td>${number(totals.defects)}</td><td>${number(totals.remaining)}</td><td>${percent(totals.good, totals.quantity)}</td><td></td>`,
    sort: (orders) => sortByUrgency(orders)
  }
};

const COMBINED_HEAD = `${IDENTITY_HEAD}<th>SL booking</th><th>Đã nhận BTP</th><th>Đã giao BTP</th><th>Tồn BTP</th><th>Hạn giao</th><th class="th-left">Cần chú ý</th>`;
const COMBINED_COLS = '<colgroup><col style="width:11%"><col style="width:9%"><col style="width:8%"><col style="width:17%"><col style="width:6%"><col style="width:8%"><col style="width:8%"><col style="width:8%"><col style="width:7%"><col style="width:7%"><col style="width:11%"></colgroup>';
const combinedRow = (order) => `<tr>${identity(order)}<td>${number(order.contract)}</td><td>${number(order.received)}</td><td>${number(order.delivered)}</td><td class="${order.onHand ? 'num--info' : ''}"><strong>${number(order.onHand)}</strong></td>${dueCell(order)}<td class="delivery-table__left"><span class="pill-stack">${pills(attentionOf(order))}</span></td></tr>`;

function renderCombined(orders, totals) {
  const { done, open } = splitPinned(orders);
  const pinned = done.length
    ? `<div class="plan-pinned">
        <div class="plan-pinned__head"><i class="ph ph-push-pin"></i><strong>Đã làm xong trong tuần booking</strong><span>${number(done.length)} đơn giao đủ · luôn ghim ở đầu</span></div>
        <div class="plan-pinned__body"><table class="delivery-table plan-table">${COMBINED_COLS}<tbody>${done.map(combinedRow).join('')}</tbody></table></div>
      </div>`
    : '<div class="plan-pinned plan-pinned--empty"><i class="ph ph-push-pin"></i>Chưa có đơn nào giao đủ trong tuần booking này.</div>';
  return `<div class="plan-table-scroll">
    <table class="delivery-table plan-table plan-table--head">${COMBINED_COLS}<thead><tr>${COMBINED_HEAD}</tr></thead></table>
    ${pinned}
    <table class="delivery-table plan-table">${COMBINED_COLS}<tbody>${open.map(combinedRow).join('') || empty(11, done.length ? 'Tất cả đơn đã giao đủ.' : 'Không có đơn nào.')}</tbody>
      <tfoot><tr><td colspan="5" class="delivery-table__left">Tổng ${number(totals.count)} đơn · ${number(totals.attention)} cần chú ý</td><td>${number(totals.quantity)}</td><td>${number(totals.received)}</td><td>${number(totals.delivered)}</td><td><strong>${number(totals.onHand)}</strong></td><td></td><td></td></tr></tfoot>
    </table>
  </div>`;
}

export function renderPlanTab(tab, orders, totals = planTotals(orders)) {
  if (tab === 'combined') return renderCombined(orders, totals);
  const table = TABLES[tab];
  const columns = (table.head.match(/<th/g) || []).length;
  return `<div class="plan-table-scroll"><table class="delivery-table plan-table plan-table--auto">
    <thead><tr>${table.head}</tr></thead>
    <tbody>${table.sort(orders).map((order) => `<tr>${table.row(order)}</tr>`).join('') || empty(columns, 'Không có đơn nào.')}</tbody>
    <tfoot><tr>${table.foot(totals)}</tr></tfoot>
  </table></div>`;
}
