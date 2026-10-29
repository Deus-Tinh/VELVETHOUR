# Phân tích Bước 1: dữ liệu sale lễ và tính giá tập trung

Ngày: 19/10/2026. Đây là tài liệu thiết kế ban đầu. Xem [báo cáo Bước 1](HOLIDAY_SALE_STEP1_REPORT.md) và [báo cáo tích hợp hiện tại](HOLIDAY_SALE_INTEGRATION_REPORT.md) để đối chiếu phần đã triển khai và giới hạn kiểm chứng.

## 1. Kết luận thiết kế

Nghiệp vụ cốt lõi đã đủ để thiết kế. Đề xuất dùng ba bảng mới cho chiến dịch, phạm vi áp dụng và báo giá dời lịch; giữ lịch hẹn cùng lịch sử thanh toán trong cấu trúc hiện có. Module dự kiến đặt tại `assets/js/domain/pricingService.js` để frontend và Node.js cùng import được.

Ba phần phải có trách nhiệm riêng:

- Module tính giá nhận dữ liệu và trả kết quả xác định; không đọc database, gọi AI, sửa lịch hẹn hoặc tăng lượt mã.
- Máy chủ nạp dữ liệu thật, kiểm tra quyền/khung giờ và lưu thay đổi trong giao dịch.
- Giao diện trình bày báo giá và nhận thao tác bấm **Xác nhận thay đổi giá**. Agent có thể tạo báo giá, không tự xác nhận.

## 2. Các điểm đã kiểm tra trong mã nguồn

| Vị trí | Hiện trạng | Ảnh hưởng tới thiết kế |
| --- | --- | --- |
| `server/server.js:50` | Dữ liệu dịch vụ, danh mục, lịch hẹn nằm trong JSON của `collection_records`; không có bảng `services`/`bookings` riêng. | Không thiết kế khóa ngoại tới các bảng chưa tồn tại hoặc yêu cầu chuyển toàn bộ dữ liệu cũ sang bảng mới. |
| `server/server.js:126` | Helper giao dịch dùng `BEGIN IMMEDIATE` và callback đồng bộ. | Bước kiểm tra cuối và ghi phải đồng bộ, ngắn; không chờ AI hoặc mạng trong giao dịch này. |
| `assets/js/services/bookingService.js:247` | Hàm giá hiện nhận dịch vụ, thời lượng và mã; chưa nhận ngày sử dụng. | Cần interface bắt buộc truyền ngày sử dụng cho giá đặt lịch. |
| `server/server.js:839`, `server/server.js:1833` | Dời lịch qua agent và HTTP đang giữ nguyên các trường giá. | Cả hai đường đều phải chuyển sang báo giá/xác nhận, không chỉ sửa giao diện khách hàng. |
| `assets/js/services/bookingService.js:546` | Nhánh xử lý trực tiếp của lớp giao diện cũng giữ giá cũ. | Cần loại bỏ hoặc cập nhật nhánh có khả năng bỏ qua quy tắc mới. |
| `assets/js/pages/myBookingsPage.js:305` | Modal chỉ có nút lưu lịch mới, chưa có báo giá/chênh lệch. | Cần thiết kế trạng thái đang báo giá, chờ xác nhận, báo giá hết hạn và lưu thành công. |
| `server/server.js:1853` | Đã có thu cọc, thanh toán và hoàn tiền trong `paymentRecords`. | Chênh lệch giá không được hiểu mặc nhiên là khoản đã hoàn hoặc cần thu ngay. |
| `assets/js/domain/serviceCatalogModel.js` | Các mức thời lượng có giá riêng; gói trị liệu có giá riêng với liệu trình thành phần. | Sale phải tính theo mức đã chọn; không cộng giảm của các thành phần vào giá gói. |

Các kết luận trong mục này ghi lại hiện trạng trước khi triển khai Bước 1. Các luồng dời lịch/giao diện đã được nối với định giá mới ở bước tích hợp; kết quả kiểm chứng nằm trong các báo cáo trên.

## 3. Mô hình SQLite đề xuất

### 3.1. `holiday_sales` — cấu hình chiến dịch

| Nhóm | Trường dự kiến | Ý nghĩa |
| --- | --- | --- |
| Định danh | `id`, `name`, `occasion` | ID ổn định, tên hiển thị và dịp lễ. |
| Ngày sử dụng | `service_date_from`, `service_date_to` | Ngày `YYYY-MM-DD`, gồm cả hai đầu, hiểu theo giờ Việt Nam. |
| Trạng thái | `enabled` | Quyết định có được xét hay không; không tự tắt chỉ vì hiện tại chưa đến lễ. |
| Mức giảm | `discount_type`, `percentage_bps`, `fixed_amount_vnd`, `max_discount_vnd` | Phần trăm lưu bằng số nguyên: 1.500 bps = 15%. Chỉ có trường giá trị tương ứng loại giảm được điền. `NULL` cho trần giảm nghĩa là không đặt trần. |
| Phạm vi | `scope_type` | Một trong `service_variant`, `service`, `category`, `all`. |
| Theo dõi thay đổi | `revision`, `created_at`, `updated_at`, `created_by`, `updated_by` | Thời điểm và phiên bản do máy chủ quản lý; cập nhật target cũng làm tăng revision của chiến dịch. |

Ràng buộc cần có: loại hợp lệ, mức giảm dương, phần trăm tối đa 10.000 bps, tiền nguyên VND, ngày đầu không sau ngày cuối. Nếu khai báo trần giảm thì phải là số nguyên dương. Ngày lịch thực sự hợp lệ vẫn cần được kiểm tra ở máy chủ, không chỉ kiểm tra hình dạng chuỗi.

Index theo trạng thái và khoảng ngày đủ để bắt đầu; chỉ tối ưu sâu hơn nếu đo đạc cho thấy cần. Thời điểm tạo/cập nhật lưu theo UTC; điều kiện sale dùng ngày sử dụng theo giờ Việt Nam.

### 3.2. `holiday_sale_targets` — đối tượng áp dụng

- Liên kết tới chiến dịch bằng khóa ngoại `campaign_id`.
- Target là danh mục, dịch vụ, hoặc cặp dịch vụ + thời lượng tùy `scope_type`.
- Với mức thời lượng, dùng cặp `serviceId + durationMinutes`: dữ liệu hiện tại chưa có `variantId` độc lập.
- Chiến dịch toàn menu không cần target cụ thể. Với các loại khác, danh sách target không được rỗng và không được trùng.
- Đề xuất mỗi chiến dịch chỉ có một loại phạm vi ở phiên bản đầu. Điều này tránh cấu hình vừa toàn menu vừa thêm một target dịch vụ để được ưu tiên giả tạo khi so độ hẹp.
- Cần thiết kế khóa duy nhất cho target, xử lý đúng giá trị không áp dụng; không dựa vào tổ hợp trường có `NULL` để mặc nhiên loại được mọi bản ghi trùng.
- Dịch vụ/danh mục hiện nằm trong JSON, vì vậy kiểm tra tồn tại và các tham chiếu đang được dùng phải thực hiện ở máy chủ. Không khai báo khóa ngoại giả tới `services(id)` hoặc `categories(id)`.

Đây là nguồn lưu chiến dịch duy nhất. Frontend nhận dữ liệu đọc qua bootstrap hoặc truy vấn catalog; không lưu thêm một bản độc lập trong `collection_records` và không cho generic collection PUT ghi đè cả bảng chiến dịch.

### 3.3. `reschedule_quotes` — báo giá trước khi dời lịch

| Nhóm | Nội dung cần lưu |
| --- | --- |
| Định danh | ID khó đoán, booking ID, người/phiên được phép xác nhận. |
| Yêu cầu | Ngày giờ mới, chuyên viên, dịch vụ/thời lượng và mã mà khách chủ động áp dụng lại nếu có. |
| Giá | Snapshot giá cũ, snapshot giá mới, chênh lệch giá, tiền đã thu ròng, khoản còn phải thanh toán và khoản cần hoàn. |
| Chống báo giá cũ | Phiên bản lịch, dữ liệu giá dịch vụ, dữ liệu chiến dịch, mã giảm giá và phiên bản chính sách tính giá. |
| Vòng đời | Thời điểm lập, hết hạn, trạng thái chờ/đã xác nhận/hết hiệu lực, thời điểm xác nhận và kết quả đã lưu. |

Đề xuất thời hạn báo giá khoảng 5 phút, có thể cấu hình. Quote không giữ chỗ. Khi bấm xác nhận phải kiểm tra lại lịch trống.

Phiên bản dữ liệu sale phải phát hiện cả việc thêm một chiến dịch mới có lợi hơn, không chỉ việc sửa chiến dịch đã chọn. Phiên bản lịch cũng phải thay đổi khi có thu/hoàn tiền hoặc đổi trạng thái để không xác nhận bảng chênh lệch dựa trên số liệu cũ.

### 3.4. Mở rộng payload lịch hẹn hiện có

- Tiếp tục lưu `originalPrice`, `discountAmount`, `finalPrice`, `promoCode` để tương thích các màn hình đang có.
- Bổ sung `pricingSnapshot`: ngày sử dụng, dịch vụ/thời lượng, giá gốc, nguồn giảm (`holiday_sale`, `coupon`, `none`), chiến dịch và revision, giá trị giảm, kết quả cuối, phiên bản chính sách và thời điểm tính.
- Bổ sung `revision` của từng lịch để kiểm tra thay đổi. Lưu giá trước/sau và quote ID trong lịch sử dời lịch; dùng lại `audit_log` cho người thao tác và sự kiện.
- Giữ `paymentRecords` nguyên trạng khi đổi giá; thao tác thu hoặc hoàn là sự kiện riêng.
- Lịch cũ chỉ biết số tiền đã lưu thì đánh dấu nguồn lịch sử là `legacy` khi cần. Không dùng cấu hình sale hiện tại để đoán lại ưu đãi quá khứ.

## 4. Interface của `domain/pricingService.js`

Đề xuất interface chính là tính một báo giá từ dữ liệu được truyền vào. Đường dẫn vật lý phù hợp dự án là `assets/js/domain/pricingService.js`.

Đầu vào bắt buộc:

- Dịch vụ và các mức thời lượng lấy từ nguồn dữ liệu thật.
- Thời lượng được chọn và `serviceDate` cụ thể.
- Danh sách chiến dịch và target hiện hành.
- Mã giảm giá được yêu cầu cùng bản ghi cấu hình thật nếu có.
- Mốc thời gian đánh giá do caller truyền vào để kiểm tra mã và phục vụ test; không tự đọc đồng hồ ở bên trong.

Đầu ra:

- `originalPrice`, `discountAmount`, `finalPrice` theo số nguyên VND.
- `discountSource`, campaign ID/revision hoặc mã được áp dụng.
- Lý do chọn chiến dịch, mức giảm của sale và mức giảm của voucher để giải thích giá cộng dồn.
- Thông tin đủ để tạo snapshot và đối chiếu lại báo giá.

Không nhận số tiền từ trình duyệt làm giá niêm yết tin cậy. Frontend có thể dùng cùng phép tính để hiển thị; máy chủ luôn chạy lại trên dữ liệu của máy chủ.

Quy trình tính:

1. Kiểm tra dịch vụ/thời lượng, lấy đúng giá niêm yết của mức đã chọn.
2. Lọc sale đang bật, đúng ngày sử dụng và đúng phạm vi.
3. Tính số tiền giảm thực tế của từng sale: tính phần trăm hoặc mức tiền, áp trần nếu có, không vượt giá gốc. Đề xuất làm tròn xuống số tiền giảm phần trăm theo VND như cách tính mã hiện tại.
4. Chọn duy nhất một sale theo thứ tự ở mục 5.
5. Chọn một sale phù hợp nhất. Nếu khách nhập voucher hợp lệ, tính cả hai khoản giảm trên giá niêm yết rồi cộng lại; tổng giảm không vượt quá giá gốc. Nếu không có sale, chỉ áp dụng voucher.
6. Phép tính không ghi dữ liệu. Lượt voucher được giữ cùng booking chờ QR và được trả lại nếu booking hết hạn, bị hủy trước khi trả đủ tiền hoặc giao dịch không đạt điều kiện.

Nếu là gói trị liệu, tính trên giá gói của mức thời lượng đã chọn. Không lấy giá hoặc sale của các liệu trình thành phần để cộng vào.

## 5. Chuẩn hóa thứ tự chọn chiến dịch

Thứ tự nghiệp vụ đã chốt:

1. `discountAmount` lớn nhất, sau khi đã tính trần và làm tròn.
2. Phạm vi hẹp hơn.
3. Thời điểm tạo/cập nhật gần nhất.

Đề xuất kỹ thuật để diễn giải độ hẹp nhất quán: `service_variant` > `service` > `category` > `all`; trong cùng loại, số target ít hơn được coi là hẹp hơn. Không so theo tên hiển thị hoặc thứ tự bản ghi trong database. Trường danh mục phải có định danh rõ ràng, không nhầm danh mục vận hành với `therapyGroup` dùng để trưng bày.

Nếu mọi tiêu chí vẫn bằng nhau, dùng ID ổn định làm tiêu chí kỹ thuật cuối để các lần chạy chọn cùng một chiến dịch. `updated_at` do máy chủ đặt khi dữ liệu thực sự thay đổi; việc xem hoặc lập quote không được cập nhật nó.

Ví dụ giá gốc 500.000đ:

| Chiến dịch | Cấu hình | Giảm thực tế |
| --- | --- | --- |
| A | Giảm 20%, tối đa 60.000đ | 60.000đ |
| B | Giảm cố định 70.000đ | 70.000đ |

B được chọn dù tỷ lệ quảng cáo của A có vẻ lớn. Chỉ khi tiền giảm bằng nhau mới so độ hẹp và độ mới.

## 6. Báo giá và xác nhận dời lịch

1. Khách/admin hoặc agent yêu cầu ngày giờ mới.
2. Máy chủ kiểm tra quyền, trạng thái cho phép dời, hạn báo trước và khung giờ; đọc giá cũ đã lưu, tính giá mới từ dữ liệu hiện hành và lưu quote. Lịch hẹn chưa thay đổi.
3. Giao diện hiển thị ngày giờ cũ/mới, giá cũ/mới, sale được chọn, chênh lệch và tình hình thu/hoàn. Bắt buộc có nút **Xác nhận thay đổi giá**; kể cả chênh lệch bằng 0 vẫn có bước xác nhận trước khi lưu lịch mới.
4. Khi bấm xác nhận, máy chủ kiểm tra lại người thao tác, quote, thời hạn, phiên bản dữ liệu, trạng thái/hạn dời và chỗ trống. Tính lại giá từ dữ liệu hiện hành.
5. Nếu có thay đổi làm quote không còn hợp lệ, trả báo giá mới hoặc lỗi khung giờ để người dùng chọn/xác nhận lại. Không tự lưu giá khác với bản đã hiển thị.
6. Nếu hợp lệ, cập nhật lịch, snapshot giá, lịch sử, lượt dùng mã nếu thực sự cần, audit và trạng thái quote trong cùng một giao dịch.
7. Gửi lại cùng quote đã xác nhận trả về kết quả đã lưu, không dời lần hai hoặc ghi nhận mã thêm lần nữa.

Tất cả đường ghi phải đi qua quy trình này, gồm agent, API hiện tại và nhánh xử lý trực tiếp của lớp giao diện. Agent chỉ được gọi thao tác chuẩn bị quote; endpoint xác nhận dành cho hành động từ giao diện theo quyền hiện có. Không cung cấp công cụ để AI tự xác nhận và không chỉ thêm một cờ `confirmed: true` vào tool ghi trực tiếp.

Đây là ngoại lệ đã được người dùng yêu cầu đối với quy tắc “lệnh rõ thì thực hiện ngay”: tạo/sửa sale rõ vẫn có thể thực hiện ngay, nhưng dời lịch phải chờ bấm xác nhận giá.

## 7. Phân biệt đổi giá với thu/hoàn tiền

Các số phải được tính riêng:

- Chênh lệch giá = giá mới − giá cũ.
- Tiền đã thu ròng = tổng cọc và thanh toán − tổng đã hoàn.
- Còn phải thanh toán = phần dương của giá mới − tiền đã thu ròng.
- Cần hoàn = phần dương của tiền đã thu ròng − giá mới.

Ví dụ giá cũ 1.000.000đ, giá mới 800.000đ:

| Tiền đã thu ròng | Giảm tổng giá | Còn thanh toán | Cần hoàn |
| --- | --- | --- | --- |
| 0đ | 200.000đ | 800.000đ | 0đ |
| 300.000đ | 200.000đ | 500.000đ | 0đ |
| 1.000.000đ | 200.000đ | 0đ | 200.000đ |

Do đó, không hiển thị “hoàn 200.000đ” cho mọi trường hợp giảm giá 200.000đ. Nếu cần hoàn nhưng chưa có giao dịch hoàn, phải ghi “cần hoàn”, không ghi “đã hoàn”. Xác nhận dời lịch không đồng nghĩa đã thu hoặc đã hoàn tiền.

Mã cũ không tự mang sang lịch mới nếu khách chưa áp dụng lại. Không tăng lượt dùng khi chỉ lập quote; cần theo dõi mã đã dùng theo lịch để xác nhận hoặc gửi lặp không tiêu thụ lượt nhiều lần. Chính sách có trả lại lượt mã cũ hay không là phần cần ghi rõ khi tích hợp bộ đếm; không tự giảm bộ đếm chỉ vì tạo báo giá.

## 8. Tương thích và thứ tự triển khai khi được yêu cầu code

1. Viết migration có phiên bản và có thể chạy lại an toàn cho ba bảng mới; không chuyển cấu trúc dịch vụ/lịch hiện có trong cùng thay đổi.
2. Xây dựng module tính giá thuần và kiểm thử quy tắc bằng dữ liệu cố định, đồng hồ truyền vào.
3. Chứng minh trường hợp không có sale vẫn cho giá/mã như hành vi hiện tại; quy định cách đọc snapshot legacy.
4. Sau đó mới nối vào tạo lịch, catalog, agent và luồng quote/xác nhận dời lịch. Chưa nối bước xác nhận thì không mở quyền ghi dời lịch theo cơ chế mới.

Ngoài tạo bảng, cần tích hợp chiến dịch vào nguồn dữ liệu đọc/backup/phiên bản của máy chủ. Tránh tạo bảng mới nhưng các màn hình vẫn đọc giá hoặc sale từ một nguồn khác.

## 9. Kiểm chứng bắt buộc khi triển khai

- Ngày đặt trước lễ/ngày sử dụng đúng lễ; đặt trong lễ nhưng sử dụng sau lễ; khoảng ngày bao gồm hai đầu theo giờ Việt Nam.
- Các mức thời lượng khác giá; gói và liệu trình; service hoặc target không còn hợp lệ.
- Giảm phần trăm có trần so với giảm tiền; thứ tự tiền giảm → phạm vi → cập nhật; trường hợp mọi tiêu chí bằng nhau cho kết quả ổn định.
- Sale thắng mã ngay cả khi mã giảm nhiều hơn; mã không bị tăng lượt khi bị bỏ qua.
- Dời giữa ngày thường/ngày lễ và giữa hai lễ; lịch cũ giữ nguyên khi chỉ báo giá hoặc hủy thao tác.
- Cọc một phần, trả đủ, đã hoàn một phần; số tiền cần thu/hoàn khác chênh lệch tổng giá.
- Agent không thể ghi dời trước nút xác nhận; gọi trực tiếp đường ghi cũ không bỏ qua được quote.
- Sale mới hoặc giá niêm yết thay đổi, mã hết lượt, có thêm thu/hoàn, lịch đổi trạng thái hoặc chỗ bị chiếm trong lúc chờ xác nhận.
- Hai xác nhận đồng thời, gửi lặp, timeout sau commit và máy chủ khởi động lại.
- Migration database mới/cũ và chạy lại lần hai; snapshot cũ không bị tính lại theo sale hiện tại.

Các mục trên là tiêu chí cho toàn bộ tính năng. Kết quả đã đạt của Bước 1 được ghi riêng trong báo cáo triển khai; không đồng nghĩa toàn bộ luồng giao diện/agent/dời lịch đã được kiểm thử.
