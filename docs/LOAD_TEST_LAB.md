# Lab tải HTTP và giới hạn API — VELVETHOUR

Thực hiện ngày **22/10/2026**, khoảng 08:41–08:45 (Asia/Ho_Chi_Minh). Kết quả là phép đo HTTP cục bộ trước/sau bản vá, không phải chứng nhận chống DDoS.

## Target và phương pháp

- Stack thực tế: Node.js **v24.16.0**, `node:http`, SQLite, giao diện HTML/CSS/JavaScript thuần. Không có Vite/React hay `vite.config.js` trong dự án.
- Target cố định: **127.0.0.1:3001**; PID trước vá **20588**, sau vá **20236**. PID sẽ thay đổi khi khởi động lại.
- `GET /`: đối chứng phục vụ tệp HTML. Fragment `#/` không được gửi lên máy chủ.
- `GET /api/services`: API thật đọc SQLite, chuẩn hóa/lọc danh mục và tính thông tin giá. Không cần thêm endpoint giả lập `sleep`, không cần đổi sang Express.
- Tool: **oha v1.16.0**, binary Windows amd64 từ [bản phát hành chính thức](https://github.com/hatoo/oha/releases/tag/v1.16.0). SHA-256 đã đối chiếu với digest của GitHub release: `d692d392e958e7e8e1b16810287e74a835a62255b079ba2766a4b3b04499f267`.
- Mỗi lượt phát tải **30 giây**, tối đa **200 kết nối**, trần tổng **1.000 QPS**, timeout yêu cầu **5 giây**, chờ yêu cầu đang chạy hoàn thành, không theo redirect. Mỗi lượt hoàn thành trên 20.000 yêu cầu. Cùng tham số cho before và after.
- PowerShell lấy CPU/RAM và kết nối TCP ngay trong lúc oha chạy. Máy có **16 bộ xử lý logic**; số mẫu thực tế là 8–10 mỗi lượt vì truy vấn bảng TCP trên máy này mất thời gian. CPU dùng khoảng thời gian thực tế giữa các lần lấy mẫu, không giả định mỗi mẫu cách nhau đúng một giây.

Lệnh cho API, chạy nguyên vẹn ở cả hai phiên bản:

```powershell
.\.scratch\load-lab\oha-windows-amd64.exe --no-tui --output-format json -z 30s -w -c 200 -q 1000 -t 5s --redirect 0 http://127.0.0.1:3001/api/services
```

Đối chứng static dùng đúng các tham số trên, thay URL thành `http://127.0.0.1:3001/`. Theo [tài liệu oha](https://github.com/hatoo/oha#usage), `-q` là QPS tổng, không phải QPS trên mỗi worker.

## Số liệu trước/sau

| Lượt | Endpoint | HTTP/s tổng | HTTP 200/s | p95 ms | p99 ms | 429 % | Lỗi mạng + 5xx % | CPU máy % | CPU một lõi % | RAM đỉnh MB | Kết nối đỉnh |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| before | `/` | 998.00 | 998.00 | 15.66 | 33.67 | 0.00 | 0.00 | 3.62 | 57.90 | 127.77 | 206 |
| before | `/api/services` | 689.23 | 689.23 | 739.84 | 1932.73 | 0.00 | 0.00 | 5.09 | 81.49 | 162.64 | 201 |
| after | `/` | 999.35 | 999.35 | 3.36 | 4.85 | 0.00 | 0.00 | 1.78 | 28.51 | 138.11 | 200 |
| after | `/api/services` | 999.31 | 29.95 | 3.36 | 11.60 | 97.00 | 0.00 | 1.15 | 18.35 | 105.71 | 200 |

Nguồn: bốn JSON oha, CSV monitor và metadata trong [load-lab/](load-lab/), tổng hợp ở [summary.json](load-lab/summary.json). Thời lượng thực có thể dài hơn 30 giây một chút do chờ yêu cầu đang chạy hoàn thành.

**Cách đọc:**

- Trước vá, API động hoàn thành **20.965 HTTP 200**, không có lỗi mạng/5xx nhưng p99 lên **1,93 giây**. Vì vậy “0 lỗi” không đồng nghĩa khả năng đáp ứng tốt khi chịu tải.
- Sau vá, API trả **899 HTTP 200 + 29.100 HTTP 429**. Mức khoảng 30/s áp dụng cho yêu cầu được chấp nhận; tổng phản hồi vẫn gần 1.000/s vì máy chủ trả 429 nhanh.
- p95/p99 trong bảng tính trên **mọi phản hồi**, bao gồm 429. Đây không phải phân vị riêng của các yêu cầu HTTP 200. Không dùng con số này để khẳng định thuật toán danh mục đã chạy nhanh hơn.
- “Lỗi mạng + 5xx” loại riêng 429 để thấy lỗi vận hành. HTTP 429 vẫn là yêu cầu bị từ chối, không tính là nghiệp vụ thành công.
- CPU là trung bình có trọng số theo thời gian lấy mẫu. “CPU máy” chia cho 16 lõi logic; “CPU một lõi” giúp nhìn tải của tiến trình Node. RAM và kết nối là đỉnh **quan sát được tại các mẫu**. Tổng kết nối có thể vượt 200 vì có trình duyệt đang mở cùng ứng dụng.

## Nguyên nhân và bản vá

1. **Thiếu giới hạn chung trước API.** Bản cũ đã có giới hạn đăng nhập sai và chat, nhưng API danh mục vẫn xử lý mọi yêu cầu. Thêm cửa sổ trượt 1 giây, mặc định **30 yêu cầu/IP/giây**, dùng chung cho các API, áp dụng trước truy vấn nghiệp vụ. Trả `429`, `Retry-After`, `X-RateLimit-Limit` và `X-RateLimit-Remaining`. Dùng IP của kết nối TCP, không tin `X-Forwarded-For`; giới hạn số IP lưu trong bộ nhớ và dọn mục hết hạn. Tệp: [httpProtection.js](../server/httpProtection.js), [server.js](../server/server.js).
2. **Timeout mặc định còn dài.** Không đúng khi nói bản cũ “không có header timeout”: [Node HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html#serverheaderstimeout) mặc định chờ header đến 60 giây và toàn bộ request đến 300 giây. Bản vá đặt header **10 giây**, nhận request **30 giây**, kiểm tra mỗi **1 giây**, tối đa **1.000 kết nối**, **100 header**, tổng header **16 KiB**. Timeout nhận request không phải deadline xử lý câu trả lời AI.
3. **Phục vụ tệp nội bộ từ thư mục gốc.** Qua đọc mã nguồn, hàm static cũ có thể phục vụ `.env` và các tệp nội bộ không bị chặn. Bản vá chỉ cho phép `/index.html`, `/assets/…`, `/tests/…`, chặn dotfile, đường dẫn vượt thư mục và dấu phân cách Windows. Không cần đọc hay in nội dung `.env` để xác minh. Đường dẫn thư mục trả 404; Host không hợp lệ trả 400; lỗi đọc stream không thoát khỏi xử lý lỗi.

Không có `web_load_test.py` trong workspace nên chưa có bằng chứng xác minh nhận định “worker cap 5”. Phép đo này dùng oha với 200 kết nối tối đa theo cấu hình đã ghi nhận.

## Kiểm chứng

- `npm test`: **62/62 bài nghiệp vụ + 121/121 bài Node pass**, trong đó có **9 bài mới** cho giới hạn API và phục vụ tệp. Các suite nghiệp vụ dùng ngân sách lớn để không bị ảnh hưởng bởi việc gọi mock liên tiếp; suite bảo vệ HTTP đặt ngân sách thấp riêng và kiểm tra 429 thật qua handler. Không cần mạng hay cơ sở dữ liệu người dùng cho các test này.
- Kiểm tra header chậm: **4 kết nối TCP** cùng gửi header chưa hoàn chỉnh, trần chạy 15 giây. Cả bốn nhận **408** và đóng sau **10.392–10.393 ms**. Sau đó `/api/health` trả **200**. Chi tiết: [header-timeout.json](load-lab/header-timeout.json).
- Smoke test HTTP sau cùng: trang chủ, JavaScript, CSS và browser runner trả **200**; HEAD tới `.env`, `package.json`, mã server và đường dẫn thư mục trả **404**. Chi tiết: [smoke.json](load-lab/smoke.json). Hash các nguồn chính và snapshot trước vá: [source-manifest.json](load-lab/source-manifest.json).
- Các lượt đo tải chỉ GET trang chủ và danh mục; không gọi AI, không tạo booking hoặc gửi dữ liệu liên hệ.

## Chạy lại trên bản đã vá

Chạy PowerShell từ thư mục dự án. Đảm bảo ứng dụng đang chạy với `SERENITY_HOST=127.0.0.1` và `SERENITY_API_RATE_LIMIT=30`. `npm start` dùng cấu hình `.env`; giá trị rate limit hợp lệ là số nguyên 1–10.000.

Tải tool một lần nếu chưa có:

```powershell
New-Item -ItemType Directory -Path .scratch/load-lab -Force | Out-Null
Invoke-WebRequest https://github.com/hatoo/oha/releases/download/v1.16.0/oha-windows-amd64.exe -OutFile .scratch/load-lab/oha-windows-amd64.exe
Get-FileHash .scratch/load-lab/oha-windows-amd64.exe -Algorithm SHA256
```

Script tự kiểm tra lại checksum trước khi chạy và chỉ chấp nhận hai endpoint cố định trên `127.0.0.1:3001`. Các lệnh sau ghi đè kết quả `after` trong thư mục báo cáo:

```powershell
./tools/load-lab.ps1 -Phase after -Endpoint '/'
./tools/load-lab.ps1 -Phase after -Endpoint '/api/services'
node tools/check-header-timeout.mjs
node tools/summarize-load-lab.mjs
npm test
```

`-Phase` chỉ đặt tên kết quả; **không tắt rate limit**. Số liệu `before` được thu từ tiến trình gốc trước khi áp bản vá. Chạy lại nhãn `before` trên mã mới sẽ không tái tạo được baseline cũ. `summarize-load-lab.mjs` cập nhật summary JSON và in bảng mới; bảng trong tài liệu này là ảnh chụp của lần đo ngày 22/10/2026.

## Giới hạn kết luận

Một lượt đo cho mỗi trường hợp, client và server cùng máy, chịu ảnh hưởng cache, JIT và ứng dụng nền. Trần phát tải 1.000 QPS và 200 kết nối không xác định tải tối đa của hệ thống. Chênh lệch static giữa hai lượt không đủ chứng minh tối ưu hiệu năng.

Rate limit hiện ở bộ nhớ **mỗi tiến trình**, dùng IP peer trực tiếp; nhiều tiến trình hoặc reverse proxy cần giới hạn dùng chung tại proxy/store phù hợp. Static vẫn được phục vụ bình thường và không thuộc ngân sách 30 API/s. Kiểm tra này chỉ xác minh hành vi HTTP/1.1 trong lab; không đo giới hạn băng thông hay khả năng chống tấn công phân tán ngoài Internet.
