import '@phosphor-icons/web/regular';
import './styles.css';
import { analyzeBookingRows } from './local-ai.js';
import { crossCheckSheets, readBooking, readWorkbook, summarizeBooking } from './booking-import.js';
import { batchRow, batchRows, defaultWeekKey, weeksFromDays } from './batches.js';
import { workWeekLabel } from './calendar.js';
import { escapeHtml, formatFileDate, formatNumber } from './format.js';
import { getPinnedLots, readJson, savePinnedLots, writeJson, writeJsonEntries } from './storage.js';
import { appTemplate } from './template.js';
import { PAGE_SIZE, STATUS_COPY, colorName, matchesFilters, renderCustomerRows, renderKpis, renderModelRows } from './models-view.js';
import { readWarehouseWorkbook } from './warehouse-import.js';
import { compactReceiptLines, readReceiptsWorkbook } from './receipts-import.js';
import { restrictToRows, summarizeLots, totalsOf } from './lots.js';
import { renderLeadtimeRows, renderWarnings } from './progress-view.js';
import { downloadFromLink, originType, readFromPath, SOURCES, statPath } from './sources.js';
import { filterOrders, planOrders, planTotals, renderDeliveryPlanTable, renderPlanCards } from './plan-results.js';
import { buildExportWorkbook, buildIssuesWorkbook, downloadWorkbook, exportFilename, sortByUrgency } from './export-workbook.js';
import { compactRows, diffBookingRows } from './booking-diff.js';
import { renderChangeList, renderChangeReport, unreviewedCount } from './changes-view.js';
import { checkIssues, renderCheckReport } from './check-view.js';
import { checkBookingSheet } from './booking-check.js';
import { calendarOrders, filterCalendar, renderCalendar, renderOrderDetail, weekColumns } from './calendar-view.js';

// Explicit build mode preserves static hosting and the desktop SQLite server.
const isStaticPages = __STATIC_PAGES__;
const fallbackDashboard = { source: 'empty', importId: null, filename: 'Chưa có file booking', rowCount: 0, totalQuantity: 0, totalImpressions: 0, uniquePo: 0, leadTimes: [], models: [] };
let dashboardRequest = 0;
let latestBookingRequest = 0;
let aiCheckRequest = 0;
let pendingBooking = null;
let bookingSaving = false;
const storageErrors = {};

let dashboardState = fallbackDashboard;
// The newest booking import; the overview and product joins always use it, whichever plan is open.
let latestBooking = fallbackDashboard;
let latestAiReport = null;
// Full rows and day plan of the newest booking, used for batches and the export.
const EMPTY_DETAIL = { importId: null, filename: null, days: [], rows: [] };
let bookingDetail = EMPTY_DETAIL;
// 'all', a week key (its Monday), or null until the first booking picks the current week.
let batchKey = readJson('planner-batch', null);
// '' = the whole week, otherwise the index of one PXC day in it.
let dayKey = readJson('planner-day', '');
let activeImportId = fallbackDashboard.importId;
let fileHistoryState = [];

document.querySelector('#app').innerHTML = appTemplate({ isStaticPages, appVersion: __APP_VERSION__, canBrowse: Boolean(window.planner?.pickExcelPath), ...workWeekLabel() });

const releaseNotes = document.querySelector('#releaseNotes');
const compactSidebar = window.matchMedia('(min-width: 761px) and (max-width: 1100px)');
const fitReleaseNotes = () => { releaseNotes.open = !compactSidebar.matches; };
fitReleaseNotes();
compactSidebar.addEventListener('change', fitReleaseNotes);
document.addEventListener('click', (event) => {
  if (compactSidebar.matches && !releaseNotes.contains(event.target)) releaseNotes.open = false;
});
releaseNotes.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    releaseNotes.open = false;
    releaseNotes.querySelector('summary').focus();
  }
});

function renderDashboard(data) {
  activeImportId = data.importId;
  aiCheckRequest++;
  dashboardState = { ...fallbackDashboard, ...data };
  document.querySelector('#filename').textContent = data.filename || 'Chưa có file booking';
  const sourceLabel = data.source === 'sqlite' ? 'Đã lưu SQLite' : data.source === 'browser' ? 'Đã lưu trên trình duyệt • Không lưu SQLite' : 'Chưa có dữ liệu';
  document.querySelector('#fileMeta').textContent = `${sourceLabel} • ${formatNumber.format(data.rowCount)} dòng`;
  document.querySelector('#rowCount').textContent = `${formatNumber.format(data.rowCount)} dòng booking`;
  document.querySelector('#totalQuantity').textContent = formatNumber.format(data.totalQuantity);
  document.querySelector('#totalImpressions').textContent = formatNumber.format(data.totalImpressions);
  renderPlanProgress();
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
  if (!writeJson('planner-file-history', files.filter((file) => file.id !== 'demo-original'))) throw new Error('Trình duyệt không cho lưu lịch sử file. Dữ liệu trước đó được giữ nguyên.');
}

async function markFile(fileId, category, note = null) {
  const file = fileHistoryState.find((item) => String(item.id) === fileId);
  if (!file || file.id === 'demo-original') throw new Error('Không tìm thấy file đã nhập.');
  const expected = file.category === 'original' ? 'processed' : file.category === 'processed' ? 'delivered' : null;
  if (category !== expected) throw new Error('Trạng thái file không hợp lệ.');
  if (isStaticPages) {
    if (!fileHistoryState.some((item) => item.importId === file.importId && item.category === category)) {
      const files = [{ ...file, id: crypto.randomUUID(), category, createdAt: new Date().toISOString(), note: note || (category === 'processed' ? 'Người dùng xác nhận đã xử lý.' : 'Người dùng xác nhận đã giao.') }, ...fileHistoryState];
      saveBrowserFiles(files);
      renderFileHistory(files);
    }
  } else {
    const response = await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: file.id, category, note }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Không thể cập nhật file.');
    renderFileHistory(payload.files);
  }
  if (!note) showToast(category === 'processed' ? 'Đã ghi nhận file đã xử lý.' : 'Đã ghi nhận file đã giao.');
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
    : '<div class="plan-list-empty"><i class="ph ph-calendar-x"></i><strong>Chưa có file kế hoạch</strong><span>Nhập file booking ở Tổng quan → Nguồn dữ liệu.</span></div>';
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
    fileHistoryState = Array.isArray(stored) ? stored.filter((file) => file.id !== 'demo-original') : [];
    renderFileHistory(fileHistoryState);
    return;
  }
  try {
    const response = await fetch('/api/files');
    if (!response.ok) throw new Error('Không đọc được lịch sử từ SQLite.');
    const payload = await response.json();
    renderFileHistory(payload.files);
    setStorageStatus('', 'history');
  } catch (error) {
    renderFileHistory(fileHistoryState);
    setStorageStatus(error.message || NETWORK_MESSAGE, 'history');
  }
}

const PAGE_COPY = {
  'Tổng quan': ['KHẢ NĂNG GIAO HÀNG', 'Tổng quan'],
  'Mã hàng': ['GIAO BÁN THÀNH PHẨM', 'Theo mã hàng'],
  'Kế hoạch': ['KẾT QUẢ TỔNG HỢP', 'Kế hoạch']
};

function showPage(pageName) {
  const isOverview = pageName === 'Tổng quan';
  const isModels = pageName === 'Mã hàng';
  const isPlanList = pageName === 'Kế hoạch';
  document.querySelector('#overviewView').hidden = !isOverview;
  document.querySelector('#modelsView').hidden = !isModels;
  document.querySelector('#planListView').hidden = !isPlanList;
  document.querySelector('#planningView').hidden = true;
  document.querySelector('#backToPlans').hidden = true;
  const [eyebrow, title] = PAGE_COPY[pageName];
  document.querySelector('#pageEyebrow').textContent = eyebrow;
  document.querySelector('#pageTitle').textContent = title;
  if (isOverview || isPlanList) loadFileHistory();
  if (isModels) loadSources();
}

function openPlanView() {
  document.querySelector('#overviewView').hidden = true;
  document.querySelector('#modelsView').hidden = true;
  document.querySelector('#planListView').hidden = true;
  document.querySelector('#planningView').hidden = false;
  document.querySelector('#backToPlans').hidden = false;
  document.querySelector('#pageEyebrow').textContent = 'KẾ HOẠCH SẢN XUẤT';
  document.querySelector('#pageTitle').textContent = 'Điều phối kế hoạch';
}

async function openPlanDetail(importId = null) {
  openPlanView();
  if (await loadDashboard(importId)) await loadAiCheck(activeImportId);
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
    container.innerHTML = `<div class="ai-empty ai-empty--good"><i class="ph ph-${report.status === 'empty' ? 'database' : 'check-circle'}"></i><strong>${report.status === 'empty' ? 'Chưa có kết quả kiểm tra' : 'Không phát hiện bất thường'}</strong><span>${report.status === 'empty' ? 'Nhập file booking để bắt đầu kiểm tra.' : `Đã rà soát ${formatNumber.format(report.rowCount)} dòng booking.`}</span></div>`;
    return;
  }
  container.innerHTML = report.findings.map((finding) => `
    <article class="ai-finding ai-finding--${escapeHtml(finding.severity)}">
      <i class="ph ph-${finding.severity === 'danger' ? 'warning-circle' : finding.severity === 'warning' ? 'warning' : 'chart-line-up'}"></i>
      <div><strong>${escapeHtml(finding.title)}</strong><span>${formatNumber.format(finding.count)} dòng · ${escapeHtml(finding.description)}</span>${finding.samples?.length ? `<small>Ví dụ: ${finding.samples.map((sample) => (sample.note ? `${escapeHtml(sample.row)}: ${escapeHtml(sample.note)}` : `dòng ${formatNumber.format(sample.row)} / PO ${escapeHtml(sample.po)}`)).join(', ')}</small>` : ''}</div>
    </article>
  `).join('');
}

async function loadAiCheck(importId, force = false) {
  const requestId = ++aiCheckRequest;
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
    if (requestId !== aiCheckRequest || String(importId) !== String(activeImportId)) return;
    renderAiCheck(report);
  } catch (error) {
    if (requestId !== aiCheckRequest || String(importId) !== String(activeImportId)) return;
    renderAiCheck({ status: 'empty', score: null, rowCount: 0, findingCount: 0, findings: [] });
    showToast(error.message, 'error');
  }
}

const EMPTY_SOURCE = { filename: null, origin: null, importedAt: null, lines: [] };
const sourceState = { receipts: { ...EMPTY_SOURCE }, deliveries: { ...EMPTY_SOURCE } };
// Lots of the whole booking (FIFO-filled), and the view of them the page shows (maybe one batch).
let lotSummary = null;
let warehouseSummary = null;
const modelFilters = { customer: '', status: 'open', query: '', columns: { model: '', modelCode: '', color: '' } };
let expandedModelKey = null;
let modelLimit = PAGE_SIZE;

const ORIGIN_COPY = { link: 'Link', path: 'Đường dẫn' };

// What a card shows: the file loaded, when, from where, and how it keeps itself up to date.
function sourceMeta(source, detail, kind) {
  if (!source?.filename) return '<span class="muted">Chưa có dữ liệu</span>';
  const origin = originState[kind]?.origin;
  const type = originType(origin);
  const from = type
    ? `<span class="source-origin source-origin--${type}" title="${escapeHtml(origin)}"><i class="ph ${type === 'link' ? 'ph-link' : 'ph-folder-open'}"></i>${ORIGIN_COPY[type]}: ${escapeHtml(origin)}</span>`
    : '<span class="source-origin"><i class="ph ph-file"></i>File chọn từ máy</span>';
  const auto = type === 'path'
    ? `<small>Tự đọc lại khi file được lưu (kiểm tra mỗi ${PATH_POLL_SECONDS} giây)</small>`
    : type === 'link' ? `<small>Tự tải lại mỗi ${AUTO_REFRESH_MINUTES} phút khi ứng dụng đang mở</small>` : '';
  return `<strong title="${escapeHtml(source.filename)}">${escapeHtml(source.filename)}</strong><span>${escapeHtml(formatFileDate(source.importedAt))} · ${detail}</span>${from}${auto}`;
}

function renderSources() {
  const booking = !latestBooking.importId ? null : latestBooking;
  document.querySelector('#sourceMeta-booking').innerHTML = booking
    ? sourceMeta({ filename: booking.filename, importedAt: booking.importedAt || booking.createdAt }, `${formatNumber.format(booking.rowCount)} dòng · ${formatNumber.format(lotSummary ? lotSummary.items.filter((item) => !item.outsideBooking).length : 0)} lô`, 'booking')
    : '<span class="muted">Chưa có file booking. Chọn file để bắt đầu.</span>';
  const receiptCount = sourceState.receipts.lines.reduce((sum, line) => sum + (line.receipts ?? 1), 0);
  document.querySelector('#sourceMeta-receipts').innerHTML = sourceMeta(sourceState.receipts, `${formatNumber.format(receiptCount)} lần nhận`, 'receipts');
  document.querySelector('#sourceMeta-deliveries').innerHTML = sourceMeta(sourceState.deliveries, `${formatNumber.format(sourceState.deliveries.lines.length)} dòng PO`, 'deliveries');
  const loaded = { booking: Boolean(booking), receipts: Boolean(sourceState.receipts.filename), deliveries: Boolean(sourceState.deliveries.filename) };
  document.querySelectorAll('[data-delete-source]').forEach((button) => { button.disabled = !loaded[button.dataset.deleteSource]; });
}

function renderWarehouse() {
  lotSummary = summarizeLots({
    bookingRows: bookingDetail.rows,
    deliveryLines: sourceState.deliveries.lines,
    receiptLines: sourceState.receipts.lines,
    pinnedLots: getPinnedLots()
  });
  // Built after the FIFO pass so batch copies of the rows carry their allocated figures.
  const booking = activeBooking();
  renderBatchOptions();
  const viewItems = booking.batch
    ? [...restrictToRows(lotSummary.items, (row) => batchRow(row, bookingDetail.days, booking.batch)), ...lotSummary.items.filter((item) => item.outsideBooking)]
    : lotSummary.items;
  warehouseSummary = { items: viewItems, ...totalsOf(viewItems) };
  const { items, totals, customers } = warehouseSummary;
  const names = [sourceState.receipts.filename && `nhận: ${sourceState.receipts.filename}`, sourceState.deliveries.filename && `giao: ${sourceState.deliveries.filename}`].filter(Boolean);
  document.querySelector('#warehouseMeta').textContent = names.length
    ? `${names.join(' · ')} · ${formatNumber.format(items.length - totals.outside)} lô booking · ${formatNumber.format(totals.outside)} mã ngoài booking`
    : 'Chưa có dữ liệu nhận/giao. Nhập ở mục Tổng quan → Nguồn dữ liệu.';
  renderColumnOptions(items);
  const select = document.querySelector('#customerFilter');
  select.innerHTML = `<option value="">Tất cả khách hàng</option>${[...customers].sort((a, b) => a.localeCompare(b, 'vi')).map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
  select.value = modelFilters.customer;
  renderModelTable();
  renderOverview();
  renderPlanProgress();
  renderPlanResults();
  renderCalendarView();
  renderExportFab();
}

// Bottom-right bubble: export the selected week (or day) from any page.
function renderExportFab() {
  const fab = document.querySelector('#exportFab');
  fab.hidden = !latestBooking.importId || !bookingDetail.rows.length;
  const booking = activeBooking();
  document.querySelector('#exportFabScope').textContent = booking.batch ? booking.batch.label.replace(/ \(.*\)$/, '') : 'Cả file booking';
  fab.title = `Xuất TH + CAN DOI cho ${booking.batch?.label || 'cả file booking'}`;
}

// Tổng quan → Kiểm tra (booking card): the selected week as a calendar, one region per order.
let calendarOpen = readJson('planner-calendar-open', false);
const calendarFilter = { status: 'all', query: '' };
let calendarItems = new Map();
const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function renderCalendarView() {
  const section = document.querySelector('#bookingCalendar');
  section.hidden = !calendarOpen;
  if (!calendarOpen || !lotSummary) return;
  const week = selectedWeek();
  const grid = document.querySelector('#calendarGrid');
  if (!week) {
    calendarItems = new Map();
    document.querySelector('#calendarTitle').textContent = 'Lịch booking';
    grid.innerHTML = '<div class="cal-empty">File booking chưa có phân bổ ngày PXC nên chưa vẽ được lịch.</div>';
    return;
  }
  const weekItems = restrictToRows(lotSummary.items, (row) => batchRow(row, bookingDetail.days, week));
  calendarItems = new Map(weekItems.map((item) => [item.key, item]));
  const columns = weekColumns(week, bookingDetail.days);
  const orders = calendarOrders(weekItems, columns);
  const selectedDate = dayKey === '' ? null : bookingDetail.days[Number(dayKey)]?.date;
  // A picked day (here or in the results above/below) shows only the orders planned that day.
  const dayColumn = columns.findIndex((column) => column.date === selectedDate);
  const shownOrders = filterCalendar(orders, calendarFilter).filter((order) => dayColumn === -1 || order.cells[dayColumn] > 0);
  grid.innerHTML = renderCalendar({ columns, orders, shownOrders, selectedDate, today: todayIso() });
  const total = orders.reduce((sum, order) => sum + order.quantity, 0);
  document.querySelector('#calendarTitle').textContent = selectedDate ? `${week.label} · ${dayName(selectedDate)}` : week.label;
  document.querySelector('#calendarMeta').textContent = `${shownOrders.length === orders.length ? '' : `${formatNumber.format(shownOrders.length)} / `}${formatNumber.format(orders.length)} đơn · ${formatNumber.format(Math.round(total))} sản phẩm trong tuần`;
  document.querySelectorAll('[data-calendar-filter]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.calendarFilter === calendarFilter.status)));
  const weeks = bookingWeeks();
  const position = weeks.findIndex((item) => item.key === week.key);
  document.querySelector('[data-week-step="-1"]').disabled = position <= 0;
  document.querySelector('[data-week-step="1"]').disabled = position >= weeks.length - 1;
}

function showCalendar() {
  calendarOpen = true;
  writeJson('planner-calendar-open', true);
  renderCalendarView();
  document.querySelector('#bookingCalendar').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openOrder(key) {
  const lot = lotSummary?.items.find((item) => item.key === key);
  if (!lot) return;
  const week = selectedWeek();
  document.querySelector('#orderTitle').textContent = `${lot.model || '—'} · ${colorName(lot.color) || ''}`;
  document.querySelector('#orderDetail').innerHTML = renderOrderDetail({ lot, weekItem: calendarItems.get(key), days: bookingDetail.days, weekLabel: week?.label || '' });
  const modal = document.querySelector('#orderModal');
  modal.classList.add('modal--open');
  modal.setAttribute('aria-hidden', 'false');
  modal.querySelector('.icon-button').focus();
}

function closeOrder() {
  const modal = document.querySelector('#orderModal');
  modal.classList.remove('modal--open');
  modal.setAttribute('aria-hidden', 'true');
}

function bookingWeeks() {
  return weeksFromDays(bookingDetail.days);
}

function selectedWeek() {
  const weeks = bookingWeeks();
  if (!weeks.length) return null;
  // The booking is always followed one week at a time.
  if (!weeks.some((week) => week.key === batchKey)) batchKey = defaultWeekKey(weeks);
  return weeks.find((week) => week.key === batchKey);
}

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const dayName = (iso) => `${WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// The selected week, or one day of it when a day is picked.
function selectedBatch() {
  const week = selectedWeek();
  if (!week || dayKey === '') return week;
  const index = Number(dayKey);
  const date = bookingDetail.days[index]?.date;
  if (!week.dayIndexes.includes(index) || !date) {
    dayKey = '';
    return week;
  }
  return { key: `${week.key}:${index}`, from: date, to: date, dayIndexes: [index], label: `${dayName(date)}/${date.slice(0, 4)} (${week.label})` };
}

// The booking as the rest of the page sees it: the whole file, or only the selected batch.
function activeBooking() {
  const week = selectedBatch();
  if (!week) return { ...latestBooking, rows: bookingDetail.rows, days: bookingDetail.days };
  const rows = batchRows(bookingDetail.rows, bookingDetail.days, week);
  const days = week.dayIndexes.map((index) => bookingDetail.days[index]);
  // Re-key allocations to the batch's own day list for the export.
  const position = new Map(week.dayIndexes.map((index, order) => [String(index), String(order)]));
  const batchOnly = rows.map((row) => ({ ...row, allocations: Object.fromEntries(Object.entries(row.allocations).map(([index, value]) => [position.get(index), value])) }));
  return { ...latestBooking, ...summarizeBooking(rows), batch: week, rows: batchOnly, days };
}

function renderBatchOptions() {
  const weeks = bookingWeeks();
  selectedWeek();
  const options = weeks.length
    ? weeks.map((week) => {
      const count = bookingDetail.rows.filter((row) => week.dayIndexes.some((index) => String(index) in (row.allocations || {}))).length;
      return `<option value="${week.key}">${escapeHtml(week.label)} · ${formatNumber.format(count)} dòng</option>`;
    }).join('')
    : '<option value="all">Tất cả booking (file chưa có phân bổ ngày)</option>';
  document.querySelectorAll('[data-batch-select]').forEach((select) => {
    select.innerHTML = options;
    select.value = weeks.length ? batchKey : 'all';
    select.disabled = !weeks.length;
  });
  selectedBatch();
  const week = weeks.find((item) => item.key === batchKey);
  const dayOptions = week
    ? `<option value="">Cả tuần</option>${week.dayIndexes.map((index) => {
      const count = bookingDetail.rows.filter((row) => String(index) in (row.allocations || {})).length;
      return `<option value="${index}">${escapeHtml(dayName(bookingDetail.days[index].date))} · ${formatNumber.format(count)} dòng</option>`;
    }).join('')}`
    : '<option value="">Cả tuần</option>';
  document.querySelectorAll('[data-day-select]').forEach((select) => {
    select.innerHTML = dayOptions;
    select.value = dayKey;
    select.disabled = !week;
  });
}

// Kế hoạch page: the selected week/day from the booking, receiving and delivery files, each
// on its own and all three together.
let planTab = readJson('planner-plan-tab', 'combined');
let planQuery = '';
let planCustomer = '';
let planStatus = '';

function renderPlanResults() {
  if (!warehouseSummary) return;
  const booking = activeBooking();
  const orders = planOrders(warehouseSummary.items);
  const shown = filterOrders(orders, planQuery, { customer: planCustomer, status: planStatus });
  const totals = planTotals(shown);
  document.querySelector('#planCards').innerHTML = renderPlanCards(totals, planTab);
  document.querySelector('#planTable').innerHTML = renderDeliveryPlanTable(shown);
  const isFiltered = Boolean(planQuery || planCustomer || planStatus);
  document.querySelector('#planResultsCount').textContent = isFiltered ? `${formatNumber.format(shown.length)} / ${formatNumber.format(orders.length)} đơn` : `${formatNumber.format(orders.length)} đơn`;
  const files = [
    !latestBooking.importId ? 'chưa có booking' : `booking: ${latestBooking.filename}`,
    sourceState.receipts.filename ? `nhận: ${sourceState.receipts.filename}` : 'chưa có file nhận',
    sourceState.deliveries.filename ? `giao: ${sourceState.deliveries.filename}` : 'chưa có file giao'
  ];
  document.querySelector('#planResultsMeta').textContent = `${booking.batch ? `${booking.batch.label} · ` : ''}${files.join(' · ')}`;

  const custSelect = document.querySelector('#planCustomerFilter');
  if (custSelect) {
    const customers = [...new Set(orders.map((o) => o.customer))].sort((a, b) => a.localeCompare(b, 'vi'));
    custSelect.innerHTML = `<option value="">Tất cả khách hàng</option>${customers.map((name) => `<option value="${escapeHtml(name)}"${name === planCustomer ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}`;
  }
}

async function loadBookingDetail(booking) {
  if (!booking.importId) return EMPTY_DETAIL;
  if (isStaticPages) {
    const stored = readJson('planner-booking-rows', null);
    const file = fileHistoryState.find((item) => item.category === 'original' && String(item.importId) === String(booking.importId));
    if (stored && String(stored.importId) === String(booking.importId)) return { days: [], ...stored, sheetCheck: file?.sheetCheck || null };
    throw new Error('Không tìm thấy chi tiết booking trên trình duyệt. Nhập lại workbook gốc để khôi phục.');
  }
  const response = await fetch(`/api/booking-rows?id=${encodeURIComponent(booking.importId)}`);
  if (!response.ok) throw new Error('Không đọc được chi tiết booking từ SQLite. Dữ liệu đang xem được giữ nguyên.');
  return { importId: booking.importId, ...await response.json() };
}

function renderOverview() {
  renderSources();
  if (!warehouseSummary) return;
  document.querySelector('#overviewKpis').innerHTML = renderKpis(warehouseSummary.totals, { batch: Boolean(activeBooking().batch) });
  document.querySelector('#overviewWarnings').innerHTML = renderWarnings(warehouseSummary.totals, latestAiReport);
  const booking = activeBooking();
  document.querySelector('#overviewLeadtimeBody').innerHTML = renderLeadtimeRows(booking, warehouseSummary);
  document.querySelector('#overviewMeta').textContent = !latestBooking.importId
    ? 'Chưa có booking. Nhập file ở mục Nguồn dữ liệu.'
    : booking.batch
      ? `${booking.batch.label}: ${formatNumber.format(booking.rowCount)} dòng booking phân bổ trong tuần · số lượng, nhận và giao chỉ tính phần của tuần này.`
      : `Booking: ${latestBooking.filename} · số nhận/giao lấy từ file nhận và file giao mới nhất.`;
}

// Plan pages: the newest booking is shown for the selected week, like the overview; older
// imports have no row detail and keep their file totals.
function renderPlanProgress() {
  const isLatest = String(dashboardState.importId) === String(latestBooking.importId) && Boolean(latestBooking.importId);
  const booking = isLatest ? activeBooking() : dashboardState;
  const lots = isLatest ? (warehouseSummary?.items || []).filter((item) => !item.outsideBooking) : [];
  if (isLatest && booking.batch) {
    document.querySelector('#totalQuantity').textContent = formatNumber.format(booking.totalQuantity);
    document.querySelector('#totalImpressions').textContent = formatNumber.format(booking.totalImpressions);
    document.querySelector('#rowCount').textContent = `${formatNumber.format(booking.rowCount)} dòng · ${booking.batch.label}`;
  }
  document.querySelector('#planLeadtimeBody').innerHTML = renderLeadtimeRows(booking, isLatest ? { items: lots } : null);
  const sum = (field) => lots.reduce((total, item) => total + item[field], 0);
  const hasActual = lots.some((item) => item.received || item.delivered);
  document.querySelector('#planReceived').textContent = hasActual ? formatNumber.format(sum('received')) : '—';
  document.querySelector('#planGood').textContent = hasActual ? formatNumber.format(sum('delivered')) : '—';
  document.querySelector('#planReceivedMeta').textContent = hasActual
    ? `${formatNumber.format(lots.filter((item) => item.received > 0).length)} / ${formatNumber.format(lots.length)} lô đã nhận BTP`
    : isLatest ? 'Chưa có số liệu nhận/giao' : 'Chỉ tính cho booking mới nhất';
  document.querySelector('#planGoodMeta').textContent = hasActual ? `${formatNumber.format(lots.filter((item) => item.status === 'done').length)} lô giao đủ` : '—';
}

// Suggestions for the Mã hàng / Model / Màu filters, from the booking lots.
function renderColumnOptions(items) {
  const lots = items.filter((item) => !item.outsideBooking);
  const values = {
    model: lots.map((item) => item.model),
    modelCode: lots.map((item) => item.modelCode),
    color: lots.map((item) => colorName(item.color))
  };
  for (const [column, list] of Object.entries(values)) {
    const unique = [...new Set(list.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
    document.querySelector(`#filterOptions-${column}`).innerHTML = unique.map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
  }
}

function renderModelTable() {
  if (!warehouseSummary) return;
  const scoped = warehouseSummary.items.filter((item) => matchesFilters(item, { ...modelFilters, status: 'any' }));
  // The figures above the table follow the customer / column / search filters.
  document.querySelector('#modelKpis').innerHTML = renderKpis(totalsOf(scoped).totals, { batch: Boolean(activeBooking().batch) });
  const filtered = sortByUrgency(scoped.filter((item) => matchesFilters(item, modelFilters)));
  document.querySelector('#customerBody').innerHTML = renderCustomerRows(
    warehouseSummary.items.filter((item) => matchesFilters(item, { query: modelFilters.query, columns: modelFilters.columns, status: 'all' })),
    modelFilters.customer
  ) || '<tr><td colspan="8" class="delivery-table__empty">Chưa có dữ liệu.</td></tr>';
  document.querySelector('#modelBody').innerHTML = renderModelRows(filtered, expandedModelKey, modelLimit);
  document.querySelectorAll('[data-status-count]').forEach((badge) => {
    badge.textContent = formatNumber.format(scoped.filter((item) => matchesFilters(item, { status: badge.dataset.statusCount })).length);
  });
  document.querySelectorAll('#statusFilters [data-status]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.status === modelFilters.status)));
  document.querySelector('#modelCount').textContent = `Hiển thị ${formatNumber.format(Math.min(modelLimit, filtered.length))} / ${formatNumber.format(filtered.length)} ${modelFilters.status === 'outside' ? 'mã ngoài booking' : 'lô'}`;
  document.querySelector('#showMoreModels').hidden = filtered.length <= modelLimit;
}

async function loadSources() {
  for (const kind of Object.keys(sourceState)) {
    if (isStaticPages) {
      sourceState[kind] = readJson(`planner-source-${kind}`, null)
        // Earlier builds kept the warehouse file under its own key.
        || (kind === 'deliveries' ? readJson('planner-warehouse', null) : null)
        || { ...EMPTY_SOURCE };
      continue;
    }
    try {
      const response = await fetch(`/api/sources?kind=${kind}`);
      if (!response.ok) throw new Error(`Không đọc được nguồn ${SOURCES[kind].title} từ SQLite. Số liệu đang xem chưa được làm mới.`);
      sourceState[kind] = await response.json();
      setStorageStatus('', `source-${kind}`);
    } catch (error) {
      setStorageStatus(error.message || NETWORK_MESSAGE, `source-${kind}`);
      showToast(error.message, 'error');
    }
  }
  renderWarehouse();
}

async function saveSource(kind, snapshot) {
  if (isStaticPages) {
    if (!writeJson(`planner-source-${kind}`, snapshot)) throw new Error('Trình duyệt không đủ chỗ lưu file này.');
    sourceState[kind] = snapshot;
    return;
  }
  const response = await fetch(`/api/sources?kind=${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Không thể lưu dữ liệu.');
  sourceState[kind] = payload;
}

async function importSource(kind, buffer, filename, origin = null, { quiet = false } = {}) {
  if (kind === 'booking') return importBooking(buffer, filename, origin, { quiet });
  const lines = kind === 'receipts' ? readReceiptsWorkbook(buffer).lines : readWarehouseWorkbook(buffer);
  if (!lines.length) throw new Error('File không có dòng dữ liệu hợp lệ.');
  const stored = kind === 'receipts' && isStaticPages ? compactReceiptLines(lines) : lines;
  await saveSource(kind, { filename, origin, importedAt: new Date().toISOString(), lines: stored });
  expandedModelKey = null;
  modelLimit = PAGE_SIZE;
  renderWarehouse();
  const what = kind === 'receipts' ? `${formatNumber.format(lines.length)} lần nhận BTP` : `${formatNumber.format(lines.length)} dòng PO từ file giao`;
  showToast(quiet ? `Đã tự cập nhật ${SOURCES[kind].title}: ${what}.` : `Đã đọc ${what}.`, quiet ? 'info' : 'success');
  return null;
}

// Where each input comes from. A link is downloaded again every AUTO_REFRESH_MINUTES; a path
// (file on a shared drive, edited and saved all day, macros included) is checked every
// PATH_POLL_SECONDS and read again as soon as its modified time changes.
const AUTO_REFRESH_MINUTES = 30;
const PATH_POLL_SECONDS = 60;
const originState = { booking: null, receipts: null, deliveries: null };
const refreshing = new Set();

async function loadOrigins() {
  if (isStaticPages) {
    Object.assign(originState, readJson('planner-origins', {}));
    return;
  }
  try {
    const response = await fetch('/api/origins');
    if (response.ok) Object.assign(originState, await response.json());
  } catch {
    // Without the list the sources still work; they just do not refresh themselves.
  }
}

async function saveOrigin(kind, origin, { mtime = null, hash = null } = {}) {
  const nextOrigin = origin ? { origin, mtime, hash, checkedAt: new Date().toISOString() } : null;
  if (isStaticPages) {
    if (!writeJson('planner-origins', { ...originState, [kind]: nextOrigin })) throw new Error('Trình duyệt không cho lưu nguồn dữ liệu. Nguồn trước đó được giữ nguyên.');
  } else {
    const response = await fetch('/api/origins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ...(nextOrigin || { origin: null }) }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Không lưu được nguồn dữ liệu.');
  }
  originState[kind] = nextOrigin;
}

async function readOrigin(origin) {
  if (originType(origin) === 'path') return readFromPath(origin);
  const { buffer, filename } = await downloadFromLink(origin, { viaServer: !isStaticPages });
  return { buffer, filename, mtime: new Date().toISOString() };
}

// Fingerprint of a downloaded file, so a refresh that brings the same file changes nothing.
async function contentHash(buffer) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Reads the file from its link or path, imports it when its content changed and remembers the
// origin for refreshes. The origin is only saved once the file was read and imported.
async function useOrigin(kind, origin, { quiet = false } = {}) {
  if (refreshing.has(kind)) {
    if (quiet) return;
    throw new Error(`Mục ${SOURCES[kind].title} đang được cập nhật, chờ một chút rồi thử lại.`);
  }
  refreshing.add(kind);
  try {
    const { buffer, filename, mtime } = await readOrigin(origin);
    const hash = await contentHash(buffer);
    const previous = originState[kind];
    if (hash && previous?.origin === origin && previous.hash === hash) {
      await saveOrigin(kind, origin, { mtime, hash });
      if (!quiet) showToast(`${SOURCES[kind].title}: file chưa thay đổi so với lần đọc trước.`, 'info');
      renderSources();
      return;
    }
    await importSource(kind, buffer, filename, origin, { quiet });
    await saveOrigin(kind, origin, { mtime, hash });
    renderSources();
  } finally {
    refreshing.delete(kind);
  }
}

async function pollOrigins() {
  if (isStaticPages) return;
  for (const kind of Object.keys(originState)) {
    const { origin, mtime } = originState[kind] || {};
    if (!origin || refreshing.has(kind)) continue;
    try {
      if (originType(origin) === 'path') {
        const info = await statPath(origin);
        if (info.mtime !== mtime) await useOrigin(kind, origin, { quiet: true });
      } else if (!(Date.now() - Date.parse(originState[kind].checkedAt || mtime || 0) < AUTO_REFRESH_MINUTES * 60_000)) {
        await useOrigin(kind, origin, { quiet: true });
      }
    } catch (error) {
      console.warn(`Không tự cập nhật được ${kind}:`, error);
    }
  }
}

async function deleteSource(kind) {
  const title = SOURCES[kind].title;
  const extra = kind === 'booking' ? '\nFile booking đang hiện sẽ bị xoá khỏi lịch sử; bản nhập trước đó (nếu có) sẽ hiện lại.' : '';
  if (!window.confirm(`Xoá file của mục ${title}?${extra}\nFile Excel gốc trên máy/ổ mạng không bị ảnh hưởng.`)) return;
  if (kind === 'booking') {
    if (isStaticPages) {
      const files = fileHistoryState.filter((file) => String(file.importId) !== String(latestBooking.importId));
      saveBrowserFiles(files);
      renderFileHistory(files);
    } else {
      const response = await fetch(`/api/imports?id=${encodeURIComponent(latestBooking.importId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Không xoá được file booking.');
      await loadFileHistory();
    }
    await saveOrigin('booking', null);
    batchKey = null;
    await loadDashboard();
    await loadChanges();
  } else {
    if (isStaticPages) {
      if (!writeJson(`planner-source-${kind}`, null)) throw new Error('Trình duyệt không cho xoá nguồn dữ liệu. File trước đó được giữ nguyên.');
    } else {
      const response = await fetch(`/api/sources?kind=${kind}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Không xoá được file.');
    }
    sourceState[kind] = { ...EMPTY_SOURCE };
    await saveOrigin(kind, null);
    renderWarehouse();
  }
  showToast(`Đã xoá file của mục ${title}.`);
}

async function loadLatestAiReport(booking) {
  if (!booking.importId) return null;
  if (isStaticPages) return fileHistoryState.find((file) => String(file.importId) === String(booking.importId) && file.aiReport)?.aiReport || null;
  try {
    const response = await fetch(`/api/ai-check?id=${encodeURIComponent(booking.importId)}`);
    if (!response.ok) throw new Error('Không đọc được báo cáo kiểm tra booking.');
    return await response.json();
  } catch (error) { showToast(error.message, 'error'); return null; }
}

function checkSources() {
  return {
    booking: !latestBooking.importId ? null : { filename: latestBooking.filename, importedAt: latestBooking.importedAt },
    receipts: sourceState.receipts,
    deliveries: sourceState.deliveries
  };
}

function renderCheck() {
  if (!warehouseSummary) return;
  const booking = activeBooking();
  document.querySelector('#checkReport').innerHTML = renderCheckReport({ booking, summary: warehouseSummary, sources: checkSources(), aiReport: latestAiReport, sheetCheck: bookingDetail.sheetCheck });
  const issues = checkIssues({ booking, summary: warehouseSummary });
  document.querySelector('#checkStatus').textContent = issues.join(' ') || `Sẵn sàng xuất ${formatNumber.format(booking.rows?.length || 0)} dòng.`;
  document.querySelector('#checkModal [data-export]').disabled = Boolean(issues.length);
}

function openCheck() {
  renderCheck();
  const modal = document.querySelector('#checkModal');
  modal.classList.add('modal--open');
  modal.setAttribute('aria-hidden', 'false');
  modal.querySelector('[data-close-check].icon-button').focus();
}

function closeCheck() {
  const modal = document.querySelector('#checkModal');
  modal.classList.remove('modal--open');
  modal.setAttribute('aria-hidden', 'true');
}

async function exportSummary() {
  if (!warehouseSummary) throw new Error('Chưa có dữ liệu để xuất.');
  const booking = activeBooking();
  const filename = exportFilename(new Date(), booking.batch);
  if (!booking.rows?.length) throw new Error('Chưa có dữ liệu booking chi tiết. Nhập lại file booking trước khi xuất.');
  const workbook = buildExportWorkbook({ booking, lots: lotSummary.items, sheetCheck: bookingDetail.sheetCheck });
  await downloadWorkbook(workbook, filename);
  // The export is the "processed" result of the newest booking file.
  const original = fileHistoryState.find((file) => file.category === 'original' && String(file.importId) === String(latestBooking.importId));
  const alreadyProcessed = fileHistoryState.some((file) => file.category === 'processed' && String(file.importId) === String(latestBooking.importId));
  // The file is already downloaded; failing to record it in the history must not look like a failed export.
  if (original && !alreadyProcessed) {
    try {
      await markFile(String(original.id), 'processed', `Đã xuất file ${filename}`);
    } catch (error) {
      const reason = isNetworkError(error.message) ? 'không kết nối được máy chủ' : error.message;
      showToast(`Đã xuất ${filename}, nhưng chưa ghi được vào "File đã làm" (${reason}).`, 'info');
      return;
    }
  }
  showToast(`Đã xuất ${filename}.`);
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

// Browser mode keeps the previous booking (rows + day plan) so the next import can be compared
// with it; the same copy feeds batches and the export.
function diffWithPreviousBrowserImport({ rows, days }, filename, importId) {
  const previous = readJson('planner-booking-rows', null);
  const compact = compactRows(rows);
  if (!previous?.rows?.length) return null;
  const report = diffBookingRows(previous.rows, compact, { previousDays: previous.days, currentDays: days });
  return report.hasChanges ? { previousFilename: previous.filename, createdAt: new Date().toISOString(), reviewedAt: null, report } : null;
}

let toastTimer;
// Browsers report a dropped connection as "Failed to fetch" (Chrome), "NetworkError…" (Firefox)
// or "Load failed" (Safari).
const isNetworkError = (message) => /failed to fetch|networkerror|load failed/i.test(String(message));
const NETWORK_MESSAGE = 'Không kết nối được máy chủ. Kiểm tra lệnh npm run dev còn chạy không, rồi tải lại trang.';

function showToast(message, type = 'success') {
  const toast = document.querySelector('#toast');
  const text = isNetworkError(message) ? NETWORK_MESSAGE : message;
  toast.textContent = text;
  toast.className = `toast toast--visible toast--${type}`;
  clearTimeout(toastTimer);
  // Longer messages stay up long enough to read.
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, text.length > 80 ? 6000 : 3200);
}

function browserDashboard(file) {
  return {
    source: 'browser',
    importId: file.importId,
    filename: file.filename,
    importedAt: file.createdAt,
    rowCount: Number(file.rowCount || 0),
    totalQuantity: Number(file.totalQuantity || 0),
    totalImpressions: Number(file.totalImpressions || 0),
    uniquePo: Number(file.uniquePo || 0),
    leadTimes: file.leadTimes || [],
    models: file.models || []
  };
}

// Without an id this loads the newest booking, which also becomes the overview's booking.
function setStorageStatus(error = '', scope = 'booking') {
  storageErrors[scope] = error;
  error = Object.values(storageErrors).filter(Boolean).join(' ');
  const status = document.querySelector('#storageStatus');
  status.textContent = error ? 'Lỗi lưu / đọc dữ liệu' : isStaticPages ? 'Lưu trên trình duyệt' : 'SQLite đã kết nối';
  const notice = document.querySelector('#storageNotice');
  notice.hidden = !error && !isStaticPages;
  notice.classList.toggle('storage-notice--error', Boolean(error));
  notice.textContent = error || 'Chế độ trình duyệt: lưu trên thiết bị này, không lưu SQLite và không đồng bộ giữa thiết bị. Không lưu lại file Excel gốc.';
}

function renderPendingBooking(error = '') {
  const element = document.querySelector('#pendingBooking');
  element.hidden = !pendingBooking;
  element.innerHTML = pendingBooking ? `<div><strong>Chưa lưu file ${escapeHtml(pendingBooking.filename)}</strong><p>${escapeHtml(error || 'Đang lưu dữ liệu…')} File đã lưu trước đó được giữ nguyên.</p></div><button type="button" id="retryBooking" class="secondary-button" ${bookingSaving ? 'disabled' : ''}>Thử lưu lại</button>` : '';
  element.querySelector('#retryBooking')?.addEventListener('click', () => {
    const pending = pendingBooking;
    withBusyButton(element.querySelector('#retryBooking'), 'Đang lưu', async () => {
      await importBooking(pending.buffer, pending.filename, pending.origin, pending.options);
      try { await saveOrigin('booking', pending.origin, { hash: await contentHash(pending.buffer) }); }
      catch (error) { showToast(`Booking đã lưu nhưng chưa cập nhật được nguồn tự làm mới: ${error.message}`, 'error'); }
      renderSources();
    });
  });
}

async function loadDashboard(importId = null) {
  const requestId = ++dashboardRequest;
  const latestRequest = importId ? null : ++latestBookingRequest;
  let data = fallbackDashboard;
  try {
    if (isStaticPages) {
      const originals = fileHistoryState.filter((file) => file.category === 'original' && file.id !== 'demo-original');
      const selected = importId ? originals.find((file) => String(file.importId) === String(importId)) : originals[0];
      if (selected) data = browserDashboard(selected);
      else if (importId) throw new Error('Không tìm thấy phiên nhập booking.');
    } else {
      const response = await fetch(importId ? `/api/dashboard?id=${encodeURIComponent(importId)}` : '/api/dashboard');
      if (!response.ok) throw new Error('Không đọc được booking từ SQLite. Dữ liệu đang xem được giữ nguyên.');
      data = await response.json();
    }
    // Historical plans keep their own totals; they must not replace the newest
    // booking used by receipt/delivery matching, FIFO and export.
    if (importId) {
      if (requestId !== dashboardRequest) return false;
      renderDashboard(data);
    } else {
      const [detail, report] = await Promise.all([loadBookingDetail(data), loadLatestAiReport(data)]);
      if (latestRequest !== latestBookingRequest) return false;
      latestBooking = data;
      bookingDetail = detail;
      latestAiReport = report;
      if (requestId === dashboardRequest) renderDashboard(data);
      renderWarehouse();
    }
    setStorageStatus();
    return true;
  } catch (error) {
    if (importId ? requestId !== dashboardRequest : latestRequest !== latestBookingRequest) return false;
    setStorageStatus(isNetworkError(error.message) ? NETWORK_MESSAGE : error.message);
    showToast(error.message || NETWORK_MESSAGE, 'error');
    return false;
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

// Reads a booking workbook (from a file or a link) and stores it; returns the new import id.
async function importBooking(buffer, filename, origin = null, { quiet = false } = {}) {
  if (bookingSaving) throw new Error('Booking đang được lưu, chờ một chút rồi thử lại.');
  const workbook = readWorkbook(buffer);
  const { rows, days, repairs } = readBooking(workbook);
  if (!rows.length) throw new Error('Không tìm thấy dữ liệu booking hợp lệ (sheet TH hoặc LEADTIME).');
  // Cell-level problems of TH are kept with the import and listed in "Kiểm tra file".
  const sheetCheck = { ...crossCheckSheets(workbook), cells: checkBookingSheet(workbook), repairs };
  const summary = summarizeBooking(rows);
  ++dashboardRequest;
  ++latestBookingRequest;
  let importId;
  let hasChanges;
  pendingBooking = { buffer, filename, origin, options: { quiet } };
  bookingSaving = true;
  renderPendingBooking();
  try {
    if (isStaticPages) {
      importId = crypto.randomUUID();
      const changes = diffWithPreviousBrowserImport({ rows, days }, filename, importId);
      hasChanges = Boolean(changes);
      const files = [{
        id: importId,
        importId,
        category: 'original',
        filename,
        origin,
        createdAt: new Date().toISOString(),
        ...summary,
        aiReport: analyzeBookingRows(rows, { sheetCheck }),
        sheetCheck,
        changes,
        note: 'Chỉ lưu thông tin file; file Excel gốc không bị thay đổi.'
      }, ...fileHistoryState.filter((item) => item.id !== 'demo-original')];
      if (!writeJsonEntries([
        ['planner-booking-rows', { importId, filename, days, rows: compactRows(rows) }],
        ['planner-file-history', files]
      ])) throw new Error('Trình duyệt không đủ chỗ lưu booking và lịch sử. Dữ liệu trước đó được giữ nguyên.');
      renderFileHistory(files);
    } else {
      const response = await fetch('/api/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, rows, days, sheetCheck })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Không thể lưu dữ liệu vào SQLite.');
      importId = payload.importId;
      hasChanges = Boolean(payload.changes);
      await loadFileHistory();
    }
    pendingBooking = null;
    setStorageStatus('', 'save');
  } catch (error) {
    setStorageStatus(error.message || NETWORK_MESSAGE, 'save');
    bookingSaving = false;
    renderPendingBooking(isNetworkError(error.message) ? NETWORK_MESSAGE : error.message);
    throw error;
  } finally { bookingSaving = false; }
  renderPendingBooking();
  // A refresh of the same file keeps the week the planner is looking at.
  if (!quiet) batchKey = null;
  const loaded = await loadDashboard();
  await loadChanges();
  if (!loaded) {
    showToast('Đã lưu booking, nhưng chưa tải lại được dữ liệu. Kiểm tra kết nối và tải lại trang; không cần nhập lại.', 'error');
    return importId;
  }
  if (hasChanges && quiet) {
    showToast('File booking vừa được cập nhật và có thay đổi: xem ở nút “Thay đổi booking”.', 'info');
  } else if (hasChanges) {
    openChanges(importId);
    showToast('File booking có thay đổi so với bản trước, hãy kiểm tra.', 'info');
  } else {
    showToast(`Đã nhập ${formatNumber.format(summary.rowCount)} dòng booking.`);
  }
  return importId;
}

async function withBusyButton(button, busyLabel, task) {
  const label = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<i class="ph ph-spinner-gap spin"></i>${busyLabel}`;
  try {
    return await task();
  } catch (error) {
    showToast(error.message, 'error');
    return null;
  } finally {
    button.disabled = false;
    button.innerHTML = label;
  }
}

const sourcesPanel = document.querySelector('.sources-panel');
const sourceForms = (kind) => [...sourcesPanel.querySelectorAll(`[data-link-form="${kind}"], [data-path-form="${kind}"]`)];

function toggleSourceForm(kind, type) {
  const card = sourcesPanel.querySelector(`[data-source="${kind}"]`);
  const form = card.querySelector(`[data-${type}-form]`);
  const opening = form.hidden;
  sourceForms(kind).forEach((item) => { item.hidden = true; });
  card.querySelectorAll('[data-toggle-form]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  if (!opening) return;
  form.hidden = false;
  card.querySelector(`[data-toggle-form="${type}"]`).setAttribute('aria-expanded', 'true');
  const input = form.querySelector('input');
  const origin = originState[kind]?.origin;
  if (!input.value && originType(origin) === type) input.value = origin;
  input.focus();
}

sourcesPanel.addEventListener('click', async (event) => {
  const pick = event.target.closest('[data-pick-file]');
  if (pick) sourcesPanel.querySelector(`[data-file-input="${pick.dataset.pickFile}"]`).click();
  const toggle = event.target.closest('[data-toggle-form]');
  if (toggle) toggleSourceForm(toggle.dataset.kind, toggle.dataset.toggleForm);
  const browse = event.target.closest('[data-browse-path]');
  if (browse) {
    const path = await window.planner.pickExcelPath();
    if (path) sourcesPanel.querySelector(`[data-path-form="${browse.dataset.browsePath}"] input`).value = path;
  }
  const update = event.target.closest('[data-update-source]');
  if (update) {
    const kind = update.dataset.updateSource;
    const origin = originState[kind]?.origin;
    // A file picked by hand has nowhere to be read from again: choose the new copy.
    if (!origin) sourcesPanel.querySelector(`[data-file-input="${kind}"]`).click();
    else withBusyButton(update, 'Đang cập nhật', () => useOrigin(kind, origin));
  }
  if (event.target.closest('[data-show-calendar]')) showCalendar();
  const remove = event.target.closest('[data-delete-source]');
  // renderSources runs after the busy state ends so an emptied card keeps Xoá disabled.
  if (remove) withBusyButton(remove, 'Đang xoá', () => deleteSource(remove.dataset.deleteSource)).then(renderSources);
});
sourcesPanel.addEventListener('change', async (event) => {
  const kind = event.target.dataset.fileInput;
  const file = event.target.files?.[0];
  if (!kind || !file) return;
  const button = sourcesPanel.querySelector(`[data-pick-file="${kind}"]`);
  await withBusyButton(button, 'Đang đọc', async () => {
    if (file.size > 25_000_000) throw new Error('File vượt giới hạn 25 MB.');
    await importSource(kind, await file.arrayBuffer(), file.name);
    // The source is now this file; stop refreshing from an older link or path.
    if (originState[kind]) await saveOrigin(kind, null);
    renderSources();
  });
  event.target.value = '';
});
sourcesPanel.addEventListener('submit', async (event) => {
  const form = event.target;
  const kind = form.dataset.linkForm || form.dataset.pathForm;
  if (!kind) return;
  event.preventDefault();
  const origin = (form.elements.url || form.elements.path).value.trim();
  const button = event.submitter || form.querySelector('[type="submit"]');
  await withBusyButton(button, 'Đang đọc', async () => {
    await useOrigin(kind, origin);
    form.reset();
    form.hidden = true;
    sourcesPanel.querySelectorAll(`[data-kind="${kind}"]`).forEach((toggle) => toggle.setAttribute('aria-expanded', 'false'));
    renderSources();
  });
});
document.querySelectorAll('[data-day-select]').forEach((select) => select.addEventListener('change', () => selectDay(select.value)));
document.querySelector('#closeCalendar').addEventListener('click', () => {
  calendarOpen = false;
  writeJson('planner-calendar-open', false);
  renderCalendarView();
});
document.querySelectorAll('[data-week-step]').forEach((button) => button.addEventListener('click', () => {
  const weeks = bookingWeeks();
  const next = weeks[weeks.findIndex((week) => week.key === batchKey) + Number(button.dataset.weekStep)];
  if (!next) return;
  batchKey = next.key;
  dayKey = '';
  writeJson('planner-batch', batchKey);
  writeJson('planner-day', dayKey);
  renderWarehouse();
  renderCheck();
}));
document.querySelector('#calendarFilters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-calendar-filter]');
  if (!button) return;
  calendarFilter.status = button.dataset.calendarFilter;
  renderCalendarView();
});
document.querySelector('#calendarSearch').addEventListener('input', (event) => {
  calendarFilter.query = event.target.value;
  renderCalendarView();
});
function selectDay(value) {
  dayKey = value;
  writeJson('planner-day', dayKey);
  expandedModelKey = null;
  modelLimit = PAGE_SIZE;
  renderWarehouse();
  renderCheck();
}

document.querySelector('#calendarGrid').addEventListener('click', (event) => {
  const day = event.target.closest('[data-cal-day]');
  if (day) selectDay(day.dataset.calDay === dayKey ? '' : day.dataset.calDay);
  const order = event.target.closest('[data-order]');
  if (order) openOrder(order.dataset.order);
});
document.querySelectorAll('[data-close-order]').forEach((button) => button.addEventListener('click', closeOrder));
document.querySelector('#planCards').addEventListener('click', (event) => {
  const card = event.target.closest('[data-plan-tab]');
  if (!card) return;
  planTab = card.dataset.planTab;
  writeJson('planner-plan-tab', planTab);
  renderPlanResults();
});
document.querySelector('#planSearch').addEventListener('input', (event) => {
  planQuery = event.target.value;
  renderPlanResults();
});
document.querySelector('#planCustomerFilter')?.addEventListener('change', (event) => {
  planCustomer = event.target.value;
  renderPlanResults();
});
document.querySelector('#planStatusFilters')?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-plan-status]');
  if (!button) return;
  planStatus = button.dataset.planStatus;
  document.querySelectorAll('#planStatusFilters button').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn === button ? 'true' : 'false');
  });
  renderPlanResults();
});
document.addEventListener('click', (event) => {
  const pinBtn = event.target.closest('[data-pin-key]');
  if (!pinBtn) return;
  event.stopPropagation();
  const key = pinBtn.dataset.pinKey;
  const pinned = getPinnedLots();
  if (pinned.has(key)) {
    pinned.delete(key);
    savePinnedLots(pinned);
    showToast('Đã bỏ ghim ưu tiên lô hàng.', 'info');
  } else {
    pinned.add(key);
    savePinnedLots(pinned);
    showToast('Đã ghim ưu tiên nhận BTP!', 'success');
  }
  renderWarehouse();
});
document.querySelectorAll('[data-batch-select]').forEach((select) => select.addEventListener('change', () => {
  batchKey = select.value;
  dayKey = '';
  writeJson('planner-batch', batchKey);
  writeJson('planner-day', dayKey);
  expandedModelKey = null;
  modelLimit = PAGE_SIZE;
  renderWarehouse();
  renderCheck();
}));
document.querySelectorAll('[data-check]').forEach((button) => button.addEventListener('click', openCheck));
const checkReport = document.querySelector('#checkReport');
checkReport.addEventListener('input', (event) => {
  if (!event.target.matches('[data-issue-search]')) return;
  const query = event.target.value.trim().toLocaleLowerCase('vi-VN');
  checkReport.querySelectorAll('[data-issue-text]').forEach((item) => { item.hidden = Boolean(query) && !item.dataset.issueText.includes(query); });
  // Open the groups that still have matches so the results are visible.
  checkReport.querySelectorAll('.issue-group').forEach((group) => {
    if (query) group.open = Boolean(group.querySelector('[data-issue-text]:not([hidden])'));
  });
});
checkReport.addEventListener('click', async (event) => {
  if (!event.target.closest('[data-download-issues]')) return;
  const name = (latestBooking.filename || 'booking').replace(/\.[^.]+$/, '');
  try {
    await downloadWorkbook(buildIssuesWorkbook(bookingDetail.sheetCheck, latestBooking.filename), `LOI_FILE_BOOKING_${name}.xlsx`);
  } catch (error) {
    showToast(error.message, 'error');
  }
});
document.querySelector('#exportFab').addEventListener('click', async () => {
  const fab = document.querySelector('#exportFab');
  const issues = checkIssues({ booking: activeBooking(), summary: warehouseSummary });
  // Something blocks the export: show the check so the planner sees why.
  if (issues.length) {
    openCheck();
    showToast(issues.join(' '), 'error');
    return;
  }
  fab.disabled = true;
  try {
    await exportSummary();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    fab.disabled = false;
  }
});
document.querySelectorAll('[data-close-check]').forEach((button) => button.addEventListener('click', closeCheck));
document.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', async () => {
  // withBusyButton returns null when the export failed; keep the dialog open to show why.
  if (await withBusyButton(button, 'Đang xuất', exportSummary) !== null) closeCheck();
}));
document.querySelector('#overviewWarnings').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-goto-status]');
  if (!chip) return;
  modelFilters.status = chip.dataset.gotoStatus;
  modelFilters.customer = '';
  document.querySelectorAll('.nav__item').forEach((item) => item.classList.toggle('nav__item--active', item.dataset.page === 'Mã hàng'));
  showPage('Mã hàng');
});

document.querySelectorAll('.nav__item').forEach((item) => item.addEventListener('click', () => {
  document.querySelectorAll('.nav__item').forEach((navItem) => navItem.classList.remove('nav__item--active'));
  item.classList.add('nav__item--active');
  showPage(item.dataset.page);
}));

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

document.querySelector('#modelSearch').addEventListener('input', (event) => {
  modelFilters.query = event.target.value;
  modelLimit = PAGE_SIZE;
  renderModelTable();
});
document.querySelectorAll('[data-column-filter]').forEach((input) => input.addEventListener('input', () => {
  modelFilters.columns[input.dataset.columnFilter] = input.value;
  modelLimit = PAGE_SIZE;
  renderModelTable();
}));
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
// A brand logo that cannot load leaves the initials underneath visible.
document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement && event.target.hasAttribute('data-brand-logo')) event.target.remove();
}, true);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeOrder();
  closeChanges();
  closeCheck();
});

// Desktop app only (window.planner comes from the Electron preload): check GitHub for a newer
// version and install it over this one.
const updateButton = document.querySelector('#updateButton');
const updateLabel = (text) => { updateButton.querySelector('span').textContent = text; };
const megabytes = (bytes) => (bytes / 1048576).toFixed(1);

async function markAvailableUpdate() {
  try {
    const info = await window.planner.checkForUpdate();
    updateButton.classList.toggle('app-update__button--new', info.available);
    updateLabel(info.available ? `Cập nhật v${info.latest}` : 'Cập nhật');
  } catch {
    // Offline at start-up: the button still checks again when clicked.
  }
}

async function runUpdate() {
  updateButton.disabled = true;
  updateLabel('Đang kiểm tra…');
  let stopProgress = () => {};
  try {
    const info = await window.planner.checkForUpdate();
    if (!info.available) {
      showToast(`Bạn đang dùng bản mới nhất (v${info.current}).`);
      return;
    }
    if (!info.asset) {
      showToast(`Có bản v${info.latest} nhưng chưa có file cài cho máy này.`, 'error');
      return;
    }
    const notes = info.notes ? `\n\nNội dung:\n${info.notes.slice(0, 600)}` : '';
    if (!window.confirm(`Có phiên bản mới v${info.latest} (đang dùng v${info.current}).${notes}\n\nTải và cài đè lên bản hiện tại? Ứng dụng sẽ tự đóng và mở lại; dữ liệu đã lưu được giữ nguyên.`)) return;
    stopProgress = window.planner.onUpdateProgress(({ received, total }) => {
      updateLabel(total ? `Đang tải ${Math.floor((received / total) * 100)}%` : `Đang tải ${megabytes(received)} MB`);
    });
    updateLabel('Đang tải…');
    const result = await window.planner.installUpdate();
    if (result.manual) showToast('Đã mở file cài mới: kéo Inkava Planner vào thư mục Applications để thay bản cũ.', 'error');
    else if (result.opened) showToast('Đang chạy từ mã nguồn nên không tự cài được; đã mở trang phát hành.');
    else if (result.installed) updateLabel('Đang cài đặt…');
  } catch (error) {
    showToast(`Không cập nhật được: ${error.message}`, 'error');
  } finally {
    stopProgress();
    if (updateButton.querySelector('span').textContent !== 'Đang cài đặt…') {
      updateButton.disabled = false;
      markAvailableUpdate();
    }
  }
}

if (window.planner) {
  updateButton.hidden = false;
  updateButton.addEventListener('click', runUpdate);
  markAvailableUpdate();
}

renderFileHistory();
renderDashboard(fallbackDashboard);
setStorageStatus(isStaticPages ? '' : 'Đang kết nối SQLite…');
// Browser mode reads the booking history before it can pick the newest booking.
(async () => {
  await loadFileHistory();
  await loadOrigins();
  await loadSources();
  await loadDashboard();
  await loadChanges();
  if (!isStaticPages) {
    pollOrigins();
    setInterval(pollOrigins, PATH_POLL_SECONDS * 1000);
  }
})();
