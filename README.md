# Inkava Production Planner

Website để nhập file booking Excel, tổng hợp nhu cầu theo leadtime, đối chiếu với năng lực nhà máy và lưu lịch sử vào SQLite.

## Chạy local

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4173 --strictPort
```

Mở `http://localhost:4173` trong trình duyệt.

## Ứng dụng desktop (.dmg / .exe)

App desktop (Electron) chứa sẵn máy chủ: SQLite, tải link SharePoint và tự cập nhật đều chạy mà không cần cài Node hay `npm run dev`. Dữ liệu lưu trong thư mục dữ liệu của người dùng (macOS: `~/Library/Application Support/inkava-production-planner/data`, Windows: `%APPDATA%\inkava-production-planner\data`).

```bash
npm run desktop     # chạy thử app desktop từ mã nguồn
npm run dist:mac    # release/Inkava-Planner-<phiên bản>-arm64.dmg (chip Apple) và …-x64.dmg (chip Intel)
npm run dist:win    # release/Inkava-Planner-Setup-<phiên bản>.exe (Windows x64)
```

App chưa được ký bằng chứng chỉ của Apple / Microsoft:
- macOS: lần đầu mở bằng chuột phải → **Open**, hoặc System Settings → Privacy & Security → **Open Anyway**.
- Windows: SmartScreen báo “Windows protected your PC” → **More info** → **Run anyway**.

### Cập nhật phiên bản

Phiên bản hiện tại hiện ở cuối thanh bên (bản đầu tiên: **v0.0.1**). Nút **Cập nhật** (chỉ có trong app desktop) đọc bản phát hành mới nhất trên GitHub Releases của repo; khi có bản mới hơn, nút chuyển màu xanh “Cập nhật vX.Y.Z”. Nhấn nút → xác nhận → app tải file cài cho đúng máy, đóng lại, cài đè lên bản cũ rồi tự mở bản mới. Dữ liệu SQLite không bị ảnh hưởng vì nằm ngoài thư mục app.

- macOS: app phải nằm trong một thư mục ghi được (thường là Applications). Nếu đang mở thẳng từ file .dmg, app chỉ mở file .dmg mới để kéo thả thay bản cũ.
- Windows: bộ cài chạy ở chế độ im lặng vào đúng thư mục đã cài trước đó.

Phát hành bản mới:
1. Tăng `version` trong `package.json` và `package-lock.json`, thêm ghi chú tương ứng trong `src/release-notes.js`. Ghi chú được hiển thị ngay trên số phiên bản ở thanh bên và đọc được khi offline.
2. `npm run dist:mac` và `npm run dist:win`.
3. Tạo GitHub Release với tag `v0.0.2`, đính kèm `Inkava-Planner-0.0.2-arm64.dmg`, `Inkava-Planner-0.0.2-x64.dmg` và `Inkava-Planner-Setup-0.0.2.exe` (giữ nguyên tên file). Phần mô tả của Release hiện trong hộp xác nhận cập nhật.

## Luồng sử dụng

**Nhập → Kiểm tra → Xử lý → Xuất file**

1. **Tổng quan → Nguồn dữ liệu** có 3 ô; mỗi ô có 3 nút cùng hàng **Chọn file / Dán link / Đường dẫn** và chân ô có **Cập nhật file**, **Xoá** (ô Booking có thêm **Kiểm tra**):
   - **Booking**: file booking của khách (sheet `TH`, hoặc `LEADTIME 1/2/3/5 NGÀY`).
   - **Nhận**: file nhập BTP (sheet `DATA`, ví dụ `INKAVA_XUẤT NHẬP BTP NEW.xlsx`): số đã nhận và ngày nhận.
   - **Giao**: file kế toán kho (sheet `TỔNG HỢP`): tổng giao, hỏng in, lỗi vải, giao đạt.
2. AI local kiểm tra booking; cảnh báo hiện ngay dưới các chỉ số.
3. Ứng dụng gom booking thành **lô**: Mã hàng (REF) + Model (7 số đầu của COLOR) + Mùa, với **SLHĐ tổng** tính lại theo đúng công thức của file (cùng SỐ PHIẾU, hoặc cùng LINE + REF + COLOR + INPUT khi chưa có phiếu).
   - Hàng nhận/giao có số phiếu khớp lô → gán thẳng cho lô đó.
   - Phần còn lại của mỗi Mã + Model (+ Mùa) được rót **FIFO**: lô có hạn giao sớm nhất được lấp trước, rồi trong lô chia xuống từng dòng PO theo hạn giao.
   - Hàng trong file nhận/giao không thuộc lô nào hiện ở bộ lọc **Ngoài booking**, không tính vào tổng.
4. **Tuần booking** và **Ngày**: chọn cả tuần hoặc một ngày trong tuần (T2…CN, kèm số dòng) để lọc đơn hàng theo ngày.
   **Tuần booking**: booking luôn được theo dõi theo từng tuần (ngày PXC CHUYỂN, Thứ Hai–Chủ Nhật), mặc định là tuần hiện tại. Số lượng là phần phân bổ vào các ngày trong tuần; nhận/đã in của mỗi dòng được rót FIFO tiếp xuống từng ngày, nên tuần chỉ nhận phần của mình.
5. **Lịch booking theo tuần**: nút **Kiểm tra** ở ô Booking (Tổng quan) mở lịch của tuần đang chọn ngay trên trang: cột là Thứ 2 → CN (kèm số đơn và số lượng mỗi ngày), mỗi đơn (lô) là một vùng trải từ ngày PXC được phân bổ tới ngày hạn giao, tô màu theo trạng thái (chưa nhận / thiếu BTP / đang in / giao đủ / trễ hạn). Có nút tuần trước / sau, tìm kiếm và lọc. Bấm vào vùng (hoặc tên đơn) để xem chi tiết: SLHĐ, SL trong tuần, nhận, giao, tồn, lỗi, hạn giao, điểm cần chú ý và từng dòng PO với các ngày phân bổ. Nút **Lỗi file & xuất file** trên lịch mở bảng kiểm tra lỗi và xuất file. Chọn một ngày (bấm vào đầu cột ngày trên lịch hoặc ô **Ngày**) thì lịch, kết quả tổng hợp, Theo mã hàng và Kế hoạch cùng lọc theo ngày đó.
   Nút bong bóng **Xuất file** ở góc dưới bên phải có trên mọi trang: xuất ngay TH + CAN DOI của tuần/ngày đang chọn; nếu dữ liệu chưa đủ để xuất, nút mở bảng kiểm tra để xem lý do.
6. **Kiểm tra file**: sau khi nhập, nút **Kiểm tra file** mở bảng tổng hợp dữ liệu chuẩn bị xuất của tuần đã chọn — nguồn file, số dòng / lô / số lượng tuần, nhận, đã in, còn thiếu, cách nối (phiếu / FIFO), các điểm cần lưu ý và xem trước các dòng. Bấm **Xuất file** trong bảng này để tải một sheet `TH` giống file booking, chỉ gồm các dòng và các ngày của tuần; sau các cột ngày là Model, Màu, SL trong tuần, Nhận BTP, Đã in (giao), Còn thiếu và các cột của lô.
   - Mục **Lỗi trong sheet TH** chỉ rõ từng ô sai trong file booking: SLHĐ TỔNG trống / sai (kể cả ô gõ tay không có công thức), TỔNG NGÀY sai (kèm công thức đang có), PXI TRẢ sớm hơn PXC, OUTPUT rơi vào Chủ Nhật hoặc sớm hơn INPUT, thiếu PO, LINE QTY / HÌNH IN / leadtime không hợp lệ, dòng trùng, TH lệch sheet LEADTIME — với giá trị trong file và giá trị đúng; lỗi của tuần đang chọn xếp lên đầu.
   - File xuất sửa sẵn SLHĐ TỔNG, TỔNG NGÀY và PXI TRẢ sai năm (ô đã sửa có ghi chú giá trị cũ), và thêm sheet **ĐỐI CHIẾU**: mỗi lỗi trong phạm vi xuất với ô trong file booking, ô trong file xuất, giá trị cũ / mới và kết quả Đã sửa / Cần kiểm tra.

Nhập bằng **đường dẫn** (app desktop / `npm run dev`): dán đường dẫn đầy đủ tới file trên máy hoặc máy chủ nội bộ, ví dụ `\\server\KHO\KE TOAN KHO.xlsm`, `Z:\Kho\Nhap.xlsx` hoặc `/Volumes/KHO/…` (app desktop có nút chọn file để lấy đường dẫn). Đọc được `.xlsx`, `.xlsm` (có macro — chỉ đọc giá trị, không chạy macro), `.xlsb`, `.xls`. Ứng dụng kiểm tra giờ sửa file mỗi 60 giây và tự đọc lại ngay khi file được lưu; booking đọc lại cũng được so với bản trước và báo ở nút **Thay đổi booking**. Chỉ máy đang chạy ứng dụng mới đọc được đường dẫn. **Xoá** bỏ file khỏi mục đó (booking: xoá lần nhập đang hiện, bản trước hiện lại) và ngừng tự cập nhật; file gốc không bị đụng tới.

**Kế hoạch** hiện kết quả tổng hợp chi tiết của tuần / ngày đang chọn, bấm 4 thẻ để chuyển bảng:
- **Từ file booking**: số lượng cần làm, ngày nhận (INPUT), hạn giao (OUTPUT), leadtime của từng đơn (lô).
- **Từ file nhận**: đã nhận bao nhiêu BTP, còn thiếu, % đã nhận, ngày nhận cuối.
- **Từ file giao**: đã giao, giao đạt, lỗi, còn phải giao, % hoàn thành.
- **Tổng hợp cả 3 file**: đơn đã giao đủ trong tuần được **ghim cứng ở đầu**; các đơn còn lại xếp theo độ gấp với đã nhận BTP, đã giao BTP, **tồn BTP** (nhận − giao), hạn giao và **cần chú ý** (trễ hạn, sắp tới hạn, chưa nhận / thiếu BTP, tồn chưa giao, lỗi).
Danh sách các file booking đã nhập nằm bên dưới.

Nhập bằng link: khi chạy `npm run dev`, máy chủ tải file từ link (SharePoint/OneDrive tự thêm `download=1` và giữ cookie khách của link “Bất kỳ ai có link”; Google Sheets tự xuất `.xlsx`). File nhận/giao nạp từ link được **cập nhật lại từ link** khi bấm nút, khi mở trang và mỗi 30 phút khi trang đang mở, vì bên giao nhận sửa file SharePoint liên tục. Link chỉ dành cho người trong tổ chức thì không tải được. Bản Sites chỉ đọc được link cho phép tải chéo (CORS), nên không tự cập nhật từ SharePoint.

## File booking sai cột, sai hàng

App bám theo **Mã hàng (REF) + Model (mã 7 số)** để đọc file booking cho chắc:
- **Tên cột linh hoạt**: không phân biệt dấu, hoa/thường, khoảng trắng; nhận cả tên gọi khác (“Mã hàng” = REF, “Model” = MODEL CODE, “Màu” = COLOR, “Line qty”, “Số phiếu”, “Lead time”…). Hàng tiêu đề được dò trong 30 dòng đầu, nên chèn thêm dòng phía trên vẫn đọc được.
- **Tự sửa khi chắc chắn** (dựa vào chính file booking): REF và MODEL CODE gõ đổi chỗ; MODEL CODE trống thì lấy mã 7 số trong ô COLOR, hoặc mã model có ở một ô khác của dòng (dữ liệu lệch cột), hoặc model duy nhất của mã hàng đó; REF trống thì lấy mã hàng mà model đó có ở các dòng khác.
- **Không tự đoán khi mơ hồ**: mã hàng có nhiều model mà dòng không có mã 7 số; MODEL CODE khác mã đầu ô COLOR; một dòng ghi mã hàng khác với mã hàng của model đó ở các dòng khác; dòng thiếu LINE (vẫn được tính, không còn bị bỏ qua).
- Mọi chỗ đã sửa / cần xem được liệt kê trong **Kiểm tra file → Đọc theo Mã hàng + Model** với sheet, số dòng, giá trị trong file, giá trị app dùng và lý do. File nhận / giao sẽ áp dụng cách này sau.

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

## Preview bằng Sites

GPT Sites chạy giao diện tĩnh và vẫn có thể đọc, tổng hợp file Excel ngay trong trình duyệt. Do bản preview không chạy Node.js, dữ liệu không được ghi vào SQLite; SQLite hoạt động khi chạy ứng dụng bằng `npm run dev`.
