# Inkava Production Planner

Website để nhập file booking Excel, tổng hợp nhu cầu theo leadtime, đối chiếu với năng lực nhà máy và lưu lịch sử vào SQLite.

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

## Theo mã hàng (file kế toán kho)

Mục **Theo mã hàng** đọc sheet `TỔNG HỢP` của file kế toán kho (`.xlsm`/`.xlsx`) và cho từng mã hàng + màu của mỗi khách:

- SL hợp đồng (SLHĐ, mỗi PO chỉ tính một lần), đã nhận BTP, đã in (tổng giao), giao đạt, lỗi (hỏng in + lỗi vải), còn phải giao.
- Mã có nhiều hình in (ORBIT/TRIBORD…) lấy số theo hình in có giao đạt thấp nhất; bấm vào dòng để xem từng hình in.
- Hạn giao lấy từ file booking (khớp theo REF + COLOR), kèm số ngày còn lại hoặc số ngày trễ.
- Trạng thái: Đã giao đủ, Đang in, Thiếu BTP, Chưa nhận BTP, Trễ hạn. Lọc theo khách hàng, trạng thái, tìm theo mã/màu.

## Đối chiếu thay đổi booking

Khách cập nhật thẳng vào file booking cũ, nên mỗi lần nhập lại, ứng dụng so sánh từng dòng (PO + REF + COLOR) với lần nhập trước và liệt kê dòng thêm mới, dòng bị xóa, dòng bị sửa (số lượng, INPUT, OUTPUT, leadtime, hình in, SLHĐ, số phiếu). Nút **Thay đổi booking** trên thanh trên báo số lần nhập chưa kiểm tra; người kiểm tra bấm **Đã kiểm tra** để ghi nhận.

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

Mục **Tổng quan** trả lời trực tiếp bốn chỉ tiêu: booking yêu cầu, lượt hình cần in, số lượng có thể in và số lượng có thể giao đúng hạn. Nếu chưa có định mức, ứng dụng để trống kết quả năng lực thay vì tạo số mô phỏng.

Mở mục **Cấu hình** hoặc nhấn vào chỉ số **Máy cần** để nhập định mức. Công thức:

```text
Tổng phút = lượt hình × phút/lượt hình + số PO × phút setup/PO
Công suất mỗi máy = ca/ngày × phút/ca × hiệu suất × số ngày kế hoạch
Máy cần = làm tròn lên(Tổng phút / Công suất mỗi máy)
Mức đáp ứng = min(100%, Tổng công suất / Tổng phút cần)
Số lượng có thể giao = sản lượng booking × Mức đáp ứng
```

Kết quả được chia theo leadtime 1/2/3/5 ngày. Lịch làm việc mặc định là Thứ Hai đến Thứ Bảy và bỏ qua Chủ Nhật. Đây là ước tính năng lực; cần xác nhận định mức thực tế với bộ phận sản xuất trước khi chốt kế hoạch.

### Danh mục cấu hình định mức

- Có thể nhập file Excel hoặc tạo từng định mức thủ công.
- Khi nhập thủ công, ứng dụng gợi ý 19 máy/công đoạn hiện có tại nhà máy: nhóm OVAL, máy Tự Động, máy in K3, SẤY, ÉP, in BÀN và THÊU.
- AI local tự nhận diện các cột tên/mã kiểu, số phút, số máy, số ca, phút mỗi ca, hiệu suất và số ngày kế hoạch.
- File cấu hình nhập vào được lưu thành danh mục mặc định; định mức đầu tiên được áp dụng cho phép tính kế hoạch.
- Chọn một mục như **Oval 18** để xem toàn bộ thông tin.
- Định mức đã lưu luôn bị khóa. Muốn sửa phải nhấn **Mở khóa để sửa** và xác nhận cảnh báo; sau khi lưu hệ thống tự khóa lại.
- Khi chạy local, danh mục nằm trong bảng SQLite `production_standards`. Bản Sites lưu danh mục trong trình duyệt.

## Preview bằng Sites

GPT Sites chạy giao diện tĩnh và vẫn có thể đọc, tổng hợp file Excel ngay trong trình duyệt. Do bản preview không chạy Node.js, dữ liệu không được ghi vào SQLite; SQLite hoạt động khi chạy ứng dụng bằng `npm run dev`.
