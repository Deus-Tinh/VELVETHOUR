# Kiểm tra Agent Spa với Gemini thật

Ngày kiểm tra: 20/10/2026, múi giờ Asia/Ho_Chi_Minh.

## Kết luận

Câu lệnh “20/10 sẽ được giảm 15% thay vì 20%. bạn chỉnh lại giúp tôi” hợp lệ và đã được thực hiện thành công trên SQLite thử nghiệm. Đối chiếu sau lệnh: chiến dịch cũ đổi từ 20% thành 15%, không sinh chiến dịch trùng và báo giá dịch vụ đúng mức 15%.

Đã kiểm tra thành công 9 tình huống bằng Gemini thật qua nhiều đợt chạy. Không phải một lần chạy liên tục 9/9: đợt toàn bộ gần nhất đạt 7/9; hai ca còn lại bị giới hạn API và sau đó đã chạy riêng thành công. Sau khi sửa phần diễn giải báo giá, ca dời lịch cũng đã chạy lại thành công.

## Nguyên nhân thông báo “bận”

- Gọi đúng câu lệnh trong ảnh với model đang cấu hình `gemini-3.8-flash` nhận HTTP 503 `UNAVAILABLE`, thông báo model có nhu cầu sử dụng cao; thời gian khoảng 18 giây.
- Các lần tiếp theo có timeout và HTTP 429 `RESOURCE_EXHAUSTED`. Chi tiết `google.rpc.QuotaFailure` chỉ ra hạn mức `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, với chiều model là `gemini-3.8-flash`.
- Cùng API key, `gemini-3.5-flash-lite` trả HTTP 200 và thực hiện được các công cụ. Không có bằng chứng key sai; thay key thuộc cùng dự án chưa chắc giải quyết hạn mức của dự án/model.
- Model dự phòng cũng từng trả 429 khi chạy nhiều ca liên tiếp. Không có cơ chế nào đảm bảo API luôn sẵn sàng nếu cả hai model đều hết hạn mức hoặc quá tải.

Server thật tại `http://127.0.0.1:3001/` trả HTTP 200 khi kiểm tra cuối. Lần này không dừng hay khởi động lại tiến trình đang chạy; cần khởi động lại backend để tiến trình nạp mã mới.

## Thay đổi đã thực hiện

- Agent Gemini chuyển sang model dự phòng khi yêu cầu đầu gặp quá tải, timeout, lỗi mạng, rate limit, hoặc quota được nhà cung cấp xác nhận là riêng model. Lỗi xác thực và quota không rõ phạm vi không kích hoạt chuyển model.
- Chỉ chuyển trước khi có lịch sử gọi công cụ. Sau khi đã thực hiện công cụ, tiếp tục giữ nguyên model và chữ ký của các vòng gọi; không phát lại thao tác ghi trên model khác.
- Giới hạn chờ model chính mặc định 12 giây, dự phòng mặc định `gemini-3.5-flash-lite`. Giữ tổng thời gian xử lý agent mặc định 60 giây.
- Gemini 3 dùng mức suy luận `low`, ngân sách đầu ra mặc định 4096 token; phản hồi `MAX_TOKENS` bị từ chối trước khi chạy công cụ chưa hoàn chỉnh.
- Giao diện nhận thông báo lỗi riêng cho timeout, mạng, quota, cấu hình và giới hạn phản hồi.
- Sửa bộ lọc số điện thoại che nhầm chuỗi ngày hẹn như `2026-10-22 (10:00)`. Ngày hợp lệ được giữ; số điện thoại và email vẫn bị ẩn.
- Phần trả lời có báo giá dời lịch lấy ngày, giờ, giá và chênh lệch trực tiếp từ báo giá máy chủ. Câu trả lời AI từng viết nhầm năm dù dữ liệu báo giá đúng; kiểm thử hồi quy hiện chặn việc hiển thị diễn giải mâu thuẫn đó.

Không sửa `.env` thực tế. Các biến tùy chọn đã được mô tả trong `.env.example`: `AI_AGENT_FALLBACK_MODEL`, `AI_AGENT_PRIMARY_TIMEOUT`, `AI_AGENT_MAX_OUTPUT_TOKENS`. Đặt `AI_AGENT_FALLBACK_MODEL=` nếu muốn tắt dự phòng.

## Kết quả từng tình huống

| Tình huống | Đối chiếu kết quả máy chủ | Kết quả |
| --- | --- | --- |
| Liệt kê sale lễ | Không đổi dữ liệu nghiệp vụ | Đạt |
| Sửa sale 20/10 từ 20% xuống 15% | Sửa đúng chiến dịch, không tạo trùng, báo giá đúng 15% | Đạt |
| “Tạo giảm giá dịp Tết” thiếu thông tin | Hỏi lại; không ghi dữ liệu | Đạt |
| Tạo sale 10% toàn menu vào ngày chỉ định | SQLite lưu đúng mức giảm và phạm vi | Đạt |
| Tạo trang ưu đãi theo mẫu, gắn sale và thêm menu | Trang published, đúng template, menu bật, API công khai trả 200 | Đạt |
| Thêm “Đặt lịch nhanh” trỏ trang có sẵn | Menu trỏ route booking và được bật | Đạt |
| Liệt kê lịch hẹn hôm nay | Không đổi dữ liệu nghiệp vụ | Đạt |
| Dời lịch sang ngày có sale 10% | Báo giá 490.000đ → 441.000đ; lịch cũ giữ nguyên, chờ nút xác nhận | Đạt |
| Tắt sale 20/10 | Chiến dịch tắt; trang ưu đãi liên kết trả 404 công khai | Đạt |

Các bằng chứng JSON:

- [Sửa đúng lệnh trong ảnh, có dự phòng sau timeout](../.scratch/spa-agent-live-1792477811669.json).
- [Đợt 7/9 với cấu hình model chính hiện có](../.scratch/spa-agent-live-1792478094348.json).
- [Hai ca dời lịch và tắt sale chạy riêng bằng model dự phòng: 2/2](../.scratch/spa-agent-live-1792478215929.json).
- [Dời lịch sau bản sửa ngày/giá từ máy chủ: 1/1](../.scratch/spa-agent-live-1792478594889.json).

## Kiểm thử tự động và giới hạn kiểm tra

`npm test`: **174/174 đạt**, gồm 62 kiểm thử nghiệp vụ và 112 kiểm thử Node; không bỏ qua ca nào. [Nhật ký lần cuối](../.scratch/spa-agent-unit-final.log).

Đã kiểm tra thêm fallback trước công cụ, quota riêng model, không chuyển khi lỗi xác thực/quota chung, không phát lại ghi khi lỗi sau công cụ, bảo toàn chữ ký Gemini, phản hồi cạn token, ngày hẹn không bị ẩn và diễn giải giá không được mâu thuẫn với báo giá. Bộ kiểm thử hiện có kiểm tra không cộng dồn sale/mã, xử lý sale trùng, xác nhận dời lịch, phân quyền admin, chống lặp và lịch sử hội thoại.

Các ca Gemini thật gọi handler HTTP của ứng dụng với phiên admin thử và SQLite tạm dưới thư mục hệ thống; không mock phản hồi AI. Đây là kiểm tra tích hợp backend, chưa phải kiểm tra thao tác/hiển thị trên trình duyệt ở lần chạy này.

Không ghi dữ liệu spa đang dùng. Kiểm tra chỉ đọc cuối cùng xác nhận chiến dịch thật “Ưu đãi 20/10” vẫn ở **20%, revision 1**. Muốn đổi sale thật thành 15%, khởi động lại backend, đăng nhập lại nếu cần rồi gửi lại câu lệnh trên giao diện Agent Spa.

## Chạy lại có chủ đích

Các lệnh sau gọi API Gemini thật và tiêu thụ hạn mức, luôn tạo cơ sở dữ liệu tạm:

```powershell
node --env-file-if-exists=.env tests/live-spa-agent.mjs --live
node --env-file-if-exists=.env tests/live-spa-agent.mjs --live --case update
node --env-file-if-exists=.env tests/live-spa-agent.mjs --live --case reschedule,disable --model gemini-3.5-flash-lite
```

Kiểm tra live không nằm trong `npm test`. Khóa và header xác thực không được ghi vào báo cáo.

Tham khảo cấu hình suy luận Gemini: [tài liệu Google về thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en).
