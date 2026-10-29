# Inkava Production Planner

Phần mềm đối chiếu booking với tình hình nhận, in và giao bán thành phẩm (BTP), hỗ trợ theo dõi và xuất kế hoạch sản xuất.

## Chức năng chính

- Nhập file booking, file nhận BTP và file giao từ máy hoặc link được phép tải.
- Theo dõi số lượng, tiến độ và hạn giao theo mã hàng, PO, tuần hoặc ngày.
- Kiểm tra dữ liệu booking, đối chiếu thay đổi và cảnh báo đơn cần xử lý.
- Tính ngày giao dự kiến từ **ngày nhận BTP + leadtime + 1 ngày làm việc**; nhà máy làm việc từ thứ Hai đến thứ Bảy.
- Xuất Excel gồm kế hoạch giao hàng, hợp đồng `TH` và bảng cân đối. Ngày nhận được ghi kèm nguồn đối chiếu; ngày chưa đủ căn cứ được để trống.

## Bắt đầu sử dụng

1. Tải ứng dụng cho Mac hoặc Windows tại [GitHub Releases](https://github.com/Khiemnguyen198/NguyenCuuKhiem/releases/latest).
2. Trong **Tổng quan → Nguồn dữ liệu**, nhập file booking, file nhận và file giao.
3. Chọn tuần hoặc ngày, kiểm tra các cảnh báo và xem kế hoạch.
4. Chọn **Xuất file** để tải kết quả Excel. Phần mềm không ghi đè file gốc.

Ứng dụng desktop lưu dữ liệu trên máy và có nút **Cập nhật** khi có phiên bản mới. Link SharePoint cần cho phép tải; với link nội bộ yêu cầu đăng nhập, hãy tải file về máy trước khi nhập.

## Chạy từ mã nguồn

Yêu cầu Node.js 24 trở lên:

```bash
npm ci
npm run dev
```

Mở địa chỉ hiển thị trong terminal. Chạy `npm test` để kiểm tra. Khi chạy local hoặc dùng ứng dụng desktop, dữ liệu được lưu vào SQLite; bản web tĩnh lưu dữ liệu trong trình duyệt.
