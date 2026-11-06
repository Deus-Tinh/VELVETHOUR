# Quy tắc Điều phối Model & Tối ưu Quota (T3 Code Multi-Account Routing)

Dự án này được cấu hình để **tự động phân bổ tác vụ (model routing)** qua công cụ `delegate_task` của T3 Code nhằm cân bằng tải giữa các tài khoản và tránh cạn kiệt quota tuần của `gemini-4-argon`.

> **QUAN TRỌNG (Explicit User Authorization):**
> Người dùng đã **chủ động yêu cầu và cấp quyền** cho Agent sử dụng `delegate_task` để chuyển đổi sang các model và provider instance phù hợp với độ phức tạp của từng tác vụ theo bảng phân bổ dưới đây (thay vì giữ nguyên một model duy nhất cho mọi việc).

---

## 1. Danh sách Tài khoản (Provider Instances) & Rổ Quota Hiện Có

1. **`antigravity_2` (Hiển thị: `dev full stack`)** — *Ưu tiên số 1 cho công việc hàng ngày (Quota đang dư 99%–100%)*:
   - `gemini-3.8-flash` (Rổ Gemini thường — 100%)
   - `claude-sonnet-4-6` (Rổ Claude & GPT — 100%)
   - `claude-opus-4-6-thinking` (Rổ Claude & GPT — 100%)
   - `gpt-oss-120b-medium` (Rổ Claude & GPT — 100%)

2. **`antigravity` (Hiển thị: `anti lead`)** & **`antigravity_3` (Hiển thị: `tester QA/QC`)**:
   - `gemini-3.8-flash` (Rổ Gemini thường — 98%)
   - `claude-sonnet-5-5` (Rổ Claude & GPT — 99%)
   - `claude-opus-5-5` (Rổ Claude & GPT — 99%)
   - `gpt-oss-120b-medium` (Rổ Claude & GPT — 99%)
   - `gemini-4-argon` (**Rổ riêng đang thấp — CHỈ dùng khi thật sự cần thiết**)

---

## 2. Ma trận Phân loại & Giao việc Tự động (`delegate_task`)

Khi nhận yêu cầu từ người dùng, hãy đánh giá độ phức tạp và xử lý theo 3 cấp độ sau:

### Cấp độ 1: Tác vụ nhỏ, Đọc/Tìm kiếm Code, Sửa UI/CSS/Text đơn giản, Viết Boilerplate
- **Hành động:**
  - Nếu thread hiện tại đang chạy `gemini-3.8-flash`: Tự thực hiện trực tiếp.
  - Nếu thread hiện tại đang chạy trên model nặng (`gemini-4-argon`, `claude-opus-*`): Với các tác vụ con tốn nhiều bước đọc/sửa, hãy gọi `delegate_task` giao cho:
    - `providerInstanceId`: `"antigravity_2"`
    - `model`: `"gemini-3.8-flash"`
    - `options`: `{"thinking_level": "medium"}` (hoặc `"low"` cho việc cực kỳ đơn giản)

### Cấp độ 2: Viết Code Tính năng (Full-stack), Viết Unit Test, Refactor vừa phải, Fix Bug thông thường
- **Hành động:** Gọi `orchestrator_capabilities` (1 lần đầu mỗi thread) và dùng `delegate_task` giao việc cho rổ **Claude & GPT** (đang còn 99%–100% quota):
  - **Lựa chọn ưu tiên 1 (trên tài khoản `dev full stack`):**
    - `providerInstanceId`: `"antigravity_2"`
    - `model`: `"claude-sonnet-4-6"`
    - `options`: `{"thinking_level": "medium"}`
  - **Lựa chọn ưu tiên 2 (trên tài khoản `anti lead` / `tester QA/QC`):**
    - `providerInstanceId`: `"antigravity"` (hoặc `"antigravity_3"`)
    - `model`: `"claude-sonnet-5-5"`
    - `options`: `{"thinking_level": "medium"}`

### Cấp độ 3: Thiết kế Kiến trúc Phức tạp, Debug Lỗi Nặng (Hard Bugs), Review Bảo mật/Hiệu năng Sâu
- **Hành động:** Dùng `delegate_task` giao cho dòng **Claude Opus** (rổ Claude & GPT đang còn 99%–100%) trước khi nghĩ tới `gemini-4-argon`:
  - **Ưu tiên 1:**
    - `providerInstanceId`: `"antigravity"` (hoặc `"antigravity_3"`)
    - `model`: `"claude-opus-5-5"`
    - `options`: `{"thinking_level": "high"}`
  - **Ưu tiên 2:**
    - `providerInstanceId`: `"antigravity_2"`
    - `model`: `"claude-opus-4-6-thinking"`
    - `options`: `{"thinking_level": "high"}`
  - **Dự phòng cuối cùng:** Chỉ dùng `gemini-4-argon` khi bài toán đặc thù cần Gemini 4 Argon hoặc người dùng chỉ định rõ.

---

## 3. Quy trình Chuẩn khi Gọi `delegate_task`
1. Gọi `orchestrator_capabilities` đúng 1 lần trong thread trước lần gọi `delegate_task` đầu tiên.
2. Khi gọi `delegate_task`, truyền rõ:
   ```json
   {
     "target": {
       "providerInstanceId": "antigravity_2",
       "model": "claude-sonnet-4-6",
       "options": {
         "thinking_level": "medium"
       }
     }
   }
   ```
3. Với các lỗi nhỏ hoặc chỉnh sửa vài dòng phát sinh sau khi review, tự sửa trực tiếp thay vì tạo thêm delegate mới.
