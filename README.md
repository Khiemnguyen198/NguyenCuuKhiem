# Inkava Production Planner

Website để nhập file booking Excel, tổng hợp nhu cầu theo leadtime, đối chiếu với năng lực nhà máy và lưu lịch sử vào SQLite.

## Chạy local

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4173 --strictPort
```

Mở `http://localhost:4173` trong trình duyệt.

## Luồng sử dụng

**Nhập → Kiểm tra → Xử lý → Xuất file**

1. **Tổng quan → Nguồn dữ liệu** có 3 ô, mỗi ô nhận file Excel hoặc link:
   - **Booking**: file booking của khách (sheet `TH`, hoặc `LEADTIME 1/2/3/5 NGÀY`).
   - **Nhận**: file nhập BTP (sheet `DATA`, ví dụ `INKAVA_XUẤT NHẬP BTP NEW.xlsx`): số đã nhận và ngày nhận.
   - **Giao**: file kế toán kho (sheet `TỔNG HỢP`): tổng giao, hỏng in, lỗi vải, giao đạt.
2. AI local kiểm tra booking; cảnh báo hiện ngay dưới các chỉ số.
3. Ứng dụng gom booking thành **lô**: Mã hàng (REF) + Model (7 số đầu của COLOR) + Mùa, với **SLHĐ tổng** tính lại theo đúng công thức của file (cùng SỐ PHIẾU, hoặc cùng LINE + REF + COLOR + INPUT khi chưa có phiếu).
   - Hàng nhận/giao có số phiếu khớp lô → gán thẳng cho lô đó.
   - Phần còn lại của mỗi Mã + Model (+ Mùa) được rót **FIFO**: lô có hạn giao sớm nhất được lấp trước, rồi trong lô chia xuống từng dòng PO theo hạn giao.
   - Hàng trong file nhận/giao không thuộc lô nào hiện ở bộ lọc **Ngoài booking**, không tính vào tổng.
4. **Tuần booking**: booking luôn được theo dõi theo từng tuần (ngày PXC CHUYỂN, Thứ Hai–Chủ Nhật), mặc định là tuần hiện tại. Số lượng là phần phân bổ vào các ngày trong tuần; nhận/đã in của mỗi dòng được rót FIFO tiếp xuống từng ngày, nên tuần chỉ nhận phần của mình.
5. **Kiểm tra file**: sau khi nhập, nút **Kiểm tra file** mở bảng tổng hợp dữ liệu chuẩn bị xuất của tuần đã chọn — nguồn file, số dòng / lô / số lượng tuần, nhận, đã in, còn thiếu, cách nối (phiếu / FIFO), các điểm cần lưu ý và xem trước các dòng. Bấm **Xuất file** trong bảng này để tải một sheet `TH` giống file booking, chỉ gồm các dòng và các ngày của tuần; sau các cột ngày là Model, Màu, SL trong tuần, Nhận BTP, Đã in (giao), Còn thiếu và các cột của lô.

Nhập bằng link: khi chạy `npm run dev`, máy chủ tải file từ link (SharePoint/OneDrive tự thêm `download=1` và giữ cookie khách của link “Bất kỳ ai có link”; Google Sheets tự xuất `.xlsx`). File nhận/giao nạp từ link được **cập nhật lại từ link** khi bấm nút, khi mở trang và mỗi 30 phút khi trang đang mở, vì bên giao nhận sửa file SharePoint liên tục. Link chỉ dành cho người trong tổ chức thì không tải được. Bản Sites chỉ đọc được link cho phép tải chéo (CORS), nên không tự cập nhật từ SharePoint.

## Theo mã hàng

Mỗi dòng là một lô: Khách hàng, Mã hàng (kèm số phiếu), Model, Màu, Mùa, SLHĐ tổng, đã nhận BTP, đã in (giao), giao đạt, lỗi (hỏng in + lỗi vải), còn thiếu, hạn giao, trạng thái (Đã giao đủ, Đang in, Thiếu BTP, Chưa nhận BTP, Trễ hạn, Sắp tới hạn). Bấm vào lô để xem từng dòng PO với số đã phân bổ và cách nối (phiếu / FIFO).

## Đối chiếu thay đổi booking

Khách cập nhật thẳng vào file booking cũ, nên mỗi lần nhập lại, ứng dụng so sánh từng dòng (PO + REF + COLOR) với lần nhập trước và liệt kê dòng thêm mới, dòng bị xóa, dòng bị sửa (số lượng, INPUT, OUTPUT, leadtime, hình in, SLHĐ, số phiếu, phân bổ theo ngày). Nút **Thay đổi booking** trên thanh trên báo số lần nhập chưa kiểm tra; người kiểm tra bấm **Đã kiểm tra** để ghi nhận.

## AI Local kiểm tra file

Bộ kiểm tra chạy hoàn toàn trong ứng dụng, không gọi API và không gửi dữ liệu booking ra ngoài. Phiên bản nhẹ hiện tại phát hiện:

- Thiếu PO, số lượng hoặc lượt hình in không hợp lệ.
- Lead time ngoài nhóm 1, 2, 3 và 5 ngày.
- Ngày OUTPUT sớm hơn ngày INPUT.
- Dòng có khả năng bị trùng.
- Sản lượng ngoại lệ theo phân bố của file.
- Hạn giao (OUTPUT) rơi vào Chủ Nhật (nhà máy làm Thứ Hai–Thứ Bảy).
- SLHĐ TỔNG trống hoặc bằng 0 (công thức trong TH bỏ sót dòng).
- Sheet `TH` lệch số lượng hoặc thiếu dòng so với các sheet `LEADTIME`.
- `TỔNG NGÀY` trong `TH` khác Σ(HÌNH IN × phân bổ ngày), thường do công thức SUMPRODUCT lệch dòng.

Khi chạy local, báo cáo được lưu trong bảng `ai_checks` của SQLite theo từng lần import. Trên website tĩnh, báo cáo được tính và lưu trong trình duyệt cùng metadata của file.

Mục **Tổng quan** phân loại lịch sử file thành:

- File kết quả đã giao.
- File đã xử lý nhưng chưa giao.
- File gốc chưa chỉnh sửa. Ứng dụng không ghi đè workbook tải lên; chỉ lưu dữ liệu đã đọc vào SQLite.

Mục **Cấu hình** vẫn lưu danh mục định mức phút/máy, nhưng Tổng quan và Kế hoạch không còn dùng số phút/máy; kết quả dựa trên số nhận/giao thực tế.

## Danh mục cấu hình định mức

- Có thể nhập file Excel hoặc tạo từng định mức thủ công.
- Khi nhập thủ công, ứng dụng gợi ý 19 máy/công đoạn hiện có tại nhà máy: nhóm OVAL, máy Tự Động, máy in K3, SẤY, ÉP, in BÀN và THÊU.
- AI local tự nhận diện các cột tên/mã kiểu, số phút, số máy, số ca, phút mỗi ca, hiệu suất và số ngày kế hoạch.
- File cấu hình nhập vào được lưu thành danh mục mặc định; định mức đầu tiên được áp dụng cho phép tính kế hoạch.
- Chọn một mục như **Oval 18** để xem toàn bộ thông tin.
- Định mức đã lưu luôn bị khóa. Muốn sửa phải nhấn **Mở khóa để sửa** và xác nhận cảnh báo; sau khi lưu hệ thống tự khóa lại.
- Khi chạy local, danh mục nằm trong bảng SQLite `production_standards`. Bản Sites lưu danh mục trong trình duyệt.

## Preview bằng Sites

GPT Sites chạy giao diện tĩnh và vẫn có thể đọc, tổng hợp file Excel ngay trong trình duyệt. Do bản preview không chạy Node.js, dữ liệu không được ghi vào SQLite; SQLite hoạt động khi chạy ứng dụng bằng `npm run dev`.
