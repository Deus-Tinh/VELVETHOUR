# BÁO CÁO KIỂM THỬ TỰ ĐỘNG — SERENITY SPA & WELLNESS

**Ngày chạy:** 2026-10-08  
**Môi trường:** Node.js v24.16.0  
**Kết quả:** 55/55 PASS, 0 FAIL trong cả hai lần chạy.

## Cách chạy

```bash
npm test
node tests/run-node.js
```

Test suite dùng memory backend và clock cố định tại 2026-10-08. Dữ liệu test không ghi vào LocalStorage thật của trình duyệt.

## Phạm vi đã chạy

- Service/category/staff CRUD cơ bản và validation category/service.
- Search không dấu; filter kết hợp; sort giá/tên/ngày/rating; pagination bounds.
- Required, email, phone Việt Nam, price/duration/number/date validators.
- Booking hợp lệ, xung đột, slot liền kề, staff specialty/schedule/break, giờ spa, ngày quá khứ, lead time, advance limit, duration/slot step, double submit và giá do client gửi.
- Promotion percent/fixed, start/end, min order, inactive/missing/usage limit, rollback khi booking persistence lỗi.
- Login demo, ownership scope, staff scope, review eligibility/duplicate và rating aggregate.
- Favorites, contact validation/admin listing, seed không ghi đè, corrupt JSON, quota error.
- Dashboard revenue/popular services và service-layer flow từ booking đến review/analytics.

## Kết quả theo case

Test 1–25 là bộ có sẵn ban đầu. Test 26–55 là regression/edge cases thêm cho các rủi ro tìm thấy trong audit. Tên đầy đủ và assertion nằm trong tests/tests.js; phạm vi theo nghiệp vụ nằm trong BUSINESS_TEST_MATRIX.md.

| Kết quả | Số lượng |
|----------|----------|
| PASS | 55 |
| FAIL | 0 |
| Tổng | 55 |

## Browser runner

Trang /tests/index.html trong Codex/Edge chỉ hiển thị “Đang chạy kiểm thử...” và không render kết quả suite. Vì vậy không tính browser run là PASS. Routes, DOM events, responsive breakpoints, keyboard/accessibility, console runtime và browser LocalStorage/reload còn cần xác minh trong browser kết nối đúng workspace.
