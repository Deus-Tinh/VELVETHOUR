# Đưa giao diện Serenity lên Cloudflare Pages

## Kiến trúc

- Cloudflare Pages phục vụ giao diện tĩnh được tạo từ `index.html` và `assets/`.
- Pages Function `functions/api/[[path]].js` chuyển `/api/*` sang backend OnWeeny tại `https://serenityspa-37e2.onweeny.com`.
- Chỉ chuyển giao diện và proxy sang Cloudflare; giữ backend hiện tại trên OnWeeny. Backend trong source dùng `node:sqlite`, còn Workers chỉ có module `node:sqlite` dạng stub, nên không chuyển nguyên backend sang Workers.
- `_routes.json` chỉ gọi Function cho `/api` và `/api/*`; file giao diện được Pages phục vụ trực tiếp.

## Preview từ branch

Tạo Cloudflare Pages project bằng Git integration, chọn repository `Deus-Tinh/VELVETHOUR`, rồi cấu hình:

- Root directory: `/`
- Build command: `npm run build:pages`
- Build output directory: `dist`
- Node version: `24.22.1` (đã ghim trong `.node-version`)
- Production branch: `main`

Push branch review sẽ tạo Preview deployment. Cấu hình biến cho Preview trước khi kiểm tra:

| Tên | Loại | Giá trị |
| --- | --- | --- |
| `SERENITY_API_ORIGIN` | Variable | `https://serenityspa-37e2.onweeny.com` |
| `SERENITY_PROXY_TOKEN` | Secret | Cùng giá trị với `SERENITY_PROXY_TOKEN` của backend OnWeeny; tối thiểu 32 ký tự ngẫu nhiên |

Không đặt token trong source, `index.html`, build variables được nhúng vào frontend, hay Git. Nếu token chưa được cấu hình giống nhau ở cả hai đầu, API sẽ không hoạt động. `/api/health` chỉ xác nhận backend trả lời; cần kiểm tra thêm đăng nhập và thao tác booking trên dữ liệu thử nghiệm trước khi chuyển traffic.

## Domain

Cloudflare có thể cấp URL Preview/`pages.dev` để kiểm tra. Địa chỉ `serenityspavn.vercel.app` là subdomain do Vercel cấp, không thể trỏ DNS của nó sang Cloudflare Pages. Muốn dùng Cloudflare làm nơi phục vụ chính, cần gắn một custom domain do bạn sở hữu vào Pages rồi mới chuyển DNS/traffic; giữ Vercel nguyên trạng cho tới khi xác nhận Preview hoạt động.

## Giới hạn thay đổi hiện tại

Branch này chỉ chuẩn bị mã proxy và hướng dẫn. Chưa tạo Pages project, chưa điền secret, chưa gắn domain, chưa đổi DNS và chưa chuyển traffic production. Việc đó cần được thực hiện sau khi bạn duyệt branch và xác nhận custom domain muốn dùng.
