# Tạo môi trường Staging trên Vercel

Đã chuẩn bị được phần file/branch — **phần còn lại phải làm trong Vercel Dashboard bằng tài khoản
của anh**, vì session này không có `VERCEL_TOKEN`/đăng nhập Vercel nên không tự bấm được qua CLI/API.

## Đã chuẩn bị sẵn (trong session này)

- Nhánh Git `staging` — đã tạo từ `claude/cloud-session-la-sao-ae8pzo` và push lên
  `origin/staging`. Đây là nhánh sẽ giữ cố định để trỏ môi trường staging vào (khác PR branch, vốn
  bị xoá sau khi merge — staging cần 1 nhánh sống lâu dài).
- `vercel.json` (đã có từ Pha 3) — build tối thiểu, dùng chung cho mọi environment.

## Việc anh cần làm trong Vercel Dashboard

Project đã tồn tại sẵn: `m12ghn-9152s-projects/m12-linehaul` (tự tạo khi org cài Vercel GitHub App).

### Cách 1 — Custom Environment (khuyến nghị, cần Vercel Pro)

1. Vào **vercel.com** → project `m12-linehaul` → **Settings → Environments**.
2. Bấm **Add Environment** → đặt tên `Staging`.
3. Gắn **Git Branch Tracking** = `staging` (nhánh vừa tạo) — mọi lần push lên nhánh này sẽ tự deploy
   vào environment Staging, có domain riêng ổn định (khác domain preview ngẫu nhiên theo PR).
4. Vào tab **Environment Variables** của environment `Staging` vừa tạo, thêm:
   ```
   SUPABASE_URL=<url project Supabase STAGING nếu có, hoặc project hiện tại>
   SUPABASE_SERVICE_ROLE_KEY=<service role key tương ứng>
   VITE_SUPABASE_URL=<giống trên, phía client>
   VITE_SUPABASE_ANON_KEY=<anon key tương ứng>
   ADMIN_TOKEN=<đặt riêng cho staging, KHÔNG trùng token production>
   ```
   ⚠️ Khuyến nghị dùng **project Supabase riêng cho staging** (tạo thêm 1 project free tier, chạy
   lại `supabase/schema.sql` + `npm run migrate:supabase` trỏ vào đó) — tránh test trên Vercel staging
   lỡ tay ghi đè dữ liệu Supabase thật đang dùng cho Pha 0/1.
5. (Tuỳ chọn) **Domains** → gắn 1 domain phụ dạng `staging-m12-lich-tai.vercel.app` hoặc domain riêng
   cho environment Staging, để có link cố định thay vì domain preview đổi theo mỗi lần deploy.

### Cách 2 — Không có Vercel Pro (chỉ Preview thường)

Nếu project đang ở gói Hobby (không có Custom Environments), dùng cách đơn giản hơn:

1. **Settings → Git** — đảm bảo Production Branch vẫn là `main` (không đổi).
2. Push/PR vào nhánh `staging` sẽ tự có **Preview Deployment** riêng (Vercel tự làm, không cần cấu
   hình gì thêm) — nhưng domain preview sẽ đổi mỗi lần deploy mới, trừ khi bật:
3. **Settings → Domains → Add** → gắn 1 domain (hoặc subdomain `*.vercel.app` do Vercel cấp) và chọn
   **Assign to a Git Branch** = `staging` — domain đó sẽ luôn trỏ vào bản deploy MỚI NHẤT của nhánh
   `staging`, coi như "staging URL" cố định dù không có Custom Environment thật sự.
4. Env vars cho riêng nhánh `staging`: **Settings → Environment Variables** → khi thêm biến, chọn
   **Preview** ở cột Environment, rồi bấm **Edit** → giới hạn theo **Branch** = `staging` (Vercel hỗ
   trợ scope biến môi trường theo branch cụ thể trong Preview).

## Sau khi có staging

- Deploy thử bằng cách push 1 commit vào nhánh `staging` (`git push origin <nhánh-làm-việc>:staging`
  hoặc merge PR vào `staging` trước khi merge `main`).
- Dùng URL staging để bật panel đối chiếu Pha 1 (`VITE_SUPABASE_SHADOW_COMPARE=1`) và test các
  endpoint Pha 3 (`api/*.ts`) an toàn, KHÔNG ảnh hưởng `main`/production (Cloudflare vẫn là production
  thật cho tới khi có quyết định cutover — xem `supabase/PHA3-PLAN.md`).
