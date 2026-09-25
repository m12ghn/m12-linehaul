# Pha 3 — Port backend `functions/api/*` sang Vercel + Supabase

Soi 23 file trong `functions/api/` (~4.100 dòng) cho thấy quy mô thật lớn hơn nhiều so với "port
1:1 cho nhanh": phụ thuộc Cloudflare KV nặng, AI đa nhà cung cấp (15+ API key khác nhau), OAuth
ghi ngược Google Sheet, snapshot theo lịch (cron). Port ẩu 1 lần rủi ro làm hỏng hệ thống đang có
người dùng thật hằng ngày. Chiến lược: **cầu nối KV → Postgres** cho các endpoint đơn giản (rủi ro
thấp, port gần như cơ học) trước, **giữ nguyên trên Cloudflare** các phần phức tạp/nhạy cảm cho tới
khi có quyết định rõ ràng từ Sếp.

## Quyết định kiến trúc: `kv_store` — cầu nối thay Cloudflare KV

Nhiều endpoint chỉ là key→value hoặc key→list đơn giản (visits, qa, report, knowledge, users,
dashdata, daily, overview, roles, aiconfig). Thay vì thiết kế bảng quan hệ riêng cho từng cái ngay
(tốn công, chưa chắc đúng nhu cầu Pha 4), dùng 1 bảng cầu nối:

```sql
kv_store(key text primary key, value jsonb, updated_at timestamptz)
```

→ port gần như **thay `env.QA_KV.get(key)` bằng `db.from('kv_store').select('value').eq('key', key)`,
`env.QA_KV.put(key, v)` bằng `.upsert({key, value: v})`** — giữ nguyên logic nghiệp vụ, chỉ đổi nơi
lưu. `kv_store` **KHÔNG có RLS public** (chỉ Vercel Edge Function dùng `SUPABASE_SERVICE_ROLE_KEY`
đọc/ghi được) — đúng mức bảo vệ như Cloudflare KV hiện tại (không lộ qua client).

## Bảng trạng thái từng endpoint

| File | Việc gì | Hướng Pha 3 | Độ ưu tiên/rủi ro |
|---|---|---|---|
| `visits.ts` | Đếm lượt truy cập | ✅ **Đã port** — `api/visits.ts` (ví dụ mẫu cho cầu nối `kv_store`) | Thấp — đã xong |
| `qa.ts` | Hỏi đáp/góp ý | ✅ **Đã port** — `api/qa.ts` (key `qa:list`) | Thấp — đã xong |
| `report.ts` | Báo cáo đã chốt (Plan Event...) | ✅ **Đã port** — `api/report.ts` (key `report:<key>`) | Thấp — đã xong |
| `knowledge.ts` | Bộ nhớ kiến thức trợ lý | ✅ **Đã port** — `api/knowledge.ts` (key `kb:list`) | Thấp — đã xong |
| `users.ts` | Ghi nhận người dùng đăng nhập | ✅ **Đã port** — `api/users.ts` (key `users:list`) — sẽ xem lại khi cutover Supabase Auth (`auth.users` đã có sẵn danh sách, có thể không cần bảng riêng nữa) | Thấp — đã xong |
| `dashdata.ts` | Dữ liệu nạp thêm cho từng mục | ✅ **Đã port** — `api/dashdata.ts` (key `extra:<id>` + `extra:_shared`) | Thấp — đã xong |
| `daily.ts` / `overview.ts` | Snapshot phân tích AI theo giờ cố định | Port qua `kv_store` — NHƯNG phụ thuộc `assistant.ts` (xem dưới) | Trung bình (chờ quyết định AI) |
| `roles.ts` | RBAC (roles + matrix) | ✅ **Đã port** — `api/roles.ts` (key `rbac:v1`, cầu nối `kv_store` — giữ nguyên contract, chưa đổi sang bảng `user_roles` vì đó là việc của cutover auth) | Thấp — đã xong |
| `geo.ts` | Toạ độ kho/BC (đọc OAuth Sheet riêng) | ✅ **Đã port** — `api/geo.ts` query thẳng bảng `warehouses` (Pha 0), không cần OAuth/cache riêng nữa | Thấp — đã xong |
| `sheet-v4.ts` | Đọc Sheet qua OAuth Sheets API | ✅ Không cần nữa sau cutover — `routes`/`route_stops` đã sống trong Postgres (Pha 0/1) | — |
| `lichtai-edit.ts` | Sửa lịch tải, ghi ngược Sheet | ✅ **Đã port** — `api/lichtai-edit.ts` UPDATE thẳng `routes`/`route_stops` (tìm route theo region_key+route_name, tìm stop theo route_id+match{} thay "dấu vân tay" trên grid) — giữ nguyên request/response shape với bản Cloudflare, log thao tác vào `kv_store` (key `ltedit:log:list`) | Đã xong — CHƯA đổi `src/lib/lichTaiEdit.ts` (client) trỏ sang Vercel, vẫn gọi bản Cloudflare cho tới khi cutover |
| `accounts.ts`, `auth.ts`, `_session.ts` | Đăng nhập + quản lý tài khoản tự chế (PBKDF2 + HMAC session) | **Thay bằng Supabase Auth** (OTP email có sẵn) — đã scaffold `src/lib/supabaseAuth.ts`, **CHƯA wire vào App.tsx** | ⚠️ Cao — đổi cơ chế đăng nhập của người dùng thật, cần Sếp xác nhận thời điểm cutover trước khi bật |
| `_admin.ts` | Check quyền admin | Thay bằng RLS (`user_roles.role_id = 'admin'`) — không cần hàm riêng phía server nữa | Trung bình, đi cùng auth |
| `_gsheets.ts`, `oauth-authorize.ts`, `oauth-callback.ts` | Ghi Sheet bằng service account + luồng xin quyền OAuth | Không cần nữa sau cutover, TRỪ KHI còn sheet nào khác chưa migrate (xem `bao-cao-tudong.ts`) | — |
| `bao-cao-tudong.ts` | Đọc sheet "Lịch tải M12" (nhật ký chuyến thực tế, KHÁC sheet kế hoạch) cho báo Telegram | ✅ Sếp chốt 2026-09-25: **migrate luôn** — đã thêm source `nhat-ky-chuyen-thuc-te` (OAuth) vào `migrate.mjs`, ghi Bronze (`raw_sheet_snapshot`) — đây vốn là 1 cuốn nhật ký/log nên giữ nguyên văn là đủ, chưa cần Silver | Đã migrate (Bronze) |
| `route.ts` | Proxy Google Maps Directions (giấu key) | Port thẳng — Vercel Edge Function đọc `GOOGLE_MAPS_KEY` từ env Vercel thay vì `kv_store`/env Cloudflare | Thấp |
| `aiconfig.ts`, `assistant.ts` | Cấu hình khoá + Trợ lý AI đa nhà cung cấp (Gemini chính + Cloudflare Workers AI nền + 14 provider dự phòng) | **Cần Sếp quyết định trước khi port**: Cloudflare Workers AI (nguồn free hiện tại) KHÔNG tồn tại trên Vercel → phải chọn 1 nhà cung cấp LLM trả phí chính thức (Anthropic/Gemini API trực tiếp/OpenAI...) và cấp API key trong Vercel. Đây là thay đổi có **chi phí thực tế**, không tự quyết được | ⚠️ Cao — chặn bởi quyết định của Sếp |
| `knowsync.ts` | Đồng bộ kiến thức bổ sung 1 lần/ngày từ Sheet | Có thể gộp vào `supabase/migrate.mjs` (chạy định kỳ qua Vercel Cron) sau khi có bảng `knowledge` — chưa làm | Thấp, chưa cấp thiết |

## Đã làm trong đợt này

- `supabase/schema.sql` — thêm bảng `kv_store` (cầu nối KV, không public), bảng `user_roles`
  (khung RBAC gắn với `auth.users`, RLS: tự đọc dòng của mình + admin đọc/ghi tất cả), policy UPDATE
  admin-only trên `routes`/`route_stops` (chuẩn bị cho `lichtai-edit` kiểu mới).
- `vercel.json` — cấu hình build tối thiểu (`npm run build` → `dist/`), để `api/` ở root được Vercel
  nhận làm Edge Functions (khác `functions/api/` của Cloudflare — 2 thư mục độc lập, không đụng nhau).
- `api/visits.ts` — ví dụ port hoàn chỉnh đầu tiên (đơn giản nhất) theo mẫu cầu nối `kv_store`, chạy
  được thật trên Vercel nếu có `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` trong env Vercel.
- `src/lib/supabaseAuth.ts` — helper đăng nhập OTP qua Supabase Auth, **CHƯA wire vào `App.tsx`**
  (đăng nhập thật của Dash vẫn dùng `_session.ts`/Cloudflare như cũ cho tới khi Sếp xác nhận cutover).
- `api/_kv.ts`, `api/_admin.ts` — helper dùng chung cho các Edge Function port tiếp theo.
- `api/qa.ts`, `api/report.ts`, `api/knowledge.ts`, `api/dashdata.ts`, `api/users.ts` — port đầy đủ
  nhóm `kv_store` đơn giản, giữ NGUYÊN contract JSON như bản Cloudflare (drop-in, frontend gọi
  `/api/...` không cần đổi gì khi deploy trên Vercel). **Lưu ý khác biệt**: `api/_admin.ts` bản Vercel
  CHỈ kiểm tra `x-admin-token` (khoá dự phòng) — CHƯA có kiểm tra phiên đăng nhập vai trò admin như
  bản Cloudflare (`_session.ts`), vì auth chưa cutover. Nghĩa là trên nhánh Vercel, thao tác admin
  (xoá QA, lưu report, xem danh sách user) chỉ chạy được nếu client gửi kèm header `x-admin-token`
  đúng — cần đặt biến `ADMIN_TOKEN` trong Vercel env giống bên Cloudflare.

## Quyết định của Sếp (2026-09-25)

1. **Nhà cung cấp LLM cho Trợ lý AI trên Vercel** — **CHƯA chọn, quyết định sau.** Đã làm rõ: KHÔNG
   dùng được gói Claude Max (claude.ai) — license đó chỉ cho cá nhân dùng qua app/CLI Claude, không
   được dùng làm backend phục vụ nhiều người dùng khác. Khi chọn xong nhà cung cấp, cần tạo **API key
   riêng trả phí** (vd console.anthropic.com cho Anthropic) và cấu hình trong Vercel env — việc port
   `assistant.ts`/`aiconfig.ts` VẪN CHỜ bước này.
2. **Thời điểm cutover đăng nhập sang Supabase Auth** — **quyết định sau.** Đăng nhập thật vẫn dùng
   Cloudflare (`_session.ts`) cho tới khi có xác nhận rõ ràng.
3. **Sheet "Lịch tải M12" (nhật ký thực tế)** — ✅ **migrate luôn**, đã thêm vào `migrate.mjs` (Bronze).

## Đã hoàn tất mọi việc KHÔNG cần chờ 2 quyết định còn treo

Toàn bộ nhóm `kv_store` đơn giản (`qa`/`report`/`knowledge`/`dashdata`/`users`/`roles`) + `geo.ts`
(query `warehouses`) + `lichtai-edit.ts` (UPDATE trực tiếp `routes`/`route_stops`) đã port sang
`api/*.ts` (Vercel Edge Functions), giữ nguyên contract JSON với bản Cloudflare tương ứng.

**Còn lại — CHỜ 2 quyết định treo** (không tự làm được, xem mục "Quyết định của Sếp"):
- `_session.ts`/`_admin.ts`/`auth.ts`/`accounts.ts` → Supabase Auth (chờ thời điểm cutover đăng nhập).
- `aiconfig.ts`/`assistant.ts` → chờ chọn nhà cung cấp LLM trả phí.

**Chưa port** (không thuộc nhóm ưu tiên, ít dùng hoặc phụ thuộc lịch cron riêng của Cloudflare):
`daily.ts`, `overview.ts` (snapshot AI theo giờ — phụ thuộc `assistant.ts`), `route.ts` (proxy Google
Maps — port thẳng khi cần, không phụ thuộc gì đang chờ), `_gsheets.ts`/`oauth-authorize.ts`/
`oauth-callback.ts`/`sheet-v4.ts` (không cần nữa sau cutover), `knowsync.ts` (đồng bộ kiến thức —
có thể gộp vào `migrate.mjs` sau).

**LƯU Ý QUAN TRỌNG:** các file `api/*.ts` này chạy SONG SONG với `functions/api/*.ts` (Cloudflare) —
CHƯA có gì trỏ dashboard sang dùng Vercel làm nguồn chính. Việc cutover thật (đổi DNS/deploy production
sang Vercel, tắt Cloudflare) là quyết định riêng, ngoài phạm vi các đợt port này.
