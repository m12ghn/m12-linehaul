# ĐẢO CHIỀU DỮ LIỆU — Google Sheet ➜ Supabase + Vercel

> Trước: Google Sheet là nơi nhập, dashboard chỉ đọc.
> Sau: **dashboard là nơi nhập**, Supabase là nguồn sự thật, Google Sheet chỉ còn để **xuất ra xem**.

---

## 1. Hệ thống hiện tại có gì (tóm tắt bản gốc)

**Quy mô:** ~26.000 dòng TypeScript · 13 view · 60 component · 24 Cloudflare Function · 7 workbook Google Sheet · 12 skill Claude riêng cho dự án.

| Lớp | Nội dung |
|---|---|
| Frontend | React 18 + TS strict + Vite, SPA tĩnh. Không Context/Redux — state lift lên `App.tsx`. Mọi view trừ `Overview` đều `React.lazy`. |
| Menu cấp 1 | Tổng Quan · Lịch Tải · TLLD Tuyến · Vùng HCM · Sản Lượng · Performance NCC · Plan Event · Trợ lý Lịch Tải · Phân quyền (Lộ trình đang ẩn) |
| Backend | Cloudflare Pages Functions (24 route) + KV `QA_KV` + Workers AI |
| Dữ liệu | Đọc realtime Google Sheets qua 3 tầng dự phòng: `/api/sheet-v4` (OAuth) → `gviz` → `export?format=csv` |
| Xác thực | Đăng nhập email GHN / OTP Brevo / mật khẩu PBKDF2 · phiên ký HMAC · RBAC ma trận (vai trò × module × chức năng con × hành động) |
| AI | Cloudflare Workers AI (llama) là nguồn chính, Gemini dự phòng; `planEngine.ts` tính deterministic, AI chỉ diễn giải |
| Bản đồ | Leaflet + toạ độ kho đọc từ sheet toạ độ toàn quốc (MyMap KML đã bị Google chặn 403) |

**7 workbook nguồn:** Lịch Tải chính (6 vùng + Tăng cường + TC Event + Điều chỉnh NCC + Sản lượng + BC Lấy + GSVT) · TLLD (4 hub) · Thông tin xe · GXT · Toạ độ kho · Kiến thức bổ sung · Báo cáo tự động.

**Khả năng ghi ngược đã có (rất hạn chế):** `functions/api/lichtai-edit.ts` — chỉ admin, chỉ sửa 6 cột có sẵn, và phải **dò lại dòng bằng dấu vân tay nội dung** vì Sheet không có khoá chính. Không thêm/xoá được tuyến hay điểm dừng.

---

## 2. Kiến trúc mới

```
Trình duyệt ──► Vercel (SPA + API routes) ──► Supabase Postgres
                        │                        (nguồn sự thật)
                        └──► Google Sheets API ──► Sheet "chỉ để xem" (xuất khi cần)
```

**Vì sao trình duyệt KHÔNG gọi thẳng Supabase:** RLS bật + không policy nào cho `anon`/`authenticated`, mọi truy cập đi qua API route bằng `service_role`. Lộ anon key cũng không đọc được gì. Đổi lại, lớp API phải tự kiểm quyền — đó là `api/_lib/session.ts → guard()`.

---

## 3. Những gì đã dựng xong trong nhánh này

| Tệp | Vai trò | Trạng thái |
|---|---|---|
| `supabase/migrations/0001_core.sql` | 20 bảng dữ liệu vận hành + view tương thích `v_lich_tai` | ✅ chạy sạch trên PG 16 |
| `supabase/migrations/0002_app.sql` | 13 bảng thay toàn bộ Cloudflare KV + trigger audit tự ghi diff | ✅ |
| `supabase/migrations/0003_rls.sql` | Bật RLS + thu hồi quyền `anon`/`authenticated` | ✅ |
| `scripts/import-sheets.mjs` | ETL 1 lần: 7 workbook → Supabase, chạy lại nhiều lần vẫn an toàn | ✅ có `--dry` |
| `api/_lib/supabase.ts` | Client PostgREST viết tay (không thêm phụ thuộc, chạy được Edge) | ✅ |
| `api/_lib/session.ts` | Port `_session.ts` + `_admin.ts`: PBKDF2, HMAC, `guard(module, action)` | ✅ typecheck sạch |
| `api/lichtai.ts` | **Endpoint đảo chiều** — CRUD tuyến + điểm dừng | ✅ 18/18 test |
| `api/auth.ts` | Port đăng nhập (quick-login / mật khẩu / OTP), giữ nguyên hợp đồng API | ✅ |
| `api/export-sheet.ts` | Xuất Supabase → Google Sheet kèm dòng cảnh báo "chỉ để xem" | ✅ |
| `src/lib/db/lichTaiApi.ts` | Lớp đọc/ghi client, giữ nguyên type `Route`/`Stop` cũ | ✅ |
| `src/lib/db/useLichTai.ts` | Hook thay `useSchedule` | ✅ |
| `src/components/RouteEditor.tsx` | Bảng nhập liệu: thêm/sửa/xoá tuyến + điểm dừng, đổi thứ tự | ✅ |
| `src/views/LichTaiNhap.tsx` | Màn "✏️ Nhập liệu" (sub-tab mới trong Lịch Tải) | ✅ build sạch |
| `api/roles.ts` | Ma trận quyền 4 cấp: bảng ↔ blob JSON client cũ đang chờ | ✅ 5 test |
| `api/accounts.ts` | Quản lý tài khoản, chặn tự hạ quyền/tự xoá mình | ✅ 5 test |
| `api/qa.ts` · `knowledge.ts` · `report.ts` · `dashdata.ts` · `daily.ts` · `overview.ts` · `visits.ts` · `users.ts` · `aiconfig.ts` · `geo.ts` | Port nốt các endpoint chạy trên KV | ✅ typecheck sạch |
| `api/cron/export-sheets.ts` | Lịch tự đẩy Supabase → Sheet mỗi 15 phút | ✅ |
| `vercel.json` · `.env.example` | Cấu hình triển khai + cron | ✅ |

**Cố ý giữ song song:** sub-tab "🚚 Lịch Tải" cũ (đọc Sheet) vẫn chạy cạnh "✏️ Nhập liệu" (Supabase) để đối chiếu số liệu. Khi hai bên khớp thì mới bỏ nhánh Sheet.

### Điều đã tốt lên so với bản cũ

| | Bản Sheet | Bản Supabase |
|---|---|---|
| Định danh dòng | dò theo nội dung (route + kho + giờ + id) | khoá chính uuid |
| Chèn/xoá dòng trên Sheet giữa chừng | **có thể ghi nhầm dòng** | không ảnh hưởng |
| Thêm/xoá tuyến, điểm dừng | không làm được | có |
| Đổi thứ tự điểm dừng | không | có |
| Hai người sửa cùng lúc | so chuỗi `oldValue` | `rev` = `updated_at`, 409 kèm mốc thời gian |
| Nhật ký | KV `ltedit:log:*`, 90 ngày, chỉ Lịch Tải | `audit_log` ghi diff mọi bảng, không giới hạn |
| Độ trễ sau khi lưu | phải refresh 2 lần chờ gviz lan truyền | thấy ngay |

---

## 4. Chạy thử tại máy

```bash
npm install
cp .env.example .env.local          # điền SUPABASE_URL, SERVICE_ROLE_KEY, SESSION_SECRET
npx vercel dev                      # cần vercel CLI để chạy được thư mục api/
```

Tạo schema trên Supabase (Studio → SQL Editor, chạy lần lượt 3 file):

```
supabase/migrations/0001_core.sql
supabase/migrations/0002_app.sql
supabase/migrations/0003_rls.sql
```

Nạp dữ liệu cũ:

```bash
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GSHEETS_SA_B64=...
node scripts/import-sheets.mjs --dry            # xem thống kê trước, KHÔNG ghi
node scripts/import-sheets.mjs                  # nạp thật
node scripts/import-sheets.mjs --only=routes    # nạp lại riêng phần tuyến
```

Cấp quyền admin cho tài khoản đầu tiên:

```sql
update accounts set role_id = 'admin' where email_lc = 'thovdt@ghn.vn';
```

---

## 5. Việc còn lại (theo thứ tự nên làm)

### Giai đoạn A — chạy song song, chưa bỏ gì (1–2 tuần)
1. Tạo project Supabase, chạy 3 file migration.
2. Chạy ETL, **đối chiếu** tab "🚚 Lịch Tải" (Sheet) và "✏️ Nhập liệu" (Supabase) — số tuyến, số điểm dừng, tổng tải trọng phải khớp.
3. Bổ sung bí danh tên kho chưa khớp toạ độ vào `warehouse_aliases` (script ETL in ra danh sách).
4. Cho 2–3 người dùng thử nhập trên dashboard, Sheet vẫn là bản chính.

### Giai đoạn B — chuyển quyền nhập (1 tuần)
5. Khoá Google Sheet về **chỉ xem** cho mọi người trừ 1 tài khoản dự phòng.
6. Bật cron `/api/cron/export-sheets` (đã khai trong `vercel.json`, 15 phút/lần) để bản Sheet luôn mới.
7. Đổi `App.tsx` cho tab "🚚 Lịch Tải" dùng `useLichTai` thay `useSchedule` → gỡ sub-tab "✏️ Nhập liệu" (gộp làm một).

### Giai đoạn C — phần Cloudflare Functions còn lại

**14/24 function đã port xong.** Còn lại 4 cái cần xử lý và 6 cái sẽ xoá:

| Function | Xử lý |
|---|---|
| `assistant.ts` (948 dòng) | **việc lớn nhất còn lại** — xem giai đoạn D |
| `route.ts` | giữ nguyên logic, chỉ đổi chỗ lấy key sang bảng `app_secrets` |
| `bao-cao-tudong.ts` | worker cron ngoài đang gọi — đổi URL sau khi port |
| `knowsync.ts` | thay bằng Vercel Cron đọc thẳng bảng `knowledge` |
| `sheet-v4.ts`, `_gsheets.ts`, `oauth-authorize.ts`, `oauth-callback.ts`, `lichtai-edit.ts`, `geo.ts` (bản cũ) | **xoá** sau giai đoạn B |

### Giai đoạn D — trợ lý AI
`assistant.ts` đang dùng **Cloudflare Workers AI (llama)** làm nguồn chính vì miễn phí và không bị WAF chặn. Vercel không có thứ tương đương. Ba lựa chọn:

- **Giữ 1 Cloudflare Worker riêng** chỉ để chạy AI, Vercel gọi sang. Ít việc nhất, vẫn tận dụng quota free.
- **Chuyển hẳn sang Gemini** (code đã có sẵn nhánh này). Đơn giản nhất, nhưng phụ thuộc quota Gemini.
- **Vercel AI Gateway.** Sạch nhất, tốn phí — nhưng bạn đã có Vercel Pro nên đây là lựa chọn hợp lý hơn trước.

### Giai đoạn E — chuyển nốt các `lib/*.ts` sang đọc Supabase
Còn ~15 file trong `src/lib/` gọi `csvSources()`: `tlld.ts`, `tangcuong.ts`, `gsvt.ts`, `congxuat.ts`, `nccVT.ts`, `fc.ts`, `sanluong.ts`, `bcLayBienDong.ts`, `xinTangCuong.ts`, `tcEvent.ts`, `dieuChinhNcc.ts`, `nccFixedCapacity.ts`, `fleetMix.ts`, `allRoutes.ts`, `tlldExclude.ts`. Bảng đích đã tạo sẵn trong `0001_core.sql` — mỗi file đổi hàm `load*()` sang gọi API tương ứng.

## 6. Gói Pro mở ra những gì (đã tận dụng trong nhánh này)

| | Miễn phí | Pro (đang dùng) | Đã dùng để làm gì |
|---|---|---|---|
| Vercel cron | 1 lần/ngày, sai số ±59 phút | **1 phút/lần, đúng phút** | Cron đẩy Sheet mỗi 15 phút — Sheet gần như luôn khớp thực tế |
| Vercel thương mại | không được phép | được | Dùng hợp lệ cho dashboard công ty |
| Supabase DB | 500 MB, **ngủ sau 7 ngày** | 8 GB, không ngủ | Nạp được nhiều năm TLLD/sản lượng, không phải cắt còn 12 tháng |
| Supabase backup | không | **sao lưu ngày, giữ 7 ngày** | An toàn dữ liệu vận hành |

**Một điểm cần quyết:** Supabase Pro chỉ có sao lưu **theo ngày**; Point-in-Time Recovery là add-on trả thêm (và bắt buộc kèm gói compute Small). Nghĩa là nếu ai xoá nhầm lúc 4h chiều, bản khôi phục gần nhất là **đầu ngày hôm đó** — mất tới 24h dữ liệu. Google Sheet trước đây có version history chi tiết hơn thế.

Ba lớp giảm rủi ro đã có sẵn trong nhánh này: xoá tuyến mặc định là **xoá mềm** (`active=false`, không mất dữ liệu), `audit_log` ghi diff từng ô kèm email người sửa nên khôi phục thủ công được, và cron đẩy Sheet 15 phút/lần cũng là một bản chụp dự phòng. Với sheet vận hành thật, tôi vẫn khuyên **bật PITR** — đây là loại chi phí đáng trả.

## 7. Rủi ro cần biết trước

1. **Sheet có dữ liệu "bẩn" mà Postgres sẽ từ chối.** Ràng buộc `stops_toi_fmt` chỉ nhận `HH:MM`; ô nào ghi "20h30" hay "sau 21h" sẽ bị ETL bỏ qua (thành rỗng). Chạy `--dry` trước để đếm.
2. **Mã tuyến trùng trong cùng vùng.** `routes_region_code_uidx` là unique — nếu Sheet đang có 2 dòng nhóm khác nhau cùng tên tuyến, ETL sẽ gộp làm một. Cần rà trước.
3. **`assistant.ts` đọc dữ liệu qua các hàm `load*()` phía client.** Khi bỏ nguồn Sheet, phải kiểm tra lại toàn bộ `src/lib/*.ts` còn gọi `csvSources()` — hiện còn khoảng 15 file (`tlld.ts`, `tangcuong.ts`, `gsvt.ts`, `congxuat.ts`, `nccVT.ts`, `fc.ts`, `sanluong.ts`…). Mỗi file cần một bảng đích tương ứng (đã tạo sẵn trong `0001_core.sql`).
4. **`SUPABASE_SERVICE_ROLE_KEY` tuyệt đối không được đặt tên bắt đầu bằng `VITE_`** — Vite sẽ nhúng thẳng vào bundle của trình duyệt.

---

## 8. Quy ước dự án vẫn giữ nguyên

Nhánh này tuân theo `.claude/skills/m12-conventions/SKILL.md` đã có sẵn:

- Cấu hình tập trung, không hardcode rải rác (ID sheet trong ETL là bản sao có chú thích rõ).
- Comment và chuỗi UI **tiếng Việt**.
- Không bịa số liệu — `m12_norm()` trong SQL nhân bản `normalizeName()` của `src/lib/normalize.ts`, sửa một bên phải sửa bên kia (ghi rõ trong comment SQL).
- Function component + hooks, view mới `React.lazy` trong `App.tsx`, không thêm Context/Redux.
- Không commit secret — tất cả qua biến môi trường Vercel.
