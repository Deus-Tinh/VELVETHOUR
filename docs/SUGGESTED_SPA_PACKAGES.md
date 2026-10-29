# Gợi ý gói trị liệu cho Serenity Spa

Ngày tham khảo menu: 15/10/2026. Ghi chú này tổng hợp menu spa tham khảo và đề xuất gói cho VelvetHour. Năm gói trong mục “Năm đề xuất bổ sung” đã được thêm vào catalog mẫu; giá là mức khởi điểm để chủ spa duyệt.

## Mẫu menu tham khảo

- **Ngải Spa** chia menu thành nhóm trị liệu, thư giãn, chăm sóc mặt/cơ thể và chân; menu có các gói theo nhu cầu như *Office Savior* (1.350.000₫/110 phút), *Summer's Breeze* (1.420.000₫/120 phút) và *Winter's Sunshine* (1.490.000₫/135 phút). Điều này gợi ý đặt tên theo mục đích và xây dựng một hành trình nhiều bước quanh nhu cầu cụ thể. [Menu 2026 của Ngải Spa](https://ngai.vn/menu.html)
- **HIÊN Wellness Spa** giới thiệu combo gội dưỡng sinh với ủ tóc (720.000₫/100 phút), massage đá nóng với gội dưỡng sinh (880.000₫/120 phút), chăm sóc da với gội dưỡng sinh (950.000₫/120 phút), và một nghi thức toàn diện kết hợp tóc, da, cơ thể. HIÊN công bố cả giá lẻ, giá combo và mức tiết kiệm; đây là mẫu tốt cho combo 2 dịch vụ dễ hiểu và một gói cao cấp nhiều dịch vụ. [Menu HIÊN Wellness Spa](https://hienwellness.com/dich-vu)
- **Trạm Spa** có ba combo 90 phút theo nhu cầu, trong đó có massage toàn thân với cổ-vai-gáy và trị liệu sâu với gội chăm sóc da đầu; giá niêm yết trên trang là 599.000–699.000₫. Cách ghép này cho thấy gói có thể giải quyết một nhu cầu cụ thể, đồng thời tạo một lựa chọn thời lượng và giá trọn gói dễ so sánh. [Menu Trạm Spa](https://tramspa.vn/dich-vu)

## Năm menu spa tham khảo bổ sung

- **Angsana Spa, Hồ Tràm** có gói *Worry Free* 90 phút, ghép massage Java 60 phút với massage da đầu 30 phút; *Wake Up Call* cũng 90 phút, ghép massage 60 phút với massage chân 30 phút. Đây là mẫu kết hợp massage toàn thân và một vùng chăm sóc bổ sung trong cùng buổi. [Menu Angsana Hồ Tràm](https://www.angsana.com/assets/2025-03/an-ho-tram-spa-menu.pdf)
- **Nonla Healing Spa** ghép gội đầu thảo dược với chăm sóc mặt (Combo 1, 550.000₫), hoặc ghép mặt, gội đầu và massage chân (Combo 3, 890.000₫). Trang không nêu thời lượng các combo. [Menu Nonla Healing Spa](https://nonlahealingspa.com/services/)
- **Spa Bar** có combo *Tĩnh lặng* 120 phút giá 1.010.000₫, kết hợp aroma với gội đầu hoặc massage chân; đây là mẫu gói có lựa chọn nhánh dịch vụ đi kèm. [Các gói kết hợp của Spa Bar](https://spabar.vn/dich-vu/cac-goi-ket-hop/)
- **Palago Boutique Hanoi** có combo massage Việt + chăm sóc mặt cơ bản 120 phút/990.000₫ và aroma + chăm sóc mặt 120 phút/1.100.000₫. Đây là mẫu ghép trị liệu cơ thể và chăm sóc mặt với giá, thời lượng trọn gói. [Combo massage Palago](https://palagoboutiquehanoi.com/hotel-services/combo-massage/)
- **Tigon Spa** có combo massage toàn thân + gội đầu 90 phút/750.000₫, massage đá nóng + gội dưỡng sinh 120 phút/1.000.000₫ và massage chân + gội đầu 90 phút/750.000₫. [Các combo Tigon Spa](https://tigonspa.com.vn/en/combos)

## Đề xuất cho catalog hiện tại

Các mã dưới đây đều là liệu trình độc lập đã có trong [service seed](../assets/js/data/servicesSeed.js). Thời lượng và giá trong bảng là **mức cấu hình đề xuất của Serenity**, không phải giá từ các menu spa tham khảo và không nên được tính tự động bằng cách cộng thời lượng/giá liệu trình. Chọn một mức gói để đặt **một kỹ thuật viên, một lịch liên tục**.

| Tên gói gợi ý | Thành phần hiện có | Mức thời lượng và giá gói đề xuất | Lý do |
|---|---|---|---|
| **Thư Giãn Từ Đầu Đến Chân** | `foot-back-neck` + `herbal-hair-wash` | 120 phút · **690.000₫** | Ghép chăm sóc vùng thường mỏi với gội dưỡng sinh. Gần với mẫu trị liệu + gội của Trạm và định hướng thảo mộc Việt của HIÊN, nhưng dùng đúng dịch vụ Serenity đã có. |
| **Cân Bằng Cơ Thể** | `shiatsu-massage` + `cupping-aroma` | 120 phút · **890.000₫** | Một gói thiên về bấm huyệt và thư giãn cơ, dùng hai liệu trình có thể thực hiện nối tiếp bởi cùng một kỹ thuật viên. Tạo lựa chọn trị liệu tập trung bên cạnh các combo thiên về thư giãn của đối thủ. |
| **Thư Thái & Rạng Rỡ** | `aroma-therapy` + `facial-dermalogica` | 150 phút · **1.090.000₫** | Ghép massage tinh dầu với chăm sóc da mặt thành một gói chăm sóc cơ thể và da. Hướng này tương đồng với các combo massage/chăm sóc da của Ngải và các gói chăm sóc mặt kết hợp của HIÊN. |

## Năm đề xuất bổ sung

Các mức dưới đây tiếp tục là **giá và thời lượng gói do Serenity đề xuất**, cấu hình độc lập với tổng thời lượng/giá liệu trình thành phần và không lấy từ menu đối thủ.

| Tên gói gợi ý | Thành phần hiện có | Mức thời lượng và giá gói đề xuất | Lý do |
|---|---|---|---|
| **Mộc Tâm & Dưỡng Sinh** | `signature-body` + `herbal-hair-wash` | 150 phút · **920.000₫** | Kết hợp massage toàn thân với chăm sóc da đầu thảo dược; hợp với mẫu massage + scalp của Angsana và định hướng dưỡng sinh của HIÊN. |
| **Làm Mới & Thả Lỏng** | `body-scrub-bath` + `aroma-therapy` | 150 phút · **990.000₫** | Tẩy da chết rồi massage tinh dầu tạo hành trình chăm sóc da cơ thể và thư giãn; Spa Bar cũng đưa aroma vào combo với một dịch vụ chăm sóc bổ sung. |
| **Dẻo Dai, Nhẹ Chân** | `thai-massage` + `foot-head-neck` | 150 phút · **990.000₫** | Ghép kéo giãn toàn thân với chăm sóc bàn chân, đầu và cổ-vai-gáy; Angsana và Tigon đều có combo massage toàn thân/chân với chăm sóc chân. |
| **Ấm Đá & Sáng Da** | `hot-stone` + `facial-dermalogica` | 180 phút · **1.290.000₫** | Ghép đá nóng với chăm sóc da mặt; Palago có các combo ghép massage cơ thể với facial, làm mẫu tham khảo cho kiểu kết hợp này. |
| **Gội Thảo Mộc & Chăm Da** | `herbal-hair-wash` + `facial-dermalogica` | 135 phút · **920.000₫** | Gội dưỡng sinh kết hợp chăm sóc mặt; hướng ghép này xuất hiện trực tiếp trong menu Nonla, đồng thời Palago cũng cho thấy nhu cầu kết hợp massage và chăm sóc mặt. |

## Nghiên cứu menu theo nhóm liệu trình

Tham khảo các website/menu chính thức ngày 15/10/2026. Tên, thời lượng và giá dưới đây là thông tin niêm yết của từng spa để lấy ý tưởng chủ đề; giá thay đổi theo menu và không phải giá đề xuất cho Serenity. Mỗi nhóm có bốn hướng tham khảo, không chép phần mô tả quảng bá.

### Cổ – vai – gáy

| Menu tham khảo | Thời lượng | Giá niêm yết | Chủ đề có thể tham khảo |
|---|---:|---:|---|
| Dao’s Care — Neck & Shoulder | 30 / 45 / 60 phút | 220.000 / 320.000 / 420.000₫ | Một dịch vụ mục tiêu với các mức thời lượng; menu ghi phiên 30 phút cần ghép với liệu trình massage khác. [Menu chính thức](https://www.daoscare.com/menu) |
| Nonla Healing Spa — Neck & Shoulder Massage | 30 / 60 / 90 phút | 200.000 / 400.000 / 550.000₫ | Cùng một nhu cầu, có lựa chọn ngắn, vừa và dài. [Bảng dịch vụ chính thức](https://nonlahealingspa.com/services/) |
| Dưỡng Sinh Spa — Intensive Neck & Shoulder Therapy | 40 / 70 phút | 289.000 / 549.000₫ | Một phiên tập trung có thể tách khỏi massage toàn thân. [Bảng giá chính thức](https://duongsinhspa.vn/en/service-price-list/) |
| Trạm Spa — Neck & Shoulder Therapy | 60 phút | 500.000₫ | Dịch vụ cổ-vai-gáy chuyên biệt ở mức một giờ. [Menu chính thức](https://tramspa.vn/en) |

### Chân

| Menu tham khảo | Thời lượng | Giá niêm yết | Chủ đề có thể tham khảo |
|---|---:|---:|---|
| Zen Herbal Onsen Spa — Champa Foot Ritual | 30 / 45 phút | 250.000 / 350.000₫ | Nghi thức chân có ngâm và chăm sóc gót. [Menu & giá chính thức](https://zenherbalspadanang.com/menu-pricing?lang=vi) |
| Yuki Beauty & Spa — Foot Massage | 30 / 60 / 90 phút | 250.000 / 390.000 / 550.000₫ | Bấm huyệt chân và ngâm chân thảo mộc theo thời lượng. [Menu chính thức](https://yukispa.com.vn/massage) |
| Dao’s Care — Foot & Back | 90 phút | 520.000₫ | Ghép chăm sóc chân với lưng trong một liệu trình đơn khách. [Menu chính thức](https://www.daoscare.com/menu) |
| Nonla Healing Spa — Foot Massage | 30 / 60 phút | 200.000 / 350.000₫ | Lựa chọn massage chân ngắn hoặc tiêu chuẩn. [Bảng dịch vụ chính thức](https://nonlahealingspa.com/services/) |

### Đầu – mặt

| Menu tham khảo | Thời lượng | Giá niêm yết | Chủ đề có thể tham khảo |
|---|---:|---:|---|
| Dao’s Care — Head | 30 phút | 220.000₫ | Chăm sóc đầu bằng bấm huyệt và massage da đầu; phiên 30 phút cần ghép với liệu trình massage khác theo menu. [Menu chính thức](https://www.daoscare.com/menu) |
| Nonla Healing Spa — Herbal Head Spa | 40 / 45 / 60 / 75 phút | 150.000 / 250.000 / 350.000 / 450.000₫ | Gội thảo dược có các cấp thời lượng. [Bảng dịch vụ chính thức](https://nonlahealingspa.com/services/) |
| HIÊN Wellness Spa — Dưỡng sáng & Rạng rỡ | 50 phút | 550.000₫ | Một liệu trình mặt riêng tập trung vào chăm sóc và dưỡng sáng. [Menu chính thức](https://hienwellness.com/dich-vu) |
| Dưỡng Sinh Spa — Herbal Head Spa & Face Rejuvenation Package | 100 phút | 1.099.000₫ | Kết hợp head spa với chăm sóc mặt trong một phiên. [Bảng giá chính thức](https://duongsinhspa.vn/en/service-price-list/) |

## Mười hai liệu trình đã thêm vào catalog

Các tên và mô tả dưới đây được viết riêng cho VelvetHour dựa trên những chủ đề thường có trong menu tham khảo, không sao chép nội dung quảng cáo của spa khác. Giá và thời lượng là mức cấu hình đề xuất để demo/catalog; cần chủ spa duyệt trước khi dùng làm bảng giá thật.

| Nhóm | Liệu trình | Thời lượng · Giá đề xuất |
|---|---|---:|
| Cổ – vai – gáy | Massage Cổ Vai Gáy Thư Giãn | 45 phút · 350.000₫ |
| Cổ – vai – gáy | Bấm Huyệt Cổ Vai Gáy | 60 phút · 450.000₫ |
| Cổ – vai – gáy | Massage Vai Gáy Chườm Túi Thảo Mộc | 60 phút · 490.000₫ |
| Cổ – vai – gáy | Thư Giãn Cổ Gáy & Lưng Trên | 75 phút · 560.000₫ |
| Chân | Ngâm Chân Thảo Mộc & Massage | 45 phút · 320.000₫ |
| Chân | Bấm Huyệt Lòng Bàn Chân | 60 phút · 420.000₫ |
| Chân | Massage Chân Đá Ấm | 75 phút · 520.000₫ |
| Chân | Chăm Sóc Gót Chân & Massage Bắp Chân | 60 phút · 450.000₫ |
| Đầu – mặt | Bấm Huyệt & Massage Da Đầu | 45 phút · 350.000₫ |
| Đầu – mặt | Massage Đầu Kiểu Thái | 45 phút · 390.000₫ |
| Đầu – mặt | Massage Gua Sha Mặt & Cổ | 45 phút · 420.000₫ |
| Đầu – mặt | Massage Thái Dương & Vùng Mắt | 30 phút · 300.000₫ |

Các mục này được thêm vào [service seed](../assets/js/data/servicesSeed.js), nhóm lọc liệu trình, catalog ảnh và migration cho database hiện tại. Mỗi mục dùng một ảnh Pexels riêng; nguồn và tác giả được liệt kê trong [ASSET_CREDITS.md](../ASSET_CREDITS.md).

## Ràng buộc khi cân nhắc

- Mô tả gói tham chiếu các ID liệu trình độc lập hiện có, không tạo bản sao liệu trình. Quy ước catalog và đặt lịch nằm trong [CONTEXT.md](../CONTEXT.md).
- Xem mỗi cặp thời lượng/giá là **lựa chọn gói được cấu hình**; không suy ra từ tổng của các thành phần. Khi đặt, giữ một kỹ thuật viên và một khoảng lịch liên tục cho toàn bộ gói.
- Không đề xuất gói đôi hoặc ghép `four-hands`, vì đặt lịch hiện tại chỉ hỗ trợ một kỹ thuật viên.
- Giá đối thủ trong ghi chú chỉ để mô tả menu đã tham khảo. Tất cả mức giá gói trong hai bảng là đề xuất ban đầu để Serenity xem xét; cần chủ spa chốt theo chi phí vận hành và định vị trước khi đưa vào catalog.
- Năm gói bổ sung đã được thêm vào seed catalog và có migration để chèn các ID còn thiếu vào cơ sở dữ liệu hiện tại khi khởi động server. Sau khi cập nhật, cần khởi động lại server để migration chạy.
