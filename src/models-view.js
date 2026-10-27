import { escapeHtml, formatNumber } from './format.js';

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
  ['printing', 'Đang in'],
  ['short-input', 'Thiếu BTP'],
  ['waiting', 'Chưa nhận BTP'],
  ['done', 'Đã giao đủ']
];

export const PAGE_SIZE = 200;
const number = (value) => formatNumber.format(Math.round(value || 0));
const percent = (value) => `${formatNumber.format(Math.round(value * 1000) / 10)}%`;
const logoColors = ['#1d6fb8', '#11a77a', '#c2410c', '#7c3aed', '#be185d', '#0f766e', '#a16207'];

export function customerLogo(name) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toLocaleUpperCase('vi-VN');
  const hash = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return `<span class="customer-logo" style="background:${logoColors[hash % logoColors.length]}" aria-hidden="true">${escapeHtml(initials || '?')}</span>`;
}

export function matchesFilters(item, { customer, status, query }) {
  if (customer && item.customer !== customer) return false;
  if (status === 'open' && item.status === 'done') return false;
  if (status === 'overdue' && !item.overdue) return false;
  if (!['all', 'open', 'overdue'].includes(status) && item.status !== status) return false;
  if (!query) return true;
  const haystack = `${item.model} ${item.color} ${item.customer}`.toLocaleLowerCase('vi-VN');
  return haystack.includes(query.trim().toLocaleLowerCase('vi-VN'));
}

export function renderKpis(totals) {
  const defectRate = totals.delivered ? totals.defects / totals.delivered : 0;
  const cards = [
    ['Số lượng hợp đồng', number(totals.contract), 'sản phẩm khách booking'],
    ['Đã nhận BTP', number(totals.received), `${percent(totals.contract ? totals.received / totals.contract : 0)} hợp đồng`],
    ['Đã in (đã giao)', number(totals.delivered), `Tồn tại xưởng ${number(totals.onHand)}`],
    ['Giao đạt', number(totals.good), `${percent(totals.contract ? totals.good / totals.contract : 0)} hợp đồng`],
    ['Lỗi', number(totals.defects), `${percent(defectRate)} · hỏng in ${number(totals.printDefects)} · lỗi vải ${number(totals.fabricDefects)}`],
    ['Còn phải giao', number(totals.remaining), `${number(totals.overdue)} mã trễ hạn`]
  ];
  return cards.map(([label, value, note]) => `<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');
}

export function renderCustomerRows(items, activeCustomer) {
  const byCustomer = new Map();
  items.forEach((item) => {
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
      <td><strong>${number(row.remaining)}</strong>${row.overdue ? `<small class="text-danger">${number(row.overdue)} mã trễ hạn</small>` : ''}</td>
      <td>${progressBar(completion)}</td>
    </tr>`;
  }).join('');
}

function progressBar(completion) {
  const state = completion >= 1 ? 'ok' : completion >= 0.9 ? 'warn' : 'low';
  return `<span class="progress" title="${percent(completion)}"><span class="progress__bar progress__bar--${state}" style="width:${Math.round(completion * 100)}%"></span></span><small>${percent(completion)}</small>`;
}

function dueCell(item) {
  if (!item.dueDate) return '<span class="muted">Chưa có booking</span>';
  const [year, month, day] = item.dueDate.split('-');
  const date = `${day}/${month}/${year}`;
  if (item.status === 'done') return `${date}<small>Đã xong</small>`;
  if (item.daysToDue < 0) return `${date}<small class="text-danger">Trễ ${number(-item.daysToDue)} ngày</small>`;
  if (item.daysToDue === 0) return `${date}<small class="text-warn">Hạn hôm nay</small>`;
  return `${date}<small>Còn ${number(item.daysToDue)} ngày</small>`;
}

function detailRow(item) {
  const prints = item.prints.length
    ? `<table class="print-table"><thead><tr><th>Hình in</th><th>Nhận</th><th>Đã in (giao)</th><th>Hỏng in</th><th>Lỗi vải</th><th>Mẫu</th><th>Thiếu vải</th><th>Giao đạt</th></tr></thead><tbody>${item.prints.map((print) => `
        <tr><th>${escapeHtml(print.name)}</th><td>${number(print.received)}</td><td>${number(print.delivered)}</td><td>${number(print.printDefects)}</td><td>${number(print.fabricDefects)}</td><td>${number(print.samples)}</td><td>${number(print.fabricShort)}</td><td>${number(print.good)}</td></tr>`).join('')}
      </tbody></table><p class="model-detail__note">Mã có ${item.prints.length} hình in: số tổng lấy theo hình in có số giao đạt thấp nhất, vì sản phẩm chỉ đủ khi in xong mọi hình.</p>`
    : '';
  const facts = [
    ['Mùa', escapeHtml(item.season || '—')],
    ['Số PO', number(item.poCount)],
    ['Leadtime', escapeHtml(item.leadTime || '—')],
    ['Tồn tại xưởng (nhận − giao)', number(item.onHand)],
    ['Thiếu BTP (hợp đồng − nhận)', number(item.inputShortage)],
    ['Mẫu / thiếu vải', `${number(item.samples)} / ${number(item.fabricShort)}`]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  return `<tr class="model-detail"><td colspan="11"><div class="model-detail__facts">${facts}</div>${prints}</td></tr>`;
}

export function renderModelRows(items, expandedKey, limit = PAGE_SIZE) {
  if (!items.length) return '<tr><td colspan="11" class="delivery-table__empty">Không có mã hàng phù hợp bộ lọc.</td></tr>';
  return items.slice(0, limit).map((item) => {
    const key = `${item.customer}|${item.model}|${item.color}`;
    const copy = STATUS_COPY[item.status];
    const expanded = key === expandedKey;
    return `<tr class="model-row${expanded ? ' model-row--expanded' : ''}" data-model-key="${escapeHtml(key)}" tabindex="0" aria-expanded="${expanded}">
      <td class="delivery-table__customers"><span class="customer-chip">${customerLogo(item.customer)}<span>${escapeHtml(item.customer)}</span></span></td>
      <th class="model-cell"><strong>${escapeHtml(item.model)}</strong><small title="${escapeHtml(item.color)}">${escapeHtml(item.color || '—')}</small></th>
      <td>${number(item.contract)}</td>
      <td>${number(item.received)}</td>
      <td>${number(item.delivered)}</td>
      <td><strong>${number(item.good)}</strong></td>
      <td>${number(item.defects)}${item.defects ? `<small>Hỏng ${number(item.printDefects)} · vải ${number(item.fabricDefects)}</small>` : ''}</td>
      <td>${item.remaining ? `<strong>${number(item.remaining)}</strong>` : '0'}</td>
      <td class="progress-cell">${progressBar(item.completion)}</td>
      <td>${dueCell(item)}</td>
      <td><span class="result-pill result-pill--${copy.state}">${copy.label}</span>${item.overdue ? '<span class="result-pill result-pill--danger">Trễ hạn</span>' : ''}</td>
    </tr>${expanded ? detailRow(item) : ''}`;
  }).join('');
}

