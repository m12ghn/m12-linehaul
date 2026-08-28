---
name: m12-create-api-endpoint
description: Tạo mới 1 Cloudflare Pages Function endpoint (/api/...) cho m12-lich-tai — CRUD trên Cloudflare KV, có/không cần xác thực admin. Kích hoạt khi user yêu cầu "thêm API mới", "tạo endpoint /api/...", "lưu dữ liệu X vào KV", hoặc cần backend nhận/trả dữ liệu cho 1 tính năng dashboard mới.
---

# Tạo Cloudflare Pages Function endpoint mới

Đọc [m12-conventions](../m12-conventions/SKILL.md) trước (đặc biệt mục bảo mật) nếu chưa đọc trong phiên này.

## Vị trí & quy ước

- Mỗi endpoint là 1 file trong [functions/api/](../../../functions/api) — tên file = tên route
  (`functions/api/foo.ts` → `/api/foo`). File tiền tố `_` (như `_admin.ts`) KHÔNG phải route, chỉ để import.
- Export `onRequestGet` / `onRequestPost` / `onRequestDelete` (Cloudflare Pages Functions convention),
  KHÔNG dùng Express-style router.
- Response luôn qua helper `json(obj, status)` cục bộ trong file — trả `content-type: application/json`,
  `cache-control: no-store` (dữ liệu realtime, không cache CDN).

## Các pattern KV đã có sẵn — bám theo, không tự chế

Tham khảo 3 endpoint mẫu đã có, chọn cái gần nhất với nhu cầu:

| Endpoint mẫu | Pattern | Khi nào dùng |
|---|---|---|
| `functions/api/qa.ts` | List + reply-thread trong 1 KV key, giới hạn `MAX`/`MAX_REPLIES` | Dữ liệu dạng thread/list có thể tăng dần |
| `functions/api/overview.ts` | Snapshot theo ngày, key `ovsnap:YYYY-MM-DD`, `expirationTtl` | Dữ liệu chỉ cần đóng băng theo mốc thời gian |
| `functions/api/dashdata.ts` | Nhiều "nguồn" nhỏ dưới 1 namespace, giới hạn tổng dung lượng | Dữ liệu do user tự thêm/xoá, cần giới hạn kích thước |

Có sẵn template khởi điểm ở [assets/endpoint-template.ts](assets/endpoint-template.ts) — copy vào
`functions/api/<ten>.ts` rồi chỉnh theo nhu cầu thay vì viết từ đầu.

## Auth — dùng đúng hàm có sẵn, không viết lại

- Import `isAdminReq` từ `./_admin` để check quyền admin: `isAdminReq(request, env)` — so header
  `x-admin-token` với `env.ADMIN_TOKEN` (secret, không phải plaintext trong `wrangler.toml`).
- KHÔNG dùng `isGhnEmail()` để cấp quyền admin — hàm đó chỉ dùng cho user-gate (email @ghn.vn), không phải
  quyền chỉnh sửa (xem comment trong `_admin.ts`: *"Email GHN KHÔNG còn là admin"*).
- Endpoint nào cho phép ghi/xoá dữ liệu chung (không phải của riêng user) → PHẢI check `isAdminReq` trước
  khi thực hiện, trả `401` nếu sai.

## KV namespace

- Namespace mặc định `QA_KV` đã bind sẵn trong `wrangler.toml` (`binding = "QA_KV"`), hầu hết endpoint nhỏ
  dùng chung namespace này với key riêng (`"qa:list"`, `"ovsnap:..."`, `"extra:..."`).
- Nếu thực sự cần KV namespace riêng (dữ liệu lớn/độc lập), phải tạo bằng `wrangler kv namespace create <ten>`
  rồi thêm `[[kv_namespaces]]` mới vào `wrangler.toml` — **đây là thay đổi hạ tầng, hỏi user trước khi tạo
  namespace mới** thay vì tự ý thêm.

## Validate input (bắt buộc — API top-level, không qua middleware)

- Luôn `.trim().slice(0, N)` chuỗi từ client trước khi lưu (xem `qa.ts`: `.slice(0, 1500)` cho nội dung,
  `.slice(0, 60)` cho tên).
- Check độ dài tối thiểu, trả `400` với `{error: "empty"}` nếu rỗng — không throw exception thô.
- `body: any = await request.json().catch(() => ({}))` — luôn catch lỗi parse JSON, không để crash function.

## Sau khi tạo endpoint mới

1. Test bằng `npm run dev` + `curl`/Postman tới `http://localhost:5180/api/<ten>` (port khai báo trong
   `.claude/launch.json`).
2. Nếu endpoint cần gọi từ frontend, viết client helper trong `src/lib/<ten>.ts` (theo mẫu `src/lib/qa.ts`),
   không gọi `fetch` rải rác trong component.
3. Deploy theo skill `m12-deploy-cloudflare` — Functions tự động deploy cùng `wrangler pages deploy dist`,
   không cần bước riêng.
