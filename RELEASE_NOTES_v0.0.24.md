# v0.0.24

- Ghép số lượng theo PO hoặc số phiếu trước khi phân bổ phần chưa xác định bằng FIFO; giữ riêng các mùa trong khóa lô.
- Giữ PXI TRẢ khi nhập booking chỉ có sheet leadtime. Nếu cùng PXC có nhiều PXI, báo các ngày mâu thuẫn và yêu cầu thống nhất file nguồn trước khi nhập.
- TH tính tổng ngày/tuần bằng công thức; CAN DOI liên kết phân bổ ngày và hình in từ TH, giữ số lẻ, bổ sung tổng W. Tổng nhận/in/giao/GAP và tải ngày phản ánh bộ lọc.
- Excel cố định hàng tiêu đề và cột nhận diện, lặp tiêu đề khi in, tô tổng và giữ hai chữ số thập phân khi cần.
- Lịch gọn hơn, hiển thị mùa/số phiếu; số lượng và tổng ở tiêu đề khớp bộ lọc đang xem.
- Giữ bốn ngày booking/thực tế riêng biệt, không suy diễn ngày nhận từ PO cũ. Ngày dự kiến vẫn bằng ngày giao BTP thực tế + leadtime + 1 ngày lịch, gồm Chủ nhật.

Phiên bản tiếp theo tuân thủ: sau v0.0.25 là v0.1.1; sau v0.1.25 là v0.2.1.
