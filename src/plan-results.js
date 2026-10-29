import { escapeHtml, formatNumber } from './format.js';
import { STATUS_COPY, colorName, customerLogo } from './models-view.js';
import { sortByUrgency } from './export-workbook.js';
import { deliveryTiming } from './delivery-timing.js';

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

export function filterOrders(orders, query = '', filters = {}) {
  const text = query.trim().toLocaleLowerCase('vi-VN');
  return orders.filter((order) => {
    if (filters.customer && order.customer !== filters.customer) return false;
    if (filters.status) {
      if (filters.status === 'pinned' && !order.pinned) return false;
      if (filters.status === 'open' && order.status === 'done') return false;
      if (filters.status === 'done' && order.status !== 'done') return false;
      if (filters.status === 'overdue' && !order.overdue) return false;
      if (filters.status === 'short-input' && order.status !== 'short-input') return false;
      if (filters.status === 'printing' && order.status !== 'printing') return false;
      if (filters.status === 'waiting' && order.status !== 'waiting') return false;
    }
    if (!text) return true;
    const pos = (order.rows || []).map((row) => `${row.po || ''} ${row.line || ''}`).join(' ');
    return [order.customer, order.model, order.modelCode, order.color, order.season, order.ticket, pos]
      .some((value) => contains(value, text));
  });
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
// Pinned open orders jump ahead of unpinned ones.
export function splitPinned(orders) {
  const done = orders.filter((order) => order.status === 'done');
  const open = orders.filter((order) => order.status !== 'done');
  const pinned = open.filter((order) => order.pinned);
  const unpinned = open.filter((order) => !order.pinned);
  return {
    done: done.sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || ''))),
    open: [...sortByUrgency(pinned), ...sortByUrgency(unpinned)],
    pinnedCount: pinned.length
  };
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
  <td class="delivery-table__left">
    <div class="customer-cell-wrap">
      <button type="button" class="pin-toggle${order.pinned ? ' pin-toggle--pinned' : ''}" data-pin-key="${escapeHtml(order.key)}" title="${order.pinned ? 'Bỏ ghim ưu tiên nhận BTP' : 'Ghim nhận BTP ưu tiên'}" aria-label="${order.pinned ? 'Bỏ ghim' : 'Ghim'}"><i class="ph ph-push-pin${order.pinned ? '-fill' : ''}"></i></button>
      <span class="customer-chip">${customerLogo(order.customer)}<span>${escapeHtml(order.customer)}</span></span>
    </div>
  </td>
  <td class="delivery-table__left">
    <div class="model-cell-inner">
      <strong>${escapeHtml(order.model || '—')}</strong>${order.pinned ? '<span class="pinned-tag" title="Lô được ưu tiên nhận BTP">Ưu tiên</span>' : ''}
    </div>
  </td>
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

export function renderDeliveryPlanTable(orders) {
  const rows = orders.flatMap((order) => (order.rows?.length ? order.rows.map((row) => ({ order, row })) : [{ order, row: order }]))
    .sort((a, b) => String(a.row.outputDate || a.order.dueDate || '9999-99-99').localeCompare(String(b.row.outputDate || b.order.dueDate || '9999-99-99'))
      || String(a.row.ref || a.order.model || '').localeCompare(String(b.row.ref || b.order.model || ''), 'vi', { numeric: true })
      || String(a.row.po || '').localeCompare(String(b.row.po || ''), 'vi', { numeric: true }));
  const body = rows.map(({ order, row }) => {
    const timing = deliveryTiming(row, order);
    const formatDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
    const warning = timing.warnings.join(' · ') || 'Không có cảnh báo';
    const expectedClass = timing.expectedDate ? (timing.expectedLate ? ' plan-date--late' : ' plan-date--actual') : '';
    const fileClass = timing.fileDate ? (timing.fileLate ? ' plan-date--late' : ' plan-date--actual') : '';
    return `<tr>
      <td class="delivery-table__left"><strong>${escapeHtml(row.ref || order.model || '—')}</strong></td>
      <td class="delivery-table__left">${escapeHtml(colorName(row.color || order.color) || row.color || order.color || '—')}</td>
      <td class="delivery-table__left">${escapeHtml(row.po || '—')}</td>
      <td>${escapeHtml(row.season || order.season || '—')}</td>
      <td>${number(row.lineQuantity ?? order.contract)}</td>
      <td>${number(order.contract)}</td>
      <td>${number(row.receivedFifo ?? order.received)}</td>
      <td>${escapeHtml(row.leadTime || order.leadTime || '—')}</td>
      <td>${formatDate(timing.bookingReceiptDate)}</td>
      <td>${formatDate(timing.contractDate)}</td>
      <td>${formatDate(timing.receiptDate)}</td>
      <td class="${fileClass}">${formatDate(timing.fileDate)}</td>
      <td class="${expectedClass}">${formatDate(timing.expectedDate)}</td>
      <td><span class="result-pill${timing.warnings.length ? ' result-pill--warn' : ''}">${escapeHtml(warning)}</span></td>
    </tr>`;
  }).join('') || empty(14, 'Không có dòng booking trong phạm vi đã chọn.');
  return `<div class="plan-table-scroll plan-delivery-table-scroll"><table class="delivery-table plan-table plan-delivery-table">
    <thead><tr><th class="th-left">Mã hàng</th><th class="th-left">Màu</th><th class="th-left">PO</th><th>SS</th><th>SLHĐ</th><th>SLHĐ tổng</th><th>SL BTP nhận</th><th>Leadtime</th><th>Ngày nhận BTP (booking)</th><th>Ngày giao BTP (booking)</th><th>Ngày nhận BTP thực tế</th><th>Ngày giao BTP thực tế</th><th>Ngày giao dự kiến</th><th>Cảnh báo</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}
