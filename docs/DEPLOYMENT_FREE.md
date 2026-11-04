# Serenity Spa — chuẩn bị triển khai miễn phí

Ngày rà soát: 29/10/2026. Phạm vi: kiểm tra và chuẩn bị mã nguồn local; không tạo dịch vụ cloud, không tạo repository, không kết nối database, không commit/push và không triển khai.

## Trạng thái

**Chưa an toàn để tạo dịch vụ Render hoặc nhận thanh toán thật.** Backend hiện dùng `node:sqlite` đồng bộ và chưa có driver/schema PostgreSQL. `DATABASE_URL` chưa được sử dụng. Để tránh website chạy nhầm trên SQLite tạm của Render, `server/server.js` hiện dừng production startup rõ ràng ngay cả khi `DATABASE_URL` đã được khai báo. Gỡ bỏ guard này chỉ được thực hiện sau khi PostgreSQL adapter, migration dữ liệu và kiểm thử trên PostgreSQL đạt.

Workspace hiện không có `.git`, remote GitHub hay lockfile gốc. Lockfile không phụ thuộc nào vừa được tạo để `npm ci` có thể cài project hiện tại; nó **chưa** bao gồm driver PostgreSQL. File `.env` local tồn tại nhưng không được mở/đọc; đã được `.gitignore` loại trừ cùng với `.env.*`, SQLite và backup. Không chạy `git add .` trước khi kiểm tra danh sách staged files.

## Kiến trúc đã xác nhận trong source

| Thành phần | Thực tế hiện tại | Việc còn thiếu |
| --- | --- | --- |
| Frontend | HTML, CSS, Vanilla JS ES Modules, hash router; gọi `/api` cùng origin | Build đã giới hạn trong `index.html`, `assets/`, `_routes.json`; cần chạy qua Pages preview khi có cấu hình |
| API | Một Node HTTP server, Node 24, dùng `node:sqlite`/`DatabaseSync` | Chuyển tất cả truy vấn và transaction sang API PostgreSQL bất đồng bộ, có pool/timeouts/shutdown |
| Database | SQLite local; có file DB, WAL/SHM trong `server/data/` | Chưa backup/migrate dữ liệu; phải tạo snapshot nhất quán và đối chiếu trên DB thử nghiệm riêng |
| Upload ảnh | Ảnh package/therapy lưu dạng BLOB trong các bảng SQLite; không dựa vào upload filesystem | Giữ dữ liệu BLOB khi chuyển schema; kiểm tra tải lên/tải xuống và giới hạn storage sau chuyển |
| Phiên đăng nhập | Cookie HttpOnly/SameSite; session hash trong DB | Chuyển session table và kiểm tra cookie khi qua cùng-origin proxy |
| GitHub | Thư mục hiện không phải Git checkout | Người dùng phải tạo/import repository sau khi các cổng kiểm thử đạt |

Phạm vi SQLite gồm 22 lệnh `CREATE TABLE` (một số lặp do migration), 17 lệnh `CREATE INDEX`, và 116 vị trí `.prepare()` trong backend. Module truy cập DB trực tiếp gồm `server/server.js`, `paymentOperations.js`, `pricingDatabase.js`, `siteContentDatabase.js`, `siteContentOperations.js`, `holidaySaleOperations.js`, và `adminAgentHistory.js`.

Các khác biệt cần xử lý trong migration: tham số `?`, `rowid`, `PRAGMA`, `BEGIN IMMEDIATE`, `INSERT OR IGNORE`, giá trị `.changes`, `VACUUM INTO`, `GLOB`, `json_valid/json_type/json_set`, cột `AUTOINCREMENT`, BLOB và CHECK/FK constraints. `node-postgres` dùng Promise và yêu cầu mọi câu lệnh trong một transaction chạy trên cùng một client; vì vậy không được thay `DatabaseSync` bằng wrapper giả đồng bộ hoặc chỉ đổi connection string.

## Các thay đổi đã chuẩn bị

- Xóa quick-login demo và mật khẩu mẫu khỏi giao diện public/seed. Dữ liệu demo chỉ được tạo local/test khi bật cờ tường minh; production không seed tài khoản demo.
- Thêm tạo Admin production một lần qua biến môi trường; không log mật khẩu hoặc hash.
- Thêm cổng production fail-closed để chưa thể dùng SQLite local làm database production.
- Thêm `.env.example`, `.node-version`, `package-lock.json`, `.gitignore`, `render.yaml`, Pages build script, `_routes.json`, Pages proxy function.
- Pages proxy chỉ nhận origin OnWeeny HTTPS được chỉ định, kiểm tra same-origin, giữ method/query/body/cookie/Set-Cookie, thêm proxy token ở phía server và không công khai token cho JavaScript.
- IP giới hạn tốc độ từ Cloudflare được chuyển bằng header riêng; backend chỉ tin header đó khi proxy token hợp lệ và IP đúng định dạng.
- Test SePay dùng thông tin giả trong tiến trình test; không gọi ngân hàng, không gọi SePay thật.
- Sửa nội dung chatbot test về giảm giá cộng dồn trên giá niêm yết theo nghiệp vụ đã chốt. Sửa trạng thái giao diện dời lịch để không báo thất bại/cho bấm xác nhận lần nữa sau khi server đã lưu thành công.

## Cổng bảo toàn dữ liệu

Không đọc nội dung SQLite thật, không ghi hoặc reset các database local, không tạo backup mới trong bước này. Tên file SQLite, WAL và SHM hiện diện trong `server/data/`; phải giữ nguyên cả thư mục này.

Trước khi chuyển dữ liệu, cần chạy một công cụ offline/readonly theo trình tự:

1. Dừng ứng dụng đang ghi SQLite hoặc dùng SQLite online backup API để tạo snapshot giao dịch nhất quán; không sao chép riêng file `.sqlite` khi có WAL.
2. Tạo thêm bản backup độc lập không đổi tên/ghi đè source; ghi checksum và kích thước, bảo vệ file chứa dữ liệu khách hàng.
3. Nạp snapshot vào database/branch Neon thử nghiệm mới, không dùng production.
4. So sánh bảng, số dòng, IDs, mã đơn/mã thanh toán, lịch hẹn, trạng thái, thanh toán/hoàn, session, audit, nội dung website, chatbot và tổng byte ảnh.
5. Chạy integrity/FK checks và nghiệp vụ booking/payment trên DB thử nghiệm.
6. Chỉ sau báo cáo đối chiếu mới cho phép người dùng tự cấu hình production. Giữ SQLite và backup gốc cho rollback; không xóa tự động.

Hiện chưa có schema PostgreSQL, migration executable, công cụ so sánh dữ liệu hay kết quả đối chiếu. Đây là blocker chính, không phải thao tác người dùng có thể bỏ qua bằng cách chỉ dán `DATABASE_URL`.

## Cấu hình sau khi blocker đã được gỡ

### GitHub

Sau khi hoàn tất chuyển DB và kiểm thử, tạo private repository nếu chưa muốn công khai source. Trước khi push, kiểm tra `.env`, `server/data`, backup, ảnh/dữ liệu khách hàng, log và lịch sử Git; chỉ thêm code/docs/config cần thiết. Repository phải có `package-lock.json` đồng bộ với `package.json`.

### Neon PostgreSQL

Tạo project/branch phát triển riêng, dùng connection string dạng pooled cho web service, lưu `DATABASE_URL` trong Render Environment. Không đặt connection string trong Pages build variables, browser code, docs hoặc GitHub. Neon Free có quota/giới hạn compute, storage và lịch sử khôi phục; kiểm tra lại dashboard trước khi tạo project và duy trì thêm bản backup ngoài Neon. Tham khảo [Neon Free plan](https://neon.com/pricing) và [connection pooling](https://neon.com/docs/connect/connection-pooling).

### Render Web Service

Khi PostgreSQL adapter đã có, kết nối repository và dùng blueprint `render.yaml`:

- Build: `npm ci`
- Start: `npm start`
- Health path: `/api/health`
- Node: `24.22.1` (được đặt trong `.node-version` và blueprint)
- Free web service không có filesystem bền vững; không được lưu SQLite hoặc upload file vào filesystem.
- Biến bí mật cấu hình tại Render Environment, không lưu vào YAML/Git.

Render Free có thể ngủ sau 15 phút không có request và cold start khoảng một phút; filesystem bị mất khi restart, sleep hoặc redeploy. Điều này làm request đầu chậm và cần tính khi nhận webhook, nhưng mã giữ chỗ 180 giây được tạo sau khi API thức dậy. Chưa có phép thử webhook với Render/SePay thật nên chưa thể cam kết thời gian giao nhận. Xem [giới hạn Render Free](https://render.com/docs/free) và [cách pin Node](https://render.com/docs/node-version).

### Cloudflare Pages

Hướng dẫn cấu hình hiện tại nằm ở [CLOUDFLARE_PAGES_ONWEENY.md](./CLOUDFLARE_PAGES_ONWEENY.md). Mô hình dùng Pages cho giao diện và proxy `/api/*` đến backend đang chạy trên OnWeeny; không chuyển Node.js hoặc SQLite sang Workers.

- Build command: `npm run build:pages`; output directory: `dist`.
- Pages variable: `SERENITY_API_ORIGIN=https://serenityspa-37e2.onweeny.com`.
- Pages secret: `SERENITY_PROXY_TOKEN`, phải trùng với secret trên backend OnWeeny và dài tối thiểu 32 ký tự.
- Chỉ `/api` và `/api/*` chạy Pages Function theo `_routes.json`; frontend assets được phục vụ tĩnh.
- Không đặt database URL, SePay key hay Gemini key trong Pages.

Pages Functions dùng Workers Free quota; hiện tại tài liệu Cloudflare nêu 100.000 request/ngày và 10 ms CPU/request. Chỉ API đi qua Function tính vào quota; assets tĩnh vẫn được Pages phục vụ. Theo dõi usage/429. Xem [Pages routing](https://developers.cloudflare.com/pages/functions/routing/), [bindings/secrets](https://developers.cloudflare.com/pages/functions/bindings/) và [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

### Danh sách biến môi trường

**Render:** `NODE_ENV`, `NODE_VERSION`, `PORT` (Render cấp), `DATABASE_URL`, `SERENITY_PROXY_TOKEN`, `SERENITY_INITIAL_ADMIN_EMAIL`, `SERENITY_INITIAL_ADMIN_PASSWORD`, `SERENITY_INITIAL_ADMIN_NAME`, `SERENITY_API_RATE_LIMIT`, `AI_PROVIDER`, `GEMINI_API_KEY`, `AI_MODEL`, `AI_FALLBACK_MODEL`, `AI_AGENT_REQUEST_TIMEOUT`, `AI_AGENT_TIMEOUT`, `SEPAY_ENABLED=false`.

**Cloudflare Pages Function:** `SERENITY_API_ORIGIN`, secret `SERENITY_PROXY_TOKEN`.

Không cần điền `SEPAY_ACCOUNT_NUMBER`, `SEPAY_ACCOUNT_HOLDER`, `SEPAY_WEBHOOK_API_KEY` hoặc bật SePay trong giai đoạn thử triển khai. Chỉ cấu hình các biến đó sau khi người dùng cho phép và xác minh webhook/đối soát trên môi trường an toàn.

## Kiểm thử và giới hạn xác minh

| Hạng mục | Trạng thái hiện tại |
| --- | --- |
| Node local | Chạy Node `v24.16.0`; target Render pin `24.22.1` nhưng chưa có môi trường Linux để chạy |
| Pages build | Đã chạy `node scripts/build-pages.mjs`; output chỉ có `index.html`, `assets/`, `_routes.json` |
| Pages proxy | Unit test mock chạy được; chưa deploy/preview trên Cloudflare |
| Production guard | Unit test xác nhận production từ chối thiếu `DATABASE_URL` và từ chối fallback SQLite trước khi tạo DB |
| API/Node suite | `npm run test:api`: **128/128 PASS**, dùng SQLite tạm và giá trị SePay giả; không đụng database nghiệp vụ và không gọi dịch vụ thanh toán thật |
| Business suite cũ | `npm run test:unit`: **51/62 PASS, 11 FAIL**. Các lỗi nằm ở test cũ kỳ vọng tạo/đổi/hủy booking local khi API offline; luồng hiện tại bắt buộc backend cho đặt lịch/thanh toán. `npm test` dừng ở đây nên chưa chạy phần API; chạy `npm run test:api` riêng đã đạt |
| PostgreSQL connect/schema/migrate | BLOCKED — chưa có driver, local PostgreSQL, Docker daemon hay database thử nghiệm |
| GitHub / Render / Neon / Cloudflare | Chưa tạo kết nối hoặc dịch vụ |
| SePay thật / email thật | Chưa gọi; `SEPAY_ENABLED` production không được bật |
| E2E production / restart persistence | BLOCKED — chưa có môi trường triển khai và database PostgreSQL |

Không tuyên bố hệ thống sẵn sàng nhận tiền thật cho tới khi các mục PostgreSQL, migration, webhook retries, booking/payment và restart persistence đều đạt.
