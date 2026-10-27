import '@phosphor-icons/web/regular';
import * as XLSX from 'xlsx';
import './styles.css';
import { analyzeBookingRows } from './local-ai.js';
import { MACHINE_SUGGESTIONS, normalizeStandardRows } from './config-ai.js';
import { calculateCapacity } from './capacity.js';

const formatNumber = new Intl.NumberFormat('vi-VN');
const isStaticPages = import.meta.env.PROD || import.meta.env.BASE_URL !== '/';

const fallbackDashboard = {
  source: 'demo',
  importId: 'demo-plan',
  filename: '45.DECATHLON - KẾ HOẠCH BOOK IN CẬP NHẬT NGÀY 26102026.xlsx',
  rowCount: 2503,
  totalQuantity: 1768485,
  totalImpressions: 2953041,
  uniquePo: 2410,
  leadTimes: [
    { leadTime: '1 ngày', rowCount: 2149, totalQuantity: 1633779, totalImpressions: 2355842 },
    { leadTime: '2 ngày', rowCount: 184, totalQuantity: 72658, totalImpressions: 272254 },
    { leadTime: '3 ngày', rowCount: 143, totalQuantity: 56000, totalImpressions: 282609 },
    { leadTime: '5 ngày', rowCount: 27, totalQuantity: 6048, totalImpressions: 42336 }
  ]
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

document.querySelector('#app').innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">Bàn điều phối<br />sản xuất</div>
      <nav class="nav" aria-label="Điều hướng chính">
        <button class="nav__item nav__item--active" data-page="Tổng quan"><i class="ph ph-house"></i><span>Tổng quan</span></button>
        <button class="nav__item" data-page="Kế hoạch"><i class="ph ph-calendar-dots"></i><span>Kế hoạch</span></button>
        <button class="nav__item" data-page="Cấu hình"><i class="ph ph-gear-six"></i><span>Cấu hình</span></button>
      </nav>
      <div class="sidebar__foot"><span class="status-dot"></span>${isStaticPages ? 'Lưu trên trình duyệt' : 'SQLite đang hoạt động'}</div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="title-group">
          <div>
            <p class="eyebrow" id="pageEyebrow">KHẢ NĂNG GIAO HÀNG</p>
            <h1 id="pageTitle">Tổng quan</h1>
          </div>
          <button class="primary-button" id="importButton"><i class="ph ph-upload-simple"></i>Nhập file booking</button>
          <button class="back-button" id="backToPlans" hidden><i class="ph ph-arrow-left"></i>Danh sách kế hoạch</button>
          <input id="fileInput" type="file" accept=".xlsx,.xls" hidden />
        </div>
        <div class="topbar__actions">
          <div class="date-stamp"><i class="ph ph-calendar-blank"></i><div><strong>Thứ Ba, 27/10/2026</strong><span>Tuần 26/10 – 31/10/2026</span></div></div>
        </div>
      </header>

      <section class="plan-list-view" id="planListView" hidden>
        <div class="plan-list-heading">
          <div><p class="section-heading__overline">DỮ LIỆU ĐÃ NHẬP</p><h2>Các file kế hoạch</h2><p>Chọn một file để mở bảng điều phối và xem năng lực sản xuất.</p></div>
          <div class="plan-list-total"><strong id="planCount">0</strong><span>kế hoạch</span></div>
        </div>
        <div class="plan-list" id="planFiles"></div>
      </section>

      <section class="overview-view" id="overviewView">
        <section class="delivery-summary">
          <div class="delivery-summary__heading">
            <div><p class="section-heading__overline">KẾT QUẢ TỔNG HỢP</p><h2>Booking và khả năng đáp ứng</h2><p>Đối chiếu nhu cầu khách hàng với năng lực máy đã cấu hình.</p></div>
            <div class="assurance-badge assurance-badge--pending" id="overviewAssurance"><i class="ph ph-info"></i><span><small>Kết luận</small><strong>Chưa đủ cấu hình</strong></span></div>
          </div>
          <div class="delivery-kpis">
            <div><span>Booking yêu cầu</span><strong id="overviewBooking">—</strong><small>sản phẩm</small></div>
            <div><span>Lượt hình cần in</span><strong id="overviewImpressions">—</strong><small>lượt hình</small></div>
            <div><span>Có thể in</span><strong id="overviewPrintable">—</strong><small>sản phẩm ước tính</small></div>
            <div><span>Có thể giao đúng hạn</span><strong id="overviewDeliverable">—</strong><small id="overviewShortage">Cần cấu hình định mức</small></div>
          </div>
          <div class="leadtime-summary">
            <div class="leadtime-summary__head"><strong>Theo leadtime booking</strong><span>Nhà máy làm Thứ 2–Thứ 7, bỏ qua Chủ Nhật</span></div>
            <div class="table-wrap"><table class="delivery-table"><thead><tr><th>Leadtime</th><th>Dòng hàng</th><th>Booking</th><th>Có thể giao</th><th>Thiếu</th><th>Kết luận</th></tr></thead><tbody id="overviewLeadtimeBody"></tbody></table></div>
          </div>
        </section>
        <div class="overview-intro">
          <div><p class="section-heading__overline">LUỒNG XỬ LÝ FILE</p><h2>Nhập → kiểm tra → xử lý → giao file</h2><p>File gốc luôn được giữ nguyên để đối chiếu.</p></div>
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
                <div class="field-wide standard-name-field">
                  <label><span>Tên máy / định mức</span><input name="name" list="machineSuggestions" required placeholder="Chọn máy hoặc nhập tên mới" /></label>
                  <datalist id="machineSuggestions">${MACHINE_SUGGESTIONS.map((machine) => `<option value="${machine}"></option>`).join('')}</datalist>
                  <div class="machine-suggestions" id="machineSuggestionPanel" hidden><span>Máy có tại nhà máy</span><div>${MACHINE_SUGGESTIONS.map((machine) => `<button type="button" data-machine-name="${machine}">${machine}</button>`).join('')}</div></div>
                </div>
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
            <div class="metric"><strong id="totalQuantity">—</strong><span>Booking yêu cầu</span><small id="rowCount">— dòng booking</small></div>
            <div class="metric"><strong id="totalImpressions">—</strong><span>Lượt hình cần in</span><small>Từ file booking</small></div>
            <div class="metric"><strong id="printableQuantity">—</strong><span>Có thể in</span><small>Sản phẩm ước tính</small></div>
            <div class="metric"><strong id="deliverableQuantity">—</strong><span>Có thể giao đúng hạn</span><small id="planShortage">Chờ cấu hình định mức</small></div>
          </section>

          <section class="capacity-panel">
            <div class="section-heading">
              <div><p class="section-heading__overline">ĐỐI CHIẾU KẾ HOẠCH</p><h2>Khả năng đáp ứng theo leadtime</h2></div>
              <button class="capacity-config-link" id="settingsShortcut"><i class="ph ph-sliders-horizontal"></i><span><strong id="machinesRequired">Cấu hình năng lực</strong><small id="machineMetricMeta">Nhập phút và số máy</small></span></button>
            </div>
            <div class="capacity-facts">
              <div><span>Tổng phút cần</span><strong id="requiredMinutes">—</strong></div>
              <div><span>Tổng phút có thể chạy</span><strong id="availableMinutes">—</strong></div>
              <div><span>Mức đáp ứng</span><strong id="coverageRate">—</strong></div>
              <div class="plan-assurance" id="planAssurance"><span>Kết luận</span><strong>Chưa đủ cấu hình</strong></div>
            </div>
            <div class="table-wrap"><table class="delivery-table"><thead><tr><th>Leadtime</th><th>Dòng hàng</th><th>Booking</th><th>Có thể giao</th><th>Thiếu</th><th>Kết luận</th></tr></thead><tbody id="planLeadtimeBody"></tbody></table></div>
            <div class="calculation-note"><i class="ph ph-info"></i><span>Kết quả là ước tính từ định mức đang chọn. Cần xác nhận số phút, số máy, ca làm và hiệu suất với sản xuất trước khi chốt kế hoạch.</span></div>
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

function summarizeLeadTimes(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const leadTime = String(row.leadTime || 'Chưa xác định').trim() || 'Chưa xác định';
    const group = groups.get(leadTime) || { leadTime, rowCount: 0, totalQuantity: 0, totalImpressions: 0 };
    group.rowCount += 1;
    group.totalQuantity += Number(row.lineQuantity || 0);
    group.totalImpressions += Number(row.lineQuantity || 0) * Number(row.printCount || 0);
    groups.set(leadTime, group);
  });
  return [...groups.values()].sort((a, b) => Number.parseInt(a.leadTime, 10) - Number.parseInt(b.leadTime, 10));
}

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
  document.querySelector('#pageEyebrow').textContent = isOverview ? 'KHẢ NĂNG GIAO HÀNG' : isConfig ? 'THÔNG SỐ & ĐỊNH MỨC' : 'DANH SÁCH KẾ HOẠCH';
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

function assuranceCopy(calculation) {
  if (!calculation) return { label: 'Chưa đủ cấu hình', state: 'pending', icon: 'info' };
  if (calculation.coverageRate >= 1) return { label: 'Đảm bảo theo năng lực', state: 'ok', icon: 'check-circle' };
  if (calculation.coverageRate >= 0.9) return { label: 'Có nguy cơ trễ', state: 'warn', icon: 'warning' };
  return { label: 'Chưa đảm bảo', state: 'danger', icon: 'warning-circle' };
}

function leadtimeRows(calculation) {
  const groups = dashboardState.leadTimes || [];
  if (!groups.length) return '<tr><td colspan="6" class="delivery-table__empty">File chưa có dữ liệu leadtime.</td></tr>';
  return groups.map((group) => {
    const quantity = Number(group.totalQuantity || 0);
    const deliverable = calculation ? Math.floor(quantity * calculation.coverageRate) : null;
    const shortage = deliverable == null ? null : Math.max(0, quantity - deliverable);
    const copy = assuranceCopy(calculation);
    return `<tr>
      <th>${escapeHtml(group.leadTime)}</th>
      <td>${formatNumber.format(group.rowCount || 0)}</td>
      <td>${formatNumber.format(quantity)}</td>
      <td>${deliverable == null ? '—' : formatNumber.format(deliverable)}</td>
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
      uniquePo: new Set(rows.map((row) => row.po)).size,
      leadTimes: summarizeLeadTimes(rows)
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
        leadTimes: localPayload.leadTimes,
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

renderFileHistory();
loadDashboard();
loadSettings();
loadFileHistory();
