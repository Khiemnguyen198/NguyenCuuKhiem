import { escapeHtml, formatNumber } from './format.js';
import { brandOf, logoUrl } from './customer-brands.js';

export const STATUS_COPY = {
  done: { label: 'Đã giao đủ', state: 'ok' },
  printing: { label: 'Đang in', state: 'info' },
  'short-input': { label: 'Thiếu BTP', state: 'warn' },
  waiting: { label: 'Chưa nhận BTP', state: 'pending' }
};

export const STATUS_FILTERS = [
  ['all', 'Tất cả'],
  ['open', 'Chưa giao đủ'],
  ['overdue', 'Trễ hạn'],
  ['at-risk', 'Tới hạn chưa nhận'],
  ['printing', 'Đang in'],
  ['short-input', 'Thiếu BTP'],
  ['waiting', 'Chưa nhận BTP'],
  ['done', 'Đã giao đủ'],
  ['outside', 'Ngoài booking']
];

export const PAGE_SIZE = 200;
const number = (value) => formatNumber.format(Math.round(value || 0));
const percent = (value) => `${formatNumber.format(Math.round(value * 1000) / 10)}%`;
const logoColors = ['#1d6fb8', '#11a77a', '#c2410c', '#7c3aed', '#be185d', '#0f766e', '#a16207'];

// Known brands show their own logo over the initials; if the image fails to load (offline,
// blocked), main.js removes it and the initials remain.
export function customerLogo(name) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toLocaleUpperCase('vi-VN');
  const hash = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const brand = brandOf(name);
  const image = brand ? `<img src="${logoUrl(brand)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-brand-logo />` : '';
  return `<span class="customer-logo${brand ? ' customer-logo--brand' : ''}" style="background:${logoColors[hash % logoColors.length]}" title="${escapeHtml(brand?.name || name)}" aria-hidden="true">${escapeHtml(initials || '?')}${image}</span>`;
}

const contains = (value, text) => !text || String(value ?? '').toLocaleLowerCase('vi-VN').includes(text.trim().toLocaleLowerCase('vi-VN'));

export function matchesFilters(item, { customer, status, query, columns = {} }) {
  if (customer && item.customer !== customer) return false;
  if (!contains(item.model, columns.model) || !contains(item.modelCode, columns.modelCode) || !contains(colorName(item.color), columns.color)) return false;
  if (status === 'any') return matchesQuery(item, query);
  // Warehouse products without a booking lot only show under their own filter.
  if ((status === 'outside') !== Boolean(item.outsideBooking)) return false;
  if (status === 'outside') return matchesQuery(item, query);
  if (status === 'open' && item.status === 'done') return false;
  if (status === 'overdue' && !item.overdue) return false;
  if (status === 'at-risk' && !item.atRisk) return false;
  if (!['all', 'open', 'overdue', 'at-risk'].includes(status) && item.status !== status) return false;
  return matchesQuery(item, query);
}

function matchesQuery(item, query) {
  if (!query) return true;
  const haystack = `${item.model} ${item.modelCode || ''} ${item.color} ${item.customer} ${item.ticket || ''} ${(item.rows || []).map((row) => row.po).join(' ')}`.toLocaleLowerCase('vi-VN');
  return haystack.includes(query.trim().toLocaleLowerCase('vi-VN'));
}

// "9046670 1P BEA FUNSTRIPES" → "1P BEA FUNSTRIPES": the model code has its own column.
export const colorName = (color) => String(color || '').replace(/^\s*\d{7}\s*/, '') || String(color || '');

// In batch mode the received / delivered figures are cumulative per product (the warehouse
// files cannot tell batches apart), so they are labelled as such instead of as a % of the batch.
export function renderKpis(totals, { batch = false } = {}) {
  const defectRate = totals.delivered ? totals.defects / totals.delivered : 0;
  const share = (value) => `${percent(totals.contract ? value / totals.contract : 0)} hợp đồng`;
  const cards = [
    ['SLHĐ tổng', number(totals.contract), batch ? 'các dòng booking trong tuần' : 'tổng các lô booking'],
    ['Đã nhận BTP', number(totals.received), share(totals.received)],
    ['Đã in (đã giao)', number(totals.delivered), `Tồn tại xưởng ${number(totals.onHand)}`],
    ['Giao đạt', number(totals.good), share(totals.good)],
    ['Lỗi', number(totals.defects), `${percent(defectRate)} · hỏng in ${number(totals.printDefects)} · lỗi vải ${number(totals.fabricDefects)}`],
    ['Còn phải giao', number(totals.remaining), `${number(totals.overdue)} lô trễ hạn`]
  ];
  return cards.map(([label, value, note]) => `<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');
}

export function renderCustomerRows(items, activeCustomer) {
  const byCustomer = new Map();
  items.filter((item) => !item.outsideBooking).forEach((item) => {
    const row = byCustomer.get(item.customer) || { name: item.customer, models: 0, open: 0, contract: 0, received: 0, good: 0, defects: 0, remaining: 0, overdue: 0 };
    row.models += 1;
    if (item.status !== 'done') row.open += 1;
    if (item.overdue) row.overdue += 1;
    for (const key of ['contract', 'received', 'good', 'defects', 'remaining']) row[key] += item[key];
    byCustomer.set(item.customer, row);
  });
  return [...byCustomer.values()].sort((a, b) => b.contract - a.contract).map((row) => {
    const completion = row.contract ? Math.min(1, row.good / row.contract) : 0;
    return `<tr class="customer-row${row.name === activeCustomer ? ' customer-row--active' : ''}" data-customer="${escapeHtml(row.name)}" tabindex="0">
      <th><span class="customer-chip">${customerLogo(row.name)}<span>${escapeHtml(row.name)}</span></span></th>
      <td>${number(row.models)}<small>${number(row.open)} chưa đủ</small></td>
      <td>${number(row.contract)}</td>
      <td>${number(row.received)}</td>
      <td>${number(row.good)}</td>
      <td>${number(row.defects)}</td>
      <td><strong>${number(row.remaining)}</strong>${row.overdue ? `<small class="text-danger">${number(row.overdue)} lô trễ hạn</small>` : ''}</td>
      <td>${progressBar(completion)}</td>
    </tr>`;
  }).join('');
}

function progressBar(completion) {
  const state = completion >= 1 ? 'ok' : completion >= 0.9 ? 'warn' : 'low';
  return `<span class="progress" title="${percent(completion)}"><span class="progress__bar progress__bar--${state}" style="width:${Math.round(completion * 100)}%"></span></span><small>${percent(completion)}</small>`;
}

function dueCell(item) {
  if (!item.dueDate) return '<span class="muted">—</span>';
  const [year, month, day] = item.dueDate.split('-');
  const date = `${day}/${month}/${year}`;
  if (item.status === 'done') return `${date}<small>Đã xong</small>`;
  if (item.daysToDue < 0) return `${date}<small class="text-danger">Trễ ${number(-item.daysToDue)} ngày</small>`;
  if (item.daysToDue === 0) return `${date}<small class="text-warn">Hạn hôm nay</small>`;
  return `${date}<small>Còn ${number(item.daysToDue)} ngày</small>`;
}

function detailRow(item) {
  const day = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  const facts = [
    ['Số phiếu', escapeHtml(item.ticket || 'chưa có')],
    ['Số PO / dòng', `${number(item.poCount)} / ${number(item.rowCount)}`],
    ['Leadtime', escapeHtml(item.leadTime || '—')],
    ['Nối với nhận/giao bằng', escapeHtml(item.matchedBy || '—')],
    ['SLHĐ tổng trong file', item.contractInFile ? number(item.contractInFile) : '—'],
    ['Tồn tại xưởng (nhận − giao)', number(item.onHand)],
    ['Thiếu BTP (SLHĐ − nhận)', number(item.inputShortage)],
    ['Nhận gần nhất', day(item.lastReceiptDate)]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  const rows = item.rows?.length
    ? `<table class="print-table"><thead><tr><th>PO</th><th>LINE QTY</th><th>Hạn giao</th><th>Nhận BTP</th><th>Đã in (giao)</th><th>Giao đạt</th><th>Còn thiếu</th></tr></thead><tbody>${item.rows.map((row) => `
        <tr><th>${escapeHtml(row.po)}</th><td>${number(row.lineQuantity)}</td><td>${day(row.outputDate)}</td><td>${number(row.receivedFifo)}</td><td>${number(row.deliveredFifo)}</td><td>${number(row.goodFifo)}</td><td>${number(row.remainingFifo)}</td></tr>`).join('')}
      </tbody></table><p class="model-detail__note">Số nhận/giao của lô được chia cho từng dòng PO theo hạn giao sớm nhất trước (FIFO).</p>`
    : '';
  const prints = item.prints.length > 1
    ? `<table class="print-table"><thead><tr><th>Hình in</th><th>Nhận</th><th>Đã in (giao)</th><th>Hỏng in</th><th>Lỗi vải</th><th>Giao đạt</th></tr></thead><tbody>${item.prints.map((print) => `
        <tr><th>${escapeHtml(print.name)}</th><td>${number(print.received)}</td><td>${number(print.delivered)}</td><td>${number(print.printDefects)}</td><td>${number(print.fabricDefects)}</td><td>${number(print.good)}</td></tr>`).join('')}
      </tbody></table><p class="model-detail__note">Nhiều hình in: số của lô lấy theo hình in có giao đạt thấp nhất.</p>`
    : '';
  return `<tr class="model-detail"><td colspan="14"><div class="model-detail__facts">${facts}</div>${rows}${prints}</td></tr>`;
}

export function renderModelRows(items, expandedKey, limit = PAGE_SIZE) {
  if (!items.length) return '<tr><td colspan="14" class="delivery-table__empty">Không có lô phù hợp bộ lọc.</td></tr>';
  return items.slice(0, limit).map((item) => {
    const { key } = item;
    const copy = STATUS_COPY[item.status];
    const expanded = key === expandedKey;
    return `<tr class="model-row${expanded ? ' model-row--expanded' : ''}" data-model-key="${escapeHtml(key)}" tabindex="0" aria-expanded="${expanded}">
      <td class="delivery-table__customers"><span class="customer-chip">${customerLogo(item.customer)}<span>${escapeHtml(item.customer)}</span></span></td>
      <th class="model-cell"><strong>${escapeHtml(item.model)}</strong>${item.ticket ? `<small>Phiếu ${escapeHtml(item.ticket)}</small>` : ''}</th>
      <td class="th-left">${escapeHtml(item.modelCode || '—')}</td>
      <td class="color-cell" title="${escapeHtml(item.color)}">${escapeHtml(colorName(item.color) || '—')}</td>
      <td>${escapeHtml(item.season || '—')}</td>
      <td>${number(item.contract)}</td>
      <td>${number(item.received)}</td>
      <td>${number(item.delivered)}</td>
      <td><strong>${number(item.good)}</strong></td>
      <td>${number(item.defects)}${item.defects ? `<small>Hỏng ${number(item.printDefects)} · vải ${number(item.fabricDefects)}</small>` : ''}</td>
      <td>${item.remaining ? `<strong>${number(item.remaining)}</strong>` : '0'}</td>
      <td class="progress-cell">${progressBar(item.completion)}</td>
      <td>${dueCell(item)}</td>
      <td><span class="result-pill result-pill--${copy.state}">${copy.label}</span>${item.overdue ? '<span class="result-pill result-pill--danger">Trễ hạn</span>' : ''}${item.atRisk ? '<span class="result-pill result-pill--warn">Sắp tới hạn</span>' : ''}${item.outsideBooking ? '<span class="result-pill result-pill--pending">Ngoài booking</span>' : ''}</td>
    </tr>${expanded ? detailRow(item) : ''}`;
  }).join('');
}

