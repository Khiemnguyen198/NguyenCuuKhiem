import { escapeHtml, formatNumber } from './format.js';
import { productKey } from './keys.js';
import { customerLogo } from './models-view.js';

const number = (value) => (value == null ? '—' : formatNumber.format(Math.round(value)));

export function shortDay(isoDate) {
  const match = String(isoDate || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return match ? `${match[2]}/${match[1]}` : null;
}

export function dateRange(first, last) {
  const from = shortDay(first);
  const to = shortDay(last);
  if (!from) return '—';
  return !to || from === to ? from : `${from} – ${to}`;
}

function customerCell(customers = []) {
  if (!customers.length) return '—';
  const shown = customers.slice(0, 3).map((customer) => `
    <span class="customer-chip" title="${escapeHtml(customer.name)}: ${formatNumber.format(customer.totalQuantity)} sản phẩm">
      ${customerLogo(customer.name)}<span>${escapeHtml(customer.name)}</span>
    </span>`).join('');
  const more = customers.length > 3 ? `<small>+${formatNumber.format(customers.length - 3)} khách</small>` : '';
  return `<div class="customer-list">${shown}${more}</div>`;
}

// Matches each booked product of a lead-time group with its receiving / delivery progress.
export function leadtimeProgress(dashboard, summary) {
  const itemsByProduct = new Map();
  for (const item of summary?.items || []) {
    const current = itemsByProduct.get(item.product);
    if (!current || item.contract > current.contract) itemsByProduct.set(item.product, item);
  }
  const models = dashboard.models || [];
  return (dashboard.leadTimes || []).map((group) => {
    const products = models.filter((model) => String(model.leadTime || '') === String(group.leadTime));
    const progress = { received: 0, good: 0, done: 0, active: 0, waiting: 0, overdue: 0, products: products.length };
    for (const model of products) {
      const item = itemsByProduct.get(productKey(model.model, model.color));
      if (!item || item.status === 'waiting') progress.waiting += 1;
      else if (item.status === 'done') progress.done += 1;
      else progress.active += 1;
      if (item?.overdue) progress.overdue += 1;
      progress.received += item?.received || 0;
      progress.good += item?.good || 0;
    }
    return { ...group, progress: models.length ? progress : null };
  });
}

function statusSummary(progress) {
  if (!progress) return '<span class="muted">Nhập lại file booking để xem</span>';
  const parts = [
    progress.done ? `<span class="result-pill result-pill--ok">${number(progress.done)} đủ</span>` : '',
    progress.active ? `<span class="result-pill result-pill--info">${number(progress.active)} đang làm</span>` : '',
    progress.waiting ? `<span class="result-pill result-pill--pending">${number(progress.waiting)} chưa nhận</span>` : '',
    progress.overdue ? `<span class="result-pill result-pill--danger">${number(progress.overdue)} trễ</span>` : ''
  ].filter(Boolean);
  return `<div class="pill-stack">${parts.join('') || '—'}</div>`;
}

export function renderLeadtimeRows(dashboard, summary) {
  const groups = leadtimeProgress(dashboard, summary);
  if (!groups.length) return '<tr><td colspan="10" class="delivery-table__empty">File chưa có dữ liệu leadtime.</td></tr>';
  return groups.map((group) => {
    const dueDate = shortDay(group.lastOutput);
    return `<tr>
      <th>${escapeHtml(group.leadTime)}${dueDate ? `<small>Hạn ${dueDate}</small>` : ''}</th>
      <td class="delivery-table__customers">${customerCell(group.customers)}</td>
      <td>${number(group.modelCount)}<small>mã</small></td>
      <td>${number(group.poCount)}<small>hợp đồng</small></td>
      <td><strong>${number(group.totalQuantity)}</strong><small>${number(group.rowCount)} dòng</small></td>
      <td>${dateRange(group.firstInput, group.lastInput)}</td>
      <td>${dateRange(group.firstOutput, group.lastOutput)}</td>
      <td>${number(group.progress?.received)}</td>
      <td>${number(group.progress?.good)}</td>
      <td>${statusSummary(group.progress)}</td>
    </tr>`;
  }).join('');
}

// Short list of things a planner should look at first; each chip opens the matching filter.
export function renderWarnings(totals, aiReport) {
  const findings = Object.fromEntries((aiReport?.findings || []).map((finding) => [finding.code, finding.count]));
  const chips = [
    totals?.overdue ? { status: 'overdue', tone: 'danger', text: `${number(totals.overdue)} mã trễ hạn chưa giao đủ` } : null,
    totals?.atRisk ? { status: 'at-risk', tone: 'warn', text: `${number(totals.atRisk)} mã tới hạn trong 3 ngày chưa nhận BTP` } : null,
    findings.sunday_output ? { tone: 'warn', text: `${number(findings.sunday_output)} dòng booking có hạn giao Chủ Nhật` } : null,
    findings.sheet_mismatch ? { tone: 'warn', text: `${number(findings.sheet_mismatch)} dòng TH lệch sheet leadtime` } : null,
    findings.daily_total_mismatch ? { tone: 'warn', text: `${number(findings.daily_total_mismatch)} ngày có TỔNG NGÀY trong TH tính sai` } : null,
    findings.missing_contract ? { tone: 'info', text: `${number(findings.missing_contract)} dòng thiếu SLHĐ tổng` } : null
  ].filter(Boolean);
  if (!chips.length) return '<span class="warning-chip warning-chip--ok"><i class="ph ph-check-circle"></i>Không có cảnh báo cần xử lý</span>';
  return chips.map((chip) => chip.status
    ? `<button type="button" class="warning-chip warning-chip--${chip.tone}" data-goto-status="${chip.status}"><i class="ph ph-warning"></i>${chip.text}<i class="ph ph-caret-right"></i></button>`
    : `<span class="warning-chip warning-chip--${chip.tone}"><i class="ph ph-info"></i>${chip.text}</span>`).join('');
}
