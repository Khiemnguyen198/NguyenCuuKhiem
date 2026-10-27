import { escapeHtml, formatFileDate, formatNumber } from './format.js';
import { STATUS_COPY, colorName } from './models-view.js';
import { ISSUE_TYPES } from './booking-check.js';

// "Kiểm tra file": what the export will contain for the selected week, before writing it.
const number = (value) => formatNumber.format(Math.round(value || 0));
const day = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const PREVIEW_ROWS = 15;
const ISSUES_SHOWN = 200;
const cellValue = (value) => (typeof value === 'number' ? number(value) : escapeHtml(value ?? ''));

// Problems found in the booking's TH sheet, grouped by kind, with the cell, the value in the
// file and the value it should hold. Problems touching the selected week come first.
function renderSheetIssues(sheetCheck, booking) {
  const cells = sheetCheck?.cells;
  const mismatches = sheetCheck?.mismatches || [];
  if (!cells?.checked) {
    return '<p class="check-note">Lần nhập này chưa có kiểm tra chi tiết. Nhập lại file booking để xem lỗi theo từng ô.</p>';
  }
  const weekRows = new Set((booking.rows || []).map((row) => `${row.po}|${row.ref}`));
  const weekDays = new Set((booking.days || []).map((day) => day.date));
  const inWeek = (issue) => (issue.date ? weekDays.has(issue.date) : weekRows.has(`${issue.po}|${issue.ref}`));
  const groups = Object.entries(ISSUE_TYPES)
    .map(([type, info]) => ({ type, info, items: cells.issues.filter((issue) => issue.type === type) }))
    .filter((group) => group.items.length);
  if (mismatches.length) {
    groups.push({
      type: 'sheet_mismatch',
      info: { title: 'TH lệch sheet LEADTIME', severity: 'warning' },
      items: mismatches.map((item) => ({ cell: item.row, po: item.po, ref: item.ref, value: item.quantity, note: item.note }))
    });
  }
  if (!groups.length) return '<p class="check-note check-clean"><i class="ph ph-check-circle"></i> Không phát hiện lỗi nào trong sheet TH.</p>';
  return groups.map(({ info, items }) => {
    const sorted = [...items].sort((a, b) => inWeek(b) - inWeek(a));
    const weekCount = items.filter(inWeek).length;
    const rows = sorted.slice(0, ISSUES_SHOWN).map((issue) => `<tr class="${inWeek(issue) ? 'issue-in-week' : ''}">
      <th>${escapeHtml(issue.cell)}</th>
      <td class="th-left">${escapeHtml(issue.po || '—')}</td>
      <td class="th-left">${escapeHtml(issue.ref || '—')}</td>
      <td class="color-cell" title="${escapeHtml(issue.color || '')}">${escapeHtml(colorName(issue.color) || '—')}</td>
      <td class="issue-value">${cellValue(issue.value)}</td>
      <td class="issue-expected">${cellValue(issue.expected)}</td>
      <td class="th-left issue-note">${escapeHtml(issue.note || '')}${inWeek(issue) ? '<span class="result-pill result-pill--info">tuần này</span>' : ''}</td>
    </tr>`).join('');
    return `<details class="issue-group issue-group--${info.severity}"${weekCount ? ' open' : ''}>
      <summary><strong>${escapeHtml(info.title)}</strong><span>${number(items.length)} ô${weekCount ? ` · ${number(weekCount)} trong tuần này` : ''}</span></summary>
      <div class="table-wrap"><table class="delivery-table issue-table"><thead><tr><th>Ô</th><th class="th-left">PO</th><th class="th-left">Mã hàng</th><th class="th-left">Màu</th><th>Trong file</th><th>Đúng ra</th><th class="th-left">Ghi chú</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${items.length > ISSUES_SHOWN ? `<p class="check-note">Hiện ${number(ISSUES_SHOWN)} / ${number(items.length)} ô.</p>` : ''}
    </details>`;
  }).join('');
}

function sourceRow(title, source, required) {
  if (source?.filename) {
    return `<li class="check-ok"><i class="ph ph-check-circle"></i><strong>${title}</strong><span title="${escapeHtml(source.filename)}">${escapeHtml(source.filename)}</span><small>${escapeHtml(formatFileDate(source.importedAt))}</small></li>`;
  }
  return `<li class="${required ? 'check-bad' : 'check-warn'}"><i class="ph ph-${required ? 'x-circle' : 'warning'}"></i><strong>${title}</strong><span>${required ? 'Chưa nhập — cần file booking để xuất' : 'Chưa nhập — cột tương ứng sẽ bằng 0'}</span></li>`;
}

export function checkIssues({ booking, summary }) {
  const issues = [];
  if (!booking.rows?.length) issues.push('Không có dòng booking nào trong tuần đã chọn.');
  return issues;
}

export function renderCheckReport({ booking, summary, sources, aiReport, sheetCheck = null }) {
  const lots = summary.items.filter((item) => !item.outsideBooking);
  const { totals } = summary;
  const rows = booking.rows || [];
  const load = rows.reduce((sum, row) => sum + Number(row.lineQuantity || 0) * Number(row.printCount || 0), 0);
  const matched = lots.reduce((counts, item) => {
    const key = item.matchedBy.includes('phiếu') ? 'ticket' : item.matchedBy.includes('FIFO') ? 'fifo' : 'none';
    counts[key] += 1;
    return counts;
  }, { ticket: 0, fifo: 0, none: 0 });
  const findings = (aiReport?.findings || []).filter((finding) => finding.severity !== 'info');

  const facts = [
    ['Dòng booking', number(rows.length), `${number(new Set(rows.map((row) => row.po)).size)} PO`],
    ['Lô (mã · model · mùa)', number(lots.length), `${number(new Set(lots.map((item) => item.model)).size)} mã hàng`],
    ['Số lượng của tuần', number(totals.contract), `${number(load)} lượt hình`],
    ['Đã nhận BTP', number(totals.received), totals.contract ? `${Math.round((totals.received / totals.contract) * 100)}% số lượng tuần` : '—'],
    ['Đã in (giao)', number(totals.delivered), `lỗi ${number(totals.defects)}`],
    ['Còn thiếu', number(totals.remaining), `${number(totals.overdue)} lô trễ hạn`]
  ].map(([label, value, note]) => `<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');

  const statuses = Object.entries(totals.statusCounts)
    .filter(([, count]) => count)
    .map(([status, count]) => `<span class="result-pill result-pill--${STATUS_COPY[status].state}">${number(count)} ${STATUS_COPY[status].label.toLocaleLowerCase('vi-VN')}</span>`)
    .join('');

  const warnings = [
    totals.overdue ? `${number(totals.overdue)} lô đã quá hạn giao mà chưa giao đủ.` : null,
    totals.atRisk ? `${number(totals.atRisk)} lô tới hạn trong 3 ngày nhưng chưa nhận BTP.` : null,
    matched.none ? `${number(matched.none)} lô chưa có số nhận/giao (chưa khớp phiếu, chưa có hàng để chia FIFO).` : null,
    ...(sheetCheck?.cells?.checked ? [] : findings.map((finding) => `File booking — ${finding.title}: ${number(finding.count)} ${finding.code === 'daily_total_mismatch' ? 'ngày' : 'dòng'} (trong cả file).`))
  ].filter(Boolean);

  const issueCount = (sheetCheck?.cells?.issues?.length || 0) + (sheetCheck?.mismatches?.length || 0);
  const lotsByKey = new Map(lots.map((item) => [item.key, item]));
  const preview = rows.slice(0, PREVIEW_ROWS).map((row) => {
    const lot = lotsByKey.get(row.lotKey);
    return `<tr>
      <th>${escapeHtml(row.po)}</th><td class="th-left">${escapeHtml(row.ref)}</td><td class="th-left">${escapeHtml(row.modelCode)}</td>
      <td class="color-cell" title="${escapeHtml(row.color)}">${escapeHtml(colorName(row.color))}</td>
      <td>${number(row.lineQuantity)}</td><td>${number(row.receivedFifo)}</td><td>${number(row.deliveredFifo)}</td><td><strong>${number(row.remainingFifo)}</strong></td>
      <td>${day(row.outputDate)}</td><td>${lot ? `<span class="result-pill result-pill--${STATUS_COPY[lot.status].state}">${STATUS_COPY[lot.status].label}</span>` : '—'}</td>
    </tr>`;
  }).join('');

  return `
    <section class="check-block"><h3>Nguồn dữ liệu</h3><ul class="check-sources">
      ${sourceRow('Booking', sources.booking, true)}${sourceRow('Nhận', sources.receipts, false)}${sourceRow('Giao', sources.deliveries, false)}
    </ul></section>
    <section class="check-block"><h3>${escapeHtml(booking.batch?.label || 'Toàn bộ booking')}</h3>
      <div class="check-facts">${facts}</div>
      <div class="pill-stack check-statuses">${statuses || '<span class="muted">Chưa có lô</span>'}</div>
      <p class="check-note">Nối nhận/giao: ${number(matched.ticket)} lô theo số phiếu · ${number(matched.fifo)} lô chia FIFO theo hạn giao · ${number(matched.none)} lô chưa có số liệu.</p>
    </section>
    <section class="check-block"><h3>Cần lưu ý ${warnings.length ? `<span class="check-count">${number(warnings.length)}</span>` : ''}</h3>
      ${warnings.length ? `<ul class="check-warnings">${warnings.map((text) => `<li><i class="ph ph-warning"></i>${escapeHtml(text)}</li>`).join('')}</ul>` : '<p class="check-note">Không có gì cần lưu ý.</p>'}
    </section>
    <section class="check-block"><h3>Lỗi trong sheet TH ${issueCount ? `<span class="check-count">${number(issueCount)}</span>` : ''}</h3>
      ${renderSheetIssues(sheetCheck, booking)}
      ${issueCount ? '<p class="check-note">Khi xuất, SLHĐ TỔNG, TỔNG NGÀY và PXI TRẢ sai năm được sửa sẵn trong sheet TH (ô đã sửa có ghi chú giá trị cũ); mọi lỗi của tuần được liệt kê ở sheet ĐỐI CHIẾU với kết quả Đã sửa / Cần kiểm tra.</p>' : ''}
    </section>
    <section class="check-block"><h3>Xem trước ${number(Math.min(PREVIEW_ROWS, rows.length))} / ${number(rows.length)} dòng sẽ xuất</h3>
      <div class="table-wrap"><table class="delivery-table check-preview"><thead><tr><th>PO</th><th class="th-left">Mã hàng</th><th class="th-left">Model</th><th class="th-left">Màu</th><th>SL tuần</th><th>Nhận BTP</th><th>Đã in (giao)</th><th>Còn thiếu</th><th>Hạn giao</th><th>Trạng thái lô</th></tr></thead>
      <tbody>${preview || '<tr><td colspan="10" class="delivery-table__empty">Không có dòng nào.</td></tr>'}</tbody></table></div>
      <p class="check-note">File xuất là một sheet TH giống file booking, chỉ gồm các dòng và các ngày của tuần này.</p>
    </section>`;
}
