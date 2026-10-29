# BUG REPORT — SERENITY SPA & WELLNESS

**Ngày audit:** 2026-10-08  
**Phạm vi:** Lỗi nghiệp vụ được tái hiện khi mở rộng suite từ 25 lên 55 case. Fixes đã được chạy lại bằng regression suite. Các lỗi dưới đây là những phát hiện đã được sửa; phần UI chưa xác minh được liệt kê trong FINAL_TEST_REPORT thay vì báo là bug.

## BUG-001 — Booking service không chặn đủ slot không hợp lệ

- **Severity:** High
- **Area:** Booking engine / availability
- **Steps to reproduce:** Gọi BookingService trực tiếp với ngày/giờ quá khứ, ngoài giờ spa hoặc ca làm, ngày nhân viên nghỉ, giờ nghỉ giữa ca, ngày spa đóng, thời gian vượt giới hạn đặt trước hoặc giờ bắt đầu không theo slot step.
- **Expected:** Request bị từ chối ở business service; availability không trả slot không dùng được.
- **Actual:** Các kiểm tra trước đây dựa một phần vào UI/không được thực hiện thống nhất ở service boundary.
- **Root cause:** Quy tắc ngày, giờ mở cửa, ca làm, breaks và slot grid chưa được enforce đầy đủ ở cả hai entry point.
- **Files affected:** assets/js/services/bookingService.js
- **Fix applied:** Bổ sung kiểm tra ở createBooking và getAvailableSlots cho date/lead/advance limit, spa closed dates, lịch nhân viên, breaks, hours, duration và slot step.
- **Retest result:** PASS — tests 26–29, 43–45, 54; full suite 55/55.

## BUG-002 — Booking access và status action thiếu scope nhất quán theo session

- **Severity:** High
- **Area:** Authorization / customer and staff data
- **Steps to reproduce:** Customer A yêu cầu booking của Customer B; staff A hoàn tất booking được gán cho staff B; guest thử gửi review cho booking của customer.
- **Expected:** Chỉ owner/admin đọc booking; chỉ nhân viên được gán hoàn tất ca; review cần tài khoản owner.
- **Actual:** Các service entry point chưa enforce đồng nhất quyền theo session hiện tại.
- **Root cause:** Một số thao tác tin vào tham số do caller truyền hoặc chỉ dựa vào việc UI ẩn nút.
- **Files affected:** assets/js/services/bookingService.js, assets/js/services/socialAndAnalyticsService.js, assets/js/pages/myBookingsPage.js
- **Fix applied:** Phạm vi list/get/by-code/by-customer/by-staff dựa trên session; status, cancel và review kiểm tra role/ownership ở service.
- **Retest result:** PASS — tests 31, 32, 34, 49, 50, 55; full suite 55/55.

## BUG-003 — Tạo booking có promotion có thể làm sai usedCount khi lưu booking lỗi

- **Severity:** High
- **Area:** Promotion / booking persistence
- **Steps to reproduce:** Dùng promotion hợp lệ, làm booking persistence ném lỗi, sau đó kiểm tra usedCount; hoặc đặt mã có usageLimit tới lượt cuối rồi thử đặt tiếp.
- **Expected:** Chỉ booking lưu thành công mới dùng một lượt; lỗi ghi booking không giữ lượt; mã đã hết lượt bị từ chối.
- **Actual:** Trước fix, cập nhật lượt và tạo booking chưa được rollback/recheck nhất quán.
- **Root cause:** Promotion usage và booking write chưa được xử lý cùng một transaction logic.
- **Files affected:** assets/js/services/bookingService.js
- **Fix applied:** Recheck promotion ở thời điểm ghi, tăng usedCount sau khi booking được tạo và rollback booking nếu cập nhật bộ đếm lỗi.
- **Retest result:** PASS — tests 30, 47, 51, 52; full suite 55/55.

## BUG-004 — Review mới ghi đè aggregate rating seed

- **Severity:** Medium
- **Area:** Reviews / service rating
- **Steps to reproduce:** Service có rating 4.9 với 98 review seed; customer gửi rating 4 cho một booking Completed.
- **Expected:** Cập nhật trung bình có trọng số và tăng reviewsCount lên 99.
- **Actual:** Aggregate cũ từng bị thay bằng dữ liệu của riêng review mới (4.0/1).
- **Root cause:** Tính lại rating từ danh sách review cục bộ trong khi dữ liệu seed chỉ có aggregate, không có đủ từng review record.
- **Files affected:** assets/js/services/socialAndAnalyticsService.js
- **Fix applied:** Fold rating mới vào aggregate rating/count hiện có.
- **Retest result:** PASS — test 37 và luồng review tích hợp test 51; full suite 55/55.

## BUG-005 — Popular Services tính cả booking đã hủy

- **Severity:** Medium
- **Area:** Admin analytics
- **Steps to reproduce:** Thêm booking Confirmed và Cancelled cùng service, gọi dashboard KPI.
- **Expected:** Chỉ Confirmed và Completed được đếm vào Popular Services.
- **Actual:** Booking Cancelled từng làm tăng số lượt phổ biến.
- **Root cause:** Aggregation đếm mọi booking status.
- **Files affected:** assets/js/services/socialAndAnalyticsService.js, docs/BUSINESS_RULES.md
- **Fix applied:** Lọc status trước khi đếm và ghi rõ rule trong BUSINESS_RULES.
- **Retest result:** PASS — test 36; full suite 55/55.

## BUG-006 — Chính sách hủy 0 giờ bị thay bằng giá trị mặc định

- **Severity:** Medium
- **Area:** Booking cancellation / admin settings
- **Steps to reproduce:** Cấu hình cancelBeforeHours = 0 rồi thử hủy booking tương lai trong ngày.
- **Expected:** 0 là giá trị hợp lệ, không yêu cầu notice tối thiểu.
- **Actual:** Logic dùng truthy fallback coi 0 như thiếu cấu hình.
- **Root cause:** Dùng phép fallback theo truthiness thay cho kiểm tra null/undefined.
- **Files affected:** assets/js/services/bookingService.js, assets/js/pages/adminDashboardPage.js
- **Fix applied:** Giữ nguyên giá trị 0 bằng nullish fallback và cho phép nhập 0 trong cài đặt.
- **Retest result:** PASS — test 48; full suite 55/55.

## BUG-007 — Danh sách liên hệ crash với seed record không có createdAt

- **Severity:** Medium
- **Area:** Admin contacts
- **Steps to reproduce:** Đăng nhập admin rồi gọi contactService.list() với seed contact thiếu createdAt.
- **Expected:** Danh sách liên hệ vẫn được trả về và sắp xếp an toàn.
- **Actual:** Comparator gọi localeCompare trên undefined và ném TypeError.
- **Root cause:** Sort giả định mọi record đều có createdAt.
- **Files affected:** assets/js/services/socialAndAnalyticsService.js
- **Fix applied:** Chuẩn hóa timestamp thiếu thành chuỗi rỗng trước khi so sánh.
- **Retest result:** PASS — test 53 kiểm tra admin đọc được cả contact seed và contact mới; full suite 55/55.

## BUG-008 — CRUD service chấp nhận category sai trạng thái và category duplicate

- **Severity:** Medium
- **Area:** Service/category CRUD
- **Steps to reproduce:** Tạo service với category không tồn tại/ngừng hoạt động; cập nhật tên category thành tên đã có sau chuẩn hóa.
- **Expected:** Từ chối tham chiếu category hỏng và duplicate.
- **Actual:** Các đường CRUD chưa áp dụng đầy đủ xác thực tham chiếu/duplicate ở service layer.
- **Root cause:** Validation tập trung ở form/UI và duplicate comparison chưa chuẩn hóa nhất quán.
- **Files affected:** assets/js/services/serviceService.js
- **Fix applied:** Enforce category tồn tại/active trong service CRUD và từ chối tên category duplicate sau chuẩn hóa.
- **Retest result:** PASS — tests 35 và 40; full suite 55/55.

## Lỗi còn mở

Không còn lỗi nghiệp vụ đã tái hiện trong suite 55 case. Các mục chưa chạy được — browser E2E, responsive, keyboard/accessibility, LocalStorage thật, và một số nhánh CRUD/edge case — là giới hạn xác minh hiện tại; chúng chưa được đánh dấu là bug đã xác nhận.
