# Quy Tắc Đặt Tên Nhánh Git (Git Branch Naming Convention)

Tài liệu này quy định chuẩn đặt tên nhánh (branch) và thông điệp commit trong dự án **Serenity Spa & Wellness (VelvetHour)** nhằm giúp Reviewer dễ dàng nắm bắt mục đích thay đổi khi kiểm tra Pull Request.

## 1. Cấu trúc tên nhánh

```text
<loại-nhánh>/<mô-tả-ngắn-bằng-kebab-case>
```

### Các tiền tố (`<loại-nhánh>`) được sử dụng:
| Tiền tố | Mục đích sử dụng | Ví dụ thực tế trong dự án |
| :--- | :--- | :--- |
| `feat/` | Thêm tính năng mới cho người dùng hoặc hệ thống quản trị | `feat/auth-password-management`, `feat/clean-url-router` |
| `fix/` | Sửa lỗi (bug fix) giao diện, nghiệp vụ hoặc kết nối API | `fix/booking-staff-availability`, `fix/vercel-connection` |
| `refactor/` | Tái cấu trúc mã nguồn, tối ưu kiến trúc không làm đổi hành vi | `refactor/service-catalog-model` |
| `deploy/` | Cấu hình triển khai, hạ tầng, proxy hoặc môi trường | `deploy/vercel-proxy-20261104` |
| `test/` | Bổ sung hoặc cập nhật bộ kiểm thử tự động | `test/auth-otp-flow` |
| `docs/` | Cập nhật tài liệu kỹ thuật, hướng dẫn vận hành | `docs/branch-naming-convention` |

## 2. Quy tắc chi tiết
1. **Chỉ dùng chữ thường, số và dấu gạch ngang (`-`)**: Không dùng khoảng trắng, chữ hoa hay ký tự đặc biệt trong phần mô tả (`kebab-case`).
2. **Ngắn gọn, thể hiện rõ phạm vi**: Nêu rõ module hoặc chức năng chính (ví dụ: `feat/auth-password-management` cho tính năng quản lý mật khẩu, đổi mật khẩu và quên mật khẩu).
3. **Commit message đi kèm**: Tuân theo chuẩn Conventional Commits:
   - `feat(auth): ...`
   - `fix(booking): ...`
   - `refactor(booking): ...`
   - `test(auth): ...`
