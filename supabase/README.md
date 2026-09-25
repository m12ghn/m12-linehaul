# Pha 0 — Import Google Sheets → Supabase

Mục tiêu Pha 0 (xem đề xuất tổng thể trong lịch sử trao đổi): dựng schema Postgres trên
Supabase + import 1 lần từ toàn bộ Sheet đang dùng trong `src/config.ts`, đối chiếu số
liệu khớp trước khi đụng tới bất kỳ UI/API nào. **Chưa đổi code app** — `src/config.ts`,
`functions/api/*`, `src/lib/sheet.ts`... vẫn đọc Google Sheets như cũ. Đây chỉ là bước
chuẩn bị dữ liệu song song.

## 1. Tạo project Supabase

1. Vào https://supabase.com → New project (free tier đủ dùng cho Pha 0).
2. Vào **Project Settings → API**, lấy:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key (⚠️ KHÔNG phải `anon` key — service role mới ghi được, bỏ qua RLS) → `SUPABASE_SERVICE_ROLE_KEY`

## 2. Chạy schema

Mở **SQL Editor** trong Supabase Dashboard → dán toàn bộ nội dung [`schema.sql`](./schema.sql) → Run.

Tạo 7 bảng: `raw_sheet_snapshot` (Bronze — sao y mọi tab Sheet), `routes`/`route_stops`
(Silver — lịch tải), `warehouses` (Silver — toạ độ kho), `tlld_daily` (Silver — TLLD),
`vehicle_assignments` (Silver — xe/tài xế), `migration_runs` (log đối chiếu).

## 3. Cấu hình biến môi trường

```bash
cp ../.env.example ../.env   # nếu chưa có
```

Điền trong `.env` (không commit — đã có trong `.gitignore`):

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# CHỈ cần cho 1 nguồn duy nhất "warehouses" (sheet toạ độ kho KHÔNG public,
# xem functions/api/geo.ts) — nếu bỏ trống, script sẽ báo lỗi và BỎ QUA
# riêng nguồn này (các nguồn khác vẫn chạy bình thường).
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
```

`GOOGLE_OAUTH_REFRESH_TOKEN` lấy bằng cách nào: dự án đã có OAuth flow sẵn ở
`functions/api/oauth-authorize.ts` + `oauth-callback.ts` (đang chạy trên Cloudflare, refresh
token hiện lưu trong KV `oauth:google_refresh_token`). Cách nhanh nhất là lấy giá trị đó ra
(qua Cloudflare dashboard → KV → namespace `QA_KV` → key `oauth:google_refresh_token`) và dán
vào `.env`. Nếu không lấy được, cứ bỏ trống — script vẫn import đủ các nguồn còn lại (lịch
tải, TLLD, xe...), chỉ riêng bảng `warehouses` sẽ trống, xử lý sau.

## 4. Chạy import

```bash
npm install               # thêm @supabase/supabase-js lần đầu
npm run migrate:supabase
```

Script sẽ:
1. Tải từng tab Sheet (gviz CSV, không cần API key — publicly-shared sheets).
2. Ghi **nguyên văn** vào `raw_sheet_snapshot` (Bronze) — kể cả các nguồn chưa có parser riêng.
3. Với 4 nguồn lõi (lịch tải, toạ độ kho, TLLD, xe) — parse thêm vào bảng Silver tương ứng.
4. In bảng đối chiếu cuối cùng: mỗi nguồn → số dòng Sheet gốc vs số dòng đã ghi Silver.

Script **idempotent** cho routes/warehouses/tlld (dùng upsert theo khoá tự nhiên) — chạy
lại nhiều lần không nhân đôi dữ liệu. `vehicle_assignments` không có khoá tự nhiên đáng tin
(1 route có thể nhiều BKS) nên script xoá sạch bảng rồi nạp lại mỗi lần chạy.

## 5. Đối chiếu số liệu (bắt buộc trước khi coi Pha 0 xong)

- Số dòng bronze mỗi `source_key` phải khớp số dòng thật trên Google Sheet (mở Sheet, đếm
  bằng `Ctrl+End` hoặc filter — trừ dòng header).
- Với `routes`: so số tuyến distinct trên Dashboard hiện tại (menu Lịch Tải, StatusBar hiện
  số tuyến/vùng) với `select region_key, count(distinct route_name) from routes group by 1`.
- Với `warehouses`: so số điểm StatusBar báo "khớp toạ độ" hiện tại với
  `select count(*) from warehouses`.
- Với `tlld_daily`: so 1 vài mã tuyến cụ thể, vài ngày cụ thể, đối chiếu số TLLD hiển thị
  trên UI hiện tại với `select * from tlld_daily where route_code = '...' order by dt desc`.

Có sai lệch → xem lại `raw_sheet_snapshot.fetch_error` / cột `note` trong bảng in ra khi
chạy script, KHÔNG tự sửa số cho khớp (đúng nguyên tắc "không bịa số liệu" của dự án).

## 6. Pha 1 — đọc song song từ Dashboard để đối chiếu

Sau khi Pha 0 chạy xong và đối chiếu số liệu khớp, bật panel đối chiếu ngay trong Dashboard:

1. Trong `.env` (dự án gốc, không phải `supabase/.env`), thêm:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...        # anon key, KHÔNG phải service_role
   VITE_SUPABASE_SHADOW_COMPARE=1
   ```
2. `npm run dev` (hoặc build lại) → đăng nhập tài khoản **admin** → mở menu **Lịch Tải** → cuộn xuống
   dưới dải trạng thái (StatusBar) sẽ thấy panel **"🧪 Pha 1 — Đối chiếu Sheet vs Supabase"**.
3. Bấm **So sánh ngay**: tải song song `loadSheet()` (Google Sheet, như cũ) và `loadSheetFromDb()`
   (`src/lib/sheetFromDb.ts`, đọc bảng `routes`/`route_stops` trong Supabase) cho vùng đang xem, rồi
   diff số tuyến, số điểm dừng, tải trọng, loại tuyến, BKS.

Panel này:
- **Chỉ hiện với admin** và **chỉ khi bật cờ** `VITE_SUPABASE_SHADOW_COMPARE=1` — mặc định (cờ trống)
  không render gì, không gọi Supabase, không ảnh hưởng người dùng thường hay dashboard production.
- **Chỉ so sánh khi bấm nút** — không tự chạy nền, không thêm tải cho mỗi lần mở trang.
- Toạ độ (`missingGeo`) vẫn tra qua `src/lib/geo.ts` (geo.json + `/api/geo`) ở cả 2 phía — Pha 1 này
  CHƯA đổi nguồn toạ độ sang bảng `warehouses`, để tách riêng việc so sánh dữ liệu tuyến khỏi việc so
  sánh nguồn toạ độ (sẽ làm ở bước sau khi routes/route_stops đã đối chiếu ổn định).

Dashboard **không đổi hành vi mặc định** ở Pha 1 — `loadSheet()`/`useSchedule` vẫn là nguồn dữ liệu
chính thức cho mọi người dùng cho tới khi có quyết định cutover (Pha 2+).

## 7. Ngoài phạm vi Pha 0/1

Các nguồn sau **chỉ có ở Bronze** (`raw_sheet_snapshot`), chưa có bảng Silver riêng — sẽ
thiết kế khi làm Pha 1 cho view tương ứng, vì cấu trúc cột phụ thuộc UI sẽ đọc gì:
GXT (`gxt:*`), Tăng cường (`surge:*`), Điều chỉnh NCC (`ncc:dieu-chinh`), Kiến thức bổ sung
(`knowledge:*`), Sản lượng (`sanluong:*`), Lịch trực GSVT (`gsvt:roster`).
