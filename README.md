# VELVETHOUR · Serenity Spa & Wellness

**Đồ án cuối kỳ môn Lập trình Web** — ứng dụng giới thiệu dịch vụ spa, massage trị liệu và đặt lịch trực tuyến. Hệ thống có giao diện cho khách hàng, cổng làm việc của nhân viên và trang quản trị dành cho người vận hành spa.

- [Tính năng theo vai trò](#tính-năng-theo-vai-trò)
- [Chạy trên máy cá nhân](#chạy-trên-máy-cá-nhân)
- [Đặt lịch và thanh toán](#đặt-lịch-và-thanh-toán)
- [Kiến trúc và cấu trúc mã nguồn](#kiến-trúc-và-cấu-trúc-mã-nguồn)
- [Kiểm thử](#kiểm-thử)
- [Triển khai và dữ liệu](#triển-khai-và-dữ-liệu)
- [Tài liệu dự án](#tài-liệu-dự-án)

## Tính năng theo vai trò

| Vai trò | Các thao tác chính |
| --- | --- |
| Khách hàng | Xem và lọc liệu trình, gói trị liệu và ưu đãi. Đăng ký, đăng nhập, cập nhật hồ sơ, chọn dịch vụ và khung giờ, thanh toán qua QR, xem, dời hoặc hủy lịch theo chính sách. Có thể hỏi chatbot về dịch vụ và cách đặt lịch. |
| Nhân viên | Xem các lịch được phân công, xác nhận lịch, gửi yêu cầu từ chối có lý do và cập nhật tiến độ trong phạm vi quyền được cấp. Gửi yêu cầu nghỉ một ngày hoặc theo khoảng ngày. |
| Quản trị viên | Quản lý lịch hẹn, dịch vụ, gói, nhân viên, ca làm và nội dung website. Mời nhân viên, xử lý yêu cầu từ chối lịch, duyệt nghỉ, quản lý voucher và sale lễ, đối soát chuyển khoản và ghi nhận hoàn tiền. |
| Quản trị viên · Thống kê | Xem số lịch và lượt khách đã phục vụ theo tháng, các dịch vụ được sử dụng, số tiền đã thu, đã hoàn và dòng tiền ròng. Các chỉ số phục vụ và dòng tiền được tính theo mốc thời gian tương ứng trong múi giờ Việt Nam. |

Yêu cầu nghỉ theo khoảng ngày bao gồm cả ngày bắt đầu và ngày kết thúc. Quản trị viên xử lý ở **Quản trị → Lịch hẹn → Yêu cầu nghỉ riêng**. Hệ thống kiểm tra các lịch xung đột khi duyệt yêu cầu.

### Các đường dẫn chính

| Đường dẫn | Màn hình |
| --- | --- |
| `/`, `/dich-vu`, `/lieu-trinh` | Trang chủ và danh mục dịch vụ |
| `/dat-lich` | Chọn dịch vụ, thời lượng, ngày giờ, chuyên viên và thanh toán |
| `/lich-cua-toi`, `/tai-khoan` | Lịch hẹn và tài khoản của khách |
| `/dang-nhap`, `/dang-ky`, `/quen-mat-khau` | Đăng nhập, đăng ký và đặt lại mật khẩu |
| `/nhan-vien`, `/moi-nhan-vien` | Cổng nhân viên và tiếp nhận lời mời |
| `/admin` | Trang quản trị |

## Chạy trên máy cá nhân

### 1. Chuẩn bị và khởi động

Cài **Git** và **Node.js 24.x**. Phiên bản Node được ghim trong [`.node-version`](.node-version). npm đi kèm Node và dùng `package-lock.json` để cài đúng phiên bản phụ thuộc.

```sh
git clone https://github.com/Deus-Tinh/VELVETHOUR.git
cd VELVETHOUR
npm ci
npm start
```

Mở [http://localhost:3001](http://localhost:3001). Máy chủ Node.js phục vụ cả trang web và API. Lần chạy đầu tạo cơ sở dữ liệu SQLite tại `server/data/serenity.sqlite` nếu môi trường chưa cấu hình `DATABASE_URL`. Thư mục dữ liệu được Git bỏ qua.

Có thể kiểm tra kết nối cơ sở dữ liệu qua [`GET /api/health`](http://localhost:3001/api/health). Khi chạy bằng SQLite, kết quả có `ok: true` và `database: "sqlite"`.

### 2. Thiết lập môi trường local

Sao chép [`.env.example`](.env.example) sang `.env` khi cần thay đổi cấu hình. Trong PowerShell dùng `Copy-Item .env.example .env`, trên Bash dùng `cp .env.example .env`. Lệnh `npm start` đọc `.env` nếu tệp tồn tại.

| Biến môi trường | Mục đích |
| --- | --- |
| `PORT`, `SERENITY_HOST` | Cổng mặc định `3001`. Dùng `SERENITY_HOST=127.0.0.1` để giới hạn truy cập trên máy đang phát triển. |
| `SERENITY_DATA_DIR`, `SERENITY_DB_PATH`, `SERENITY_BACKUP_DIR` | Đường dẫn dữ liệu local, tệp SQLite và thư mục sao lưu SQLite. |
| `DATABASE_URL` | Chọn PostgreSQL bằng chuỗi kết nối. Để trống khi chạy SQLite local. |
| `SERENITY_SEED_DEMO_DATA` | Bật dữ liệu mẫu bổ sung khi khởi tạo cơ sở dữ liệu local mới. |
| `SERENITY_TEST_ADMIN_PASSWORD`, `SERENITY_TEST_STAFF_PASSWORD` | Đặt mật khẩu cho tài khoản quản trị và nhân viên local trước khi khởi tạo cơ sở dữ liệu. Dùng mật khẩu riêng cho môi trường phát triển. |
| `VIETQR_DIRECT_ENABLED`, `SEPAY_ENABLED`, `SEPAY_BANK_NAME`, `SEPAY_ACCOUNT_NUMBER`, `SEPAY_ACCOUNT_HOLDER`, `SEPAY_WEBHOOK_API_KEY` | Chọn chế độ thanh toán, cấu hình thông tin ngân hàng và xác thực webhook. |
| `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` | Cấu hình AI phía máy chủ. Với Gemini có thể dùng `GEMINI_API_KEY`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Gửi email OTP đặt lại mật khẩu. |

Khách hàng có thể tự đăng ký ở `/dang-ky`. Để thử luồng quản trị, đặt `SERENITY_TEST_ADMIN_PASSWORD` trong `.env` **trước lần khởi tạo SQLite đầu tiên**, rồi đăng nhập bằng `admin@example.invalid` tại `/dang-nhap`. Tài khoản này dành cho phát triển local. Tạo môi trường dữ liệu riêng nếu cần thử lại từ đầu với thông tin mới.

Nếu dùng tệp mẫu, biến `VIETQR_DIRECT_ENABLED` được bật sẵn nhưng thông tin tài khoản còn trống. Có thể xem chính xác chế độ API đang cung cấp tại [`GET /api/payment/config`](http://localhost:3001/api/payment/config). Dùng bộ kiểm thử tự động để thử các tình huống thanh toán bằng dữ liệu giả lập.

## Đặt lịch và thanh toán

1. Khách chọn **liệu trình** hoặc **gói trị liệu** và chọn mức thời lượng. Gói có giá và thời lượng được cấu hình riêng, đặt một chuyên viên cho toàn bộ buổi.
2. Hệ thống kiểm tra ca làm, ngày nghỉ, khả năng thực hiện dịch vụ, lịch của chuyên viên, thời lượng và phòng còn trống.
3. API tính giá dựa trên dịch vụ, ngày sử dụng và ưu đãi hợp lệ. Sale lễ áp dụng theo ngày sử dụng dịch vụ. Khi nhiều sale cùng áp dụng, hệ thống chọn sale có lợi nhất. Voucher hợp lệ được tính thêm theo quy tắc định giá.
4. Đơn chờ thanh toán giữ chuyên viên và phòng trong **180 giây** ban đầu. QR mang số tiền và nội dung chuyển khoản tương ứng với đơn.
5. Khách theo dõi trạng thái trong **Lịch của tôi**. Khi dời lịch, hệ thống báo lại giá và phần chênh lệch trước khi xác nhận. Hủy lịch đã thanh toán có thể tạo yêu cầu hoàn **50% số tiền thực nhận** theo chính sách. Quản trị viên xử lý chuyển khoản hoàn tiền và cập nhật trạng thái.

| Chế độ | Điều kiện và cách xác nhận |
| --- | --- |
| VietQR duyệt thủ công | Bật `VIETQR_DIRECT_ENABLED` và điền thông tin tài khoản. Sau khi chuyển khoản, khách bấm báo đã chuyển. Đơn chuyển sang chờ đối soát và thời hạn chờ được kéo dài 24 giờ kể từ lúc báo. Quản trị viên kiểm tra giao dịch ngân hàng rồi xác nhận. |
| SePay tự động | Bật `SEPAY_ENABLED`, điền thông tin tài khoản và khóa webhook. API xác thực webhook tại `POST /api/payments/sepay/webhook`, đối chiếu tài khoản nhận, mã đơn, số tiền và thời hạn giữ chỗ. Các giao dịch lệch thông tin hoặc đến muộn được đưa vào quy trình đối soát. |
| Chưa cấu hình | Khách có thể duyệt danh mục và xem khung giờ. Để hoàn tất luồng đặt lịch trả trước, máy chủ cần có cấu hình thanh toán hợp lệ. |

Khi cả hai chế độ đều được cấu hình đầy đủ, SePay được ưu tiên. Thanh toán bằng thẻ hiện chưa mở.

### Chatbot và Agent Spa

Chatbot công khai hỗ trợ tra cứu dịch vụ, gợi ý liệu trình và hướng dẫn đặt lịch. Phản hồi theo quy tắc vẫn hoạt động khi chưa cấu hình khóa AI.

**Quản trị → Agent Spa** cung cấp các công cụ tìm lịch, tạo lịch, cập nhật trạng thái và quản lý sale lễ. Với thao tác dời lịch, agent chuẩn bị báo giá và người dùng xác nhận thay đổi trước khi lưu. Quản trị viên cũng có thể tạo và sửa sale trực tiếp trong tab **Khuyến mãi**. [Tài liệu chatbot](docs/ai-chatbot/README.md) · [Luồng sale lễ](docs/HOLIDAY_SALE_INTEGRATION_REPORT.md) · [Lịch sử Agent Spa](docs/ADMIN_AGENT_HISTORY.md)

## Kiến trúc và cấu trúc mã nguồn

Frontend dùng **HTML, CSS và JavaScript ES Modules**. Trình duyệt gọi API cùng origin. Backend là máy chủ HTTP **Node.js**, quản lý phiên qua cookie `HttpOnly`, kiểm tra quyền và xử lý các thay đổi về lịch, giá, thanh toán và dữ liệu quản trị. SQLite dùng `node:sqlite`. PostgreSQL dùng thư viện `pg` và migration có phiên bản. Giao diện sử dụng định dạng tiếng Việt, VND và múi giờ `Asia/Ho_Chi_Minh`.

```text
VELVETHOUR/
├── index.html               Trang vào của ứng dụng web
├── assets/
│   ├── css/                 Giao diện và kiểu hiển thị
│   ├── images/              Ảnh dịch vụ và nội dung
│   └── js/
│       ├── core/             Router, store và kiểm tra đầu vào
│       ├── domain/           Mô hình danh mục, sale và tính giá
│       ├── pages/            Màn hình khách, nhân viên và quản trị
│       ├── services/         Gọi API và điều phối nghiệp vụ phía trình duyệt
│       └── ui/               Thành phần giao diện dùng chung
├── server/
│   ├── server.js            HTTP API và máy chủ chạy local
│   ├── db/migrations/       Lược đồ và migration PostgreSQL
│   └── *.js                 Truy cập dữ liệu, lịch, giá, thanh toán và AI
├── api/                     Proxy API cho Vercel
├── functions/               Proxy API cho Cloudflare Pages
├── scripts/                 Đóng gói Pages, sao lưu và chuyển dữ liệu
├── tests/                   Kiểm thử nghiệp vụ, API và PostgreSQL
├── docs/                    Đặc tả, báo cáo và hướng dẫn vận hành
└── .github/workflows/       Kiểm thử tự động trên GitHub Actions
```

### API thường dùng

| Endpoint | Mục đích |
| --- | --- |
| `GET /api/health`, `GET /api/ready` | Kiểm tra cơ sở dữ liệu đang dùng. Trả HTTP 503 khi kiểm tra kết nối thất bại. |
| `GET /api/services`, `POST /api/pricing/quote` | Lấy danh mục và tính báo giá. |
| `POST /api/auth/login`, `GET /api/auth/session` | Đăng nhập và đọc phiên hiện tại. |
| `GET /api/bookings`, `POST /api/bookings` | Xem lịch theo phạm vi quyền và gửi yêu cầu đặt lịch. |
| `POST /api/bookings/:id/reschedule/quote`, `POST /api/bookings/:id/reschedule/confirm` | Báo giá và xác nhận dời lịch. |
| `GET /api/payment/config`, `POST /api/payments/sepay/webhook` | Đọc cấu hình thanh toán công khai và tiếp nhận thông báo giao dịch từ SePay. |
| `POST /api/staff/day-off-requests`, `GET /api/admin/staff-day-off-requests` | Gửi và xem yêu cầu nghỉ của nhân viên theo vai trò. |
| `GET /api/admin/analytics/monthly` | Đọc thống kê tháng bằng quyền quản trị. |

## Kiểm thử

Cài phụ thuộc bằng `npm ci` trước khi chạy. Các bài kiểm thử API thiết lập dữ liệu tạm và cấu hình thanh toán giả lập.

| Lệnh | Phạm vi |
| --- | --- |
| `npm test` | Chạy cả `test:unit` và `test:api`. |
| `npm run test:unit` | Kiểm thử quy tắc nghiệp vụ và giao diện thống kê tháng. |
| `npm run test:api` | Kiểm thử API, xác thực, lịch hẹn, thanh toán, khuyến mãi, nội dung, chatbot và proxy. |
| `npm run test:postgres` | Kiểm thử adapter PostgreSQL và tích hợp ghi đọc, khởi động lại, nhập dữ liệu, lịch nhân viên và thống kê. |

Bộ tích hợp PostgreSQL cần biến `PG_TEST_DATABASE_URL` trỏ tới **PostgreSQL local dành riêng cho kiểm thử**. Host phải là loopback, tên database phải chứa `test`, và tài khoản cần quyền tạo và xóa các database tạm mà suite tạo ra. Đặt biến trong môi trường shell trước khi chạy. GitHub Actions khởi tạo PostgreSQL 18 và chạy cả ba nhóm trên. [Cấu hình CI](.github/workflows/test.yml)

## Triển khai và dữ liệu

Cấu hình trong repo tách frontend **Vercel** và backend **Render**. Trình duyệt gọi `/api/*` trên domain frontend, rồi proxy chuyển tiếp tới backend. Ở production, các bên dùng cùng giá trị `SERENITY_PROXY_TOKEN`.

1. Chuẩn bị PostgreSQL cho backend và đặt `DATABASE_URL` trong Render. `render.yaml` dùng `npm ci` để cài phụ thuộc, `npm start` để chạy API và `/api/health` để kiểm tra sức khỏe. Backend áp dụng migration PostgreSQL khi khởi động.
2. Với cơ sở dữ liệu production chưa có quản trị viên hoạt động, cấu hình `SERENITY_INITIAL_ADMIN_EMAIL` và `SERENITY_INITIAL_ADMIN_PASSWORD` trong Render. Có thể đặt thêm `SERENITY_INITIAL_ADMIN_NAME`. Sau khi tài khoản được tạo thành công, có thể gỡ các giá trị khởi tạo.
3. Đặt `SERENITY_API_ORIGIN` ở Vercel thành URL HTTPS của Render và đặt `SERENITY_PROXY_TOKEN` khớp với backend. `vercel.json` khai báo các đường dẫn SPA và rewrite `/api/*`. Nếu dùng Cloudflare Pages, lệnh `npm run build:pages` tạo nội dung tĩnh trong `dist/` và proxy được định nghĩa ở `functions/`.
4. Sau khi triển khai, kiểm tra `/api/health` trả về `database: "postgres"`, đăng nhập qua domain frontend và thử các luồng cần kiểm chứng trong môi trường phù hợp. Khi dùng SePay, cấu hình webhook HTTPS và khóa tại máy chủ và trong trang quản lý SePay.

### Sao lưu và chuyển dữ liệu

| Công việc | Lệnh hoặc công cụ |
| --- | --- |
| Kiểm tra SQLite hiện tại | `npm run db:check` |
| Tạo bản sao lưu SQLite | `npm run db:backup` |
| Kiểm tra bản sao lưu SQLite | `npm run db:verify-backup -- "<đường-dẫn-tuyệt-đối>"` |
| Chạy migration PostgreSQL thủ công | `npm run db:postgres:migrate` |
| Chuyển SQLite sang PostgreSQL | `npm run db:postgres:import-sqlite -- "<đường-dẫn-bản-sao-lưu-SQLite>"` |
| Sao lưu và diễn tập khôi phục PostgreSQL | Dùng `pg_dump` và `pg_restore` trên môi trường phù hợp, hoặc dùng khả năng sao lưu của dịch vụ PostgreSQL đang vận hành. |

Hai lệnh CLI PostgreSQL đọc `DATABASE_URL` từ môi trường shell. Khi chuyển dữ liệu, kiểm tra bản sao lưu trước và dùng PostgreSQL đích trống. Importer dùng giao dịch cơ sở dữ liệu, từ chối đích đã có dữ liệu ứng dụng và bỏ qua dữ liệu phiên đăng nhập và OTP đặt lại mật khẩu. [Hướng dẫn migration, backup và rollback](docs/render-postgres-guide.md)

## Tài liệu dự án

| Chủ đề | Tài liệu |
| --- | --- |
| Thuật ngữ và quy tắc đặt lịch | [Mô hình nghiệp vụ](CONTEXT.md) · [Quy tắc nghiệp vụ](docs/BUSINESS_RULES.md) |
| Định giá và thanh toán | [Thiết kế giá sale lễ](docs/HOLIDAY_SALE_PRICING_DESIGN.md) · [Quyết định tích hợp SePay](docs/adr/0001-sepay-qr-prepayment.md) |
| Tích hợp và kiểm thử | [Ma trận kiểm thử nghiệp vụ](docs/BUSINESS_TEST_MATRIX.md) · [Kiểm thử tải local](docs/LOAD_TEST_LAB.md) |
| Phát triển và tài nguyên | [Quy ước nhánh Git](docs/GIT_BRANCH_CONVENTION.md) · [Nguồn tài nguyên hình ảnh](ASSET_CREDITS.md) |
