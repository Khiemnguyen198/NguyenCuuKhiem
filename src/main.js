import '@phosphor-icons/web/regular';
import './styles.css';
import { analyzeBookingRows } from './local-ai.js';
import { bestStandardSheet } from './config-ai.js';
import { calculateCapacity } from './capacity.js';
import { extractBookingRows, readWorkbook, summarizeBooking } from './booking-import.js';
import { workWeekLabel } from './calendar.js';
import { DEMO_DASHBOARD } from './demo-data.js';
import { escapeHtml, formatFileDate, formatNumber } from './format.js';
import { readJson, writeJson } from './storage.js';
import { appTemplate } from './template.js';
import { PAGE_SIZE, customerLogo, matchesFilters, renderCustomerRows, renderKpis, renderModelRows } from './models-view.js';
import { readWarehouseWorkbook, summarizeWarehouse } from './warehouse-import.js';
import { compactRows, diffBookingRows } from './booking-diff.js';
import { renderChangeList, renderChangeReport, unreviewedCount } from './changes-view.js';

const isStaticPages = import.meta.env.PROD || import.meta.env.BASE_URL !== '/';

const fallbackDashboard = DEMO_DASHBOARD;

const defaultSettings = {
  minutesPerImpression: null,
  setupMinutesPerPo: 0,
  machineCount: null,
  shiftsPerDay: 1,
  minutesPerShift: 480,
  efficiencyPercent: 85,
  planningDays: 6
};

let dashboardState = fallbackDashboard;
let settingsState = { ...defaultSettings };
let activeImportId = fallbackDashboard.importId;
let standardsState = [];
let selectedStandardId = null;
let standardEditConfirmed = false;
let fileHistoryState = [{
  id: 'demo-original',
  importId: 'demo-plan',
  category: 'original',
  filename: fallbackDashboard.filename,
  createdAt: '2026-10-26T14:32:00+07:00',
  rowCount: fallbackDashboard.rowCount,
  totalQuantity: fallbackDashboard.totalQuantity,
  note: 'File gốc được giữ nguyên; hệ thống chỉ đọc dữ liệu.'
}];

document.querySelector('#app').innerHTML = appTemplate({ isStaticPages, ...workWeekLabel() });

function renderDashboard(data) {
  dashboardState = { ...fallbackDashboard, ...data };
  document.querySelector('#filename').textContent = data.filename;
  const sourceLabel = data.source === 'sqlite' ? 'Đã lưu SQLite' : data.source === 'browser' ? 'Đã đọc trong trình duyệt' : 'Dữ liệu mẫu';
  document.querySelector('#fileMeta').textContent = `${sourceLabel} • ${formatNumber.format(data.rowCount)} dòng`;
  document.querySelector('#rowCount').textContent = `${formatNumber.format(data.rowCount)} dòng booking`;
  document.querySelector('#totalQuantity').textContent = formatNumber.format(data.totalQuantity);
  document.querySelector('#totalImpressions').textContent = formatNumber.format(data.totalImpressions);
  document.querySelector('#overviewBooking').textContent = formatNumber.format(data.totalQuantity);
  document.querySelector('#overviewImpressions').textContent = formatNumber.format(data.totalImpressions);
  renderMachineCalculation();
}

function emptyHistory(label) {
  return `<div class="history-empty"><i class="ph ph-tray"></i><strong>Chưa có ${label}</strong><span>Dữ liệu sẽ xuất hiện tại đây khi có thao tác thực tế.</span></div>`;
}

function fileAction(file) {
  if (file.id === 'demo-original') return '<span class="history-row__status">Mẫu</span>';
  const category = file.category === 'original' ? 'processed' : file.category === 'processed' ? 'delivered' : null;
  if (!category) return '<span class="history-row__status">Đã giao</span>';
  const done = fileHistoryState.some((item) => item.category === category && item.importId === file.importId);
  const label = category === 'processed' ? 'Đánh dấu đã xử lý' : 'Đánh dấu đã giao';
  return done ? '<span class="history-row__status">Đã ghi nhận</span>' : `<button class="history-action" data-file-id="${escapeHtml(file.id)}" data-category="${category}" aria-label="${label}: ${escapeHtml(file.filename)}">${label}</button>`;
}

function saveBrowserFiles(files) {
  if (!writeJson('planner-file-history', files.filter((file) => file.id !== 'demo-original'))) showToast('Trình duyệt không cho lưu lịch sử file.', 'error');
}

async function markFile(fileId, category) {
  const file = fileHistoryState.find((item) => String(item.id) === fileId);
  if (!file || file.id === 'demo-original') throw new Error('Không tìm thấy file đã nhập.');
  const expected = file.category === 'original' ? 'processed' : file.category === 'processed' ? 'delivered' : null;
  if (category !== expected) throw new Error('Trạng thái file không hợp lệ.');
  if (isStaticPages) {
    if (!fileHistoryState.some((item) => item.importId === file.importId && item.category === category)) {
      const files = [{ ...file, id: crypto.randomUUID(), category, createdAt: new Date().toISOString(), note: category === 'processed' ? 'Người dùng xác nhận đã xử lý.' : 'Người dùng xác nhận đã giao.' }, ...fileHistoryState];
      saveBrowserFiles(files);
      renderFileHistory(files);
    }
  } else {
    const response = await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: file.id, category }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Không thể cập nhật file.');
    renderFileHistory(payload.files);
  }
  showToast(category === 'processed' ? 'Đã ghi nhận file đã xử lý.' : 'Đã ghi nhận file đã giao.');
}

function fileRow(file) {
  const meta = [file.rowCount ? `${formatNumber.format(file.rowCount)} dòng` : null, file.totalQuantity ? `${formatNumber.format(file.totalQuantity)} sản phẩm` : null].filter(Boolean).join(' • ');
  const safeFilename = escapeHtml(file.filename);
  return `
    <article class="history-row">
      <span class="history-row__icon"><i class="ph ph-file-xls"></i></span>
      <div class="history-row__body"><strong title="${safeFilename}">${safeFilename}</strong><span>${escapeHtml(meta || file.note || 'File sản xuất')}</span><small>${escapeHtml(formatFileDate(file.createdAt))}</small></div>
      ${fileAction(file)}
    </article>
  `;
}

function planRow(file) {
  const safeFilename = escapeHtml(file.filename);
  const metadata = [
    file.rowCount ? `${formatNumber.format(file.rowCount)} dòng booking` : null,
    file.totalQuantity ? `${formatNumber.format(file.totalQuantity)} sản phẩm` : null
  ].filter(Boolean).join(' • ');
  return `
    <button class="plan-row" data-plan-id="${escapeHtml(file.importId)}">
      <span class="plan-row__icon"><i class="ph ph-calendar-check"></i></span>
      <span class="plan-row__body"><strong title="${safeFilename}">${safeFilename}</strong><span>${escapeHtml(metadata || 'Kế hoạch sản xuất')}</span><small>Cập nhật ${escapeHtml(formatFileDate(file.createdAt))}</small></span>
      <span class="plan-row__status"><i class="ph ph-check-circle"></i>Sẵn sàng điều phối</span>
      <i class="ph ph-caret-right plan-row__arrow"></i>
    </button>
  `;
}

function renderPlanList(files = fileHistoryState) {
  const plans = files.filter((file) => file.category === 'original');
  document.querySelector('#planCount').textContent = formatNumber.format(plans.length);
  document.querySelector('#planFiles').innerHTML = plans.length
    ? plans.map(planRow).join('')
    : '<div class="plan-list-empty"><i class="ph ph-calendar-x"></i><strong>Chưa có file kế hoạch</strong><span>Nhấn “Nhập file booking” để tạo kế hoạch đầu tiên.</span></div>';
}

function renderFileHistory(files = fileHistoryState) {
  fileHistoryState = files;
  const groups = {
    delivered: files.filter((file) => file.category === 'delivered'),
    processed: files.filter((file) => file.category === 'processed' && !files.some((event) => event.category === 'delivered' && event.importId === file.importId)),
    original: files.filter((file) => file.category === 'original')
  };
  for (const [category, items] of Object.entries(groups)) {
    document.querySelector(`#${category}Count`).textContent = formatNumber.format(items.length);
    document.querySelector(`#${category}Badge`).textContent = formatNumber.format(items.length);
    document.querySelector(`#${category}Files`).innerHTML = items.length ? items.map(fileRow).join('') : emptyHistory(category === 'delivered' ? 'file đã giao' : category === 'processed' ? 'file đã xử lý' : 'file gốc');
  }
  renderPlanList(files);
}

async function loadFileHistory() {
  if (isStaticPages) {
    const stored = readJson('planner-file-history', []);
    if (Array.isArray(stored) && stored.length) fileHistoryState = stored;
    renderFileHistory(fileHistoryState);
    return;
  }
  try {
    const response = await fetch('/api/files');
    if (!response.ok) throw new Error();
    const payload = await response.json();
    renderFileHistory(payload.files);
  } catch {
    renderFileHistory(fileHistoryState);
  }
}

function saveBrowserStandards(standards) {
  // Unsaved drafts stay in memory only.
  if (!writeJson('planner-production-standards', standards.filter((item) => !item.isDraft))) showToast('Trình duyệt không cho lưu định mức.', 'error');
}

function standardRow(standard) {
  return `
    <button class="standard-row${String(standard.id) === String(selectedStandardId) ? ' standard-row--active' : ''}" data-standard-id="${escapeHtml(standard.id)}">
      <span class="standard-row__icon"><i class="ph ph-timer"></i></span>
      <span class="standard-row__copy"><strong>${escapeHtml(standard.name)}</strong><small>${formatNumber.format(standard.minutesPerImpression)} phút / lượt hình</small></span>
      ${standard.isDefault ? '<span class="default-badge">Mặc định</span>' : ''}
      <i class="ph ph-caret-right"></i>
    </button>
  `;
}

function renderStandardList(query = '') {
  const normalized = query.trim().toLocaleLowerCase('vi-VN');
  const standards = standardsState.filter((standard) => standard.name.toLocaleLowerCase('vi-VN').includes(normalized));
  document.querySelector('#standardsCount').textContent = `${formatNumber.format(standardsState.length)} cấu hình`;
  document.querySelector('#standardList').innerHTML = standards.length
    ? standards.map(standardRow).join('')
    : '<div class="standard-list-empty"><i class="ph ph-folder-open"></i><strong>Chưa có định mức</strong><span>Nhập Excel hoặc tạo cấu hình thủ công.</span></div>';
}

function setStandardEditable(editable) {
  document.querySelector('#standardFields').disabled = !editable;
  document.querySelector('#unlockStandard').hidden = editable;
  document.querySelector('#saveStandard').hidden = !editable;
  document.querySelector('#machineSuggestionPanel').hidden = !editable;
  const lock = document.querySelector('#standardLockState');
  lock.innerHTML = editable ? '<i class="ph ph-lock-key-open"></i>Đang chỉnh sửa' : '<i class="ph ph-lock-key"></i>Đang khóa';
  lock.dataset.unlocked = editable ? 'true' : 'false';
}

function selectStandard(id) {
  const standard = standardsState.find((item) => String(item.id) === String(id));
  if (!standard) return;
  selectedStandardId = standard.id;
  standardEditConfirmed = false;
  document.querySelector('#standardEmpty').hidden = true;
  const form = document.querySelector('#standardForm');
  form.hidden = false;
  for (const [name, value] of Object.entries(standard)) {
    if (form.elements[name]) form.elements[name].value = value ?? '';
  }
  document.querySelector('#standardTitle').textContent = standard.name;
  document.querySelector('#standardSource').textContent = standard.source === 'excel' ? `EXCEL · ${standard.sourceFilename || 'FILE CẤU HÌNH'}` : 'NHẬP THỦ CÔNG';
  document.querySelector('#standardUpdated').textContent = standard.updatedAt ? `Cập nhật ${formatFileDate(standard.updatedAt)}` : 'Chưa lưu';
  document.querySelector('#applyStandard').innerHTML = standard.isDefault
    ? '<i class="ph ph-check-circle"></i>Đang dùng để tính kế hoạch'
    : '<i class="ph ph-check-circle"></i>Dùng để tính kế hoạch';
  document.querySelector('#applyStandard').disabled = Boolean(standard.isDefault);
  setStandardEditable(Boolean(standard.isDraft));
  renderStandardList(document.querySelector('#standardSearch').value);
}

async function loadStandards() {
  try {
    if (isStaticPages) {
      const stored = readJson('planner-production-standards', []);
      standardsState = Array.isArray(stored) ? stored : [];
    } else {
      const response = await fetch('/api/standards');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Không thể đọc danh mục định mức.');
      standardsState = payload.standards;
    }
    renderStandardList();
    if (standardsState.length) selectStandard(standardsState.find((item) => item.isDefault)?.id || standardsState[0].id);
    else {
      document.querySelector('#standardForm').hidden = true;
      document.querySelector('#standardEmpty').hidden = false;
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function standardFromForm() {
  const form = document.querySelector('#standardForm');
  const numberValue = (name) => form.elements[name].value === '' ? null : Number(form.elements[name].value);
  return {
    id: selectedStandardId,
    name: form.elements.name.value.trim(),
    minutesPerImpression: numberValue('minutesPerImpression'),
    setupMinutesPerPo: numberValue('setupMinutesPerPo'),
    machineCount: numberValue('machineCount'),
    shiftsPerDay: numberValue('shiftsPerDay'),
    minutesPerShift: numberValue('minutesPerShift'),
    efficiencyPercent: numberValue('efficiencyPercent'),
    planningDays: numberValue('planningDays'),
    note: form.elements.note.value.trim()
  };
}

async function saveImportedStandards(standards, sourceFilename) {
  if (isStaticPages) {
    const existing = standardsState.filter((item) => !standards.some((incoming) => incoming.name.toLocaleLowerCase('vi-VN') === item.name.toLocaleLowerCase('vi-VN')));
    const imported = standards.map((standard, index) => ({
      ...standard, id: crypto.randomUUID(), source: 'excel', sourceFilename,
      isDefault: index === 0, locked: true, updatedAt: new Date().toISOString()
    }));
    standardsState = [...imported, ...existing.map((item) => ({ ...item, isDefault: false }))];
    saveBrowserStandards(standardsState);
  } else {
    const response = await fetch('/api/standards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standards, source: 'excel', sourceFilename, makeDefault: true })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Không thể lưu file cấu hình.');
    standardsState = payload.standards;
  }
  renderStandardList();
  const active = standardsState.find((item) => item.isDefault) || standardsState[0];
  selectStandard(active.id);
  await applyStandardToPlan(active, false);
}

const PAGE_COPY = {
  'Tổng quan': ['KHẢ NĂNG GIAO HÀNG', 'Tổng quan'],
  'Mã hàng': ['GIAO BÁN THÀNH PHẨM', 'Theo mã hàng'],
  'Kế hoạch': ['DANH SÁCH KẾ HOẠCH', 'Kế hoạch'],
  'Cấu hình': ['THÔNG SỐ & ĐỊNH MỨC', 'Cấu hình']
};

function showPage(pageName) {
  const isOverview = pageName === 'Tổng quan';
  const isModels = pageName === 'Mã hàng';
  const isPlanList = pageName === 'Kế hoạch';
  const isConfig = pageName === 'Cấu hình';
  document.querySelector('#overviewView').hidden = !isOverview;
  document.querySelector('#modelsView').hidden = !isModels;
  document.querySelector('#planListView').hidden = !isPlanList;
  document.querySelector('#configView').hidden = !isConfig;
  document.querySelector('#planningView').hidden = true;
  document.querySelector('#backToPlans').hidden = true;
  document.querySelector('#importButton').hidden = isConfig || isModels;
  const [eyebrow, title] = PAGE_COPY[pageName];
  document.querySelector('#pageEyebrow').textContent = eyebrow;
  document.querySelector('#pageTitle').textContent = title;
  if (isOverview || isPlanList) loadFileHistory();
  if (isModels) loadWarehouse();
  if (isConfig) loadStandards();
}

function openPlanView() {
  document.querySelector('#overviewView').hidden = true;
  document.querySelector('#modelsView').hidden = true;
  document.querySelector('#planListView').hidden = true;
  document.querySelector('#configView').hidden = true;
  document.querySelector('#planningView').hidden = false;
  document.querySelector('#backToPlans').hidden = false;
  document.querySelector('#importButton').hidden = false;
  document.querySelector('#pageEyebrow').textContent = 'KẾ HOẠCH SẢN XUẤT';
  document.querySelector('#pageTitle').textContent = 'Điều phối kế hoạch';
}

async function openPlanDetail(importId = null) {
  activeImportId = importId || fallbackDashboard.importId;
  openPlanView();
  await loadDashboard(importId);
  await loadAiCheck(activeImportId);
}

function aiStatusCopy(report) {
  if (report.status === 'good') return { title: 'Dữ liệu tốt', meta: 'Không phát hiện lỗi đáng kể', icon: 'ph-check-circle' };
  if (report.status === 'review') return { title: 'Nên kiểm tra lại', meta: `${formatNumber.format(report.findingCount)} điểm cần chú ý`, icon: 'ph-warning' };
  if (report.status === 'danger') return { title: 'Có lỗi cần xử lý', meta: `${formatNumber.format(report.findingCount)} bất thường được phát hiện`, icon: 'ph-warning-circle' };
  return { title: 'Chưa có dữ liệu', meta: 'Nhập file booking để bắt đầu', icon: 'ph-info' };
}

function renderAiCheck(report) {
  const copy = aiStatusCopy(report);
  const state = document.querySelector('#dataCheckState');
  state.dataset.status = report.status;
  state.querySelector('i').className = `ph ${copy.icon}`;
  document.querySelector('#dataCheckTitle').textContent = copy.title;
  document.querySelector('#dataCheckMeta').textContent = copy.meta;
  const score = document.querySelector('#aiScore');
  score.textContent = report.score == null ? '—' : report.score;
  score.dataset.status = report.status;
  const container = document.querySelector('#aiFindings');
  if (!report.findings?.length) {
    container.innerHTML = `<div class="ai-empty ai-empty--good"><i class="ph ph-${report.status === 'empty' ? 'database' : 'check-circle'}"></i><strong>${report.status === 'empty' ? 'Chưa có kết quả kiểm tra' : 'Không phát hiện bất thường'}</strong><span>${report.status === 'empty' ? 'File mẫu không nằm trong SQLite. Hãy nhập file booking thật.' : `Đã rà soát ${formatNumber.format(report.rowCount)} dòng booking.`}</span></div>`;
    return;
  }
  container.innerHTML = report.findings.map((finding) => `
    <article class="ai-finding ai-finding--${escapeHtml(finding.severity)}">
      <i class="ph ph-${finding.severity === 'danger' ? 'warning-circle' : finding.severity === 'warning' ? 'warning' : 'chart-line-up'}"></i>
      <div><strong>${escapeHtml(finding.title)}</strong><span>${formatNumber.format(finding.count)} dòng · ${escapeHtml(finding.description)}</span>${finding.samples?.length ? `<small>Ví dụ: ${finding.samples.map((sample) => `dòng ${formatNumber.format(sample.row)} / PO ${escapeHtml(sample.po)}`).join(', ')}</small>` : ''}</div>
    </article>
  `).join('');
}

async function loadAiCheck(importId, force = false) {
  document.querySelector('#aiFindings').innerHTML = '<div class="ai-empty"><i class="ph ph-spinner-gap spin"></i><strong>AI local đang kiểm tra</strong><span>Đọc dữ liệu booking và tìm điểm bất thường…</span></div>';
  try {
    if (isStaticPages) {
      const file = fileHistoryState.find((item) => item.category === 'original' && String(item.importId) === String(importId));
      renderAiCheck(file?.aiReport || { status: 'empty', score: null, rowCount: 0, findingCount: 0, findings: [] });
      return;
    }
    const response = await fetch(`/api/ai-check?id=${encodeURIComponent(importId)}${force ? '&force=1' : ''}`);
    const report = await response.json();
    if (!response.ok) throw new Error(report.error || 'Không thể kiểm tra file.');
    renderAiCheck(report);
  } catch (error) {
    renderAiCheck({ status: 'empty', score: null, rowCount: 0, findingCount: 0, findings: [] });
    showToast(error.message, 'error');
  }
}

function assuranceCopy(calculation) {
  if (!calculation) return { label: 'Chưa đủ cấu hình', state: 'pending', icon: 'info' };
  if (calculation.coverageRate >= 1) return { label: 'Đảm bảo theo năng lực', state: 'ok', icon: 'check-circle' };
  if (calculation.coverageRate >= 0.9) return { label: 'Có nguy cơ trễ', state: 'warn', icon: 'warning' };
  return { label: 'Chưa đảm bảo', state: 'danger', icon: 'warning-circle' };
}

function shortDay(isoDate) {
  const match = String(isoDate || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return match ? `${match[2]}/${match[1]}` : null;
}

function dateRange(first, last) {
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

const countOrDash = (value) => (value == null ? '—' : formatNumber.format(value));

function leadtimeRows(calculation) {
  const groups = dashboardState.leadTimes || [];
  if (!groups.length) return '<tr><td colspan="9" class="delivery-table__empty">File chưa có dữ liệu leadtime.</td></tr>';
  const copy = assuranceCopy(calculation);
  return groups.map((group) => {
    const quantity = Number(group.totalQuantity || 0);
    const deliverable = calculation ? Math.floor(quantity * calculation.coverageRate) : null;
    const shortage = deliverable == null ? null : Math.max(0, quantity - deliverable);
    const dueDate = shortDay(group.lastOutput);
    return `<tr>
      <th>${escapeHtml(group.leadTime)}${dueDate ? `<small>Hạn ${dueDate}</small>` : ''}</th>
      <td class="delivery-table__customers">${customerCell(group.customers)}</td>
      <td>${countOrDash(group.modelCount)}<small>mã</small></td>
      <td>${countOrDash(group.poCount)}<small>hợp đồng</small></td>
      <td><strong>${formatNumber.format(quantity)}</strong><small>${formatNumber.format(group.rowCount || 0)} dòng</small></td>
      <td>${formatNumber.format(quantity)}<small>Nhập ${dateRange(group.firstInput, group.lastInput)}</small></td>
      <td>${deliverable == null ? '—' : formatNumber.format(deliverable)}<small>Xuất ${dateRange(group.firstOutput, group.lastOutput)}</small></td>
      <td>${shortage == null ? '—' : formatNumber.format(shortage)}</td>
      <td><span class="result-pill result-pill--${copy.state}">${copy.label}</span></td>
    </tr>`;
  }).join('');
}

function renderMachineCalculation() {
  const calculation = calculateCapacity(dashboardState, settingsState);
  const copy = assuranceCopy(calculation);
  const overviewAssurance = document.querySelector('#overviewAssurance');
  overviewAssurance.className = `assurance-badge assurance-badge--${copy.state}`;
  overviewAssurance.innerHTML = `<i class="ph ph-${copy.icon}"></i><span><small>Kết luận</small><strong>${copy.label}</strong></span>`;
  document.querySelector('#overviewLeadtimeBody').innerHTML = leadtimeRows(calculation);
  document.querySelector('#planLeadtimeBody').innerHTML = leadtimeRows(calculation);
  if (!calculation) {
    ['#printableQuantity', '#deliverableQuantity', '#overviewPrintable', '#overviewDeliverable', '#requiredMinutes', '#availableMinutes', '#coverageRate'].forEach((selector) => {
      document.querySelector(selector).textContent = '—';
    });
    document.querySelector('#planShortage').textContent = 'Chờ cấu hình định mức';
    document.querySelector('#overviewShortage').textContent = 'Cần cấu hình định mức';
    document.querySelector('#machinesRequired').textContent = 'Cấu hình năng lực';
    document.querySelector('#machineMetricMeta').textContent = 'Nhập phút và số máy';
    const planAssurance = document.querySelector('#planAssurance');
    planAssurance.className = 'plan-assurance plan-assurance--pending';
    planAssurance.querySelector('strong').textContent = copy.label;
    return;
  }
  document.querySelector('#printableQuantity').textContent = formatNumber.format(calculation.printableQuantity);
  document.querySelector('#deliverableQuantity').textContent = formatNumber.format(calculation.deliverableQuantity);
  document.querySelector('#overviewPrintable').textContent = formatNumber.format(calculation.printableQuantity);
  document.querySelector('#overviewDeliverable').textContent = formatNumber.format(calculation.deliverableQuantity);
  const shortageText = calculation.shortageQuantity
    ? `Thiếu ${formatNumber.format(calculation.shortageQuantity)} sản phẩm`
    : 'Đủ theo booking';
  document.querySelector('#planShortage').textContent = shortageText;
  document.querySelector('#overviewShortage').textContent = shortageText;
  document.querySelector('#requiredMinutes').textContent = formatNumber.format(Math.round(calculation.requiredMinutes));
  document.querySelector('#availableMinutes').textContent = formatNumber.format(Math.round(calculation.availableMinutes));
  document.querySelector('#coverageRate').textContent = `${formatNumber.format(Math.round(calculation.coverageRate * 100))}%`;
  document.querySelector('#machinesRequired').textContent = `${formatNumber.format(calculation.machinesRequired)} máy cần`;
  document.querySelector('#machineMetricMeta').textContent = calculation.gap >= 0
    ? `Đang có ${formatNumber.format(settingsState.machineCount)} máy`
    : `Thiếu ${formatNumber.format(Math.abs(calculation.gap))} máy`;
  const planAssurance = document.querySelector('#planAssurance');
  planAssurance.className = `plan-assurance plan-assurance--${copy.state}`;
  planAssurance.querySelector('strong').textContent = copy.label;
}

function fillSettingsForm(settings = settingsState) {
  const form = document.querySelector('#settingsForm');
  Object.entries(settings).forEach(([name, value]) => {
    if (form.elements[name]) form.elements[name].value = value ?? '';
  });
  renderCalculationPreview();
}

function settingsFromForm() {
  const form = document.querySelector('#settingsForm');
  return Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, Number(value)]));
}

function renderCalculationPreview() {
  const preview = document.querySelector('#calculationPreview');
  const calculation = calculateCapacity(dashboardState, settingsFromForm());
  if (!calculation) {
    preview.innerHTML = '<i class="ph ph-calculator"></i><span>Nhập phút/lượt hình và số máy để xem kết quả.</span>';
    return;
  }
  preview.innerHTML = `
    <div><span>Tổng phút cần</span><strong>${formatNumber.format(Math.round(calculation.requiredMinutes))}</strong></div>
    <div><span>Công suất / máy</span><strong>${formatNumber.format(Math.round(calculation.capacityPerMachine))} phút</strong></div>
    <div><span>Máy cần</span><strong>${formatNumber.format(calculation.machinesRequired)}</strong></div>
  `;
}

function openSettings() {
  fillSettingsForm();
  const modal = document.querySelector('#settingsModal');
  modal.classList.add('modal--open');
  modal.setAttribute('aria-hidden', 'false');
  modal.querySelector('input')?.focus();
}

function closeSettings() {
  const modal = document.querySelector('#settingsModal');
  modal.classList.remove('modal--open');
  modal.setAttribute('aria-hidden', 'true');
}

async function loadSettings() {
  if (isStaticPages) {
    settingsState = { ...defaultSettings, ...readJson('planner-settings', {}) };
    renderMachineCalculation();
    return;
  }
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) throw new Error();
    settingsState = { ...defaultSettings, ...await response.json() };
    renderMachineCalculation();
  } catch {
    settingsState = { ...defaultSettings };
  }
}

async function persistSettings(settings) {
  if (isStaticPages) {
    if (!writeJson('planner-settings', settings)) throw new Error('Trình duyệt không cho lưu cấu hình.');
    settingsState = settings;
  } else {
    const response = await fetch('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Không thể lưu cấu hình.');
    settingsState = payload;
  }
  renderMachineCalculation();
}

async function applyStandardToPlan(standard, updateDefault = true) {
  const fields = ['minutesPerImpression', 'setupMinutesPerPo', 'machineCount', 'shiftsPerDay', 'minutesPerShift', 'efficiencyPercent', 'planningDays'];
  const settings = { ...defaultSettings, ...settingsState };
  fields.forEach((field) => {
    if (standard[field] != null && standard[field] !== '') settings[field] = Number(standard[field]);
  });
  await persistSettings(settings);
  if (updateDefault) {
    if (isStaticPages) {
      standardsState = standardsState.map((item) => ({ ...item, isDefault: String(item.id) === String(standard.id) }));
      saveBrowserStandards(standardsState);
    } else {
      const response = await fetch('/api/standards', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: standard.id, setDefault: true })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Không thể đặt cấu hình mặc định.');
      standardsState = payload.standards;
    }
    selectStandard(standard.id);
  }
}

let warehouseState = { filename: null, importedAt: null, lines: [] };
let warehouseSummary = null;
const modelFilters = { customer: '', status: 'open', query: '' };
let expandedModelKey = null;
let modelLimit = PAGE_SIZE;

function latestBookingModels() {
  if (dashboardState.models?.length) return dashboardState.models;
  return fileHistoryState.find((file) => file.category === 'original' && file.models?.length)?.models || [];
}

function renderWarehouse() {
  warehouseSummary = summarizeWarehouse(warehouseState.lines, latestBookingModels());
  const { items, totals, customers } = warehouseSummary;
  document.querySelector('#warehouseMeta').textContent = warehouseState.filename
    ? `${warehouseState.filename} · nhập ${formatFileDate(warehouseState.importedAt)} · ${formatNumber.format(items.length)} mã hàng của ${formatNumber.format(customers.length)} khách`
    : 'Chưa có file kế toán kho. Nhấn “Nhập file kho” để tải sheet TỔNG HỢP.';
  document.querySelector('#modelKpis').innerHTML = renderKpis(totals);
  const select = document.querySelector('#customerFilter');
  select.innerHTML = `<option value="">Tất cả khách hàng</option>${[...customers].sort((a, b) => a.localeCompare(b, 'vi')).map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
  select.value = modelFilters.customer;
  renderModelTable();
}

function renderModelTable() {
  if (!warehouseSummary) return;
  const scoped = warehouseSummary.items.filter((item) => matchesFilters(item, { ...modelFilters, status: 'all' }));
  const filtered = scoped.filter((item) => matchesFilters(item, modelFilters));
  // Unfinished work first: overdue, then nearest due date, then largest remaining quantity.
  filtered.sort((a, b) => (b.overdue - a.overdue)
    || ((a.daysToDue ?? Infinity) - (b.daysToDue ?? Infinity))
    || (b.remaining - a.remaining));
  document.querySelector('#customerBody').innerHTML = renderCustomerRows(
    warehouseSummary.items.filter((item) => matchesFilters(item, { query: modelFilters.query, status: 'all' })),
    modelFilters.customer
  ) || '<tr><td colspan="8" class="delivery-table__empty">Chưa có dữ liệu kho.</td></tr>';
  document.querySelector('#modelBody').innerHTML = renderModelRows(filtered, expandedModelKey, modelLimit);
  document.querySelectorAll('[data-status-count]').forEach((badge) => {
    badge.textContent = formatNumber.format(scoped.filter((item) => matchesFilters(item, { status: badge.dataset.statusCount })).length);
  });
  document.querySelectorAll('#statusFilters [data-status]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.status === modelFilters.status)));
  document.querySelector('#modelCount').textContent = `Hiển thị ${formatNumber.format(Math.min(modelLimit, filtered.length))} / ${formatNumber.format(filtered.length)} mã hàng`;
  document.querySelector('#showMoreModels').hidden = filtered.length <= modelLimit;
}

async function loadWarehouse() {
  if (isStaticPages) {
    warehouseState = readJson('planner-warehouse', warehouseState);
  } else {
    try {
      const response = await fetch('/api/warehouse');
      if (response.ok) warehouseState = await response.json();
    } catch {
      showToast('Không đọc được dữ liệu kho từ SQLite.', 'error');
    }
  }
  renderWarehouse();
}

async function saveWarehouse(snapshot) {
  if (isStaticPages) {
    if (!writeJson('planner-warehouse', snapshot)) throw new Error('Trình duyệt không đủ chỗ lưu file kho.');
    warehouseState = snapshot;
    return;
  }
  const response = await fetch('/api/warehouse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Không thể lưu file kho.');
  warehouseState = payload;
}

let changesState = [];
let selectedChangeId = null;

async function loadChanges() {
  if (isStaticPages) {
    changesState = fileHistoryState
      .filter((file) => file.category === 'original' && file.changes)
      .map((file) => ({ importId: file.importId, filename: file.filename, ...file.changes }));
  } else {
    try {
      const response = await fetch('/api/changes');
      if (response.ok) changesState = (await response.json()).changes;
    } catch {
      changesState = [];
    }
  }
  renderChangesBadge();
}

function renderChangesBadge() {
  const pending = unreviewedCount(changesState);
  const badge = document.querySelector('#changesBadge');
  badge.hidden = !pending;
  badge.textContent = formatNumber.format(pending);
  document.querySelector('#changesButton').classList.toggle('changes-button--alert', Boolean(pending));
}

function renderChanges() {
  const selected = changesState.find((change) => String(change.importId) === String(selectedChangeId));
  document.querySelector('#changeList').innerHTML = renderChangeList(changesState, selectedChangeId);
  document.querySelector('#changeReport').innerHTML = renderChangeReport(selected);
  const reviewed = document.querySelector('#changeReviewed');
  reviewed.textContent = selected?.reviewedAt ? `Đã kiểm tra lúc ${formatFileDate(selected.reviewedAt)}` : selected ? 'Chưa có ai xác nhận đã kiểm tra.' : '';
  document.querySelector('#markReviewed').hidden = !selected || Boolean(selected.reviewedAt);
}

function openChanges(importId = null) {
  const firstPending = changesState.find((change) => !change.reviewedAt);
  selectedChangeId = importId ?? firstPending?.importId ?? changesState[0]?.importId ?? null;
  renderChanges();
  const modal = document.querySelector('#changesModal');
  modal.classList.add('modal--open');
  modal.setAttribute('aria-hidden', 'false');
  modal.querySelector('[data-close-changes].icon-button').focus();
}

function closeChanges() {
  const modal = document.querySelector('#changesModal');
  modal.classList.remove('modal--open');
  modal.setAttribute('aria-hidden', 'true');
}

async function markChangesReviewed(importId) {
  if (isStaticPages) {
    const files = fileHistoryState.map((file) => (String(file.importId) === String(importId) && file.category === 'original' && file.changes
      ? { ...file, changes: { ...file.changes, reviewedAt: new Date().toISOString() } }
      : file));
    saveBrowserFiles(files);
    fileHistoryState = files;
  } else {
    const response = await fetch('/api/changes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ importId }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Không thể xác nhận đã kiểm tra.');
  }
  await loadChanges();
  renderChanges();
}

// Browser mode keeps the previous booking rows so the next import can be compared with them.
function diffWithPreviousBrowserImport(rows, filename) {
  const previous = readJson('planner-booking-rows', null);
  const compact = compactRows(rows);
  if (!writeJson('planner-booking-rows', { filename, rows: compact })) {
    showToast('Trình duyệt không đủ chỗ lưu bản booking để đối chiếu lần sau.', 'error');
  }
  if (!previous?.rows?.length) return null;
  const report = diffBookingRows(previous.rows, compact);
  return report.hasChanges ? { previousFilename: previous.filename, createdAt: new Date().toISOString(), reviewedAt: null, report } : null;
}

let toastTimer;
function showToast(message, type = 'success') {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.className = `toast toast--visible toast--${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}

async function loadDashboard(importId = null) {
  if (isStaticPages) {
    const selectedPlan = importId && importId !== fallbackDashboard.importId
      ? fileHistoryState.find((file) => file.category === 'original' && String(file.importId) === String(importId))
      : null;
    renderDashboard(selectedPlan ? {
      source: 'browser',
      importId: selectedPlan.importId,
      filename: selectedPlan.filename,
      rowCount: Number(selectedPlan.rowCount || 0),
      totalQuantity: Number(selectedPlan.totalQuantity || 0),
      totalImpressions: Number(selectedPlan.totalImpressions || 0),
      uniquePo: Number(selectedPlan.uniquePo || 0),
      leadTimes: selectedPlan.leadTimes || []
    } : fallbackDashboard);
    return;
  }
  try {
    const response = await fetch(importId ? `/api/dashboard?id=${encodeURIComponent(importId)}` : '/api/dashboard');
    if (!response.ok) throw new Error('API không khả dụng');
    renderDashboard(await response.json());
  } catch {
    renderDashboard(fallbackDashboard);
  }
}

document.querySelector('#overviewView').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-file-id]');
  if (!button) return;
  button.disabled = true;
  try { await markFile(button.dataset.fileId, button.dataset.category); }
  catch (error) { showToast(error.message, 'error'); }
  finally { button.disabled = false; }
});

document.querySelector('#importButton').addEventListener('click', () => document.querySelector('#fileInput').click());
document.querySelector('#fileInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const button = document.querySelector('#importButton');
  button.disabled = true;
  button.innerHTML = '<i class="ph ph-spinner-gap spin"></i>Đang xử lý';
  try {
    const rows = extractBookingRows(readWorkbook(await file.arrayBuffer()));
    if (!rows.length) throw new Error('Không tìm thấy dữ liệu booking hợp lệ.');
    const summary = summarizeBooking(rows);
    if (isStaticPages) {
      const importId = crypto.randomUUID();
      const changes = diffWithPreviousBrowserImport(rows, file.name);
      const files = [{
        id: importId,
        importId,
        category: 'original',
        filename: file.name,
        createdAt: new Date().toISOString(),
        ...summary,
        aiReport: analyzeBookingRows(rows),
        changes,
        note: 'Chỉ lưu thông tin file; file Excel gốc không bị thay đổi.'
      }, ...fileHistoryState.filter((item) => item.id !== 'demo-original')];
      saveBrowserFiles(files);
      renderFileHistory(files);
      openPlanDetail(importId);
      await loadChanges();
      if (changes) {
        openChanges(importId);
        showToast('File booking có thay đổi so với bản trước, hãy kiểm tra.', 'info');
      } else {
        showToast(`Đã đọc ${formatNumber.format(summary.rowCount)} dòng. Bản preview Sites không lưu SQLite.`, 'info');
      }
      return;
    }
    let response;
    try {
      response = await fetch('/api/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, rows })
      });
    } catch {
      // Server unreachable: still show the workbook, but nothing is saved.
      renderDashboard({ source: 'browser', importId: `browser-${Date.now()}`, filename: file.name, ...summary });
      openPlanView();
      showToast(`Đã đọc ${formatNumber.format(summary.rowCount)} dòng nhưng không kết nối được SQLite, dữ liệu chưa được lưu.`, 'info');
      return;
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Không thể lưu dữ liệu vào SQLite.');
    renderDashboard(payload);
    await loadFileHistory();
    openPlanDetail(payload.importId);
    await loadChanges();
    if (payload.changes) {
      openChanges(payload.importId);
      showToast('File booking có thay đổi so với bản trước, hãy kiểm tra.', 'info');
    } else {
      showToast(`Đã nhập ${formatNumber.format(payload.rowCount)} dòng vào SQLite.`);
    }
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = '<i class="ph ph-upload-simple"></i>Nhập file booking';
    event.target.value = '';
  }
});

document.querySelectorAll('.nav__item').forEach((item) => item.addEventListener('click', () => {
  document.querySelectorAll('.nav__item').forEach((navItem) => navItem.classList.remove('nav__item--active'));
  item.classList.add('nav__item--active');
  showPage(item.dataset.page);
}));

document.querySelector('#standardList').addEventListener('click', (event) => {
  const row = event.target.closest('[data-standard-id]');
  if (row) selectStandard(row.dataset.standardId);
});
document.querySelector('#standardSearch').addEventListener('input', (event) => renderStandardList(event.target.value));
document.querySelector('#machineSuggestionPanel').addEventListener('click', (event) => {
  const suggestion = event.target.closest('[data-machine-name]');
  if (!suggestion) return;
  const form = document.querySelector('#standardForm');
  form.elements.name.value = suggestion.dataset.machineName;
  document.querySelector('#standardTitle').textContent = suggestion.dataset.machineName;
  form.elements.minutesPerImpression.focus();
});
document.querySelector('#addStandard').addEventListener('click', () => {
  const draft = {
    id: `draft-${Date.now()}`, name: '', minutesPerImpression: null,
    setupMinutesPerPo: settingsState.setupMinutesPerPo, machineCount: settingsState.machineCount,
    shiftsPerDay: settingsState.shiftsPerDay, minutesPerShift: settingsState.minutesPerShift,
    efficiencyPercent: settingsState.efficiencyPercent, planningDays: settingsState.planningDays,
    note: '', source: 'manual', isDefault: false, isDraft: true
  };
  standardsState = [draft, ...standardsState.filter((item) => !item.isDraft)];
  renderStandardList();
  selectStandard(draft.id);
  document.querySelector('#standardForm').elements.name.focus();
});
document.querySelector('#importStandards').addEventListener('click', () => document.querySelector('#standardsFileInput').click());
document.querySelector('#standardsFileInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const button = document.querySelector('#importStandards');
  button.disabled = true;
  button.innerHTML = '<i class="ph ph-spinner-gap spin"></i>AI đang chuẩn hóa';
  try {
    const result = bestStandardSheet(readWorkbook(await file.arrayBuffer()));
    if (!result.standards.length) throw new Error('AI local chưa tìm thấy cột tên định mức và số phút trong file.');
    await saveImportedStandards(result.standards, file.name);
    showToast(`AI đã chuẩn hóa ${formatNumber.format(result.standards.length)} định mức từ sheet ${result.sheetName}.`);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = '<i class="ph ph-file-xls"></i>Nhập Excel cấu hình';
    event.target.value = '';
  }
});
document.querySelector('#unlockStandard').addEventListener('click', () => {
  const standard = standardsState.find((item) => String(item.id) === String(selectedStandardId));
  if (!standard) return;
  const confirmed = window.confirm(`Bạn có chắc muốn chỉnh sửa “${standard.name}”? Thay đổi định mức có thể làm thay đổi kết quả tính kế hoạch.`);
  if (!confirmed) return;
  standardEditConfirmed = true;
  setStandardEditable(true);
  document.querySelector('#standardForm').elements.name.focus();
});
document.querySelector('#standardForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const standard = standardFromForm();
  const current = standardsState.find((item) => String(item.id) === String(selectedStandardId));
  const submit = event.submitter;
  submit.disabled = true;
  try {
    if (isStaticPages) {
      const saved = { ...current, ...standard, id: current?.isDraft ? crypto.randomUUID() : current.id, isDraft: false, locked: true, updatedAt: new Date().toISOString() };
      standardsState = standardsState.map((item) => String(item.id) === String(selectedStandardId) ? saved : item);
      if (!standardsState.some((item) => item.isDefault)) saved.isDefault = true;
      saveBrowserStandards(standardsState);
      selectedStandardId = saved.id;
    } else {
      const isDraft = Boolean(current?.isDraft);
      const response = await fetch('/api/standards', {
        method: isDraft ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isDraft
          ? { standards: [standard], source: 'manual', makeDefault: !standardsState.some((item) => !item.isDraft && item.isDefault) }
          : { ...standard, confirmed: standardEditConfirmed })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Không thể lưu định mức.');
      standardsState = payload.standards;
      selectedStandardId = standardsState.find((item) => item.name.toLocaleLowerCase('vi-VN') === standard.name.toLocaleLowerCase('vi-VN'))?.id;
    }
    standardEditConfirmed = false;
    renderStandardList();
    selectStandard(selectedStandardId);
    const savedStandard = standardsState.find((item) => String(item.id) === String(selectedStandardId));
    if (savedStandard?.isDefault) await applyStandardToPlan(savedStandard, false);
    showToast('Đã lưu và khóa lại định mức.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submit.disabled = false;
  }
});
document.querySelector('#applyStandard').addEventListener('click', async () => {
  const standard = standardsState.find((item) => String(item.id) === String(selectedStandardId));
  if (!standard) return;
  try {
    await applyStandardToPlan(standard);
    showToast(`Đã dùng “${standard.name}” làm cấu hình tính kế hoạch.`);
  } catch (error) {
    showToast(error.message, 'error');
  }
});

document.querySelector('#planFiles').addEventListener('click', (event) => {
  const plan = event.target.closest('[data-plan-id]');
  if (plan) openPlanDetail(plan.dataset.planId);
});
document.querySelector('#backToPlans').addEventListener('click', () => showPage('Kế hoạch'));
document.querySelector('#runAiCheck').addEventListener('click', async () => {
  const button = document.querySelector('#runAiCheck');
  button.disabled = true;
  await loadAiCheck(activeImportId, true);
  button.disabled = false;
});

document.querySelector('#settingsShortcut').addEventListener('click', openSettings);
document.querySelectorAll('[data-close-settings]').forEach((button) => button.addEventListener('click', closeSettings));
document.querySelector('#settingsForm').addEventListener('input', renderCalculationPreview);
document.querySelector('#settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const settings = settingsFromForm();
  const submit = event.submitter;
  submit.disabled = true;
  try {
    await persistSettings(settings);
    closeSettings();
    showToast('Đã lưu định mức và tính lại số máy.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submit.disabled = false;
  }
});

document.querySelector('#importWarehouse').addEventListener('click', () => document.querySelector('#warehouseFileInput').click());
document.querySelector('#warehouseFileInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const button = document.querySelector('#importWarehouse');
  button.disabled = true;
  button.innerHTML = '<i class="ph ph-spinner-gap spin"></i>Đang đọc file kho';
  try {
    const lines = readWarehouseWorkbook(await file.arrayBuffer());
    if (!lines.length) throw new Error('Sheet TỔNG HỢP không có dòng mã hàng nào.');
    await saveWarehouse({ filename: file.name, importedAt: new Date().toISOString(), lines });
    expandedModelKey = null;
    modelLimit = PAGE_SIZE;
    renderWarehouse();
    showToast(`Đã đọc ${formatNumber.format(lines.length)} dòng PO từ file kho.`);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = '<i class="ph ph-warehouse"></i>Nhập file kho';
    event.target.value = '';
  }
});
document.querySelector('#modelSearch').addEventListener('input', (event) => {
  modelFilters.query = event.target.value;
  modelLimit = PAGE_SIZE;
  renderModelTable();
});
document.querySelector('#customerFilter').addEventListener('change', (event) => {
  modelFilters.customer = event.target.value;
  modelLimit = PAGE_SIZE;
  renderModelTable();
});
document.querySelector('#statusFilters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-status]');
  if (!button) return;
  modelFilters.status = button.dataset.status;
  modelLimit = PAGE_SIZE;
  renderModelTable();
});
document.querySelector('#showMoreModels').addEventListener('click', () => {
  modelLimit += PAGE_SIZE;
  renderModelTable();
});
function toggleRow(event) {
  if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
  const customerRow = event.target.closest('[data-customer]');
  if (customerRow) {
    modelFilters.customer = modelFilters.customer === customerRow.dataset.customer ? '' : customerRow.dataset.customer;
    document.querySelector('#customerFilter').value = modelFilters.customer;
    modelLimit = PAGE_SIZE;
    renderModelTable();
    return;
  }
  const modelRow = event.target.closest('[data-model-key]');
  if (!modelRow) return;
  if (event.type === 'keydown') event.preventDefault();
  expandedModelKey = expandedModelKey === modelRow.dataset.modelKey ? null : modelRow.dataset.modelKey;
  renderModelTable();
}
['click', 'keydown'].forEach((type) => document.querySelector('#modelsView').addEventListener(type, toggleRow));

document.querySelector('#changesButton').addEventListener('click', () => openChanges());
document.querySelectorAll('[data-close-changes]').forEach((button) => button.addEventListener('click', closeChanges));
document.querySelector('#changeList').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-change-id]');
  if (!tab) return;
  selectedChangeId = tab.dataset.changeId;
  renderChanges();
});
document.querySelector('#markReviewed').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await markChangesReviewed(selectedChangeId);
    showToast('Đã ghi nhận kiểm tra thay đổi booking.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeChanges();
  closeSettings();
});

renderFileHistory();
loadDashboard();
loadSettings();
loadFileHistory();
loadChanges();
