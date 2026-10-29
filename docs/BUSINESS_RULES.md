# CÁC QUY TẮC NGHIỆP VỤ (BUSINESS RULES SPECIFICATION)
## DỰ ÁN: SERENITY SPA & WELLNESS

---

### 1. QUY TẮC ĐẶT LỊCH & XUNG ĐỘT KHUNG GIỜ (CONFLICT DETECTION)
- **Công thức xung đột**: chỉ áp dụng đối với các lịch có cùng **nhân viên** và cùng **ngày**. Thời gian giữ chuyên viên được làm tròn lên theo bước đặt lịch:
  `lockedEnd = start + ceil(duration / slotStep) * slotStep`
  Hai khoảng `[start, lockedEnd)` bị xung đột nếu chúng giao nhau. Ví dụ liệu trình 80 phút bắt đầu lúc 10:00 với bước 30 phút giữ chuyên viên đến 11:30; giờ bắt đầu 11:30 vẫn hợp lệ nếu không vướng lịch khác. `endTime` của booking vẫn lưu giờ kết thúc trị liệu thực tế.
- **Quy tắc chiếm chỗ**:
  - Các lịch có trạng thái `Pending`, `Confirmed` hoặc `CheckedIn` sẽ **chiếm slot**.
  - Các lịch có trạng thái `Cancelled` **không chiếm slot**.
  - Hai lịch hẹn liền kề nhau (`existingEnd === newStart`) được xem là **hợp lệ**, không bị xung đột.
- **Giới hạn thời gian**:
  - Không được đặt lịch trong quá khứ (`date < today`).
  - Nếu đặt lịch trong ngày hôm nay, giờ bắt đầu phải cách thời điểm hiện tại tối thiểu 30 phút.
  - Slot phải nằm trọn vẹn trong ca làm việc của nhân viên (`shiftStart` đến `shiftEnd`) và giờ mở cửa Spa (`openTime` đến `closeTime`).

---

### 2. QUY TẮC TÍNH GIÁ & SNAPSHOT HÓA (PRICING SNAPSHOT)
- **Giá gốc (`originalPrice`)**: Được lấy trực tiếp từ bản ghi `Service` hoặc `Variant` tương ứng với thời lượng đã chọn.
- **Giá giảm (`discountAmount`)**: Chọn sale ngày phù hợp có mức giảm cao nhất, sau đó cộng thêm một voucher hợp lệ:
  - Sale ngày và voucher được tính riêng trên giá niêm yết (`originalPrice`), rồi cộng số tiền giảm.
  - Tổng giảm không vượt quá giá niêm yết; nếu không có sale ngày thì chỉ áp dụng voucher.
  - Voucher vẫn phải hợp lệ theo các điều kiện dưới đây:
  - Mã phải tồn tại, đang kích hoạt (`active === true`), chưa hết hạn (`expiresAt >= today`).
  - Chưa vượt quá giới hạn lượt sử dụng (`usedCount < usageLimit`).
  - Đơn hàng đạt giá trị tối thiểu (`originalPrice >= minOrder`).
  - Số tiền giảm không vượt quá mức tối đa (`maxDiscount`) và không vượt quá giá gốc đơn hàng.
- **Giá cuối cùng (`finalPrice`)**:
  `finalPrice = Math.max(0, originalPrice - discountAmount)`
- **Bảo toàn giá lịch sử**: Giá trị của lịch hẹn được snapshot vào bản ghi Booking. Khi Admin sửa giá dịch vụ trong tương lai, các booking đã tạo trước đó **vẫn giữ nguyên giá cũ**.

---

### 3. QUY TẮC LUỒNG TRẠNG THÁI (STATUS WORKFLOW)
- Với đơn đặt trước thanh toán QR, `Pending` nghĩa là đang giữ lịch chờ thanh toán tối đa 180 giây; trạng thái thanh toán được lưu riêng. Không được xác nhận thủ công khi đơn mới chưa nhận đủ tiền.
- **Luồng hợp lệ**:
  - `Pending` → `Confirmed` hoặc `Cancelled`
  - `Confirmed` → `CheckedIn`, `Cancelled` hoặc `NoShow`
  - `CheckedIn` → `Completed`
- Lịch `CheckedIn` tự chuyển sang `Completed` sau `endTime` thực tế; lịch hủy, vắng mặt hoặc chưa ghi nhận khách đã đến không tự hoàn tất.
- **Quy tắc trạng thái cuối (Terminal states)**:
  - `Completed`: Đã hoàn thành trị liệu. Không thể chuyển ngược về `Pending` hay `Cancelled`.
  - `Cancelled`: Đã bị hủy. Không thể kích hoạt lại thành `Completed` hay `Confirmed`.
- **Chính sách hủy lịch từ khách hàng**:
  - Khách hàng chỉ được hủy lịch trực tuyến trước giờ hẹn tối thiểu số tiếng quy định trong Cài đặt Spa (mặc định là 2 tiếng).
  - Hủy sát giờ phải liên hệ trực tiếp Hotline.

---

### 4. QUY TẮC ĐÁNH GIÁ (REVIEW ELIGIBILITY)
- Khách hàng chỉ có thể gửi đánh giá cho những lịch hẹn có trạng thái là `Completed`.
- Mỗi lịch hẹn chỉ được gửi đánh giá tối đa 1 lần.
- Review phải thuộc booking của tài khoản khách hàng đang đăng nhập.
- Khi có đánh giá mới, điểm trung bình và số lượng review được cập nhật dựa trên aggregate hiện tại của dịch vụ, bao gồm cả số liệu seed sẵn.

### 5. QUY TẮC KHÁCH HÀNG, NHÂN VIÊN VÀ QUẢN TRỊ
- Customer chỉ đọc booking của tài khoản mình; staff chỉ đọc và hoàn tất booking được gán cho chính staff đó; admin có quyền quản lý toàn bộ booking.
- Guest có thể tra cứu booking bằng đúng số điện thoại đã dùng khi đặt. Đây là cơ chế demo, không phải xác thực danh tính bảo mật.
- Thao tác CRUD dịch vụ, danh mục, nhân viên, khuyến mãi, cài đặt, danh sách liên hệ và analytics chỉ dành cho admin.
- Demo auth lưu session phía client/LocalStorage, không phải hệ thống xác thực an toàn cho production.

### 6. QUY TẮC XÓA DỮ LIỆU LIÊN QUAN (SOFT DELETE)
- Không xóa cứng dữ liệu nếu đã có lịch hẹn liên kết:
  - Dịch vụ đã có trong lịch hẹn: khi xóa sẽ chuyển sang chế độ `Tạm Ẩn` (`active = false`), không xóa mất dữ liệu lịch sử.
  - Danh mục có dịch vụ: chuyển sang `Tạm Ẩn`.
  - Chuyên viên đã có lịch phục vụ: chuyển sang `Tạm Nghỉ` (`active = false`).
  - Mã khuyến mãi đã có lượt dùng: chuyển sang `Tắt` (`active = false`).

### 7. KHUYẾN MÃI VÀ CHỈ SỐ PHỔ BIẾN
- Mã khuyến mãi chỉ dùng từ `startDate` đến `expiresAt`, phải active, còn lượt và đạt `minOrder`.
- `usedCount` được giữ khi tạo booking chờ thanh toán; nếu booking hết hạn, bị hủy trước khi thanh toán hoặc phát sinh giao dịch không đạt điều kiện, lượt voucher được trả lại. Booking đã thanh toán giữ lượt dùng.
- Popular Services đếm booking `Confirmed` và `Completed`; booking `Pending` và `Cancelled` không được tính.
- Revenue chỉ cộng `finalPrice` của booking `Completed`.

### 8. LIỆU TRÌNH VÀ GÓI TRỊ LIỆU
- **Liệu trình** là dịch vụ độc lập; **Gói trị liệu** là một mặt hàng combo tham chiếu một hoặc nhiều liệu trình đang hoạt động. Gói không sao chép thành bản ghi liệu trình.
- Quản trị cấu hình giá và từng mức thời lượng của gói riêng. Thời lượng đặt lịch của gói tiếp tục dùng các mức đã cấu hình; không tự cộng thời lượng của liệu trình thành phần.
- Một booking gói giữ một chuyên viên trong một khung lịch liên tục có độ dài bằng mức thời lượng gói khách đã chọn. Backend kiểm tra slot và giá theo biến thể gói như một dịch vụ duy nhất.
- Gói chỉ được hiển thị và đặt khi bản thân gói đang hoạt động và mọi liệu trình thành phần còn tồn tại, đang hoạt động. Khi liệu trình thành phần bị xóa, hệ thống tạm ẩn liệu trình và các gói đang tham chiếu tới nó.
- Booking lưu snapshot tên dịch vụ/gói, thời lượng và giá tại thời điểm đặt; thay đổi catalog sau đó không sửa lịch sử booking.
- Liệu trình lẻ có thêm `therapyGroup` để tổ chức nhóm hiển thị theo Massage toàn thân, Cổ–vai–gáy, Chân, Đầu–mặt và Combo/đặc biệt. Trường này độc lập với `category` nghiệp vụ đang dùng để ghép chuyên viên.
- Khi thêm hoặc sửa liệu trình trong quản trị, phải chọn nhóm hiển thị. Các gợi ý hiện trong nhóm chưa có dữ liệu chỉ là nội dung demo, không tạo lựa chọn đặt lịch giả.

### 9. THANH TOÁN GIỮ LỊCH BẰNG QR
- **Phương thức hiện mở**: Chuyển khoản VietQR vào tài khoản Techcombank của chủ Spa. Thanh toán bằng thẻ được hiển thị là chưa mở và không tạo giao dịch.
- **Giá phải trả**: Khách thanh toán toàn bộ `finalPrice` sau khi sale ngày và voucher được cộng dồn. Không nhận cọc, thanh toán thiếu hoặc chia nhiều lần cho một mã giữ lịch.
- **Giữ chỗ**: Tạo đơn ở trạng thái `Pending` / `awaiting_payment`, sinh một mã chuyển khoản riêng cho đơn và giữ nhân viên/phòng tối đa 180 giây. QR chứa sẵn tài khoản, số tiền và mã chuyển khoản. Hết hạn thì đơn bị hủy và slot được giải phóng.
- **Xác nhận lịch**: Chỉ giao dịch tiền vào đúng tài khoản, đúng mã, đúng chính xác số tiền, phát sinh trong thời gian giữ chỗ và còn slot mới chuyển đơn sang `Confirmed`. Hệ thống dùng webhook SePay đã xác thực; webhook trùng chỉ được ghi nhận một lần.
- **Thiếu tiền, thừa tiền, sai mã hoặc giao dịch đến muộn**: Không xác nhận lịch. Giao dịch ghép được với mã đơn sẽ bị đánh dấu cần đối soát; giao dịch không ghép được được lưu trong danh sách đối soát của Admin. Với giao dịch sai/thiếu mã, Admin chỉ gắn giao dịch vào đơn sau khi xác minh với khách; thao tác này hủy slot còn chờ, không xác nhận lịch, không hoàn tiền, ghi audit và mở sẵn tin nhắn để nhân viên gửi cho khách. Khách cũng thấy lý do trong lịch của mình sau khi giao dịch được gắn. Hiển thị cảnh báo “Nếu chuyển thiếu hoặc sai mã, chúng tôi sẽ không hoàn tiền lại.” Các khoản thừa tiền, giao dịch sau hạn hoặc không còn slot chỉ vào đối soát, không tự xác nhận/hoàn; Admin quyết định từng trường hợp và có thể tạo đề nghị hoàn với số tiền không vượt giao dịch đó. Nhân viên chuyển thủ công, Admin ghi mã tham chiếu.
- **Hủy lịch đã thanh toán**: Giữ nguyên hạn hủy trực tuyến đang cài đặt. Khi khách hủy hợp lệ, tạo yêu cầu hoàn bằng 50% số tiền thực thu sau các khoản hoàn trước; số tiền hoàn dùng VND nguyên và làm tròn đến đồng gần nhất. Khách cung cấp tài khoản nhận; nhân viên chuyển thủ công, Admin ghi mã giao dịch để hoàn tất yêu cầu.
- **Hủy khi chưa thanh toán**: Không tạo yêu cầu hoàn. Nếu còn giữ voucher cho đơn đang chờ, lượt voucher được trả lại khi đơn hết hạn, bị hủy hoặc không đạt điều kiện thanh toán.
- **Dời lịch**: Chỉ lịch đã thanh toán đủ mới được dời. Khách có thể chọn chuyên viên khác còn khả dụng; máy chủ kiểm tra lại xung đột. Giá lịch mới được tính theo chính sách sale ngày và voucher ở trên. Nếu giá tăng, khung lịch cũ vẫn được giữ, khung mới được giữ tối đa 180 giây và mã chuyển khoản riêng của đơn yêu cầu đúng phần chênh lệch; chỉ sau khi nhận đủ phần tăng lịch mới được lưu. Nếu hết hạn/không đủ tiền, lịch cũ còn hiệu lực và khung mới được giải phóng. Nếu giá giảm, lịch mới được lưu sau khi khách xác nhận, tạo yêu cầu hoàn 100% phần chênh lệch vào tài khoản khách cung cấp; nhân viên chuyển thủ công, Admin ghi mã giao dịch.
- **Cấu hình thanh toán**: Nếu SePay chưa bật đủ tài khoản và webhook API key, việc tạo đơn trả trước bị từ chối. Không hiện số tài khoản/QR công khai cho tới khi cấu hình sẵn sàng. Cổng thẻ luôn khóa cho đến khi được triển khai riêng.
