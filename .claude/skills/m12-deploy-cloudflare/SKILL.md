---
name: m12-deploy-cloudflare
description: Build và deploy dashboard m12-lich-tai lên Cloudflare Pages (production tại m12-lich-tai.pages.dev). Kích hoạt khi user nói "deploy", "đẩy lên production", "cập nhật lên web", "publish thay đổi", hoặc sau khi hoàn thành 1 thay đổi code cần lên bản live. LUÔN hỏi xác nhận trước khi thực sự chạy lệnh deploy — đây là hành động ảnh hưởng người dùng thật.
---

# Deploy m12-lich-tai lên Cloudflare Pages

## Kênh deploy chính thức — chỉ dùng link canonical

Theo quy ước đã chốt với user (xem memory `feedback-m12-canonical-link`): **chỉ dùng và nhắc tới**
`https://m12-lich-tai.pages.dev` — KHÔNG đưa link dạng hash tạm (`*.m12-lich-tai.pages.dev` với chuỗi
ngẫu nhiên) mà `wrangler` in ra sau mỗi lần deploy, trừ khi user hỏi riêng.

## Deploy thủ công (1 lần)

```bash
npm run build   # tsc -b && vite build (prebuild tự chạy build-geo.mjs trước)
npm run deploy  # npx wrangler pages deploy dist --project-name=m12-lich-tai --commit-dirty=true
```

Hoặc gộp cả 2 bằng `npm run deploy` (script này tự chạy `npm run build` trước, xem `package.json`).

**Sau khi deploy xong, luôn nhắc user Ctrl+Shift+R (hard refresh)** — Cloudflare Pages cache asset tĩnh,
bản mới có thể không hiện ngay nếu không hard refresh.

## Deploy tự động khi đang code (auto-watch)

```bash
npm run auto   # chạy scripts/auto-deploy.mjs — giữ cửa sổ mở
```

- Theo dõi `src/`, `functions/`, `public/`, `scripts/` + các file cấu hình gốc (`index.html`,
  `vite.config.ts`, `wrangler.toml`, `package.json`).
- Debounce 4 giây — gộp nhiều lần lưu liên tiếp thành 1 lần build+deploy.
- **CHỈ deploy khi build thành công** — nếu `npm run build` fail (exit code ≠ 0), auto-deploy dừng lại,
  không đẩy bản lỗi lên production. Sửa lỗi rồi lưu lại, script tự chạy tiếp.
- Không dùng `npm run auto` khi làm việc chung với người khác trên cùng máy — mỗi lần lưu file là 1 lần
  deploy thật lên production, không phải môi trường staging.

## Trước khi deploy — checklist

1. `npm run build` chạy sạch, không lỗi TypeScript (`tsc -b`) và không lỗi Vite build.
2. Nếu vừa đổi MyMap hoặc thêm alias kho → đã chạy `npm run build:geo` để cập nhật `src/data/geo.json`
   (script `prebuild` tự chạy lại nên thường không cần gọi tay, nhưng kiểm tra log build có dòng
   "✓ Ghi src/data/geo.json").
3. Nếu vừa thêm/sửa endpoint trong `functions/api/` → test bằng `npm run dev` trước, Functions deploy
   cùng lúc với `wrangler pages deploy dist`, không có bước riêng.
4. Nếu vừa thêm biến môi trường/secret mới → xác nhận đã chạy
   `npx wrangler pages secret put <TEN> --project-name=m12-lich-tai` (secret KHÔNG tự có từ code, phải
   set thủ công 1 lần trên Cloudflare).

## Kênh deploy dự phòng (không phải kênh chính, chỉ dùng khi được yêu cầu)

| Kênh | Lệnh | Khi nào dùng |
|---|---|---|
| Vercel | `vercel --prod` | Backup nếu Cloudflare Pages down; dùng `api/sheet.ts` làm proxy CORS thay cho Functions |
| Docker + Nginx | `docker build -t m12-lich-tai . && docker run -p 8080:80 m12-lich-tai` | Self-host VPS, không có Functions (chỉ SPA tĩnh) |

**Không tự ý chuyển kênh deploy chính hoặc sửa `vercel.json`/`Dockerfile`/`nginx.conf` khi chưa được yêu
cầu** — đây là cấu hình hạ tầng, theo quy tắc chung phải hỏi user trước.

## Việc KHÔNG được tự ý làm khi deploy

- Không tự chạy `wrangler pages secret put` với giá trị đoán được — secret phải do user cung cấp.
- Không tự đổi `project-name` trong lệnh deploy hoặc `wrangler.toml` `name`.
- Không force deploy khi `npm run build` đang báo lỗi (bỏ qua bằng cách sửa script) — phải sửa lỗi gốc.
