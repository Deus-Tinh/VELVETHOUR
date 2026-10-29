# LUỒNG DỮ LIỆU THỐNG NHẤT (DATA FLOW ARCHITECTURE)
## DỰ ÁN: SERENITY SPA & WELLNESS

---

### 1. NGUYÊN TẮC THIẾT KẾ DỮ LIỆU (SINGLE SOURCE OF TRUTH)
- Mọi thao tác đọc và ghi dữ liệu đều đi qua **Business Services** và **Repositories**.
- Khi kết nối máy chủ, SQLite là nguồn dữ liệu dùng chung; LocalStorage chỉ làm cache phía trình duyệt. Chế độ demo không có máy chủ mới dùng LocalStorage làm dữ liệu cục bộ.
- Tuyệt đối không cho phép trang UI tự đọc/ghi trực tiếp vào key thô của LocalStorage.
- Cache trình duyệt dùng namespace `serenity:v2:` để tránh xung đột với các ứng dụng khác.

---

### 2. SƠ ĐỒ KIẾN TRÚC TỔNG THỂ

```
┌────────────────────────────────────────────────────────┐
│                     USER INTERFACE                     │
│  Home | Services | Booking | Customer | Staff | Admin  │
└───────────────────────────┬────────────────────────────┘
                            │ (Events & Actions)
                            ▼
┌────────────────────────────────────────────────────────┐
│                  CONTROLLERS / PAGES                   │
│   servicesPage.js | bookingPage.js | adminPage.js ...  │
└───────────────────────────┬────────────────────────────┘
                            │ (Business Invocations)
                            ▼
┌────────────────────────────────────────────────────────┐
│                   BUSINESS SERVICES                    │
│   bookingService | serviceService | authService ...    │
└───────────────────────────┬────────────────────────────┘
                            │ (CRUD Operations)
                            ▼
┌────────────────────────────────────────────────────────┐
│                      REPOSITORIES                      │
│   serviceRepo | staffRepo | bookingRepo | userRepo ... │
└───────────────────────────┬────────────────────────────┘
                            │
              ┌─────────────┴───────────────┐
              ▼                             ▼
┌──────────────────────────┐   ┌─────────────────────────┐
│ API / SQLite (connected) │   │ LocalStorage cache/demo │
└──────────────────────────┘   └─────────────────────────┘
```

---

### 3. VÍ DỤ LUỒNG ĐỒNG BỘ: ĐẶT LỊCH HẸN VÀ CẬP NHẬT DOANH THU
1. **Khách hàng chọn lịch và thanh toán tại `#/booking`**:
   - `bookingService.createBooking()` gửi lựa chọn lên máy chủ; máy chủ tính giá cuối, kiểm tra xung đột nhân viên/phòng và tạo mã chuyển khoản duy nhất.
   - Booking được lưu ở trạng thái `Pending` / `awaiting_payment`, giữ slot 180 giây và hiển thị QR VietQR động với đúng số tiền, mã nội dung.
   - SePay gửi webhook đã xác thực khi có tiền vào. Máy chủ chống giao dịch trùng và chỉ chuyển booking sang `Confirmed` khi khớp tài khoản, mã, số tiền, thời hạn và slot.
   - Đơn quá hạn được hủy và giải phóng slot. Giao dịch thiếu/thừa/sai mã/đến muộn được lưu trong kho giao dịch và màn đối soát Admin. Với giao dịch không ghép mã được, Admin xác minh rồi gắn thủ công vào hồ sơ đơn; hệ thống đánh dấu cần đối soát, hủy slot đang chờ, ghi nhật ký và tạo sẵn tin nhắn cho nhân viên gửi. Không xác nhận lịch hay tự hoàn tiền.
2. **Khách hàng truy cập `#/my-bookings`**:
   - `bookingService.byCustomer()` đọc danh sách booking từ `bookings` repo.
   - Hiển thị lịch hẹn với mã code `SER-YYMMDD-XXXX`.
3. **Chuyên viên hoàn thành ca tại `#/staff`**:
   - Chuyên viên bấm "✓ Hoàn Thành".
   - `bookingService.updateStatus(id, 'Completed')` cập nhật trạng thái trong `bookings`.
4. **Admin Dashboard phản ánh tức thời tại `#/admin`**:
   - `analyticsService.getDashboardKPIs()` tính toán lại:
     - `totalRevenue`: Lấy tất cả booking có status `Completed`, tính tổng `finalPrice`.
     - Lịch `Cancelled` không được tính vào doanh thu.
   - Biểu đồ Canvas 7 ngày vẽ lại các điểm dữ liệu mới.

**Khách hủy lịch đã thanh toán**:
- Máy chủ tạo yêu cầu hoàn đúng 50% số tiền thực thu và lưu tài khoản khách nhận hoàn.
- Nhân viên chuyển khoản thủ công; Admin ghi mã giao dịch trong tab Đối Soát QR / Hoàn Tiền để hoàn tất yêu cầu.

**Khách dời lịch sang ngày có giá khác**:
- Nếu giá tăng, lịch cũ vẫn giữ nguyên; máy chủ giữ khung giờ mới 180 giây, tạo QR cùng mã đơn cho đúng phần chênh lệch và chỉ cập nhật lịch sau khi webhook xác nhận đủ tiền.
- Nếu giá giảm, lịch mới được cập nhật sau khi khách xác nhận; máy chủ tạo đề nghị hoàn 100% phần chênh lệch vào tài khoản khách cung cấp để nhân viên chuyển thủ công.
- Giao dịch thừa, sau hạn hoặc khung giờ mới không còn trống không tự xác nhận; Admin quyết định từng trường hợp trong tab đối soát.

### 4. LUỒNG CATALOG LIỆU TRÌNH VÀ GÓI
- Cả liệu trình lẻ và gói trị liệu cùng nằm trong collection `services`, được phân biệt bằng `kind` (`therapy` hoặc `package`). Dữ liệu cũ được nhận diện tương thích từ danh mục `packages`.
- Gói lưu `components` là các ID tham chiếu tới liệu trình lẻ; không tạo bản sao các liệu trình. Backend xác thực liên kết khi nhận cập nhật catalog qua `PUT /api/admin/collections/services`.
- Trang công khai truy vấn `GET /api/services?kind=therapy` hoặc `GET /api/services?kind=package`; phân trang phía máy chủ giới hạn tối đa 6 mục mỗi trang.
- Nhóm hiển thị của liệu trình được lưu bằng `therapyGroup`, tách khỏi `category` dùng để ghép chuyên viên. `GET /api/services?therapyGroup=...` lọc nhóm trước khi phân trang phía máy chủ; trang gói giữ `therapyGroup=all`, nên bộ lọc nhóm không thay đổi phân trang tối đa 6 gói hiện có.
- Bước đặt lịch chia catalog thành hai tab: liệu trình và gói trị liệu. Tab liệu trình lọc theo `therapyGroup`; cả hai tab vẫn tìm kiếm và phân trang tối đa 6 lựa chọn. Khi khách xác nhận gói, luồng booking hiện có gửi ID gói và mức thời lượng đã chọn tới `POST /api/bookings`; máy chủ kiểm tra lại thành phần, giá biến thể và slot rồi lưu một booking duy nhất.
