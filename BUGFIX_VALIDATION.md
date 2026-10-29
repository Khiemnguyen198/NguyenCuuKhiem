# Xác nhận sửa lỗi dữ liệu

Bản sửa dựa trên `master` v0.0.11, commit `093f7df8e7dc992c3ce8eb08e69e23ffff087e3e`, thay vì snapshot cũ `d978a43` dùng trong lần kiểm tra đầu. Các tính năng nhận/giao BTP, lô, FIFO, đối chiếu thay đổi và xuất workbook của bản mới được giữ lại.

## Sáu vấn đề đã xử lý

| Vấn đề ban đầu | Kết quả trên phiên bản hiện tại |
| --- | --- |
| Ngày Excel bị lùi ngày tại Việt Nam | Giữ cách đọc serial đã có trong v0.0.11, bổ sung kiểm tra ngày hợp lệ và test workbook thật ở UTC/Việt Nam; không dùng ISO timestamp để đổi ngày lịch |
| Lỗi lưu bị che hoặc chuyển thành dữ liệu mẫu | Giữ file trước, hiện lỗi liên tục và nút thử lại; lỗi đọc dashboard/chi tiết cũng giữ dữ liệu đang xem, không tạo booking mẫu |
| Dependency Excel có cảnh báo high | Ghim SheetJS 0.20.3 qua npm alias có provenance; đồng thời vá Electron cùng major lên 44.10.0; npm audit không còn cảnh báo |
| Giá trị số sai bị đổi thành 0/NaN/null | Validation chung sau repair, tại parser và API, từ chối số thiếu/âm/không hữu hạn/tổng vượt giới hạn; thông báo sheet/dòng; giữ ký hiệu phân bổ có ý nghĩa |
| Tiếng Việt hỏng ở ranh giới HTTP chunk | Gom Buffer rồi giải mã UTF-8 một lần; giới hạn payload theo byte, trả 413 đúng nghĩa |
| Nhãn nguồn dữ liệu và SQLite sai | Chế độ lưu được cấu hình rõ; nhãn đọc/lưu/lỗi phản ánh kết quả; không suy ra chế độ từ base URL và không dùng booking mẫu khi chưa có dữ liệu |

Các bảng mô phỏng và tab chưa hoàn thiện của snapshot cũ đã được thay trong nhánh master mới. Bản sửa này giữ luồng tiến độ thực tế hiện có; không thêm lại định mức máy vào sản phẩm đã bỏ chức năng này.

## Bảo vệ dữ liệu bổ sung

- SQLite lưu dòng booking, lịch sử, thay đổi và báo cáo kiểm tra trong cùng giao dịch; lỗi giữa chừng rollback toàn bộ.
- Browser storage cập nhật booking chi tiết và lịch sử cùng một thao tác có rollback, không báo thành công khi đầy/chặn bộ nhớ.
- Xem kế hoạch lịch sử không thay booking mới nhất dùng cho nhận/giao/FIFO/xuất file. Các phản hồi đến chậm không được ghi đè lựa chọn mới.
- Lỗi đọc nguồn nhận/giao được hiện rõ thay vì âm thầm giữ số liệu cũ như đã cập nhật.
- Không thay đổi workbook gốc hoặc tự sửa lịch sử đã lưu sai. Trường hợp dữ liệu cũ bị sai ngày/số, cần nhập lại file gốc.

## Kiểm tra

- `npm test`: 98 kiểm tra Node, gồm bộ test v0.0.11 và các test mới về ngày/số, UTF-8, rollback SQLite, nhiều database, storage quota, route có base khác `/` và xuất workbook sau serialize.
- `npm run test:e2e`: 12 nhóm kiểm tra Chromium/Playwright, kiểm tra SQLite và browser storage, lưu/reload, số liệu không hợp lệ, lỗi POST/GET, retry, lịch sử, phản hồi đến chậm, quota rollback, mobile và non-root base.
- `npm run build`: build web.
- `npm run build:desktop`: build frontend cho desktop.
- `npm audit --audit-level=high`: không còn lỗ hổng được npm audit liệt kê.
- `git diff --check`: không có lỗi whitespace.

Kiểm thử dùng workbook tự tạo và database tạm; không ghi vào database người dùng. Build desktop chưa phải kiểm thử cài đặt `.dmg`/`.exe` trên macOS/Windows. Chưa phát hành bộ cài hoặc tự cập nhật app desktop đang cài trên máy người dùng.
