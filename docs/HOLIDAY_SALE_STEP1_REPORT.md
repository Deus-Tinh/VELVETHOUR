# Báo cáo triển khai Bước 1 — Định giá sale lễ

Ngày: 19/10/2026. Phạm vi: schema SQLite, mô hình chiến dịch, phép tính giá và kiểm thử nền tảng.

Đây là báo cáo tại thời điểm hoàn tất Bước 1. API, giao diện, công cụ agent và xác nhận dời lịch đã được triển khai tiếp; xem [báo cáo tích hợp hiện tại](HOLIDAY_SALE_INTEGRATION_REPORT.md).

## Đã hoàn tất

- `assets/js/domain/holidaySaleModel.js`: chuẩn hóa và kiểm tra chiến dịch, ngày sử dụng, phần trăm theo basis point, số tiền VND, loại phạm vi, target, revision và thời điểm UTC. Có thể kiểm tra target bằng danh sách dịch vụ/danh mục thật khi ghi chiến dịch ở bước tiếp theo.
- `assets/js/domain/pricingService.js`: phép tính giá thuần, bắt buộc truyền ngày sử dụng và thời điểm đánh giá. Chọn một sale theo tiền giảm thực tế, độ hẹp, thời điểm cập nhật và ID ổn định khi mọi tiêu chí bằng nhau. Sale lễ ưu tiên trước mã; không cộng dồn.
- Cùng module cung cấp phép tính chênh lệch khi dời lịch: giá cũ/mới, tiền đã thu ròng, khoản còn thanh toán và khoản cần hoàn. Không tạo giao dịch tiền và không thay đổi dữ liệu đầu vào.
- `server/pricingDatabase.js`: migration phiên bản 1 cho `holiday_sales`, `holiday_sale_targets`, `reschedule_quotes`; có kiểu dữ liệu/ràng buộc, khóa ngoại target và index. Không tạo khóa ngoại giả tới bảng dịch vụ/lịch hẹn vì chúng hiện nằm trong collection JSON.
- Migration chạy trong giao dịch, ghi phiên bản sau khi tạo schema thành công, có thể gọi lại và từ chối phiên bản schema mới hơn thay vì ghi đè.
- `readHolidaySales` đọc nguồn SQLite duy nhất và chuyển sang dữ liệu mà module định giá dùng được; chiến dịch có phạm vi nhưng thiếu target trả lỗi rõ ràng.
- `server/server.js` gọi migration khi khởi tạo database. Database dùng thực tế sẽ nhận schema khi máy chủ nạp phiên bản mã mới.
- `package.json` đã đưa hai file kiểm thử mới vào `npm test`.

## Kết quả kiểm thử

Lệnh `npm test` kết thúc với exit code 0:

- 62/62 bài nghiệp vụ hiện có đạt.
- 62/62 bài Node test đạt, bao gồm 30 bài đã có và 32 bài mới.
- Tổng cộng 124 bài đạt, không có bài thất bại hoặc bỏ qua.

32 bài mới gồm 22 bài định giá và 10 bài SQLite, kiểm tra:

- Đặt trước cho ngày lễ, đặt trong lễ nhưng sử dụng sau lễ, khoảng ngày gồm hai đầu.
- Giá từng mức thời lượng, giá gói độc lập với liệu trình thành phần, không nhầm nhóm trưng bày với danh mục vận hành.
- So mức giảm thực tế sau trần, mọi mức ưu tiên phạm vi, target ít hơn, thời điểm cập nhật và trường hợp bằng nhau hoàn toàn.
- Dữ liệu đầu vào được đóng băng vẫn tính được; đảo thứ tự nguồn chiến dịch không đổi kết quả.
- Sale không cộng mã, kể cả mã giảm cao hơn hoặc không hợp lệ; mã chỉ được xét khi khách yêu cầu và không có sale phù hợp.
- Coupon kiểm tra theo giờ Việt Nam bằng mốc đánh giá được truyền vào; các cấu hình mã hợp lệ giữ cách tính giảm như module khuyến mãi hiện có.
- Giá không âm, phần trăm làm tròn VND, trường hợp cọc một phần/trả đủ/đã hoàn một phần.
- Migration database mới/cũ, chạy lại, rollback khi tạo bảng lỗi và bảo vệ phiên bản tương lai.
- Giữ nguyên từng byte payload giá/thanh toán cũ, phiên đăng nhập và phiên bản collection.
- SQLite chặn ngày không tồn tại, mức giảm sai, scope sai, target trùng/không có chiến dịch; xóa chiến dịch dọn target tương ứng.
- Đọc chiến dịch đã lưu để tính giá, lưu quote, từ chối trạng thái xác nhận thiếu dữ liệu và mở lại database tạm sau khi đóng.

Các kiểm thử SQLite dùng bộ nhớ hoặc thư mục tạm. Không khởi chạy server ứng dụng với database của người dùng và không gọi Gemini/OpenAI thật trong kiểm thử này.

## Phần chưa kích hoạt tại thời điểm Bước 1

- Chưa có endpoint hoặc công cụ agent tạo/sửa/tắt sale.
- Chưa chuyển luồng tính giá catalog, trang chi tiết hoặc đặt lịch hiện có sang dùng chiến dịch mới.
- Chưa có endpoint lập/xác nhận quote; không coi ràng buộc của bảng quote là thay thế cho kiểm tra quyền, phiên bản, khung giờ và thao tác xác nhận ở máy chủ.
- Chưa thay đổi luồng dời lịch hiện tại. Chỉ nên kích hoạt định giá sale khi tích hợp đầy đủ báo giá/xác nhận để không có đường dời lịch giữ ưu đãi sai ngày.
- Chưa tạo menu động/trang ưu đãi hoặc kiểm thử trình duyệt cho các phần đó.
- Không tự thêm chiến dịch demo vào database đang dùng.

## Bước tiếp theo

Tích hợp các thao tác quản trị và đường đọc dữ liệu, luồng định giá khi đặt lịch, cùng báo giá/xác nhận khi dời lịch. Mọi đường ghi cần kiểm tra quyền, dữ liệu thật và phiên bản; giao diện/agent phải chờ nút **Xác nhận thay đổi giá** trước khi ghi lịch mới.
