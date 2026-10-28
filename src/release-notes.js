import { escapeHtml } from './format.js';

// Bundle notes with their version so they remain accurate and available offline.
const RELEASE_NOTES = {
  '0.0.6': [
    'Sửa lỗi logo bị cắt ở đầu thanh bên.',
    'Căn giữa logo khi thanh bên thu gọn.'
  ],
  '0.0.7': [
    'Hiển thị ghi chú bản đang dùng ngay trên số phiên bản.',
    'Có thể thu gọn ghi chú và đọc khi không có mạng.'
  ],
  '0.0.8': [
    'Sửa lỗi lệch ngày do múi giờ địa phương (UTC+7) trong toIsoDate.',
    'Nhận diện tên sheet linh hoạt (bỏ qua khoảng trắng thừa và chữ hoa/thường).',
    'Chống lệch số lượng phân bổ FIFO và chia ngày chi tiết.'
  ],
  '0.0.9': [
    'Bộ lọc nhanh và tìm kiếm tức thời theo PO, Model, Màu, Khách hàng và Trạng thái.',
    'Ghim ưu tiên nhận BTP thủ công (Manual Priority Pinning) cho các đơn hàng gấp.',
    'Xuất và in phiếu giao nhận BTP xưởng (khổ A4 chuẩn kèm 3 chữ ký trách nhiệm).'
  ],
  '0.0.11': [
    'Thêm bảng Kế hoạch giao hàng theo từng PO với ngày giao hợp đồng và ngày giao thực tế.',
    'Highlight ngày giao thực tế và cảnh báo giao trễ; vẫn giữ các sheet TH và CAN DOI khi xuất file.'
  ],
};

export function renderReleaseNotes(version) {
  const notes = RELEASE_NOTES[version];
  return `<details class="release-notes" id="releaseNotes" open>
    <summary title="Ghi chú phiên bản" aria-label="Ghi chú phiên bản"><i class="ph ph-note" aria-hidden="true"></i><span>Release notes</span><i class="ph ph-caret-down release-notes__caret" aria-hidden="true"></i></summary>
    <div class="release-notes__body">
      <strong>Có gì mới · v${escapeHtml(version)}</strong>
      ${notes ? `<ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : '<p>Chưa có ghi chú cho phiên bản này.</p>'}
    </div>
  </details>`;
}
