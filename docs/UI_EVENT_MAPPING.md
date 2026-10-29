# BẢN ĐỒ TƯƠNG TÁC GIAO DIỆN & DỮ LIỆU (UI EVENT MAPPING)
## DỰ ÁN: SERENITY SPA & WELLNESS

---

### MÔ HÌNH THỐNG NHẤT
```
UI Element → Event → Controller/Handler → Business Service → Repository → LocalStorage → Bus Event → UI Render
```

---

### BẢNG MAPPING CHI TIẾT

| # | Thành phần UI | Sự kiện | Handler / Controller | Service / Nghiệp vụ | Repository & Storage | Kết quả cập nhật UI |
|---|---|---|---|---|---|---|
| 1 | **Nút "Đặt Lịch Ngay" (Card / Banner)** | `click` | `navigate('#/booking?service=id')` | `serviceService.get(id)` | `services` | Mở Booking Wizard với dịch vụ được chọn sẵn |
| 2 | **Nút "Yêu Thích" ♥ (Service Card / Detail)** | `click` | `favoriteToggleHandler` | `favoriteService.toggle(userId, serviceId)` | `favorites` | Đổi màu trái tim đỏ, hiện toast thông báo |
| 3 | **Ô tìm kiếm liệu trình** | `input` | `debounce(renderFilteredList)` | `serviceService.query({ q })` | `services` | Lọc danh sách không phân biệt hoa/thường/dấu |
| 4 | **Bộ lọc Danh mục / Giá / Thời lượng** | `change` | `filterChangeHandler` | `serviceService.query({ filters })` | `services` | Cập nhật danh sách hiển thị và phân trang |
| 5 | **Bộ chọn thời lượng (Variant Picker)** | `click` | `variantSelectHandler` | `serviceService.get()` | Memory State | Đổi giá hiển thị tức thời, cập nhật nút Đặt Lịch |
| 6 | **Chọn ngày trong Booking Wizard** | `click` | `dateSelectHandler` | `bookingService.getAvailableSlots()` | `bookings`, `settings`, `staff` | Tải lại các khung giờ trống và đã kín trong ngày |
| 7 | **Nút "Áp dụng mã giảm giá"** | `click` | `applyPromoHandler` | `promotionService.check()` | `promotions` | Tính tiền giảm, cập nhật tổng thanh toán |
| 8 | **Nút "XÁC NHẬN ĐẶT LỊCH"** | `click` | `submitBookingHandler` | `bookingService.createBooking()` | `bookings`, `promotions` | Khóa double submit, tạo mã, chuyển sang `#/my-bookings` |
| 9 | **Nút "Hủy Lịch" (Customer Portal)** | `click` | `cancelBookingHandler` | `bookingService.cancelByCustomer()` | `bookings` | Hiện Confirm Modal, kiểm tra trước 2h, chuyển trạng thái "Cancelled" |
| 10 | **Nút "Đánh Giá" (Customer Portal)** | `click` | `openReviewModal` | `reviewService.createReview()` | `reviews`, `services` | Lưu nhận xét, tính lại rating trung bình cho dịch vụ |
| 11 | **Nút "Hoàn Thành Ca" (Staff Portal)** | `click` | `staffCompleteHandler` | `bookingService.updateStatus('Completed')` | `bookings` | Chuyển badge "Completed", cộng vào doanh thu hệ thống |
| 12 | **Form Thêm / Sửa Dịch Vụ (Admin)** | `submit` | `saveServiceHandler` | `serviceService.create/update()` | `services` | Validate dữ liệu, lưu LocalStorage, làm mới bảng dịch vụ |
| 13 | **Nút "Xóa Dịch Vụ" (Admin)** | `click` | `deleteServiceHandler` | `serviceService.remove()` | `services`, `bookings` | Kiểm tra lịch sử booking: nếu có thì chuyển Tạm Ẩn |
| 14 | **Form Cài Đặt Giờ Spa (Admin)** | `submit` | `saveSettingsHandler` | `settingsService.update()` | `settings` | Cập nhật giờ mở/đóng cửa và bước slot đặt lịch |
| 15 | **Nút "Khôi Phục Demo" (Admin)** | `click` | `resetDemoHandler` | `resetDemoData()` | Toàn bộ Collections | Nạp lại dữ liệu chuẩn ban đầu, hiện thông báo thành công |
| 16 | **Nút 1-Click Login Demo** | `click` | `quickLoginHandler` | `authService.login()` | `users`, `session` | Lưu session, cập nhật tên và avatar trên Navbar |
| 17 | **Form Liên Hệ (Contact Us)** | `submit` | `contactSubmitHandler` | `contactService.create()` | `contacts` | Validate SĐT/Email, lưu tin nhắn vào Admin Contacts |
