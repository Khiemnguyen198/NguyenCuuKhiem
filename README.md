# Inkava Production Planner

Website thử nghiệm để nhập file booking Excel, tổng hợp tải in theo lead time và lưu lịch sử vào SQLite.

## Chạy local

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4173 --strictPort
```

Mở `http://localhost:4173` trong trình duyệt.

## Luồng thử nghiệm

1. Chọn **Nhập file booking**.
2. Chọn workbook `.xlsx` có sheet `TH`, hoặc các sheet `LEADTIME 1/2/3/5 NGÀY`.
3. Ứng dụng đọc các cột booking, lưu phiên nhập vào `.data/planner.db`, rồi cập nhật số dòng, tổng sản lượng và tổng lượt hình.
4. Mở mục **Kế hoạch**, chọn đúng file trong danh sách để vào bảng điều phối của lần import đó.
5. Khung **AI Local** tự kiểm tra dữ liệu trong SQLite và liệt kê các dòng cần xem lại.

## AI Local kiểm tra file

Bộ kiểm tra chạy hoàn toàn trong ứng dụng, không gọi API và không gửi dữ liệu booking ra ngoài. Phiên bản nhẹ hiện tại phát hiện:

- Thiếu PO, số lượng hoặc lượt hình in không hợp lệ.
- Lead time ngoài nhóm 1, 2, 3 và 5 ngày.
- Ngày OUTPUT sớm hơn ngày INPUT.
- Dòng có khả năng bị trùng.
- Sản lượng ngoại lệ theo phân bố của file.

Khi chạy local, báo cáo được lưu trong bảng `ai_checks` của SQLite theo từng lần import. Trên website tĩnh, báo cáo được tính và lưu trong trình duyệt cùng metadata của file.

Mục **Tổng quan** phân loại lịch sử file thành:

- File kết quả đã giao.
- File đã xử lý nhưng chưa giao.
- File gốc chưa chỉnh sửa. Ứng dụng không ghi đè workbook tải lên; chỉ lưu dữ liệu đã đọc vào SQLite.

Phần số phút và số máy hiện dùng dữ liệu mô phỏng giao diện. Kết quả thật chỉ được tính sau khi cấu hình định mức thời gian, số máy, số ca và hiệu suất.

Mở mục **Cấu hình** hoặc nhấn vào chỉ số **Máy cần** để nhập định mức. Công thức:

```text
Tổng phút = lượt hình × phút/lượt hình + số PO × phút setup/PO
Công suất mỗi máy = ca/ngày × phút/ca × hiệu suất × số ngày kế hoạch
Máy cần = làm tròn lên(Tổng phút / Công suất mỗi máy)
```

## Bản test công khai

GitHub Pages chạy giao diện tĩnh và vẫn có thể đọc, tổng hợp file Excel ngay trong trình duyệt. Do Pages không chạy Node.js, dữ liệu trên bản công khai không được ghi vào SQLite; SQLite chỉ hoạt động khi chạy ứng dụng bằng `npm run dev`.
