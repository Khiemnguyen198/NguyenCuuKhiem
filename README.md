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

Phần số phút và số máy hiện dùng dữ liệu mô phỏng giao diện. Kết quả thật chỉ được tính sau khi cấu hình định mức thời gian, số máy, số ca và hiệu suất.

Mở mục **Cấu hình** hoặc nhấn vào chỉ số **Máy cần** để nhập định mức. Công thức:

```text
Tổng phút = lượt hình × phút/lượt hình + số PO × phút setup/PO
Công suất mỗi máy = ca/ngày × phút/ca × hiệu suất × số ngày kế hoạch
Máy cần = làm tròn lên(Tổng phút / Công suất mỗi máy)
```

## Bản test công khai

GitHub Pages chạy giao diện tĩnh và vẫn có thể đọc, tổng hợp file Excel ngay trong trình duyệt. Do Pages không chạy Node.js, dữ liệu trên bản công khai không được ghi vào SQLite; SQLite chỉ hoạt động khi chạy ứng dụng bằng `npm run dev`.
