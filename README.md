# SERENITY SPA & WELLNESS — MASSAGE & TRỊ LIỆU 
> **Đồ án cuối kỳ môn Lập trình Web — Ứng dụng Đặt lịch Spa & Trị liệu Thư giãn**  
> *Website riêng Serenity Spa & Wellness — giới thiệu dịch vụ massage và hỗ trợ đặt lịch trực tuyến.*

---

## 1. GIỚI THIỆU DỰ ÁN
**SERENITY SPA & WELLNESS** là ứng dụng web đặt lịch spa, massage trị liệu và phục hồi sức khỏe tọa lạc tại Quận 1, TP. Hồ Chí Minh.
Giao diện dùng **Vanilla JavaScript (ES Modules), HTML5 và CSS3**. Chế độ local chạy máy chủ **Node.js 24+ tại cổng 3001** và lưu dữ liệu trong SQLite. Chuyển sang PostgreSQL cho production chưa hoàn tất; máy chủ hiện chủ động từ chối khởi động với `NODE_ENV=production` để tránh ghi dữ liệu vào ổ đĩa tạm của dịch vụ cloud.

---

## 2. CÔNG NGHỆ BẮT BUỘC
- **Ngôn ngữ & Nền tảng**: HTML5, CSS3 thuần, JavaScript ES6+ (ES Modules).
- **Vận hành chia sẻ**: Node.js HTTP API, SQLite trên máy chủ, phiên đăng nhập cookie `HttpOnly`, kiểm soát quyền ở API.
- **Lưu dữ liệu**: SQLite trên máy chủ; LocalStorage chỉ làm cache cho giao diện.
- **Trực quan hóa dữ liệu**: HTML5 Canvas API thuần (Biểu đồ doanh thu 7 ngày).
- **Định dạng & Tiền tệ**: Intl API (`vi-VN`, `VND`), Date API (`Asia/Ho_Chi_Minh`).
- **Điều hướng**: Hash Routing SPA (`#/`, `#/services`, `#/booking`, `#/my-bookings`, `#/staff`, `#/admin`...).

---

## 3. TÀI KHOẢN QUẢN TRỊ
Không có tài khoản/mật khẩu dùng chung trong source hoặc giao diện public. Môi trường production tạo tài khoản Admin đầu tiên bằng `SERENITY_INITIAL_ADMIN_EMAIL` và `SERENITY_INITIAL_ADMIN_PASSWORD` đã nhập trực tiếp trong Render Environment. Khi database đã có Admin, có thể xóa hai biến khởi tạo này khỏi dịch vụ.

---

## 4. HƯỚNG DẪN KHỞI CHẠY & KIỂM THỬ

### 4.1. Chạy chế độ dữ liệu dùng chung
Yêu cầu Node.js 24 trở lên. Máy chủ phục vụ cả giao diện và API tại cổng `3001`:
```bash
npm start
```
Mở **`http://localhost:3001/#/`**. SQLite được tạo tại `server/data/serenity.sqlite`; thư mục dữ liệu không được đưa vào Git. Máy chủ tạo bản sao lưu hằng ngày và có nút tải backup trong trang Quản trị. Ứng dụng không chạy chế độ lưu LocalStorage ngoại tuyến cho đặt lịch/thanh toán.

Để cho thiết bị khác trong cùng mạng truy cập, mở `http://<IP-máy-chạy-server>:3001/#/`. Máy chủ mặc định lắng nghe trên các giao diện mạng; cần dùng mạng tin cậy và HTTPS nếu đưa lên Internet.

Tài khoản demo không được tự động tạo ở production. Local/test có thể bật dữ liệu mẫu có kiểm soát bằng `SERENITY_SEED_DEMO_DATA=true`; mật khẩu test được tạo lúc chạy và không lưu trong source.

### 4.2. Chạy bộ kiểm thử tự động (Test Suite)
Bộ kiểm thử nghiệp vụ chạy qua `node tests/run-node.js`; Node/API test dùng bộ nhớ hoặc SQLite tạm để không đụng dữ liệu của người dùng:
- **Chạy qua Terminal (Node.js)**:  
  ```bash
  npm test
  ```
  Hoặc chạy trực tiếp bằng `node tests/run-node.js`. Ghi chú: một số test booking cũ vẫn mong muốn tạo lịch local khi API offline, trong khi luồng hiện tại yêu cầu backend thanh toán; kết quả `npm test` hiện còn các lỗi tương thích test này. Xem báo cáo triển khai trước khi dùng test suite làm cổng deploy.
- **Browser runner**: Mở `http://localhost:3001/tests/index.html`. Cần chạy máy chủ bằng `npm start`; trạng thái của lần audit gần nhất được ghi trong `docs/FINAL_TEST_REPORT.md`.

### 4.3. Agent quản lý lịch hẹn và sale lễ
Sau khi đăng nhập Admin, mở `#/admin` và chọn tab **Agent Spa**. Agent có công cụ tìm/xem/tạo lịch, cập nhật trạng thái và tạo/sửa/tắt sale lễ. Khi dời lịch, agent chỉ chuẩn bị báo giá; khách/admin phải bấm **Xác nhận thay đổi giá** để lưu. Agent auditor chỉ có quyền đọc. Biểu mẫu sale cũng có tại tab **Khuyến mãi** và không phụ thuộc AI.

Sale xét ngày sử dụng dịch vụ, chọn một sale có lợi nhất; voucher hợp lệ được cộng thêm trên giá niêm yết. Ví dụ: “Tạo sale giảm 15% toàn bộ dịch vụ cho ngày sử dụng 20/11/2026, tên Sale 20/11”. Xem [báo cáo tích hợp và giới hạn kiểm chứng Gemini thật](docs/HOLIDAY_SALE_INTEGRATION_REPORT.md).

Agent dùng cấu hình AI phía máy chủ trong `.env` (`AI_PROVIDER`, `AI_API_KEY` hoặc khóa theo provider, và `AI_MODEL`). `AI_AGENT_REQUEST_TIMEOUT` mặc định 30 giây cho mỗi vòng và `AI_AGENT_TIMEOUT` mặc định 60 giây cho cả yêu cầu. Số điện thoại và email được ẩn trước khi gửi nội dung đến AI; máy chủ giữ giá trị gốc trong bộ nhớ tối đa 10 phút để hoàn tất thao tác tạo lịch. Xem thêm [`docs/ai-chatbot/README.md`](docs/ai-chatbot/README.md).

### 4.4. Lab kiểm thử tải và bảo vệ HTTP

API mặc định giới hạn 30 yêu cầu/IP trong cửa sổ trượt 1 giây; vượt mức trả HTTP 429 kèm `Retry-After`. Có thể cấu hình `SERENITY_API_RATE_LIMIT` trong `.env`. Máy chủ dùng timeout nhận header 10 giây, nhận request 30 giây và chỉ phục vụ các đường dẫn giao diện được cho phép. Xem [hướng dẫn, số liệu trước/sau và giới hạn kết luận](docs/LOAD_TEST_LAB.md). Script `tools/load-lab.ps1` chỉ chạy trên localhost, tối đa 200 kết nối, 1.000 QPS và 30 giây mỗi lượt.

### 4.5. Thanh toán QR giữ lịch

Đơn đặt trước giữ nhân viên/phòng tối đa 180 giây. Hệ thống tạo QR VietQR động chứa tài khoản Techcombank, tổng giá phải trả và một mã riêng của đơn. Chỉ webhook SePay đã xác thực, đúng tài khoản, đúng mã, đúng số tiền và trong thời hạn mới xác nhận lịch. Thanh toán thẻ đang khóa; hoàn tiền không tự động.

Nghiệp vụ hiện có giữ lịch 180 giây, sinh mã riêng theo đơn, chỉ xác nhận sau khi webhook SePay xác thực nhận đủ tiền; thanh toán thẻ vẫn khóa. Khách bị cảnh báo rõ khi chuyển sai/thiếu mã; hủy sau thanh toán tạo yêu cầu hoàn 50% số tiền thực nhận, còn dời lịch tính phần chênh lệch theo báo giá. **Không bật `SEPAY_ENABLED` hoặc nhận tiền thật từ bản cloud trong trạng thái hiện tại.** Xem trạng thái, các rủi ro và điều kiện mở khóa trong [hướng dẫn triển khai miễn phí](docs/DEPLOYMENT_FREE.md).

---

## 5. HỆ THỐNG TÀI LIỆU DỰ ÁN
Tất cả các tài liệu kiến trúc và kiểm thử chi tiết được lưu trong thư mục `docs/`:
- [`docs/INTEGRATION_AUDIT.md`](docs/INTEGRATION_AUDIT.md): Báo cáo audit tích hợp hệ thống.
- [`docs/UI_EVENT_MAPPING.md`](docs/UI_EVENT_MAPPING.md): Bản đồ liên kết UI Element → Event → Service → LocalStorage.
- [`docs/DATA_FLOW.md`](docs/DATA_FLOW.md): Kiến trúc luồng dữ liệu thống nhất (Single Source of Truth).
- [`docs/BUSINESS_RULES.md`](docs/BUSINESS_RULES.md): Đặc tả chi tiết các quy tắc nghiệp vụ cốt lõi.
- [`docs/BUSINESS_TEST_MATRIX.md`](docs/BUSINESS_TEST_MATRIX.md): Ma trận phạm vi kiểm thử và trạng thái thực chạy.
- [`docs/BUG_REPORT.md`](docs/BUG_REPORT.md): Lỗi tìm thấy, nguyên nhân và bản sửa.
- [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md): Kết quả 55 business tests qua Node.js.
- [`docs/FINAL_TEST_REPORT.md`](docs/FINAL_TEST_REPORT.md): Đánh giá cuối, bao gồm giới hạn browser/E2E.
- [`docs/FINAL_CHECKLIST.md`](docs/FINAL_CHECKLIST.md): Checklist với các mục đã xác minh và chưa thể xác minh.
