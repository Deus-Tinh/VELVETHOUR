# Business Test Matrix — SERENITY SPA & WELLNESS

**Ngày chạy:** 2026-10-08 (Asia/Saigon)  
**Bộ test:** 55 test Vanilla JS, chạy bằng Node.js; mọi test dùng memory backend để không chạm dữ liệu trình duyệt.  
**Kết quả:** 55/55 PASS trên cả npm test và lần chạy node trực tiếp.  
**Giới hạn:** Trình duyệt Codex/Edge không tải được test server của workspace; các kiểm tra UI, LocalStorage trình duyệt thật và E2E thao tác màn hình chưa được chạy.  
**Status:** PASS = toàn bộ phạm vi ghi ở hàng đã được chạy; NOT_RUN = chưa chạy; BLOCKED = không thể chạy trong môi trường hiện tại.

| ID | Nghiệp vụ | Input | Expected | Actual | Status |
|----|-----------|-------|----------|--------|--------|
| SVC-01 | Service create/update/delete cơ bản | Dữ liệu dịch vụ hợp lệ | CRUD đọc lại đúng | Tạo, sửa giá, xóa dịch vụ chưa liên kết đều chạy trong suite | PASS |
| SVC-02 | Service validation | Tên/category thiếu; category không có hoặc inactive; giá/duration âm hoặc 0 | Từ chối và không ghi | Đã xác nhận các trường hợp này trong test 40 | PASS |
| SVC-03 | Service payload sai kiểu | Mảng/object thay cho chuỗi/số | Từ chối và không ghi | Chưa kiểm tra toàn bộ kiểu dữ liệu | NOT_RUN |
| SVC-04 | Category reference | Tạo service với category không tồn tại/inactive | Không tạo tham chiếu mồ côi | Đã kiểm tra trong test 40 | PASS |
| SVC-05 | Duplicate slug/name của service | Hai service có cùng slug | Từ chối nếu slug là khóa duy nhất | Chưa có quy tắc/test xác nhận | NOT_RUN |
| SVC-06 | Service read và inactive | ID có/không có; dịch vụ active/inactive | Đọc đúng trạng thái | Đọc qua test CRUD và kiểm tra service sau soft-delete trong test 51 | PASS |
| SVC-07 | Service update invalid | ID không tồn tại hoặc payload cập nhật sai | Từ chối cập nhật | Chưa kiểm tra đủ ca lỗi update | NOT_RUN |
| SVC-08 | Giá snapshot trong booking | Tạo booking rồi đổi giá dịch vụ | Booking cũ giữ giá đã lưu | Test 51 đổi giá sau khi tạo booking; originalPrice/finalPrice của booking giữ nguyên | PASS |
| SVC-09 | Xóa dịch vụ đã có booking | Remove service được booking tham chiếu | Ẩn dịch vụ, giữ booking/lịch sử | Đã kiểm tra service chuyển inactive và booking giữ giá trong test 51 | PASS |
| CAT-01 | Category CRUD | Tạo, đổi tên, xóa category rỗng | Thay đổi được lưu | Đã chạy trong test 2 | PASS |
| CAT-02 | Category duplicate | Tên trùng sau chuẩn hóa hoa/thường | Từ chối duplicate | Đã chạy trong test 35 | PASS |
| CAT-03 | Category có service liên kết | Xóa category đang được service dùng | Không tạo orphan | Chưa kiểm tra | NOT_RUN |
| STF-01 | Staff CRUD cơ bản | Tạo, sửa, xóa staff chưa liên kết booking | Thay đổi được lưu | Đã chạy trong test 3 | PASS |
| STF-02 | Staff validation | Specialty, ca làm, working days, breaks và ngày nghỉ sai | Từ chối lịch không hợp lệ | Validation trực tiếp và lưu staff invalid chưa được bao phủ đủ | NOT_RUN |
| STF-03 | Staff availability | Specialty sai, ngày không làm/ngày nghỉ, break | Từ chối booking và ẩn slot | Đã kiểm tra specialty, working day/day off và break trong test 13, 27, 44 | PASS |
| STF-04 | Staff inactive/history | Disable staff và kiểm tra booking lịch sử/tương lai | Không nhận booking mới, lịch sử còn | Đường booking của staff inactive chưa được test riêng | NOT_RUN |
| SRCH-01 | Search | Hoa thường, dấu/không dấu, whitespace, không kết quả | Kết quả đúng hoặc rỗng, không crash | Đã kiểm tra trong test 4 và 38 | PASS |
| FLT-01 | Filter kết hợp | Category, max price, duration | Mọi kết quả thỏa tất cả điều kiện | Đã kiểm tra trong test 5 và 38 | PASS |
| FLT-02 | Filter theo staff/status/date | Bộ lọc status, staff và ngày | Kết quả đúng | Chưa chạy | NOT_RUN |
| SORT-01 | Sort | Giá, tên, mới/cũ, rating | Đúng thứ tự, không đổi mảng nguồn | Đã kiểm tra các trường sort và thứ tự nguồn trong test 38 | PASS |
| PAGE-01 | Pagination | Trang đầu và page vượt giới hạn | Trả trang hợp lệ, clamp page | Đã kiểm tra trong test 7 và 38 | PASS |
| PAGE-02 | Search/filter từ trang cuối | Thay query khi đang ở trang cuối | Reset/clamp hợp lý trong UI | Logic query có clamp; tương tác UI chưa chạy | BLOCKED |
| VAL-01 | Required/email/phone/number/date | Rỗng, null, undefined, email/phone lỗi, NaN/Infinity, ngày invalid/quá khứ | Chấp nhận/từ chối theo validator | Đã chạy các biên được liệt kê trong test 39 | PASS |
| BKG-01 | Tạo booking hợp lệ | Service, staff, ngày và slot hợp lệ | Code, snapshot, status và lưu trữ đúng | Đã chạy trong test 10 và luồng tích hợp test 51 | PASS |
| BKG-02 | Booking overlap 10:30–11:30 với lịch 10:00–11:00 | Cùng staff/ngày | Reject xung đột | Đã chạy trong test 11; các kiểu đè khác chưa chạy hết | PASS |
| BKG-03 | Slot liền kề | Booking kết thúc đúng lúc booking mới bắt đầu | Cho phép | Đã chạy trong test 12 | PASS |
| BKG-04 | Khác staff và slot Cancelled | Cùng giờ nhưng staff khác; đặt lại slot đã hủy | Cho phép | Đã chạy trong test 43 | PASS |
| BKG-05 | Completed history và transition | Completed không bị sửa ngược; doanh thu chỉ tính Completed | Giữ lịch sử và chặn transition sai | Đã kiểm tra test 18, 22 và 51; chưa chạy toàn bộ transition matrix | PASS |
| BKG-06 | Staff specialty/ca/ngày nghỉ/break | Booking không phù hợp lịch nhân viên | Reject ở service và slot availability | Đã kiểm tra test 13, 27, 44 | PASS |
| BKG-07 | Spa hours và ngày đóng cửa | Slot ngoài giờ, ngày đóng cửa | Không có slot/không tạo booking | Đã kiểm tra test 26 và 45 | PASS |
| BKG-08 | Duration vượt ca | Thời lượng kết thúc sau giờ staff/spa đóng | Reject | Chưa kiểm tra ca cụ thể 90 phút vượt ca | NOT_RUN |
| BKG-09 | Past date, past time, lead time, advance limit | Ngày qua, giờ qua, còn đúng 30 phút, vượt maxAdvanceDays | Chặn input sai; đúng biên được nhận | Đã kiểm tra test 28, 45, 54 | PASS |
| BKG-10 | Duration/slot alignment | Duration không hỗ trợ; startTime ngoài bước slot | Reject | Đã kiểm tra test 29 và 54 | PASS |
| BKG-11 | Auto assign staff | Nhiều staff, chọn người phù hợp/rảnh | Chọn staff hợp lệ hoặc báo unavailable | Chưa xác nhận tính năng này tồn tại | NOT_RUN |
| BKG-12 | Double submit và giá do client gửi | Gửi payload giống nhau hai lần, sửa giá trong payload | Chỉ một booking, giá tính từ service/promo | Đã kiểm tra test 46; request đồng thời thật chưa mô phỏng | PASS |
| BKG-13 | Booking code uniqueness | Tạo nhiều booking trong cùng dataset | Không trùng code | Chưa chạy kiểm tra hàng loạt | NOT_RUN |
| BKG-14 | Status transition matrix | Pending/Confirmed/Completed/Cancelled, mọi hướng chuyển | Chỉ cho phép transition theo rule | Một số hướng sai/đúng đã chạy; chưa chạy hết ma trận | NOT_RUN |
| BKG-15 | Cancellation notice | Trước/sát cutoff; notice 0 giờ; terminal state | Theo settings và ownership | Đã kiểm tra biên 2 giờ và chính sách 0 giờ trong test 17, 48 | PASS |
| PROMO-01 | Percent/fixed/cap | 10% và fixed discount; maxDiscount; final không âm | Tính discount/final chính xác | Percent/cap trong test 16, fixed/cap trong test 47 | PASS |
| PROMO-02 | Promotion constraints | Start/end, inactive, min spend, unknown, usage limit | Từ chối mã không hợp lệ | Đã kiểm tra test 15, 47 và 52 | PASS |
| PROMO-03 | Promotion usage transaction | Booking thành công/thất bại và usageLimit | Chỉ booking thành công tăng một lượt | Đã kiểm tra rollback và usageLimit trong test 30, 51, 52 | PASS |
| AUTH-01 | Demo login | Tài khoản đúng/sai, email lạ, inactive | Login hoặc lỗi phù hợp | Đã kiểm tra trong test 49 | PASS |
| AUTH-02 | Session persistence và role rendering | Logout/reload/navbar theo role | Session được khôi phục đúng | Chưa chạy bằng trình duyệt | BLOCKED |
| AUTH-03 | Profile ownership | Customer sửa profile mình/đổi profile người khác | Chỉ owner được cập nhật | Owner scope được kiểm tra trong test 49 | PASS |
| AUTH-04 | Profile field validation/uniqueness | Tên/email/phone sai hoặc trùng | Từ chối dữ liệu không hợp lệ | Chưa chạy toàn bộ trường hợp | NOT_RUN |
| PERM-01 | Customer booking read/review scope | A đọc/review booking của B | Không lộ dữ liệu, từ chối review | Đã kiểm tra read ở test 31 và review ở test 55; hủy cross-account chưa kiểm tra | PASS |
| PERM-02 | Staff booking scope | Staff A hoàn tất booking của staff B | Từ chối | Đã kiểm tra trong test 32 và test 50 | PASS |
| REV-01 | Review eligibility/ownership/duplicate | Completed owner, trạng thái khác, user khác, gửi lần hai | Chỉ owner của Completed, một lần | Đã kiểm tra trong test 34, 51, 55 | PASS |
| REV-02 | Rating 0 | Gửi review với rating 0 | Từ chối | Đã kiểm tra trong test 55 | PASS |
| REV-03 | Rating 6 | Gửi review với rating 6 | Từ chối | Chưa kiểm tra riêng | NOT_RUN |
| REV-04 | Seeded rating aggregate | Thêm review cho service đã có aggregate seed | Tăng review count, giữ đúng trung bình có trọng số | Đã kiểm tra trong test 37 | PASS |
| FAV-01 | Favorites | Thêm/bỏ favorite, service không tồn tại | Toggle đúng, invalid service bị từ chối | Đã kiểm tra test 24 và 33; tách biệt hai account chưa test | PASS |
| CONT-01 | Contact form/admin list | Email lỗi/hợp lệ, tạo và admin đọc contact có seed record | Từ chối input sai, list không crash | Đã kiểm tra test 25, 53 sau khi sửa sort thiếu createdAt | PASS |
| LS-01 | Repository persistence | Write rồi gắn lại cùng storage backend | Đọc lại được sau khi tái gắn backend | Đã kiểm tra backend mô phỏng trong test 19 và 42 | PASS |
| LS-02 | Browser LocalStorage/reload | Ghi trên browser rồi reload trang | Dữ liệu còn trong localStorage thật | Test suite dùng memory backend; chưa chạy browser | NOT_RUN |
| LS-03 | Seed/reset safety | Seed lại sau khi sửa demo record | Seed không ghi đè thay đổi | Đã kiểm tra trong test 41 | PASS |
| LS-04 | Corrupt JSON | Lưu JSON hỏng rồi đọc key | Fallback an toàn và xóa key lỗi | Đã kiểm tra trong test 20 | PASS |
| LS-05 | Missing key/invalid collection schema | Key thiếu hoặc collection sai schema | Fallback hoặc báo lỗi rõ ràng | Chưa kiểm tra đủ | NOT_RUN |
| LS-06 | Storage write errors | Backend ném quota error | Lỗi quota được báo rõ | Đã kiểm tra trong test 42 | PASS |
| INT-01 | Booking relationship integrity | Service/customer/staff/promo tham chiếu qua flow mới | Quan hệ cùng ID và snapshot | Flow mới kiểm tra service, user, staff, promo, booking trong test 51; kiểm tra toàn dataset chưa chạy | PASS |
| INT-02 | Service → public list/detail → booking trên UI | Admin tạo service rồi đi qua các màn hình | Service mới được public và đặt lịch được | Luồng service layer đã chạy; cross-page UI chưa chạy | BLOCKED |
| INT-03 | Booking → customer/admin/staff/KPI trên UI | Booking mới và đổi status | Mỗi màn hình hiển thị đúng dữ liệu | Các service scope/KPI đã chạy; cross-page UI chưa chạy | BLOCKED |
| INT-04 | Complete → review → rating/revenue trên UI | Hoàn tất booking rồi review | Dashboard và service page đồng bộ | Service-layer integration pass test 51; UI chưa chạy | BLOCKED |
| KPI-01 | Dashboard counts | Tính lại counts từ booking/service/staff/user repos | KPI bằng dữ liệu nguồn | KPI service được kiểm tra trong test 21; chưa kiểm tra độc lập từng trường | PASS |
| KPI-02 | Revenue | Completed finalPrice và loại Cancelled | Tổng đúng | Đã kiểm tra test 22 và 51 | PASS |
| KPI-03 | Popular services | Confirmed/Completed, bỏ Cancelled | Chỉ booking hợp lệ được đếm | Đã kiểm tra test 36; tie-break và dataset 10/5/1 chưa chạy | PASS |
| ROUTE-01 | Routes/history/reload/invalid params | Home, services, detail, booking, auth, profile, admin/staff, route lỗi | Không màn hình trắng | Chưa kiểm thử được qua browser của workspace | BLOCKED |
| DOM-01 | DOM events/forms/modals/keyboard | Click, submit, change, Esc, modal, tabs, pagination | Event chạy đúng, không double submit | Chưa kiểm thử UI qua browser | BLOCKED |
| RESP-01 | Responsive interactions | 1440/1024/768/430/390px | Luồng chính dùng được ở từng viewport | Chưa kiểm thử browser viewport | BLOCKED |
| A11Y-01 | Keyboard/focus/labels/aria | Điều hướng keyboard, modal, label, aria-live | Interaction cơ bản truy cập được | Chưa kiểm thử screen/keyboard | BLOCKED |
| RUNTIME-01 | Browser runtime/console/assets | Load app, routes, imports, errors, ảnh | Không lỗi runtime/console | Trang home đang mở được, nhưng test runner treo ở “Đang chạy kiểm thử”; không lấy được console và không xác nhận bundle đúng workspace | BLOCKED |
| SEC-01 | Price/role boundary | Tamper giá từ payload; customer gọi admin service | Service tự tính giá, role được kiểm tra ở service | Đã kiểm tra test 46 và 50 | PASS |
| SEC-02 | DOM injection/eval | User input đi qua HTML sinks | Không thực thi markup/script ngoài ý muốn | Có innerHTML templates và helper esc; chưa chạy taint/XSS test toàn app, không có eval trong kết quả tìm kiếm mã JS | NOT_RUN |
| E2E-01 | Kịch bản demo đầy đủ trên browser | Login, search/filter/sort, booking/promo, reload, confirm, complete, review, KPI, service CRUD | 33 bước đồng bộ end-to-end | Service-layer kịch bản rút gọn pass test 51; browser không kết nối được test server | BLOCKED |
