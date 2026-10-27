import { escapeHtml, formatFileDate, formatNumber } from './format.js';

const DATE_FIELDS = new Set(['inputDate', 'outputDate']);
const NUMBER_FIELDS = new Set(['lineQuantity', 'printCount', 'contractQuantity']);

function formatValue(field, value) {
  if (value == null || value === '') return '—';
  if (DATE_FIELDS.has(field)) {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : escapeHtml(value);
  }
  if (NUMBER_FIELDS.has(field)) return formatNumber.format(Number(value));
  return escapeHtml(value);
}

function signed(value) {
  return `${value > 0 ? '+' : ''}${formatNumber.format(value)}`;
}

function rowIdentity(row) {
  return `<th><strong>${escapeHtml(row.po || '—')}</strong><small>${escapeHtml(row.customer || '')}</small></th>
    <td class="th-left"><strong>${escapeHtml(row.ref || '—')}</strong></td>
    <td class="color-cell" title="${escapeHtml(row.color || '')}">${escapeHtml(row.color || '—')}</td>`;
}

function changeDetail(change) {
  const delta = NUMBER_FIELDS.has(change.field) && Number.isFinite(Number(change.before)) && Number.isFinite(Number(change.after))
    ? ` <em class="${Number(change.after) > Number(change.before) ? 'delta-up' : 'delta-down'}">(${signed(Number(change.after) - Number(change.before))})</em>`
    : '';
  return `<li><span>${change.label}</span><del>${formatValue(change.field, change.before)}</del><i class="ph ph-arrow-right"></i><ins>${formatValue(change.field, change.after)}</ins>${delta}</li>`;
}

function section(title, tone, rows, renderRow, headers) {
  if (!rows.length) return '';
  return `<section class="change-section change-section--${tone}">
    <h3>${title} <span>${formatNumber.format(rows.length)}</span></h3>
    <div class="table-wrap"><table class="delivery-table change-table"><thead><tr>${headers.map((header, index) => `<th${index === 1 || index === 2 ? ' class="th-left"' : ''}>${header}</th>`).join('')}</tr></thead><tbody>${rows.map(renderRow).join('')}</tbody></table></div>
  </section>`;
}

export function unreviewedCount(changes) {
  return changes.filter((change) => !change.reviewedAt).length;
}

export function renderChangeList(changes, selectedId) {
  if (!changes.length) return '<p class="change-empty">Chưa có lần nhập nào khác với bản trước.</p>';
  return changes.map((change) => `<button type="button" class="change-tab${String(change.importId) === String(selectedId) ? ' change-tab--active' : ''}" data-change-id="${escapeHtml(change.importId)}">
    <strong>${escapeHtml(formatFileDate(change.createdAt))}</strong>
    <span>${formatNumber.format(change.report.counts.added + change.report.counts.removed + change.report.counts.changed)} thay đổi</span>
    ${change.reviewedAt ? '<small class="change-tab__ok">Đã kiểm tra</small>' : '<small class="change-tab__new">Chưa kiểm tra</small>'}
  </button>`).join('');
}

export function renderChangeReport(change) {
  if (!change) return '<div class="history-empty"><i class="ph ph-check-circle"></i><strong>Không có thay đổi</strong><span>Khi nhập lại file booking, mọi dòng được thêm, xóa hoặc sửa sẽ hiện ở đây.</span></div>';
  const { report } = change;
  const summary = `<div class="change-summary">
    <div><span>Dòng thêm mới</span><strong>${formatNumber.format(report.counts.added)}</strong><small>${signed(report.addedQuantity)} sản phẩm</small></div>
    <div><span>Dòng bị xóa</span><strong>${formatNumber.format(report.counts.removed)}</strong><small>${signed(-report.removedQuantity)} sản phẩm</small></div>
    <div><span>Dòng bị sửa</span><strong>${formatNumber.format(report.counts.changed)}</strong><small>số lượng, ngày, leadtime…</small></div>
    <div><span>Tổng booking thay đổi</span><strong class="${report.quantityDelta < 0 ? 'delta-down' : 'delta-up'}">${signed(report.quantityDelta)}</strong><small>sản phẩm</small></div>
  </div>`;
  const source = `<p class="change-source">So sánh <strong>${escapeHtml(change.filename)}</strong> với bản nhập trước <strong>${escapeHtml(change.previousFilename || '')}</strong>.${report.truncated ? ' Mỗi nhóm chỉ hiện 500 dòng đầu.' : ''}</p>`;
  const changed = section('Dòng bị sửa', 'changed', report.changed, ({ row, changes }) => `<tr>${rowIdentity(row)}<td>${escapeHtml(row.leadTime || '—')}</td><td class="th-left"><ul class="change-fields">${changes.map(changeDetail).join('')}</ul></td></tr>`, ['PO', 'Mã hàng', 'Màu', 'Leadtime', 'Thay đổi']);
  const added = section('Dòng thêm mới', 'added', report.added, (row) => `<tr>${rowIdentity(row)}<td>${escapeHtml(row.leadTime || '—')}</td><td>${formatValue('lineQuantity', row.lineQuantity)}</td><td>${formatValue('outputDate', row.outputDate)}</td></tr>`, ['PO', 'Mã hàng', 'Màu', 'Leadtime', 'Số lượng', 'Hạn giao']);
  const removed = section('Dòng bị xóa', 'removed', report.removed, (row) => `<tr>${rowIdentity(row)}<td>${escapeHtml(row.leadTime || '—')}</td><td>${formatValue('lineQuantity', row.lineQuantity)}</td><td>${formatValue('outputDate', row.outputDate)}</td></tr>`, ['PO', 'Mã hàng', 'Màu', 'Leadtime', 'Số lượng', 'Hạn giao']);
  return `${source}${summary}${changed}${added}${removed}`;
}
