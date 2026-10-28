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
// TH vs LEADTIME differences in the same shape as the cell-level issues.
export function sheetIssueList(sheetCheck) {
  const mismatches = (sheetCheck?.mismatches || []).map((item) => ({
    type: 'sheet_mismatch', cell: item.row, po: item.po, ref: item.ref, value: item.quantity,
    reason: `Dòng ${item.row} (PO ${item.po}, REF ${item.ref}) ${item.note}: sheet TH và sheet LEADTIME tương ứng phải có cùng dòng và cùng LINE QTY.`,
    suggestion: 'Đối chiếu dòng này giữa sheet TH và sheet LEADTIME, sửa bên sai.',
    howToCheck: `Tìm PO ${item.po} trong sheet TH và sheet LEADTIME.`
  }));
  return [...(sheetCheck?.cells?.issues || []), ...mismatches];
}

export const ISSUE_GROUPS = { ...ISSUE_TYPES, sheet_mismatch: { title: 'TH lệch sheet LEADTIME', severity: 'warning', autoFix: false } };

function rowContext(issue) {
  if (issue.date) return `Cột ngày PXC ${day(issue.date)}`;
  const parts = [
    issue.line && `LINE ${issue.line}`, issue.customer, issue.po && `PO ${issue.po}`,
    issue.ticket && issue.ticket !== '0' && `phiếu ${issue.ticket}`, issue.quantity ? `SL ${number(issue.quantity)}` : '',
    issue.input && `IN ${day(issue.input).slice(0, 5)}`, issue.output && `OUT ${day(issue.output).slice(0, 5)}`, issue.leadTime
  ].filter(Boolean);
  return parts.join(' · ');
}

// Problems found in the booking's TH sheet: a summary by kind (fixed on export or to review),
// a search box, then every problem with its row, values, reasoning and how to check it.
function renderSheetIssues(sheetCheck, booking) {
  if (!sheetCheck?.cells?.checked) {
    return '<p class="check-note">Lần nhập này chưa có kiểm tra chi tiết. Nhập lại file booking để xem lỗi theo từng ô.</p>';
  }
  const issues = sheetIssueList(sheetCheck);
  if (!issues.length) return '<p class="check-note check-clean"><i class="ph ph-check-circle"></i> Không phát hiện lỗi nào trong sheet TH.</p>';
  const weekRows = new Set((booking.rows || []).map((row) => `${row.po}|${row.ref}`));
  const weekDays = new Set((booking.days || []).map((item) => item.date));
  const inWeek = (issue) => (issue.date ? weekDays.has(issue.date) : weekRows.has(`${issue.po}|${issue.ref}`));
  const groups = Object.entries(ISSUE_GROUPS)
    .map(([type, info]) => ({ type, info, items: issues.filter((issue) => issue.type === type) }))
    .filter((group) => group.items.length);
  const fixed = groups.filter((group) => group.info.autoFix).reduce((sum, group) => sum + group.items.length, 0);
  const summary = `<div class="issue-summary">
    <div><strong>${number(issues.length)}</strong><span>lỗi trong ${number(sheetCheck.cells.rowCount || 0)} dòng TH</span></div>
    <div class="issue-summary--fixed"><strong>${number(fixed)}</strong><span>sẽ tự sửa khi xuất</span></div>
    <div class="issue-summary--review"><strong>${number(issues.length - fixed)}</strong><span>cần người kế hoạch kiểm tra</span></div>
    <div><strong>${number(issues.filter(inWeek).length)}</strong><span>thuộc tuần đang chọn</span></div>
  </div>
  <table class="issue-overview"><tbody>${groups.map(({ info, items }) => `<tr><th>${escapeHtml(info.title)}</th><td>${number(items.length)}</td><td>${info.autoFix ? '<span class="result-pill result-pill--ok">tự sửa khi xuất</span>' : '<span class="result-pill result-pill--warn">cần kiểm tra</span>'}</td></tr>`).join('')}</tbody></table>
  <label class="issue-search"><i class="ph ph-magnifying-glass"></i><input type="search" data-issue-search placeholder="Tìm theo ô (M2450), PO, mã hàng, số phiếu…" /></label>`;

  return summary + groups.map(({ info, items }) => {
    const sorted = [...items].sort((a, b) => inWeek(b) - inWeek(a));
    const weekCount = items.filter(inWeek).length;
    const rows = sorted.slice(0, ISSUES_SHOWN).map((issue) => {
      const search = [issue.cell, issue.po, issue.ref, issue.color, issue.ticket, issue.line].filter(Boolean).join(' ').toLocaleLowerCase('vi-VN');
      return `<tbody class="issue-item${inWeek(issue) ? ' issue-in-week' : ''}" data-issue-text="${escapeHtml(search)}">
      <tr>
        <th>${escapeHtml(issue.cell)}</th>
        <td class="th-left issue-context">${escapeHtml(rowContext(issue))}</td>
        <td class="th-left">${escapeHtml(issue.ref || '—')}<small title="${escapeHtml(issue.color || '')}">${escapeHtml(colorName(issue.color) || '')}</small></td>
        <td class="issue-value">${cellValue(issue.value)}</td>
        <td class="issue-expected">${cellValue(issue.expected)}</td>
        <td>${info.autoFix ? '<span class="result-pill result-pill--ok">Tự sửa</span>' : '<span class="result-pill result-pill--warn">Kiểm tra</span>'}${inWeek(issue) ? '<span class="result-pill result-pill--info">tuần này</span>' : ''}</td>
      </tr>
      <tr class="issue-detail"><td colspan="6">
        <p><b>Lý do:</b> ${escapeHtml(issue.reason || '')}</p>
        ${issue.suggestion ? `<p><b>Đề xuất:</b> ${escapeHtml(issue.suggestion)}</p>` : ''}
        ${issue.howToCheck ? `<p><b>Cách kiểm tra:</b> ${escapeHtml(issue.howToCheck)}</p>` : ''}
      </td></tr>
    </tbody>`;
    }).join('');
    return `<details class="issue-group issue-group--${info.severity}"${weekCount ? ' open' : ''}>
      <summary><strong>${escapeHtml(info.title)}</strong><span>${number(items.length)} lỗi${weekCount ? ` · ${number(weekCount)} trong tuần này` : ''} · ${info.autoFix ? 'tự sửa khi xuất' : 'cần kiểm tra'}</span></summary>
      <div class="table-wrap"><table class="delivery-table issue-table"><thead><tr><th>Ô</th><th class="th-left">Dòng trong file</th><th class="th-left">Mã hàng · Màu</th><th>Trong file</th><th>Đúng ra</th><th>Xử lý</th></tr></thead>${rows}</table></div>
      ${items.length > ISSUES_SHOWN ? `<p class="check-note">Hiện ${number(ISSUES_SHOWN)} / ${number(items.length)} lỗi — tải danh sách lỗi để xem đủ.</p>` : ''}
    </details>`;
  }).join('');
}

// Rows the reader fixed or could not fix by Mã hàng + Model (booking-columns.js).
function renderRepairs(repairs) {
  if (!repairs?.length) return '';
  const applied = repairs.filter((repair) => repair.applied);
  const review = repairs.filter((repair) => !repair.applied);
  const table = (items) => `<div class="table-wrap"><table class="delivery-table repair-table">
    <thead><tr><th class="th-left">Ô</th><th class="th-left">PO / Mã hàng</th><th class="th-left">Cột</th><th class="th-left">Trong file</th><th class="th-left">App dùng</th><th class="th-left">Lý do</th></tr></thead>
    <tbody>${items.map((repair) => `<tr>
      <td class="delivery-table__left">${escapeHtml(repair.sheet || 'TH')} · dòng ${number(repair.sheetRow)}</td>
      <td class="delivery-table__left">${escapeHtml(repair.po || '—')}<small>${escapeHtml(repair.ref || '')}</small></td>
      <td class="delivery-table__left">${escapeHtml(repair.field)}</td>
      <td class="delivery-table__left">${escapeHtml(repair.found)}</td>
      <td class="delivery-table__left"><strong>${escapeHtml(repair.used)}</strong></td>
      <td class="delivery-table__left repair-reason">${escapeHtml(repair.reason)}</td>
    </tr>`).join('')}</tbody></table></div>`;
  return `<section class="check-block"><h3>Đọc theo Mã hàng + Model <span class="check-count">${number(repairs.length)}</span></h3>
    <p class="check-note">App đọc cột theo tên (không phân biệt dấu, hoa thường, tên gọi khác như “Mã hàng”, “Model”, “Màu”) và đối chiếu từng dòng với các model của mã hàng đó trong chính file booking.</p>
    ${applied.length ? `<h4 class="repair-heading repair-heading--ok"><i class="ph ph-wrench"></i>Đã tự sửa ${number(applied.length)} chỗ</h4>${table(applied)}` : ''}
    ${review.length ? `<h4 class="repair-heading repair-heading--warn"><i class="ph ph-warning"></i>Cần người kiểm tra ${number(review.length)} chỗ (app không tự đoán)</h4>${table(review)}` : ''}
  </section>`;
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
    ${renderRepairs(sheetCheck?.repairs)}
    <section class="check-block"><h3>Lỗi trong sheet TH ${issueCount ? `<span class="check-count">${number(issueCount)}</span>` : ''}${issueCount ? '<button type="button" class="link-refresh issue-download" data-download-issues><i class="ph ph-download-simple"></i>Tải danh sách lỗi (cả file)</button>' : ''}</h3>
      ${renderSheetIssues(sheetCheck, booking)}
      ${issueCount ? '<p class="check-note">Đây là lỗi trong dữ liệu nhập của sheet TH. Khi xuất, PXI TRẢ gõ nhầm năm được sửa (ô có ghi chú giá trị cũ); SLHĐ TỔNG, TỔNG NGÀY, TỔNG TUẦN luôn được tính lại; các lỗi còn lại cần người kế hoạch sửa trong file booking.</p>' : ''}
    </section>
    <section class="check-block"><h3>Xem trước ${number(Math.min(PREVIEW_ROWS, rows.length))} / ${number(rows.length)} dòng sẽ xuất</h3>
      <div class="table-wrap"><table class="delivery-table check-preview"><thead><tr><th>PO</th><th class="th-left">Mã hàng</th><th class="th-left">Model</th><th class="th-left">Màu</th><th>SL tuần</th><th>Nhận BTP</th><th>Đã in (giao)</th><th>Còn thiếu</th><th>Hạn giao</th><th>Trạng thái lô</th></tr></thead>
      <tbody>${preview || '<tr><td colspan="10" class="delivery-table__empty">Không có dòng nào.</td></tr>'}</tbody></table></div>
      <p class="check-note">File xuất gồm 2 sheet: TH (giống file booking, chỉ các dòng và ngày của tuần) và CAN DOI (mỗi lô một dòng, số lượng từng ngày, Thực nhận / Đã in / Đã giao / GAP lấy từ file nhận và file giao).</p>
    </section>`;
}
