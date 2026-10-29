# Kế hoạch Agent Admin quản lý sale dịp lễ và mục trên website

Ngày lập: 19/10/2026. Cập nhật 20/10/2026: đã triển khai schema, định giá, API, giao diện sale, công cụ agent, menu động, trang ưu đãi theo mẫu, lưu lịch sử hội thoại và xác nhận dời lịch. Đã kiểm tra 9 tình huống bằng Gemini thật qua nhiều đợt và 174 kiểm thử tự động đạt; xem [báo cáo kiểm tra mới nhất](SPA_AGENT_LIVE_TEST_REPORT.md), [báo cáo tích hợp ngày 19/10](HOLIDAY_SALE_INTEGRATION_REPORT.md) và [báo cáo Bước 1](HOLIDAY_SALE_STEP1_REPORT.md).

## 1. Yêu cầu đã được người dùng xác nhận

- Admin ra lệnh bằng tiếng Việt ngay trên website.
- Lệnh rõ và đủ thông tin được thực hiện ngay; chỉ hỏi lại khi thiếu thông tin hoặc chưa xác định được đối tượng.
- Trọng tâm là thêm/sửa chương trình sale cho dịp lễ theo lệnh admin.
- Sale tự giảm giá dịch vụ; website hiển thị giá gốc và giá sale. Khách không cần nhập mã.
- Điều kiện hưởng sale xét theo ngày sử dụng dịch vụ trên lịch hẹn: lịch đúng ngày lễ được ưu đãi, có thể đặt trước; lịch sau ngày lễ không được hưởng sale lễ đó.
- Khi lịch đủ điều kiện hưởng sale lễ, sale ngày và voucher khách nhập cùng được áp dụng; mỗi khoản giảm được tính riêng trên giá niêm yết rồi cộng tiền giảm, tổng giảm không vượt giá niêm yết.
- Khi nhiều sale lễ cùng khớp, chọn duy nhất chương trình có `discountAmount` cao nhất; nếu bằng nhau, ưu tiên phạm vi hẹp hơn, sau đó chiến dịch được tạo/cập nhật gần nhất. Không cộng dồn sale lễ.
- Khi dời lịch, tính lại giá theo ngày sử dụng mới. Khách/admin bắt buộc bấm **Xác nhận thay đổi giá** sau khi xem giá cũ, giá mới và chênh lệch trước khi máy chủ lưu lịch mới. Yêu cầu này cũng áp dụng với thao tác bắt đầu từ agent.
- Hỗ trợ thêm mục menu trỏ đến trang có sẵn, đồng thời tạo trang nội dung mới theo mẫu để giới thiệu ưu đãi.
- Tạo chiến dịch cần có lệnh admin. Chiến dịch đã tạo tự xét ngày sử dụng dịch vụ theo khoảng ngày lễ được chỉ định; hết dịp lễ thì ngừng hiển thị sale đó trên danh sách hiện hành.

Ví dụ yêu cầu đủ rõ:

> Tạo sale giảm 15% cho liệu trình Signature Body Massage ở tất cả mức thời lượng, áp dụng cho lịch hẹn sử dụng dịch vụ ngày 20/11/2026. Tạo trang theo mẫu ưu đãi và thêm vào menu với tên Sale 20/11.

Ví dụ yêu cầu cần hỏi lại:

> Thêm sale cho ngày lễ sắp tới.

Agent cần xác định dịp nào, năm/ngày sử dụng dịch vụ được ưu đãi, mức giảm và dịch vụ áp dụng trước khi ghi dữ liệu.

Ví dụ kiểm tra điều kiện ngày với chiến dịch chỉ áp dụng ngày 20/11/2026:

| Ngày tạo lịch | Ngày sử dụng dịch vụ | Kết quả |
| --- | --- | --- |
| 18/11/2026 | 20/11/2026 | Có sale lễ. |
| 20/11/2026 | 20/11/2026 | Có sale lễ nếu khung giờ còn đặt được. |
| 20/11/2026 | 21/11/2026 | Không có sale lễ. |
| 21/11/2026 | 21/11/2026 | Không có sale lễ. |

## 2. Hiện trạng ban đầu trước triển khai

Mục này ghi lại bằng chứng lúc lập kế hoạch. Các thay đổi và kết quả mới nằm trong [báo cáo tích hợp](HOLIDAY_SALE_INTEGRATION_REPORT.md).

| Nội dung | Bằng chứng và kết luận |
| --- | --- |
| Kiến trúc | Vanilla JavaScript, hash routing, Node.js 24 và SQLite. Runtime hiện có Node.js v24.16.0. |
| Agent có sẵn | `server/spaManagerAgent.js` chỉ cung cấp thao tác lịch hẹn và auditor đọc lịch. Chưa có công cụ sửa menu, tạo trang hoặc tạo sale trực tiếp. |
| Quyền admin | `/api/admin/agent/messages` có kiểm tra nguồn gửi, phiên đăng nhập và vai trò trên máy chủ. Đã thử lại các tình huống từ chối bằng database tạm. |
| Menu và trang | `assets/js/demo.js` viết cố định menu, các route và nội dung Giới thiệu/Liên hệ. Cần mô hình dữ liệu để có thể thêm trang bằng lệnh. |
| Khuyến mãi hiện tại | `promotionService` và `checkPromotion` xử lý mã giảm giá nhập lúc đặt lịch. Chưa phải mô hình chiến dịch tự hiển thị giá sale. |
| Giá đặt lịch | Máy chủ tự tính và lưu `originalPrice`, `discountAmount`, `finalPrice`. Cần tích hợp sale vào đường tính giá này. |
| Đồng bộ | Giao diện có refresh sau lệnh agent; các cửa sổ đang hiển thị lấy dữ liệu mới định kỳ 30 giây. Chưa kiểm thử bằng trình duyệt cho luồng sale. |
| Kiểm chứng sau lệnh | Prompt yêu cầu gọi auditor sau khi ghi, nhưng runtime chưa bắt buộc đọc lại dữ liệu sau mọi lần ghi. Cần bước đối chiếu xác định ở máy chủ. |
| AI | Đã xác nhận có provider Gemini, cấu hình model và khóa. Không in khóa và chưa gọi AI thật; hiệu lực khóa, quota và độ chính xác hiểu lệnh chưa được xác minh. |

Các kiểm tra đã chạy:

- `npm test`: 62/62 bài nghiệp vụ và 30/30 bài Node test đạt, exit code 0.
- 7/7 phép kiểm tra trực tiếp handler Agent Admin đạt: khách chưa đăng nhập nhận 401; staff/customer nhận 403; nguồn gửi khác nhận 403; lệnh rỗng và mã hội thoại sai nhận 400; thiếu cấu hình AI nhận 503.
- Các phép kiểm tra handler dùng SQLite tạm và chặn lời gọi AI bên ngoài. Không sửa dữ liệu nghiệp vụ đang dùng.
- Trong `tests/` chưa tìm thấy bài kiểm thử riêng cho `/api/admin/agent/messages` hoặc `runSpaManagerAgent`. Kết quả hiện tại chưa chứng minh tính năng mới hoạt động.
- Sau triển khai Bước 1: `npm test` đạt 62/62 bài nghiệp vụ và 62/62 bài Node test; trong đó có 32 bài mới về định giá và SQLite. Các API test dùng database tạm; chưa chạy migration trên database đang dùng của người dùng.

## 3. Quy tắc nghiệp vụ đã chốt

Người dùng đã chốt điều kiện ngày sử dụng, ưu tiên sale lễ, xử lý trùng chiến dịch và quy trình tính lại giá/xác nhận khi dời lịch. Các chi tiết kỹ thuật ở tài liệu thiết kế không được làm thay đổi các quy tắc này.

1. **Đã chốt:** sale xét theo ngày khách đến sử dụng dịch vụ ghi trên lịch hẹn, dùng múi giờ `Asia/Ho_Chi_Minh`. Đặt trước cho ngày lễ vẫn được sale; đặt trong ngày lễ nhưng sử dụng sau ngày lễ không được sale lễ đó.
2. Giữ nguyên giá gốc và giá của từng mức thời lượng. Giá sale được tính theo chiến dịch đang bật và ngày sử dụng được chọn. Trước dịp lễ có thể hiển thị ưu đãi sắp tới nhưng phải ghi rõ “áp dụng cho lịch ngày …”; không mô tả thành ưu đãi cho mọi ngày đặt lịch.
3. **Đã chốt:** một sale ngày phù hợp được chọn theo số tiền giảm thực tế, phạm vi hẹp hơn rồi thời điểm tạo/cập nhật gần nhất. Sale ngày và voucher hợp lệ được cộng dồn bằng cách tính riêng từng khoản trên giá niêm yết; tổng giảm tối đa bằng giá niêm yết. Nếu không có sale ngày phù hợp thì voucher vẫn được xét theo điều kiện riêng.
4. Lưu giá và chiến dịch đã áp dụng vào lịch hẹn. Việc admin sửa/tắt sale không tự thay đổi số tiền của lịch đã tạo. **Đã chốt khi dời lịch:** tính lại theo ngày sử dụng mới; hiển thị giá cũ, giá mới và chênh lệch; bắt buộc khách/admin bấm **Xác nhận thay đổi giá** trước khi lưu. Dời ra ngoài ngày lễ mất sale lễ đó; dời vào ngày lễ hoặc sang dịp lễ khác xét sale phù hợp của ngày mới.
5. Tên ngày lễ chưa đủ để suy ra ngày, năm và thời gian sale. Nếu chưa có cấu hình lịch đã xác minh hoặc ngày cụ thể từ admin, agent phải hỏi lại; đặc biệt với dịp theo âm lịch.
6. Không tự tạo chương trình cho tất cả ngày lễ hoặc lặp hằng năm. Chỉ thực hiện khi lệnh admin chỉ định phạm vi đó; một chiến dịch đã lưu vẫn tự xét đúng khoảng ngày sử dụng dịch vụ và ngừng quảng bá sau dịp lễ.

## 4. Phương án triển khai theo thứ tự

### Bước 1 — Mô hình chiến dịch và phép tính giá dùng chung

- Bổ sung dữ liệu chiến dịch: tên, dịp lễ, kiểu/mức giảm, phạm vi dịch vụ hoặc danh mục, mức thời lượng, ngày sử dụng bắt đầu/kết thúc được ưu đãi, trạng thái bật/tắt và phiên bản.
- Khoảng ngày sử dụng gồm cả ngày bắt đầu và ngày kết thúc theo giờ Việt Nam. Khi cần biểu diễn bằng mốc thời gian, “đến hết ngày” tương ứng mốc kết thúc loại trừ đầu ngày kế tiếp.
- Kiểm tra đầy đủ phía máy chủ: tỷ lệ hợp lệ, số tiền VND nguyên, thời gian đúng thứ tự, dịch vụ tồn tại, phạm vi rõ ràng và giá sau giảm không âm.
- Dùng chung một phép tính giá có đầu vào ngày sử dụng dịch vụ cho danh sách, chi tiết, các mức thời lượng, đặt/dời lịch và thông tin giá do chatbot/agent cung cấp.
- Nếu chưa chọn ngày sử dụng, giá sale trên trang giới thiệu phải kèm ngày áp dụng; giá chốt khi đặt lịch luôn theo ngày khách chọn.
- Bộ lọc và sắp xếp theo giá phải dùng cùng mức giá khách đang nhìn thấy.
- Dữ liệu cũ chưa có chiến dịch vẫn hoạt động như hiện tại; không thay thế các mã giảm giá đã có.

### Bước 2 — Công cụ quản trị cho Agent Website

- Mở rộng khu vực Agent Spa bằng khả năng quản lý website; giữ các thao tác lịch hẹn đang có.
- Cung cấp thao tác đọc/tìm chiến dịch, xem tác động giá, tạo/sửa/tắt chiến dịch và quản lý mục menu/trang theo mẫu.
- AI chuyển câu lệnh thành thao tác có cấu trúc. Máy chủ quyết định trường nào được sửa và kiểm tra dữ liệu trước khi thực thi.
- Lệnh như “sửa sale 20/11 thành 20%” phải tìm đúng chiến dịch và năm; nếu có nhiều kết quả thì hỏi lại.
- Thiếu dữ liệu không được ghi một phần. Lệnh rõ được thực hiện ngay, không thêm bước duyệt bản xem trước.
- Kiểm tra quyền admin tại thời điểm ghi; giới hạn thao tác ở các chức năng quản trị được hỗ trợ.
- Lưu mã yêu cầu để gửi lại cùng yêu cầu không tạo chiến dịch hoặc trang trùng.
- Riêng dời lịch, agent chỉ chuẩn bị báo giá và hiển thị nút xác nhận. Không giữ công cụ dời lịch ghi ngay hoặc cho agent tự xác nhận thay người dùng.

### Bước 3 — Menu động và trang ưu đãi theo mẫu

- Bổ sung dữ liệu menu và trang trong SQLite, tích hợp vào bootstrap và bộ định tuyến.
- Menu hỗ trợ nhãn, vị trí, trạng thái hiển thị và đích đến là route có sẵn hoặc trang mới.
- Mẫu trang ưu đãi gồm tiêu đề, nội dung, khoảng thời gian, danh sách dịch vụ sale và nút đặt lịch. Có thể dùng mẫu nội dung giới thiệu khi admin yêu cầu.
- Nội dung được lưu theo trường dữ liệu, hiển thị qua mẫu có sẵn và escape đúng cách.
- Kiểm tra slug trùng, đích đến không tồn tại và xung đột với route hệ thống.
- Trang và menu liên quan được tạo trong cùng giao dịch khi nằm trong một lệnh. Không tự thêm mục menu nếu admin chỉ yêu cầu tạo sale.

### Bước 4 — Hiển thị và áp dụng giá

- Hiển thị giá gốc gạch ngang, giá sale, mức giảm và ngày sử dụng được ưu đãi trên danh sách, trang chi tiết và trang ưu đãi. Sau dịp lễ, danh sách hiện hành trở về giá thường.
- Tính sale theo đúng ngày sử dụng và mức thời lượng khách chọn, cập nhật ngay khi đổi ngày và chuyển sang bước đặt lịch với cùng chính sách giá.
- Khi có sale lễ phù hợp, vẫn cho khách nhập voucher hợp lệ và cộng khoản giảm voucher với sale ngày theo giá niêm yết. Máy chủ tính lại riêng từng khoản, áp trần tổng giảm tại giá gốc và ghi snapshot vào booking.
- Máy chủ tính lại giá trước khi tạo hoặc dời lịch. Nếu ngày sử dụng hoặc chiến dịch đã thay đổi kể từ lúc báo giá, giao diện cập nhật và yêu cầu khách kiểm tra lại số tiền trước khi gửi tiếp.
- Dời lịch có hai giai đoạn: tạo báo giá chưa thay đổi lịch hẹn, rồi xác nhận báo giá để lưu. Báo giá được gắn với đúng lịch, ngày giờ mới, người thao tác, phiên bản dữ liệu và thời hạn. Dữ liệu đã đổi hoặc khung giờ hết chỗ thì không được tự lưu giá/ngày khác với bản đã xác nhận.
- Phân biệt chênh lệch giá dịch vụ với khoản cần thu/hoàn thực tế theo tiền đã thu ròng. Xác nhận dời lịch không tự tạo giao dịch thu tiền hoặc hoàn tiền.
- Xét điều kiện bằng ngày sử dụng dịch vụ, trạng thái chiến dịch và thời gian máy chủ; đặt trước ngày lễ không bị từ chối chỉ vì hiện tại chưa đến ngày lễ. Không phụ thuộc việc AI còn chạy hay tiến trình hẹn giờ có hoạt động.
- Giao diện đang mở cần cập nhật khi thay đổi ngày sử dụng, qua mốc kết thúc dịp lễ và khi cửa sổ được mở lại.
- Sau lệnh thành công, làm mới phần bị ảnh hưởng và giữ lại hội thoại agent, vị trí trang cùng dữ liệu biểu mẫu đang nhập.

### Bước 5 — Đọc lại, nhật ký và xử lý lỗi

- Sau mỗi lệnh ghi, máy chủ bắt buộc đọc lại chiến dịch, trang, menu và phép tính giá mẫu để đối chiếu với yêu cầu đã chuẩn hóa.
- Chỉ báo “đã tạo/đã sửa” khi có kết quả ghi và kiểm chứng tương ứng; auditor AI có thể giải thích nhưng không thay thế phép đối chiếu này.
- Nhật ký ghi admin thực hiện, mã yêu cầu, thay đổi trước/sau, thời gian và kết quả kiểm chứng.
- Dùng giao dịch và kiểm tra phiên bản để tránh ghi thiếu hoặc ghi đè thay đổi mới của admin khác.
- Nếu AI timeout sau khi dữ liệu đã lưu, trả trạng thái từ nhật ký thao tác; không báo chưa thực hiện rồi tạo lại lần nữa.

## 5. Các phần dự kiến thay đổi

| Phần | Mục đích |
| --- | --- |
| Module mới về chiến dịch và giá trong `assets/js/domain/` | Quy tắc sale, hiệu lực và giá dùng chung cho frontend/backend. |
| Module công cụ Agent Website trong `server/` | Hiểu yêu cầu và thực hiện các thao tác được phép. |
| `server/server.js`, `server/serviceCatalog.js` | Lưu chiến dịch/menu/trang; kiểm tra quyền; tính giá và ghi lịch; trả catalog theo giá hiện hành. |
| `assets/js/data/repositories.js`, `assets/js/services/apiClient.js` | Dữ liệu mới, đồng bộ và cập nhật từng phần. |
| `assets/js/demo.js` và trang mẫu mới | Menu động và route nội dung/ưu đãi. |
| Các trang dịch vụ, chi tiết, đặt lịch và Agent Admin | Hiển thị sale nhất quán, thao tác bằng lệnh và kết quả thực hiện. |
| Các luồng chatbot cung cấp giá | Dùng cùng giá có hiệu lực để không tư vấn lệch giá đặt lịch. |
| `tests/` | Kiểm thử quy tắc giá, công cụ agent, API và luồng trình duyệt liên quan. |

## 6. Ma trận kiểm chứng trước khi hoàn tất

| Tình huống | Điều kiện đạt |
| --- | --- |
| Lệnh đủ thông tin | Tạo đúng chiến dịch ngay; đọc lại khớp yêu cầu; có nhật ký. |
| Lệnh thiếu mức giảm/ngày/dịch vụ hoặc khớp nhiều chương trình | Hỏi đúng thông tin còn thiếu; không ghi dữ liệu. |
| Khách/staff gọi công cụ | Bị từ chối phía máy chủ, kể cả gọi trực tiếp API. |
| Đặt trước cho đúng ngày lễ | Vẫn được sale lễ dù ngày tạo lịch chưa đến dịp lễ. |
| Đặt đúng ngày lễ nhưng sử dụng sau ngày lễ | Không được sale lễ; không dùng ngày tạo lịch để cấp ưu đãi. |
| Khoảng ngày lễ, sau ngày lễ, chiến dịch bị tắt | Xét đúng ngày sử dụng và trạng thái bật/tắt; qua dịp lễ không quảng bá giá sale hết hạn trên danh sách hiện hành. |
| Ranh giới ngày theo giờ Việt Nam | Ngày sử dụng đầu/cuối dịp lễ có sale; ngày kế tiếp không có sale lễ đó. |
| Các mức thời lượng | Giá gốc và sale đúng cho từng mức; tổng đặt lịch trùng mức đã chọn. |
| Sale lễ cùng voucher | Tính cả sale ngày và voucher hợp lệ trên giá niêm yết rồi cộng khoản giảm; không vượt giá niêm yết. Khi không có sale phù hợp, voucher vẫn xét theo điều kiện riêng. |
| Hai sale lễ trùng ngày sử dụng | Chọn mức giảm tiền thực tế lớn nhất; bằng nhau thì phạm vi hẹp hơn, rồi thời điểm tạo/cập nhật gần nhất; không cộng dồn. |
| Giả mạo giá từ trình duyệt | Máy chủ bỏ qua số tiền tự gửi và tính lại giá đúng. |
| Sale đổi giữa báo giá và gửi lịch | Thông báo giá mới, không tạo lịch với số tiền chưa được khách kiểm tra lại. |
| Hết sale hoặc sửa chiến dịch | Giá hiện hành cập nhật; lịch đã tạo giữ nguyên số tiền đã lưu. |
| Dời lịch vào/ra ngoài ngày lễ hoặc sang dịp lễ khác | Tính lại đúng chương trình theo ngày mới, hiển thị chênh lệch và chỉ lưu sau khi khách/admin bấm xác nhận. |
| Báo giá dời lịch, hủy thao tác, agent chưa được xác nhận | Lịch hẹn và tiền giữ nguyên; không tăng lượt mã hoặc tạo giao dịch thu/hoàn. |
| Báo giá hết hạn hoặc dữ liệu thay đổi trước xác nhận | Báo lại giá và yêu cầu xác nhận mới; không áp dụng âm thầm. |
| Lịch đã cọc hoặc thanh toán | Phân biệt giảm tổng giá với số tiền thực sự cần hoàn; giữ nguyên lịch sử tiền đã thu/hoàn. |
| Gửi lặp, lỗi mạng, AI timeout sau khi ghi | Một yêu cầu chỉ tạo một kết quả; hiển thị đúng trạng thái thực tế. |
| Hai admin sửa đồng thời | Phát hiện xung đột; không ghi đè âm thầm. |
| Trang/menu mới | Mở được từ menu và URL trực tiếp, reload vẫn còn; slug trùng bị chặn; nội dung được escape. |
| Dữ liệu và giao diện sau reload | Sale/menu/trang tồn tại trong SQLite; giá nhất quán ở catalog, chi tiết, chatbot và đặt lịch. |
| AI thật | Kiểm tra khóa/quota và một tập lệnh tiếng Việt trên dữ liệu thử riêng; tách kết quả này khỏi test mô phỏng. |
| Hồi quy | Bộ test hiện có tiếp tục đạt; kiểm thử trình duyệt trên desktop và kích thước mobile. |

## 7. Những điều chưa được xác minh hoặc chưa chốt

- Đã triển khai và kiểm thử nền tảng Bước 1: mô hình sale, tính giá thuần, tính chênh lệch cần thu/hoàn, migration ba bảng và đọc dữ liệu chiến dịch từ SQLite.
- Chưa nối sale vào luồng giá đang dùng, menu/trang mẫu hoặc agent. Chưa triển khai endpoint báo giá/xác nhận dời lịch; bảng quote hiện chỉ là nền tảng dữ liệu.
- Chưa kiểm chứng khả năng gọi Gemini thật, quota, tốc độ và độ chính xác xử lý lệnh sale.
- Chưa kiểm thử trình duyệt, ranh giới thời gian hoặc nhiều thiết bị cho luồng mới.
- Đã chốt đầy đủ nghiệp vụ cốt lõi: ngày sử dụng, chọn một sale ngày, cộng sale ngày với voucher trên giá niêm yết, thứ tự xử lý sale trùng và tính lại/xác nhận giá khi dời lịch.
- Phần thiết kế cần cụ thể hóa cách biểu diễn phạm vi, báo giá có phiên bản, ghi nhận chênh lệch và tương thích dữ liệu cũ. Đây là chi tiết kỹ thuật, không phải lý do tự thay đổi chính sách đã chốt.
- Chưa tạo danh sách ngày lễ; các ngày có tính biến đổi cần nguồn ngày/tháng/năm đã xác minh nếu bổ sung tính năng suy ra từ tên dịp lễ.

Kết quả hiện tại là nền tảng Bước 1 và các kiểm thử tương ứng. Chưa mở quyền quản lý sale hoặc thay đổi hành vi dời lịch đang dùng; các phần này cần được nối cùng quy trình xác nhận giá.

## 8. Phân tích thiết kế Bước 1

Xem [HOLIDAY_SALE_PRICING_DESIGN.md](HOLIDAY_SALE_PRICING_DESIGN.md) để đánh giá thiết kế, và [HOLIDAY_SALE_STEP1_REPORT.md](HOLIDAY_SALE_STEP1_REPORT.md) để xem phần đã triển khai, kiểm thử cùng các giới hạn hiện tại.
