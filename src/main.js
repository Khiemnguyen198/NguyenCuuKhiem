import '@phosphor-icons/web/regular';
import * as XLSX from 'xlsx';
import './styles.css';
import { analyzeBookingRows } from './local-ai.js';
import { normalizeStandardRows } from './config-ai.js';

const formatNumber = new Intl.NumberFormat('vi-VN');
const isStaticPages = import.meta.env.PROD || import.meta.env.BASE_URL !== '/';

const fallbackDashboard = {
  source: 'demo',
  importId: 'demo-plan',
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
      <div class="sidebar__foot"><span class="status-dot"></span>${isStaticPages ? 'Lưu trên trình duyệt' : 'SQLite đang hoạt động'}</div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="title-group">
          <div>
            <p class="eyebrow" id="pageEyebrow">DANH SÁCH KẾ HOẠCH</p>
            <h1 id="pageTitle">Kế hoạch</h1>
          </div>
          <button class="primary-button" id="importButton"><i class="ph ph-upload-simple"></i>Nhập file booking</button>
          <button class="back-button" id="backToPlans" hidden><i class="ph ph-arrow-left"></i>Danh sách kế hoạch</button>
          <input id="fileInput" type="file" accept=".xlsx,.xls" hidden />
        </div>
        <div class="topbar__actions">
          <div class="date-stamp"><i class="ph ph-calendar-blank"></i><div><strong>Thứ Ba, 27/10/2026</strong><span>Tuần 26/10 – 31/10/2026</span></div></div>
        </div>
      </header>

      <section class="plan-list-view" id="planListView">
        <div class="plan-list-heading">
          <div><p class="section-heading__overline">DỮ LIỆU ĐÃ NHẬP</p><h2>Các file kế hoạch</h2><p>Chọn một file để mở bảng điều phối và xem năng lực sản xuất.</p></div>
          <div class="plan-list-total"><strong id="planCount">0</strong><span>kế hoạch</span></div>
        </div>
        <div class="plan-list" id="planFiles"></div>
      </section>

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
            <header><span class="history-icon"><i class="ph ph-paper-plane-tilt"></i></span><div><h3>Lịch sử giao file</h3><p>Các file được xác nhận đã giao</p></div><span class="history-count" id="deliveredBadge">0</span></header>
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

      <section class="config-view" id="configView" hidden>
        <div class="config-intro">
          <div><p class="section-heading__overline">ĐỊNH MỨC SẢN XUẤT</p><h2>Danh mục thời gian chuẩn</h2><p>Nhập Excel hoặc tạo thủ công. AI local sẽ chuẩn hóa dữ liệu để dùng cho kế hoạch.</p></div>
          <div class="config-actions">
            <button class="secondary-button" id="addStandard"><i class="ph ph-plus"></i>Nhập thủ công</button>
            <button class="primary-button" id="importStandards"><i class="ph ph-file-xls"></i>Nhập Excel cấu hình</button>
            <input id="standardsFileInput" type="file" accept=".xlsx,.xls" hidden />
          </div>
        </div>
        <div class="config-workspace">
          <aside class="standard-library">
            <div class="standard-library__head"><div><strong>Danh mục định mức</strong><span id="standardsCount">0 cấu hình</span></div><label><i class="ph ph-magnifying-glass"></i><input id="standardSearch" type="search" placeholder="Tìm Oval 18…" /></label></div>
            <div class="standard-list" id="standardList"></div>
          </aside>
          <section class="standard-detail">
            <div class="standard-detail__empty" id="standardEmpty"><i class="ph ph-sliders-horizontal"></i><strong>Chọn một định mức</strong><span>Thông tin đầy đủ sẽ hiển thị tại đây.</span></div>
            <form id="standardForm" hidden>
              <header class="standard-detail__head">
                <div><div class="standard-source" id="standardSource">NHẬP THỦ CÔNG</div><h3 id="standardTitle">Định mức mới</h3><p id="standardUpdated">Chưa lưu</p></div>
                <span class="lock-state" id="standardLockState"><i class="ph ph-lock-key"></i>Đang khóa</span>
              </header>
              <fieldset id="standardFields" disabled>
                <label class="field-wide"><span>Tên định mức / mã kiểu</span><input name="name" required placeholder="Ví dụ: Oval 18" /></label>
                <label><span>Phút / lượt hình</span><input name="minutesPerImpression" type="number" min="0.0001" step="0.0001" required /></label>
                <label><span>Phút setup / PO</span><input name="setupMinutesPerPo" type="number" min="0" step="0.1" /></label>
                <label><span>Số máy</span><input name="machineCount" type="number" min="1" step="1" /></label>
                <label><span>Số ca / ngày</span><input name="shiftsPerDay" type="number" min="1" step="1" /></label>
                <label><span>Phút / ca</span><input name="minutesPerShift" type="number" min="1" step="1" /></label>
                <label><span>Hiệu suất (%)</span><input name="efficiencyPercent" type="number" min="1" max="100" step="0.1" /></label>
                <label><span>Số ngày kế hoạch</span><input name="planningDays" type="number" min="1" max="6" step="1" /></label>
                <label class="field-wide"><span>Ghi chú</span><textarea name="note" rows="3" placeholder="Thông tin bổ sung…"></textarea></label>
              </fieldset>
              <footer class="standard-detail__footer">
                <button type="button" class="secondary-button" id="unlockStandard"><i class="ph ph-lock-key-open"></i>Mở khóa để sửa</button>
                <button type="submit" class="primary-button" id="saveStandard" hidden><i class="ph ph-floppy-disk"></i>Lưu thay đổi</button>
                <button type="button" class="apply-standard" id="applyStandard"><i class="ph ph-check-circle"></i>Dùng để tính kế hoạch</button>
              </footer>
            </form>
          </section>
        </div>
      </section>

      <div class="workspace" id="planningView" hidden>
        <div class="workspace__main">
          <section class="file-strip" aria-live="polite">
            <div class="file-icon"><i class="ph ph-file-xls"></i></div>
            <div class="file-strip__copy"><strong id="filename">Đang tải dữ liệu…</strong><span id="fileMeta">Kết nối SQLite</span></div>
            <div class="valid-state" id="dataCheckState"><i class="ph ph-brain"></i><div><strong id="dataCheckTitle">AI local sẵn sàng</strong><span id="dataCheckMeta">Kiểm tra trực tiếp trên thiết bị</span></div></div>
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

        <aside class="issues-panel ai-panel">
          <div class="issues-panel__title"><div><p>AI LOCAL</p><h2>Kiểm tra file</h2></div><span id="aiScore">—</span></div>
          <div class="ai-privacy"><i class="ph ph-shield-check"></i><span>Chạy cục bộ · Không gửi dữ liệu ra ngoài</span></div>
          <div class="ai-findings" id="aiFindings"><div class="ai-empty"><i class="ph ph-brain"></i><strong>Chọn file để kiểm tra</strong><span>AI local sẽ rà soát dữ liệu đã lưu trong SQLite.</span></div></div>
          <button class="ai-refresh" id="runAiCheck"><i class="ph ph-arrows-clockwise"></i>Kiểm tra lại</button>
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
    .filter((row) => row.LINE != null && [row.PO, row.REF, row['MODEL CODE'], row['LINE QTY']].some((value) => value != null && value !== ''))
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

function fileAction(file) {
  if (file.id === 'demo-original') return '<span class="history-row__status">Mẫu</span>';
  const category = file.category === 'original' ? 'processed' : file.category === 'processed' ? 'delivered' : null;
  if (!category) return '<span class="history-row__status">Đã giao</span>';
  const done = fileHistoryState.some((item) => item.category === category && item.importId === file.importId);
  const label = category === 'processed' ? 'Đánh dấu đã xử lý' : 'Đánh dấu đã giao';
  return done ? '<span class="history-row__status">Đã ghi nhận</span>' : `<button class="history-action" data-file-id="${escapeHtml(file.id)}" data-category="${category}" aria-label="${label}: ${escapeHtml(file.filename)}">${label}</button>`;
}

function saveBrowserFiles(files) {
  localStorage.setItem('planner-file-history', JSON.stringify(files.filter((file) => file.id !== 'demo-original')));
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
    try {
      const stored = JSON.parse(localStorage.getItem('planner-file-history') || '[]');
      if (Array.isArray(stored) && stored.length) fileHistoryState = stored;
    } catch { showToast('Không thể đọc lịch sử trong trình duyệt.', 'error'); }
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
  localStorage.setItem('planner-production-standards', JSON.stringify(standards));
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
      const stored = JSON.parse(localStorage.getItem('planner-production-standards') || '[]');
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

function bestStandardSheet(workbook) {
  let best = { standards: [], mapping: {}, ignoredRows: 0, confidence: 'low', sheetName: '' };
  for (const sheetName of workbook.SheetNames) {
    for (let range = 0; range < 8; range += 1) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { range, defval: null, raw: true });
      const candidate = { ...normalizeStandardRows(rows), sheetName };
      if (candidate.standards.length > best.standards.length) best = candidate;
    }
  }
  return best;
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

function showPage(pageName) {
  const isOverview = pageName === 'Tổng quan';
  const isPlanList = pageName === 'Kế hoạch';
  const isConfig = pageName === 'Cấu hình';
  document.querySelector('#overviewView').hidden = !isOverview;
  document.querySelector('#planListView').hidden = !isPlanList;
  document.querySelector('#configView').hidden = !isConfig;
  document.querySelector('#planningView').hidden = true;
  document.querySelector('#backToPlans').hidden = true;
  document.querySelector('#importButton').hidden = isConfig;
  document.querySelector('#pageEyebrow').textContent = isOverview ? 'QUẢN LÝ FILE' : isConfig ? 'THÔNG SỐ & ĐỊNH MỨC' : 'DANH SÁCH KẾ HOẠCH';
  document.querySelector('#pageTitle').textContent = isOverview ? 'Tổng quan' : isConfig ? 'Cấu hình' : 'Kế hoạch';
  if (isOverview) loadFileHistory();
  if (isPlanList) loadFileHistory();
  if (isConfig) loadStandards();
}

async function openPlanDetail(importId = null) {
  activeImportId = importId || fallbackDashboard.importId;
  document.querySelector('#overviewView').hidden = true;
  document.querySelector('#planListView').hidden = true;
  document.querySelector('#configView').hidden = true;
  document.querySelector('#planningView').hidden = false;
  document.querySelector('#backToPlans').hidden = false;
  document.querySelector('#importButton').hidden = false;
  document.querySelector('#pageEyebrow').textContent = 'KẾ HOẠCH SẢN XUẤT';
  document.querySelector('#pageTitle').textContent = 'Điều phối kế hoạch';
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

async function persistSettings(settings) {
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
      uniquePo: Number(selectedPlan.uniquePo || 0)
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
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const rows = extractBookingRows(workbook);
    if (!rows.length) throw new Error('Không tìm thấy dữ liệu booking hợp lệ.');
    const localPayload = {
      source: 'browser',
      importId: `browser-${Date.now()}`,
      filename: file.name,
      rowCount: rows.length,
      totalQuantity: rows.reduce((sum, row) => sum + row.lineQuantity, 0),
      totalImpressions: rows.reduce((sum, row) => sum + row.lineQuantity * row.printCount, 0),
      uniquePo: new Set(rows.map((row) => row.po)).size
    };
    if (isStaticPages) {
      const importId = crypto.randomUUID();
      localPayload.importId = importId;
      const aiReport = analyzeBookingRows(rows);
      const files = [{
        id: importId,
        importId,
        category: 'original',
        filename: file.name,
        createdAt: new Date().toISOString(),
        rowCount: rows.length,
        totalQuantity: localPayload.totalQuantity,
        totalImpressions: localPayload.totalImpressions,
        uniquePo: localPayload.uniquePo,
        aiReport,
        note: 'Chỉ lưu thông tin file; file Excel gốc không bị thay đổi.'
      }, ...fileHistoryState.filter((item) => item.id !== 'demo-original')];
      saveBrowserFiles(files);
      renderFileHistory(files);
      openPlanDetail(importId);
      showToast(`Đã đọc ${formatNumber.format(localPayload.rowCount)} dòng. Bản preview Sites không lưu SQLite.`, 'info');
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
      showToast(`Đã đọc ${formatNumber.format(payload.rowCount)} dòng. Bản preview Sites không lưu SQLite.`, 'info');
      return;
    }
    renderDashboard(payload);
    await loadFileHistory();
    openPlanDetail(payload.importId);
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
  if (item.dataset.page === 'Tổng quan' || item.dataset.page === 'Kế hoạch' || item.dataset.page === 'Cấu hình') showPage(item.dataset.page);
  else showToast(`${item.dataset.page} đang được hoàn thiện trong bản test.`, 'info');
}));

document.querySelector('#standardList').addEventListener('click', (event) => {
  const row = event.target.closest('[data-standard-id]');
  if (row) selectStandard(row.dataset.standardId);
});
document.querySelector('#standardSearch').addEventListener('input', (event) => renderStandardList(event.target.value));
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
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const result = bestStandardSheet(workbook);
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

document.querySelectorAll('.issue').forEach((issue) => issue.addEventListener('click', () => {
  document.querySelectorAll('.issue').forEach((item) => item.classList.remove('issue--selected'));
  issue.classList.add('issue--selected');
}));

renderSchedule();
renderFileHistory();
loadDashboard();
loadSettings();
loadFileHistory();
