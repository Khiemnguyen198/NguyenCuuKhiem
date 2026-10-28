import { STATUS_FILTERS } from './models-view.js';
import { renderSourceCards } from './sources.js';
import { CALENDAR_FILTERS, renderLegend } from './calendar-view.js';

export function appTemplate({ isStaticPages, dayLabel, weekLabel, appVersion, canBrowse = false }) {
  return `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">Bàn điều phối<br />sản xuất</div>
      <nav class="nav" aria-label="Điều hướng chính">
        <button class="nav__item nav__item--active" data-page="Tổng quan"><i class="ph ph-house"></i><span>Tổng quan</span></button>
        <button class="nav__item" data-page="Mã hàng"><i class="ph ph-list-magnifying-glass"></i><span>Theo mã hàng</span></button>
        <button class="nav__item" data-page="Kế hoạch"><i class="ph ph-calendar-dots"></i><span>Kế hoạch</span></button>
      </nav>
      <div class="app-update">
        <span id="appVersion">Phiên bản v${appVersion}</span>
        <button type="button" class="app-update__button" id="updateButton" title="Kiểm tra và cài phiên bản mới" hidden><i class="ph ph-arrow-circle-up"></i><span>Cập nhật</span></button>
      </div>
      <div class="sidebar__foot"><span class="status-dot"></span>${isStaticPages ? 'Lưu trên trình duyệt' : 'SQLite đang hoạt động'}</div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="title-group">
          <div>
            <p class="eyebrow" id="pageEyebrow">KHẢ NĂNG GIAO HÀNG</p>
            <h1 id="pageTitle">Tổng quan</h1>
          </div>
          <button class="primary-button" id="importButton" hidden><i class="ph ph-upload-simple"></i>Nhập file booking</button>
          <button class="back-button" id="backToPlans" hidden><i class="ph ph-arrow-left"></i>Danh sách kế hoạch</button>
          <input id="fileInput" type="file" accept=".xlsx,.xls,.xlsm,.xlsb" hidden />
        </div>
        <div class="topbar__actions">
          <button class="changes-button" id="changesButton" type="button"><i class="ph ph-bell-ringing"></i><span>Thay đổi booking</span><b id="changesBadge" hidden>0</b></button>
          <div class="date-stamp"><i class="ph ph-calendar-blank"></i><div><strong>${dayLabel}</strong><span>${weekLabel}</span></div></div>
        </div>
      </header>

      <section class="plan-list-view" id="planListView" hidden>
        <section class="delivery-summary plan-results">
          <div class="delivery-summary__heading">
            <div><p class="section-heading__overline">KẾT QUẢ TỔNG HỢP CHI TIẾT</p><h2>Booking, nhận và giao của tuần booking</h2><p id="planResultsMeta">Chưa có dữ liệu booking.</p></div>
            <div class="batch-pickers"><label class="batch-picker"><span>Tuần booking</span><select data-batch-select aria-label="Chọn tuần booking"></select></label><label class="batch-picker batch-picker--day"><span>Ngày</span><select data-day-select aria-label="Chọn ngày trong tuần"></select></label></div>
          </div>
          <div class="plan-cards" id="planCards"></div>
          <div class="model-filters"><label class="model-search"><i class="ph ph-magnifying-glass"></i><input id="planSearch" type="search" placeholder="Tìm khách hàng, mã hàng, model, màu, PO…" /></label><span class="plan-results__count" id="planResultsCount"></span></div>
          <div id="planTable"></div>
        </section>
        <div class="plan-list-heading">
          <div><p class="section-heading__overline">DỮ LIỆU ĐÃ NHẬP</p><h2>Các file booking đã nhập</h2><p>Chọn một file để mở bảng điều phối của file đó.</p></div>
          <div class="plan-list-total"><strong id="planCount">0</strong><span>kế hoạch</span></div>
        </div>
        <div class="plan-list" id="planFiles"></div>
      </section>

      <section class="models-view" id="modelsView" hidden>
        <section class="delivery-summary">
          <div class="delivery-summary__heading">
            <div><p class="section-heading__overline">TIẾN ĐỘ GIAO BÁN THÀNH PHẨM</p><h2>Booking, nhận, in và giao theo từng mã hàng</h2><p id="warehouseMeta">Chưa có dữ liệu nhận/giao. Nhập ở mục Tổng quan → Nguồn dữ liệu.</p></div>
            <button class="primary-button" data-check><i class="ph ph-list-checks"></i>Kiểm tra file</button>
          </div>
          <div class="delivery-kpis delivery-kpis--six" id="modelKpis"></div>
        </section>
        <section class="delivery-summary">
          <div class="leadtime-summary__head"><strong>Theo khách hàng</strong><span>Nhấn vào một khách hàng để xem các mã hàng của họ</span></div>
          <div class="table-wrap table-wrap--scroll"><table class="delivery-table"><thead><tr><th>Khách hàng</th><th>Số lô</th><th>SLHĐ tổng</th><th>Đã nhận</th><th>Giao đạt</th><th>Lỗi</th><th>Còn phải giao</th><th>Hoàn thành</th></tr></thead><tbody id="customerBody"></tbody></table></div>
        </section>
        <section class="delivery-summary">
          <div class="model-filters">
            <label class="model-search"><i class="ph ph-magnifying-glass"></i><input id="modelSearch" type="search" placeholder="Tìm PO, số phiếu…" /></label>
            <div class="column-filters" role="group" aria-label="Lọc theo cột">
              <input type="search" data-column-filter="model" list="filterOptions-model" placeholder="Mã hàng" aria-label="Lọc mã hàng" />
              <input type="search" data-column-filter="modelCode" list="filterOptions-modelCode" placeholder="Model" aria-label="Lọc model" />
              <input type="search" data-column-filter="color" list="filterOptions-color" placeholder="Màu" aria-label="Lọc màu" />
              <datalist id="filterOptions-model"></datalist><datalist id="filterOptions-modelCode"></datalist><datalist id="filterOptions-color"></datalist>
            </div>
            <select data-batch-select aria-label="Chọn tuần booking"></select>
            <select data-day-select aria-label="Chọn ngày trong tuần"></select>
            <select id="customerFilter" aria-label="Lọc theo khách hàng"><option value="">Tất cả khách hàng</option></select>
            <div class="status-filters" id="statusFilters" role="group" aria-label="Lọc theo trạng thái">${STATUS_FILTERS.map(([value, label]) => `<button type="button" data-status="${value}"${value === 'open' ? ' aria-pressed="true"' : ''}>${label}<span data-status-count="${value}"></span></button>`).join('')}</div>
          </div>
          <div class="table-wrap"><table class="delivery-table model-table"><thead><tr><th>Khách hàng</th><th class="th-left">Mã hàng</th><th class="th-left">Model</th><th class="th-left">Màu</th><th>Mùa</th><th>SLHĐ tổng</th><th>Đã nhận</th><th>Đã in (giao)</th><th>Giao đạt</th><th>Lỗi</th><th>Còn thiếu</th><th>Hoàn thành</th><th>Hạn giao</th><th>Trạng thái</th></tr></thead><tbody id="modelBody"></tbody></table></div>
          <div class="model-table__foot"><span id="modelCount"></span><button class="secondary-button" id="showMoreModels" hidden>Xem thêm</button></div>
        </section>
      </section>

      <section class="overview-view" id="overviewView">
        <section class="delivery-summary sources-panel">
          <div class="delivery-summary__heading">
            <div><p class="section-heading__overline">NGUỒN DỮ LIỆU</p><h2>Nhập booking, nhận và giao</h2><p>${isStaticPages ? 'Mỗi nguồn nhận file Excel hoặc link.' : 'Mỗi nguồn nhận file Excel, link hoặc đường dẫn trên máy chủ nội bộ (kể cả file có macro .xlsm). Link và đường dẫn được tự cập nhật khi file thay đổi.'}</p></div>
          </div>
          <div class="source-grid">${renderSourceCards({ allowPath: !isStaticPages, canBrowse })}</div>
        </section>
        <section class="delivery-summary booking-calendar" id="bookingCalendar" hidden>
          <div class="delivery-summary__heading">
            <div><p class="section-heading__overline">KIỂM TRA FILE BOOKING · LỊCH THEO TUẦN</p><h2 id="calendarTitle">Lịch booking</h2><p id="calendarMeta">Mỗi đơn (lô) là một vùng trên lịch, trải qua các ngày PXC được phân bổ. Bấm vào vùng để xem chi tiết.</p></div>
            <div class="calendar-actions">
              <button type="button" class="icon-button" data-week-step="-1" aria-label="Tuần trước"><i class="ph ph-caret-left"></i></button>
              <select data-batch-select aria-label="Chọn tuần booking"></select>
              <button type="button" class="icon-button" data-week-step="1" aria-label="Tuần sau"><i class="ph ph-caret-right"></i></button>
              <button type="button" class="primary-button" data-check><i class="ph ph-list-checks"></i>Lỗi file &amp; xuất file</button>
              <button type="button" class="icon-button" id="closeCalendar" aria-label="Ẩn lịch"><i class="ph ph-x"></i></button>
            </div>
          </div>
          <div class="model-filters calendar-filters">
            <label class="model-search"><i class="ph ph-magnifying-glass"></i><input id="calendarSearch" type="search" placeholder="Tìm khách hàng, mã hàng, model, màu, PO…" /></label>
            <div class="status-filters" id="calendarFilters" role="group" aria-label="Lọc đơn trên lịch">${CALENDAR_FILTERS.map(([value, label]) => `<button type="button" data-calendar-filter="${value}"${value === 'all' ? ' aria-pressed="true"' : ''}>${label}</button>`).join('')}</div>
            <div class="calendar-legend">${renderLegend()}</div>
          </div>
          <div id="calendarGrid"></div>
        </section>
        <section class="delivery-summary">
          <div class="delivery-summary__heading">
            <div><p class="section-heading__overline">KẾT QUẢ TỔNG HỢP</p><h2>Booking, nhận, in và giao</h2><p id="overviewMeta">Số liệu thực tế từ file nhận và file giao, đối chiếu với booking.</p></div>
            <div class="batch-pickers"><label class="batch-picker"><span>Tuần booking</span><select data-batch-select aria-label="Chọn tuần booking"></select></label><label class="batch-picker batch-picker--day"><span>Ngày</span><select data-day-select aria-label="Chọn ngày trong tuần"></select></label></div>
          </div>
          <div class="delivery-kpis delivery-kpis--six" id="overviewKpis"></div>
          <div class="warning-strip" id="overviewWarnings"></div>
          <div class="leadtime-summary">
            <div class="leadtime-summary__head"><strong>Theo leadtime booking</strong><span>Đã nhận / giao đạt là lũy kế theo mã hàng · Nhà máy làm Thứ 2–Thứ 7</span></div>
            <div class="table-wrap"><table class="delivery-table"><thead><tr><th>Leadtime</th><th class="th-left">Khách hàng</th><th>Số mã</th><th>Số hợp đồng</th><th>Tổng đơn hàng</th><th>Ngày nhận (INPUT)</th><th>Hạn giao (OUTPUT)</th><th>Đã nhận BTP</th><th>Đã in (giao)</th><th class="th-left">Tình trạng lô</th></tr></thead><tbody id="overviewLeadtimeBody"></tbody></table></div>
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
            <div class="metric"><strong id="planReceived">—</strong><span>Đã nhận BTP</span><small id="planReceivedMeta">Các mã trong file này</small></div>
            <div class="metric"><strong id="planGood">—</strong><span>Đã in (giao)</span><small id="planGoodMeta">Các mã trong file này</small></div>
          </section>

          <section class="capacity-panel">
            <div class="section-heading">
              <div><p class="section-heading__overline">ĐỐI CHIẾU KẾ HOẠCH</p><h2>Tiến độ theo leadtime</h2></div>
            </div>
            <div class="table-wrap"><table class="delivery-table"><thead><tr><th>Leadtime</th><th class="th-left">Khách hàng</th><th>Số mã</th><th>Số hợp đồng</th><th>Tổng đơn hàng</th><th>Ngày nhận (INPUT)</th><th>Hạn giao (OUTPUT)</th><th>Đã nhận BTP</th><th>Đã in (giao)</th><th class="th-left">Tình trạng lô</th></tr></thead><tbody id="planLeadtimeBody"></tbody></table></div>
            <div class="calculation-note"><i class="ph ph-info"></i><span>Đã nhận và giao đạt lấy từ file nhận / file giao mới nhất, cộng dồn theo mã hàng + màu.</span></div>
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
  <div class="modal" id="checkModal" aria-hidden="true">
    <button class="modal__backdrop" data-close-check aria-label="Đóng"></button>
    <section class="settings-dialog changes-dialog" role="dialog" aria-modal="true" aria-labelledby="checkTitle">
      <header class="settings-dialog__header">
        <div><p class="section-heading__overline">KIỂM TRA FILE</p><h2 id="checkTitle">Dữ liệu chuẩn bị xuất</h2></div>
        <div class="batch-pickers"><label class="batch-picker"><span>Tuần booking</span><select data-batch-select aria-label="Chọn tuần booking"></select></label><label class="batch-picker batch-picker--day"><span>Ngày</span><select data-day-select aria-label="Chọn ngày trong tuần"></select></label></div>
        <button class="icon-button" data-close-check aria-label="Đóng"><i class="ph ph-x"></i></button>
      </header>
      <div class="check-report" id="checkReport"></div>
      <footer class="settings-dialog__footer">
        <span class="change-reviewed" id="checkStatus"></span>
        <button type="button" class="secondary-button" data-close-check>Đóng</button>
        <button type="button" class="primary-button" data-export><i class="ph ph-microsoft-excel-logo"></i>Xuất file</button>
      </footer>
    </section>
  </div>
  <div class="modal" id="orderModal" aria-hidden="true">
    <button class="modal__backdrop" data-close-order aria-label="Đóng"></button>
    <section class="settings-dialog changes-dialog order-dialog" role="dialog" aria-modal="true" aria-labelledby="orderTitle">
      <header class="settings-dialog__header">
        <div><p class="section-heading__overline">CHI TIẾT ĐƠN HÀNG</p><h2 id="orderTitle">Đơn hàng</h2></div>
        <button class="icon-button" data-close-order aria-label="Đóng"><i class="ph ph-x"></i></button>
      </header>
      <div class="order-detail" id="orderDetail"></div>
    </section>
  </div>
  <div class="modal" id="changesModal" aria-hidden="true">
    <button class="modal__backdrop" data-close-changes aria-label="Đóng"></button>
    <section class="settings-dialog changes-dialog" role="dialog" aria-modal="true" aria-labelledby="changesTitle">
      <header class="settings-dialog__header">
        <div><p class="section-heading__overline">ĐỐI CHIẾU FILE BOOKING</p><h2 id="changesTitle">Thay đổi so với bản trước</h2></div>
        <button class="icon-button" data-close-changes aria-label="Đóng"><i class="ph ph-x"></i></button>
      </header>
      <div class="changes-layout">
        <nav class="change-list" id="changeList" aria-label="Các lần nhập có thay đổi"></nav>
        <div class="change-report" id="changeReport"></div>
      </div>
      <footer class="settings-dialog__footer">
        <span class="change-reviewed" id="changeReviewed"></span>
        <button type="button" class="secondary-button" data-close-changes>Đóng</button>
        <button type="button" class="primary-button" id="markReviewed"><i class="ph ph-check-circle"></i>Đã kiểm tra</button>
      </footer>
    </section>
  </div>
  <div class="toast" id="toast" role="status"></div>
`;
}
