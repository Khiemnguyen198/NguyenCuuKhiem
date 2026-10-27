import '@phosphor-icons/web/regular';
import * as XLSX from 'xlsx';
import './styles.css';

const formatNumber = new Intl.NumberFormat('vi-VN');
const isStaticPages = import.meta.env.BASE_URL !== '/';

const fallbackDashboard = {
  source: 'demo',
  filename: '45.DECATHLON - KẾ HOẠCH BOOK IN CẬP NHẬT NGÀY 26102026.xlsx',
  rowCount: 2503,
  totalQuantity: 1768485,
  totalImpressions: 2953041,
  uniquePo: 2410
};

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
let fileHistoryState = [{
  id: 'demo-original',
  category: 'original',
  filename: fallbackDashboard.filename,
  createdAt: '2026-10-26T14:32:00+07:00',
  rowCount: fallbackDashboard.rowCount,
  totalQuantity: fallbackDashboard.totalQuantity,
  note: 'File gốc được giữ nguyên; hệ thống chỉ đọc dữ liệu.'
}];

const schedule = [
  {
    label: '1 ngày', due: '28/10',
    days: [
      { load: 520418, minutes: 173473, capacity: 144000, machines: 22, rate: 120 },
      { load: 312617, minutes: 104206, capacity: 144000, machines: 13, rate: 72 },
      { load: 198306, minutes: 66102, capacity: 144000, machines: 9, rate: 46 },
      null, null, null
    ]
  },
  {
    label: '2 ngày', due: '29/10',
    days: [
      { load: 286720, minutes: 95573, capacity: 144000, machines: 12, rate: 66 },
      { load: 402118, minutes: 134039, capacity: 144000, machines: 17, rate: 93 },
      { load: 365422, minutes: 121807, capacity: 144000, machines: 16, rate: 85 },
      { load: 201744, minutes: 67248, capacity: 144000, machines: 9, rate: 47 },
      null, null
    ]
  },
  {
    label: '3 ngày', due: '30/10',
    days: [
      { load: 218305, minutes: 72768, capacity: 144000, machines: 10, rate: 51 },
      { load: 267440, minutes: 89147, capacity: 144000, machines: 12, rate: 62 },
      { load: 309815, minutes: 103272, capacity: 144000, machines: 14, rate: 72 },
      { load: 288671, minutes: 96224, capacity: 144000, machines: 13, rate: 67 },
      { load: 176120, minutes: 58707, capacity: 144000, machines: 8, rate: 41 },
      null
    ]
  },
  {
    label: '5 ngày', due: '31/10',
    days: [
      { load: 102665, minutes: 34222, capacity: 144000, machines: 5, rate: 24 },
      { load: 141232, minutes: 47077, capacity: 144000, machines: 6, rate: 33 },
      { load: 188506, minutes: 62835, capacity: 144000, machines: 8, rate: 44 },
      { load: 212884, minutes: 70961, capacity: 144000, machines: 9, rate: 49 },
      { load: 233418, minutes: 77806, capacity: 144000, machines: 10, rate: 54 },
      { load: 321560, minutes: 107187, capacity: 144000, machines: 14, rate: 74 }
    ]
  }
];

const weekdays = [
  ['Thứ 2', '26/10'], ['Thứ 3', '27/10'], ['Thứ 4', '28/10'],
  ['Thứ 5', '29/10'], ['Thứ 6', '30/10'], ['Thứ 7', '31/10']
];

document.querySelector('#app').innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">Bàn điều phối<br />sản xuất</div>
      <nav class="nav" aria-label="Điều hướng chính">
        <button class="nav__item" data-page="Tổng quan"><i class="ph ph-house"></i><span>Tổng quan</span></button>
        <button class="nav__item nav__item--active" data-page="Kế hoạch"><i class="ph ph-calendar-dots"></i><span>Kế hoạch</span></button>
        <button class="nav__item" data-page="Cân đối"><i class="ph ph-chart-bar"></i><span>Cân đối</span></button>
        <button class="nav__item" data-page="Lịch sử"><i class="ph ph-clock-counter-clockwise"></i><span>Lịch sử</span></button>
        <button class="nav__item" data-page="Cấu hình"><i class="ph ph-gear-six"></i><span>Cấu hình</span></button>
      </nav>
      <div class="sidebar__foot"><span class="status-dot"></span>SQLite đang hoạt động</div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="title-group">
          <div>
            <p class="eyebrow" id="pageEyebrow">BẢNG ĐIỀU PHỐI</p>
            <h1 id="pageTitle">Kế hoạch sản xuất</h1>
          </div>
          <button class="primary-button" id="importButton"><i class="ph ph-upload-simple"></i>Nhập file booking</button>
          <input id="fileInput" type="file" accept=".xlsx,.xls" hidden />
        </div>
        <div class="topbar__actions">
          <div class="date-stamp"><i class="ph ph-calendar-blank"></i><div><strong>Thứ Ba, 27/10/2026</strong><span>Tuần 26/10 – 31/10/2026</span></div></div>
        </div>
      </header>

      <section class="overview-view" id="overviewView" hidden>
        <div class="overview-intro">
          <div><p class="section-heading__overline">KHO TỆP SẢN XUẤT</p><h2>Lịch sử xử lý file</h2><p>Theo dõi file từ lúc nhận bản gốc đến khi hoàn thành và giao đi.</p></div>
          <div class="overview-counts">
            <div><strong id="deliveredCount">0</strong><span>Đã giao</span></div>
            <div><strong id="processedCount">0</strong><span>Đã xử lý</span></div>
            <div><strong id="originalCount">0</strong><span>File gốc</span></div>
          </div>
        </div>
        <div class="file-history-grid">
          <section class="file-history-card file-history-card--delivered">
            <header><span class="history-icon"><i class="ph ph-paper-plane-tilt"></i></span><div><h3>Lịch sử giao file</h3><p>Các file kết quả đã gửi đi</p></div><span class="history-count" id="deliveredBadge">0</span></header>
            <div class="file-history-list" id="deliveredFiles"></div>
          </section>
          <section class="file-history-card file-history-card--processed">
            <header><span class="history-icon"><i class="ph ph-check-square-offset"></i></span><div><h3>File đã làm</h3><p>Kết quả đã xử lý, chờ giao</p></div><span class="history-count" id="processedBadge">0</span></header>
            <div class="file-history-list" id="processedFiles"></div>
          </section>
          <section class="file-history-card file-history-card--original">
            <header><span class="history-icon"><i class="ph ph-file-lock"></i></span><div><h3>File gốc chưa chỉnh sửa</h3><p>Bản tải lên được bảo toàn</p></div><span class="history-count" id="originalBadge">0</span></header>
            <div class="file-history-list" id="originalFiles"></div>
          </section>
        </div>
      </section>

      <div class="workspace" id="planningView">
        <div class="workspace__main">
          <section class="file-strip" aria-live="polite">
            <div class="file-icon"><i class="ph ph-file-xls"></i></div>
            <div class="file-strip__copy"><strong id="filename">Đang tải dữ liệu…</strong><span id="fileMeta">Kết nối SQLite</span></div>
            <div class="valid-state"><i class="ph ph-check-circle"></i><div><strong>Dữ liệu hợp lệ</strong><span>Sẵn sàng lập kế hoạch</span></div></div>
          </section>

          <section class="metrics" aria-label="Tổng quan dữ liệu">
            <div class="metric"><strong id="rowCount">—</strong><span>dòng booking</span></div>
            <div class="metric"><strong id="totalQuantity">—</strong><span>sản phẩm</span></div>
            <div class="metric"><strong id="totalImpressions">—</strong><span>lượt hình</span></div>
            <button class="metric metric--pending" id="settingsShortcut"><strong id="machinesRequired">—</strong><span id="machineMetricLabel">Máy cần <i class="ph ph-info"></i></span><small id="machineMetricMeta">Chờ cấu hình định mức thời gian</small></button>
          </section>

          <section class="capacity-panel">
          <div class="section-heading">
            <div><p class="section-heading__overline">KẾ HOẠCH TUẦN</p><h2>Năng lực sản xuất theo tuần</h2></div>
            <div class="legend"><span><i class="legend__dot legend__dot--ok"></i>≤ 85% Bình thường</span><span><i class="legend__dot legend__dot--warn"></i>&gt; 85% Quá tải</span><span><i class="legend__dot legend__dot--danger"></i>&gt; 100% Vượt tải</span></div>
          </div>
          <div class="table-wrap">
            <table class="capacity-table">
              <thead><tr><th>Hạn giao</th><th>Chỉ tiêu</th>${weekdays.map(([day, date]) => `<th>${day}<span>${date}</span></th>`).join('')}</tr></thead>
              <tbody id="scheduleBody"></tbody>
            </table>
          </div>
          <div class="simulation-note"><i class="ph ph-info"></i><span>Số phút và máy trong bảng đang là dữ liệu mô phỏng giao diện. Hệ thống chỉ tính thật sau khi có định mức.</span></div>
          </section>
        </div>

        <aside class="issues-panel">
          <div class="issues-panel__title"><h2>Cần xử lý</h2><span>3</span></div>
          <button class="issue issue--danger">
            <i class="ph ph-warning-circle"></i><div><strong>Vượt công suất ngày 26/10</strong><span>Hạn giao 1 ngày đang ở 120%</span><small>Cần điều phối thêm máy hoặc dời đơn</small></div><i class="ph ph-caret-right"></i>
          </button>
          <button class="issue issue--warning">
            <i class="ph ph-warning"></i><div><strong>Nguy cơ quá tải ngày 27/10</strong><span>Hạn giao 2 ngày ở 93%</span><small>Cân nhắc điều chuyển sản lượng</small></div><i class="ph ph-caret-right"></i>
          </button>
          <button class="issue issue--warning">
            <i class="ph ph-clock-countdown"></i><div><strong>Dữ liệu thiếu định mức</strong><span>Còn 12 mã chưa có định mức thời gian</span><small>Vui lòng cấu hình để tính máy cần</small></div><i class="ph ph-caret-right"></i>
          </button>
        </aside>
      </div>
    </main>
  </div>
  <div class="modal" id="settingsModal" aria-hidden="true">
    <button class="modal__backdrop" data-close-settings aria-label="Đóng cấu hình"></button>
    <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
      <header class="settings-dialog__header">
        <div><p class="section-heading__overline">ĐỊNH MỨC SẢN XUẤT</p><h2 id="settingsTitle">Tính phút và số máy</h2></div>
        <button class="icon-button" data-close-settings aria-label="Đóng"><i class="ph ph-x"></i></button>
      </header>
      <form id="settingsForm">
        <div class="settings-grid">
          <label><span>Phút / lượt hình</span><input name="minutesPerImpression" type="number" min="0.0001" step="0.0001" required placeholder="Ví dụ: 0,25" /><small>Định mức thời gian cho một lượt hình in.</small></label>
          <label><span>Phút setup / PO</span><input name="setupMinutesPerPo" type="number" min="0" step="0.1" required /></label>
          <label><span>Số máy hiện có</span><input name="machineCount" type="number" min="1" step="1" required /></label>
          <label><span>Số ca / ngày</span><input name="shiftsPerDay" type="number" min="1" step="1" required /></label>
          <label><span>Phút / ca</span><input name="minutesPerShift" type="number" min="1" step="1" required /></label>
          <label><span>Hiệu suất máy (%)</span><input name="efficiencyPercent" type="number" min="1" max="100" step="0.1" required /></label>
          <label><span>Số ngày kế hoạch</span><input name="planningDays" type="number" min="1" step="1" required /><small>Tính từ Thứ Hai đến Thứ Bảy; Chủ Nhật nghỉ.</small></label>
        </div>
        <div class="calculation-preview" id="calculationPreview"></div>
        <footer class="settings-dialog__footer">
          <button type="button" class="secondary-button" data-close-settings>Hủy</button>
          <button type="submit" class="primary-button"><i class="ph ph-floppy-disk"></i>Lưu & tính lại</button>
        </footer>
      </form>
    </section>
  </div>
  <div class="toast" id="toast" role="status"></div>
`;

function rateClass(rate) {
  if (rate > 100) return 'danger';
  if (rate > 85) return 'warn';
  return 'ok';
}

function renderSchedule() {
  document.querySelector('#scheduleBody').innerHTML = schedule.map((group) => {
    const metrics = [
      ['Tải in', 'lượt hình', 'load'],
      ['Phút cần', 'phút', 'minutes'],
      ['Công suất', 'phút', 'capacity'],
      ['Máy cần', 'máy', 'machines'],
      ['Trạng thái', '', 'rate']
    ];
    return metrics.map(([label, unit, key], metricIndex) => `
      <tr class="${metricIndex === metrics.length - 1 ? 'status-row' : ''}">
        ${metricIndex === 0 ? `<th rowspan="5" class="leadtime"><strong>${group.label}</strong><span>(${group.due})</span></th>` : ''}
        <th class="indicator">${label}${unit ? `<span>(${unit})</span>` : ''}</th>
        ${group.days.map((day) => {
          if (!day) return '<td class="empty">—</td>';
          if (key !== 'rate') return `<td>${formatNumber.format(day[key])}</td>`;
          const state = rateClass(day.rate);
          return `<td><strong class="rate rate--${state}">${day.rate}%</strong><span class="bar"><i class="bar__fill bar__fill--${state}" style="width:${Math.min(day.rate, 100)}%"></i></span></td>`;
        }).join('')}
      </tr>
    `).join('');
  }).join('');
}

function toIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function readRowsFromSheet(sheet, range, leadTimeOverride = null) {
  const records = XLSX.utils.sheet_to_json(sheet, { range, defval: null, raw: true });
  return records
    .filter((row) => row.LINE != null && row.PO != null && Number(row['LINE QTY']) >= 0)
    .map((row) => ({
      line: String(row.LINE ?? ''),
      customer: String(row.CUS ?? ''),
      brand: String(row.BRAND ?? ''),
      ref: String(row.REF ?? ''),
      color: String(row.COLOR ?? ''),
      po: String(row.PO ?? ''),
      season: String(row.SS ?? ''),
      lineQuantity: Number(row['LINE QTY'] || 0),
      inputDate: toIsoDate(row.INPUT),
      outputDate: toIsoDate(row.OUTPUT),
      modelCode: String(row['MODEL CODE'] ?? ''),
      ticketNumber: String(row['SỐ PHIẾU'] ?? ''),
      planner: String(row['KẾ HOẠCH'] ?? ''),
      printCount: Number(row['HÌNH IN'] || 0),
      leadTime: String(row.Leadtime ?? leadTimeOverride ?? '')
    }));
}

function extractBookingRows(workbook) {
  if (workbook.Sheets.TH) return readRowsFromSheet(workbook.Sheets.TH, 4);
  const sources = [
    ['LEADTIME 1 NGÀY', '1 ngày'],
    ['LEADTIME 2 NGÀY', '2 ngày'],
    ['LEADTIME 3 NGÀY', '3 ngày'],
    ['LEADTIME 5 NGÀY', '5 ngày']
  ];
  return sources.flatMap(([sheetName, leadTime]) => workbook.Sheets[sheetName]
    ? readRowsFromSheet(workbook.Sheets[sheetName], 3, leadTime)
    : []);
}

function renderDashboard(data) {
  dashboardState = { ...fallbackDashboard, ...data };
  document.querySelector('#filename').textContent = data.filename;
  const sourceLabel = data.source === 'sqlite' ? 'Đã lưu SQLite' : data.source === 'browser' ? 'Đã đọc trong trình duyệt' : 'Dữ liệu mẫu';
  document.querySelector('#fileMeta').textContent = `${sourceLabel} • ${formatNumber.format(data.rowCount)} dòng`;
  document.querySelector('#rowCount').textContent = formatNumber.format(data.rowCount);
  document.querySelector('#totalQuantity').textContent = formatNumber.format(data.totalQuantity);
  document.querySelector('#totalImpressions').textContent = formatNumber.format(data.totalImpressions);
  renderMachineCalculation();
}

function formatFileDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || 'Chưa có thời gian';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function emptyHistory(label) {
  return `<div class="history-empty"><i class="ph ph-tray"></i><strong>Chưa có ${label}</strong><span>Dữ liệu sẽ xuất hiện tại đây khi có thao tác thực tế.</span></div>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function fileRow(file) {
  const meta = [file.rowCount ? `${formatNumber.format(file.rowCount)} dòng` : null, file.totalQuantity ? `${formatNumber.format(file.totalQuantity)} sản phẩm` : null].filter(Boolean).join(' • ');
  const safeFilename = escapeHtml(file.filename);
  return `
    <article class="history-row">
      <span class="history-row__icon"><i class="ph ph-file-xls"></i></span>
      <div class="history-row__body"><strong title="${safeFilename}">${safeFilename}</strong><span>${escapeHtml(meta || file.note || 'File sản xuất')}</span><small>${escapeHtml(formatFileDate(file.createdAt))}</small></div>
      <button class="history-row__menu" aria-label="Xem chi tiết ${safeFilename}"><i class="ph ph-dots-three-vertical"></i></button>
    </article>
  `;
}

function renderFileHistory(files = fileHistoryState) {
  fileHistoryState = files;
  const groups = {
    delivered: files.filter((file) => file.category === 'delivered'),
    processed: files.filter((file) => file.category === 'processed'),
    original: files.filter((file) => file.category === 'original')
  };
  for (const [category, items] of Object.entries(groups)) {
    document.querySelector(`#${category}Count`).textContent = formatNumber.format(items.length);
    document.querySelector(`#${category}Badge`).textContent = formatNumber.format(items.length);
    document.querySelector(`#${category}Files`).innerHTML = items.length ? items.map(fileRow).join('') : emptyHistory(category === 'delivered' ? 'file đã giao' : category === 'processed' ? 'file đã xử lý' : 'file gốc');
  }
}

async function loadFileHistory() {
  if (isStaticPages) {
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

function showPage(pageName) {
  const isOverview = pageName === 'Tổng quan';
  document.querySelector('#overviewView').hidden = !isOverview;
  document.querySelector('#planningView').hidden = isOverview;
  document.querySelector('#pageEyebrow').textContent = isOverview ? 'QUẢN LÝ FILE' : 'BẢNG ĐIỀU PHỐI';
  document.querySelector('#pageTitle').textContent = isOverview ? 'Tổng quan' : 'Kế hoạch sản xuất';
  if (isOverview) loadFileHistory();
}

function calculateCapacity(data, settings) {
  const minutesPerImpression = Number(settings.minutesPerImpression);
  const machineCount = Number(settings.machineCount);
  if (!minutesPerImpression || !machineCount) return null;
  const requiredMinutes = data.totalImpressions * minutesPerImpression + data.uniquePo * Number(settings.setupMinutesPerPo || 0);
  const capacityPerMachine = Number(settings.shiftsPerDay) * Number(settings.minutesPerShift) * (Number(settings.efficiencyPercent) / 100) * Number(settings.planningDays);
  if (capacityPerMachine <= 0) return null;
  const machinesRequired = Math.ceil(requiredMinutes / capacityPerMachine);
  return { requiredMinutes, capacityPerMachine, machinesRequired, gap: machineCount - machinesRequired };
}

function renderMachineCalculation() {
  const calculation = calculateCapacity(dashboardState, settingsState);
  const metric = document.querySelector('#settingsShortcut');
  if (!calculation) {
    document.querySelector('#machinesRequired').textContent = '—';
    document.querySelector('#machineMetricLabel').innerHTML = 'Máy cần <i class="ph ph-info"></i>';
    document.querySelector('#machineMetricMeta').textContent = 'Chờ cấu hình định mức thời gian';
    metric.dataset.state = 'pending';
    return;
  }
  document.querySelector('#machinesRequired').textContent = formatNumber.format(calculation.machinesRequired);
  document.querySelector('#machineMetricLabel').textContent = `Máy cần / ${settingsState.planningDays} ngày`;
  document.querySelector('#machineMetricMeta').textContent = calculation.gap >= 0
    ? `Đủ công suất • dư ${formatNumber.format(calculation.gap)} máy`
    : `Thiếu ${formatNumber.format(Math.abs(calculation.gap))} máy`;
  metric.dataset.state = calculation.gap >= 0 ? 'ok' : 'danger';
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
    try { settingsState = { ...defaultSettings, ...JSON.parse(localStorage.getItem('planner-settings')) }; } catch { settingsState = { ...defaultSettings }; }
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

let toastTimer;
function showToast(message, type = 'success') {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.className = `toast toast--visible toast--${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}

async function loadDashboard() {
  if (isStaticPages) {
    renderDashboard(fallbackDashboard);
    return;
  }
  try {
    const response = await fetch('/api/dashboard');
    if (!response.ok) throw new Error('API không khả dụng');
    renderDashboard(await response.json());
  } catch {
    renderDashboard(fallbackDashboard);
  }
}

document.querySelector('#importButton').addEventListener('click', () => document.querySelector('#fileInput').click());
document.querySelector('#fileInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const button = document.querySelector('#importButton');
  button.disabled = true;
  button.innerHTML = '<i class="ph ph-spinner-gap spin"></i>Đang xử lý';
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const rows = extractBookingRows(workbook);
    if (!rows.length) throw new Error('Không tìm thấy dữ liệu booking hợp lệ.');
    const localPayload = {
      source: 'browser',
      filename: file.name,
      rowCount: rows.length,
      totalQuantity: rows.reduce((sum, row) => sum + row.lineQuantity, 0),
      totalImpressions: rows.reduce((sum, row) => sum + row.lineQuantity * row.printCount, 0),
      uniquePo: new Set(rows.map((row) => row.po)).size
    };
    if (isStaticPages) {
      renderDashboard(localPayload);
      fileHistoryState = [{ id: `browser-${Date.now()}`, category: 'original', filename: file.name, createdAt: new Date().toISOString(), rowCount: rows.length, totalQuantity: localPayload.totalQuantity, note: 'File gốc được giữ nguyên trong trình duyệt.' }, ...fileHistoryState.filter((item) => item.filename !== file.name)];
      renderFileHistory(fileHistoryState);
      showToast(`Đã đọc ${formatNumber.format(localPayload.rowCount)} dòng. Bản web công khai không lưu SQLite.`, 'info');
      return;
    }
    let payload;
    try {
      const response = await fetch('/api/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, rows })
      });
      if (!response.ok) throw new Error('API không khả dụng');
      payload = await response.json();
    } catch {
      payload = localPayload;
      renderDashboard(payload);
      showToast(`Đã đọc ${formatNumber.format(payload.rowCount)} dòng. Bản web công khai không lưu SQLite.`, 'info');
      return;
    }
    renderDashboard(payload);
    loadFileHistory();
    showToast(`Đã nhập ${formatNumber.format(payload.rowCount)} dòng vào SQLite.`);
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
  if (item.dataset.page === 'Cấu hình') openSettings();
  else if (item.dataset.page === 'Tổng quan' || item.dataset.page === 'Kế hoạch') showPage(item.dataset.page);
  else showToast(`${item.dataset.page} đang được hoàn thiện trong bản test.`, 'info');
}));

document.querySelector('#settingsShortcut').addEventListener('click', openSettings);
document.querySelectorAll('[data-close-settings]').forEach((button) => button.addEventListener('click', closeSettings));
document.querySelector('#settingsForm').addEventListener('input', renderCalculationPreview);
document.querySelector('#settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const settings = settingsFromForm();
  const submit = event.submitter;
  submit.disabled = true;
  try {
    if (isStaticPages) {
      localStorage.setItem('planner-settings', JSON.stringify(settings));
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
    closeSettings();
    showToast('Đã lưu định mức và tính lại số máy.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll('.issue').forEach((issue) => issue.addEventListener('click', () => {
  document.querySelectorAll('.issue').forEach((item) => item.classList.remove('issue--selected'));
  issue.classList.add('issue--selected');
}));

renderSchedule();
renderFileHistory();
loadDashboard();
loadSettings();
loadFileHistory();
