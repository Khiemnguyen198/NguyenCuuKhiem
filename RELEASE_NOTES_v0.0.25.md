# v0.0.25

- Sheet CAN DOI đổi tên thành CAN_DOI và theo đúng bố cục file KHSX: thêm cột SỐ PHIẾU và cột thứ bắt đầu in (Thứ Hai = 1), cột A là công thức REF & MODEL CODE & SLHĐ TỔNG.
- Gom dòng như pivot của KHSX: REF · MODEL CODE · SỐ PHIẾU · Mùa · SLHĐ TỔNG (lấy đúng cột của booking) · HÌNH IN · Leadtime.
- CAN_DOI liệt kê mọi nhóm của file booking; nhóm không có hàng trong phạm vi đã chọn có W = 0 và để trống số liệu, lọc cột W để ẩn.
- REF, MODEL CODE, SỐ PHIẾU ghi dạng số như KHSX để tra cứu sang các sheet khác.
