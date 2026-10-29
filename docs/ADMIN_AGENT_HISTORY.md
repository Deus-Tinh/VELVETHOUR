# Lịch sử hội thoại Agent Spa

Lịch sử Agent Spa của admin được lưu trong SQLite cùng database ứng dụng. Hai bảng `admin_agent_conversations` và `admin_agent_messages` tách biệt với chatbot tư vấn khách hàng. Migration bổ sung chạy khi khởi động máy chủ; hội thoại RAM cũ chưa từng ghi vào database không thể khôi phục đầy đủ.

## Sử dụng

- Tab Agent Spa tự mở lại hội thoại đang chọn trong phiên trình duyệt; nếu không còn hội thoại đó, mở hội thoại gần nhất của admin.
- Chọn hội thoại trong danh sách để xem lại. Có nút tạo hội thoại mới, xóa hội thoại hiện tại và xóa toàn bộ lịch sử của chính tài khoản đang đăng nhập.
- Nội dung và kết quả lỗi AI được lưu. Hội thoại dài tải từng nhóm 100 tin nhắn; bấm “Xem tin nhắn cũ hơn” để đọc tiếp.
- Số điện thoại/email trong văn bản được ẩn trước khi lưu. Thông tin liên hệ nguyên bản dùng cho việc đặt lịch vẫn chỉ ở bộ nhớ tạm phía máy chủ theo cơ chế hiện có.
- Tin nhắn giữ 30 ngày kể từ khi gửi. Hội thoại còn hoạt động chỉ giữ các tin nhắn trong cửa sổ đó. Việc dọn dữ liệu chạy khi khởi động, khi truy cập lịch sử/gửi tin nhắn và mỗi giờ khi máy chủ đang chạy.
- Phạm vi lưu giữ và xóa áp dụng cho database hoạt động. Các bản sao lưu database đã tải/xuất trước đó là bản chụp riêng.

## Phục hồi và chống lặp lệnh

Đọc hội thoại chỉ gọi API đọc; không gọi AI hoặc công cụ thay đổi dữ liệu. Kết quả thao tác cũ được hiển thị dạng văn bản. Báo giá cũ chỉ có phần tóm tắt, không dựng lại nút xác nhận.

Khi gửi tin nhắn mới, Agent được nhận tối đa 20 tin nhắn hoàn tất gần nhất làm ngữ cảnh (vòng gọi model hiện giới hạn đầu vào lịch sử ở 18 tin). Tin nhắn lỗi hoặc đang chờ không được đưa vào ngữ cảnh hoàn tất. Lịch sử được nhắc rõ là dữ liệu tham khảo; lệnh thay đổi phải xuất phát từ yêu cầu hiện tại và phải kiểm tra lại dữ liệu trực tiếp.

Trong lúc có yêu cầu đang chạy, máy chủ từ chối gửi lệnh song song hoặc xóa cùng hội thoại. Nếu tải lại trang, giao diện chỉ đọc và theo dõi kết quả đang xử lý. Nếu khởi động lại máy chủ giữa chừng, tin nhắn được đánh dấu gián đoạn và không tự chạy lại; kết quả công cụ đã ghi nhận vẫn hiện trong lịch sử.

Xóa chat không xóa sale, menu, trang hoặc nhật ký nghiệp vụ đã thực hiện. Nội dung biên nhận chống lặp bị loại bỏ nhưng mã băm tối thiểu được giữ để yêu cầu cũ không thể vô tình chạy lại sau khi xóa chat.

## API admin

| Phương thức | Đường dẫn | Kết quả |
| --- | --- | --- |
| GET | `/api/admin/agent/conversations` | Hội thoại của admin hiện tại, thời hạn lưu giữ |
| POST | `/api/admin/agent/conversations` | Tạo hội thoại rỗng; không gọi AI |
| GET | `/api/admin/agent/conversations/:id?before=:messageId` | Tin nhắn, phân trang và trạng thái đang xử lý |
| DELETE | `/api/admin/agent/conversations/:id` | Xóa nội dung hội thoại của chính admin |
| DELETE | `/api/admin/agent/conversations` | Xóa toàn bộ lịch sử của chính admin |
| POST | `/api/admin/agent/messages` | Gửi yêu cầu mới với `conversationId` và `requestId` |

Các API đều kiểm tra phiên admin. Thao tác ghi/xóa kiểm tra origin. Quyền đọc/xóa bị giới hạn bởi `owner_id` trên máy chủ, không dựa vào bộ lọc giao diện.

## Kiểm chứng

Chạy `npm test`. Các bài bổ sung kiểm tra SQLite sau đóng/mở, thời hạn 30 ngày, phân trang, che thông tin liên hệ, tách hai admin, lỗi AI và gửi lại, yêu cầu đang chạy, xóa lịch sử không xóa thay đổi nghiệp vụ, mở lại chat không gọi AI/công cụ, và lỗi làm mới giao diện sau khi đã lưu.

Kiểm thử dùng database tạm và provider mô phỏng. Chúng không xác nhận Gemini thật đã hết lỗi timeout trước đó.
