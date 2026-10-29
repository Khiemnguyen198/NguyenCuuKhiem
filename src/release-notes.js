import { escapeHtml } from './format.js';

// Bundle notes with their version so they remain accurate and available offline.
const RELEASE_NOTES = {
  '0.0.19': [
    'Đọc ngày giao thực tế từ chứng từ xuất trong sheet NHẬP XUẤT của file kho.',
    'Đối chiếu PO, mã hàng, màu và số phiếu trước khi ghi ngày giao.'
  ],
  '0.0.18': [
    'Trình bày file Excel rõ ràng hơn, giữ công thức, bộ lọc và bốn cột ngày nhận/giao BTP.',
    'Xóa chức năng phiếu giao nhận BTP.'
  ],
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
  '0.0.17': [
    'Hiển thị riêng bốn ngày nhận/giao BTP theo booking và thực tế trong file xuất.',
    'Giữ đúng INPUT và OUTPUT của booking khi lọc theo tuần hoặc ngày.'
  ],
  '0.0.16': [
    'Đối chiếu ngày nhận BTP theo số phiếu và mã hàng khi file nhận ghi màu viết tắt.',
    'Cảnh báo ngày nhận sớm hơn INPUT booking để kiểm tra lịch sử nhập.'
  ],
  '0.0.15': [
    'Bổ sung ngày nhận BTP và nguồn đối chiếu vào sheet hợp đồng TH khi xuất file.',
    'Phân bổ ngày nhận theo FIFO cho dữ liệu nhận không có số phiếu khớp.'
  ],
  '0.0.14': [
    'Tính ngày giao dự kiến từ ngày nhận BTP cộng leadtime và thêm một ngày làm việc.',
    'Đối chiếu ngày giao theo PO, cảnh báo chênh lệch và giữ riêng ngày giao thực tế trong file.',
    'Sửa lỗi nhập và lưu dữ liệu; cập nhật biểu tượng bo góc trên Mac.'
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
