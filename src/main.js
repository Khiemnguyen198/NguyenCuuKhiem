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
  totalImpressions: 2953041
};

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
            <p class="eyebrow">BẢNG ĐIỀU PHỐI</p>
            <h1>Kế hoạch sản xuất</h1>
          </div>
          <button class="primary-button" id="importButton"><i class="ph ph-upload-simple"></i>Nhập file booking</button>
          <input id="fileInput" type="file" accept=".xlsx,.xls" hidden />
        </div>
        <div class="topbar__actions">
          <div class="date-stamp"><i class="ph ph-calendar-blank"></i><div><strong>Thứ Ba, 27/10/2026</strong><span>Tuần 26/10 – 31/10/2026</span></div></div>
        </div>
      </header>

      <div class="workspace">
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
            <div class="metric metric--pending"><strong>—</strong><span>Máy cần <i class="ph ph-info"></i></span><small>Chờ cấu hình định mức thời gian</small></div>
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
  document.querySelector('#filename').textContent = data.filename;
  document.querySelector('#fileMeta').textContent = `${data.source === 'sqlite' ? 'Đã lưu SQLite' : 'Dữ liệu mẫu'} • ${formatNumber.format(data.rowCount)} dòng`;
  document.querySelector('#rowCount').textContent = formatNumber.format(data.rowCount);
  document.querySelector('#totalQuantity').textContent = formatNumber.format(data.totalQuantity);
  document.querySelector('#totalImpressions').textContent = formatNumber.format(data.totalImpressions);
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
      totalImpressions: rows.reduce((sum, row) => sum + row.lineQuantity * row.printCount, 0)
    };
    if (isStaticPages) {
      renderDashboard(localPayload);
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
  if (item.dataset.page !== 'Kế hoạch') showToast(`${item.dataset.page} đang được hoàn thiện trong bản test.`, 'info');
}));

document.querySelectorAll('.issue').forEach((issue) => issue.addEventListener('click', () => {
  document.querySelectorAll('.issue').forEach((item) => item.classList.remove('issue--selected'));
  issue.classList.add('issue--selected');
}));

renderSchedule();
loadDashboard();
