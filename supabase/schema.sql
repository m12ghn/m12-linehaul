/* ============================================================
   SCHEMA PHA 0 — di dời dữ liệu Google Sheets -> Supabase (Postgres)
   Chạy 1 lần trong Supabase SQL Editor (hoặc `supabase db push`) TRƯỚC KHI
   chạy `node supabase/migrate.mjs`.

   Kiến trúc 2 lớp:
   - BRONZE (raw_sheet_snapshot): sao y NGUYÊN VĂN từng tab Sheet đang dùng
     trong src/config.ts, không diễn giải gì. Dùng để đối chiếu số dòng
     100% với Sheet gốc + làm lưới an toàn nếu lớp Silver dò cột sai.
   - SILVER (routes/route_stops/warehouses/tlld_daily/vehicle_assignments):
     dữ liệu đã parse có cấu trúc cho 4 mảng LÕI (lịch tải, bản đồ, TLLD,
     xe) — nơi logic tính toán (planEngine, TLLD...) sẽ đọc ở Pha 1.
     Các nguồn còn lại (GXT, tăng cường, sản lượng, kiến thức, GSVT...)
     TẠM DỪNG ở Bronze trong Pha 0 — lên Silver khi làm Pha 1 cho từng view
     tương ứng (không parse trước khi biết chắc UI Pha 1 cần cột gì).
   ============================================================ */

-- ------------------------------------------------------------
-- BRONZE: bản sao thô của MỌI tab Sheet trong config.ts
-- ------------------------------------------------------------
create table if not exists raw_sheet_snapshot (
  id bigint generated always as identity primary key,
  run_id uuid not null,                 -- 1 run migrate.mjs = 1 run_id, gom các snapshot cùng lượt chạy
  source_key text not null,             -- vd "routes:noi-thanh-hcm", "tlld:HCM20", "vehicles:song-than"
  sheet_id text not null,
  gid text,                             -- null nếu đọc theo tên tab (sheet_name)
  sheet_name text,
  header jsonb not null default '[]',   -- dòng tiêu đề gốc, dạng mảng string
  rows jsonb not null default '[]',     -- toàn bộ dòng dữ liệu (bỏ header), mảng các mảng string
  row_count int not null default 0,
  fetch_error text,                     -- khác null nếu lượt fetch nguồn này lỗi (sheet riêng tư, mất mạng...)
  fetched_at timestamptz not null default now()
);
create index if not exists raw_sheet_snapshot_source_run_idx on raw_sheet_snapshot (source_key, run_id);
create index if not exists raw_sheet_snapshot_run_idx on raw_sheet_snapshot (run_id);

comment on table raw_sheet_snapshot is
  'Bronze — bản sao nguyên văn từng tab Google Sheet tại thời điểm chạy migrate.mjs. Không dùng trực tiếp cho UI, chỉ để đối chiếu/khôi phục.';

-- ------------------------------------------------------------
-- SILVER: Lịch tải (thay 6 tab SHEETS trong config.ts)
-- 1 route_stops row = 1 dòng sheet gốc (Stop). "routes" là tuyến gom
-- theo tên (mirror src/lib/sheet.ts loadSheetUncached ở tầng DB thay vì
-- tính lại mỗi lần load như client hiện tại).
-- ------------------------------------------------------------
create table if not exists routes (
  id bigint generated always as identity primary key,
  region_key text not null,        -- key trong SHEETS (noi-thanh-hcm, mbh-song-than...)
  route_name text not null,
  load_text text,                  -- "Tải trọng" — giữ dạng text như Sheet gốc (không suy diễn đơn vị)
  category text,                   -- "Loại tuyến"
  ncc text,
  bks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (region_key, route_name)
);

create table if not exists route_stops (
  id bigint generated always as identity primary key,
  route_id bigint not null references routes(id) on delete cascade,
  region_key text not null,
  warehouse_name text,             -- "Tên kho"
  loai_hinh text,
  gio_toi text,                    -- giữ nguyên dạng text như Sheet (không parse giờ ở lớp Silver)
  gio_roi text,
  sheet_row_id text,               -- cột "ID" trong Sheet (nếu có) — dùng để xuất Excel/đối chiếu
  source_row_index int not null,   -- thứ tự dòng gốc trong Sheet — GIỮ NGUYÊN thứ tự (xem lib/sheet.ts:
                                    -- KHÔNG tự sắp lại theo giờ, tuyến nhiều ngày sẽ bị đảo lộ trình)
  created_at timestamptz not null default now()
);
create index if not exists route_stops_route_idx on route_stops (route_id);
create index if not exists route_stops_region_idx on route_stops (region_key);

comment on table routes is 'Silver — tuyến lịch tải, gom theo route_name trong từng vùng (region_key).';
comment on table route_stops is 'Silver — từng điểm dừng (1 dòng Sheet gốc) của 1 tuyến, giữ nguyên thứ tự nhập.';

-- ------------------------------------------------------------
-- SILVER: Toạ độ kho/bưu cục (thay sheet toạ độ CHÍNH THỨC + MyMap cũ)
-- ------------------------------------------------------------
create table if not exists warehouses (
  id bigint generated always as identity primary key,
  warehouse_id text,
  warehouse_name text not null,
  normalized_name text not null,   -- PHẢI khớp normalizeName() src/lib/normalize.ts (dùng để khớp Route<->Warehouse)
  district_name text,
  latitude double precision,
  longitude double precision,
  alias text[] not null default '{}', -- thay bảng ALIASES thủ công trong src/lib/geo.ts
  updated_at timestamptz not null default now(),
  unique (normalized_name)
);
create index if not exists warehouses_name_idx on warehouses (normalized_name);

comment on table warehouses is 'Silver — toạ độ kho/BC, thay geo.json + sheet toạ độ chính thức + MyMap KML.';

-- ------------------------------------------------------------
-- SILVER: TLLD theo ngày (thay 4 tab hub TLLD_TABS, cấu trúc cố định
-- cột 0=ngày, 3=mã tuyến, 10=tlld_weight theo comment gốc trong config.ts)
-- ------------------------------------------------------------
create table if not exists tlld_daily (
  id bigint generated always as identity primary key,
  dt date not null,
  route_code text not null,
  hub text not null,               -- HCM01 | HCM20 | Sóng Thần | Tân Tạo
  tlld_weight numeric,
  created_at timestamptz not null default now(),
  unique (dt, route_code, hub)
);
create index if not exists tlld_daily_route_idx on tlld_daily (route_code);
create index if not exists tlld_daily_dt_idx on tlld_daily (dt);

comment on table tlld_daily is 'Silver — tỷ lệ lấp đầy theo ngày x mã tuyến x hub, thay 4 tab TLLD_TABS.';

-- ------------------------------------------------------------
-- SILVER: Xe/tài xế theo mã tuyến (thay VEHICLE_TABS, gộp nhiều tab)
-- ------------------------------------------------------------
create table if not exists vehicle_assignments (
  id bigint generated always as identity primary key,
  route_code text not null,
  plate_number text,
  driver_name text,
  driver_phone text,
  tab_source text not null,        -- key nguồn (vd "vehicles:song-than") — biết dòng nào tới từ tab nào
  created_at timestamptz not null default now()
);
create index if not exists vehicle_assignments_route_idx on vehicle_assignments (route_code);

comment on table vehicle_assignments is 'Silver — BKS/SĐT/tài xế theo mã tuyến, gộp từ các tab trong VEHICLE_TABS.';

-- ------------------------------------------------------------
-- Ghi log lần chạy migrate (đối chiếu nhanh không cần soi raw_sheet_snapshot)
-- ------------------------------------------------------------
create table if not exists migration_runs (
  run_id uuid primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb                    -- { "<source_key>": { sheetCount, dbCount, error } }
);

-- ------------------------------------------------------------
-- RLS (PHA 1) — Dashboard đọc trực tiếp từ trình duyệt bằng anon key
-- (xem src/lib/supabaseClient.ts). Chỉ cho SELECT công khai trên các
-- bảng SILVER dùng để hiển thị (đúng mức lộ dữ liệu như Sheet "Ai có
-- liên kết -> Người xem" hiện tại). Bronze (raw_sheet_snapshot) và
-- migration_runs KHÔNG có policy public -> chỉ service_role (migrate.mjs)
-- đọc/ghi được, tránh lộ toàn bộ Sheet thô ra client.
-- ------------------------------------------------------------
alter table routes enable row level security;
alter table route_stops enable row level security;
alter table warehouses enable row level security;
alter table tlld_daily enable row level security;
alter table vehicle_assignments enable row level security;
alter table raw_sheet_snapshot enable row level security;
alter table migration_runs enable row level security;

-- CREATE POLICY không có IF NOT EXISTS trong Postgres -> drop trước rồi tạo lại, chạy lại
-- schema.sql nhiều lần không lỗi "policy already exists".
drop policy if exists "public read routes" on routes;
create policy "public read routes" on routes for select using (true);
drop policy if exists "public read route_stops" on route_stops;
create policy "public read route_stops" on route_stops for select using (true);
drop policy if exists "public read warehouses" on warehouses;
create policy "public read warehouses" on warehouses for select using (true);
drop policy if exists "public read tlld_daily" on tlld_daily;
create policy "public read tlld_daily" on tlld_daily for select using (true);
drop policy if exists "public read vehicle_assignments" on vehicle_assignments;
create policy "public read vehicle_assignments" on vehicle_assignments for select using (true);
-- KHÔNG tạo policy select cho raw_sheet_snapshot / migration_runs -> mặc định chặn hết với anon key.

/* ============================================================
   PHA 3 — hạ tầng cho port functions/api/* sang Vercel (xem supabase/PHA3-PLAN.md).
   ============================================================ */

-- ------------------------------------------------------------
-- Cầu nối thay Cloudflare KV: port cơ học `env.QA_KV.get/put(key)` -> bảng này.
-- KHÔNG có policy public -> chỉ Vercel Edge Function (service_role) đọc/ghi được,
-- đúng mức bảo vệ như KV hiện tại (accounts/report/knowledge... không lộ qua client).
-- ------------------------------------------------------------
create table if not exists kv_store (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table kv_store enable row level security;
-- KHÔNG tạo policy select/insert/update cho anon/authenticated -> mặc định chặn hết.

-- ------------------------------------------------------------
-- Khung RBAC gắn với Supabase Auth (auth.users) — THAY THẾ dần accounts:v2 (KV) +
-- roles.ts một khi cutover đăng nhập sang Supabase Auth (CHƯA bật, xem PHA3-PLAN.md
-- mục "Cần Sếp quyết định"). Ai cũng đọc được dòng CỦA MÌNH (để tự biết vai trò);
-- CHỈ admin đọc/ghi được TOÀN BỘ (quản lý nhân sự).
-- ------------------------------------------------------------
create table if not exists user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  role_id text not null default 'staff',
  disabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table user_roles enable row level security;

drop policy if exists "read own role" on user_roles;
create policy "read own role" on user_roles for select using (auth.uid() = user_id);

-- Admin đọc/ghi mọi dòng — kiểm tra qua chính bảng này (subquery) nên KHÔNG đệ quy vô hạn:
-- policy chỉ áp dụng cho câu lệnh đang chạy, subquery vẫn được phép chạy vì cùng thoả "read own role".
drop policy if exists "admin manage all roles" on user_roles;
create policy "admin manage all roles" on user_roles for all
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role_id = 'admin'))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role_id = 'admin'));

-- ------------------------------------------------------------
-- Chuẩn bị cho lichtai-edit kiểu mới: sửa lịch tải = UPDATE thẳng vào routes/route_stops
-- qua Supabase client (RLS chỉ cho phép admin ghi) thay vì gọi 1 Vercel Function riêng
-- ghi ngược Google Sheet như hiện tại.
-- ------------------------------------------------------------
drop policy if exists "admin update routes" on routes;
create policy "admin update routes" on routes for update
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role_id = 'admin'))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role_id = 'admin'));
drop policy if exists "admin update route_stops" on route_stops;
create policy "admin update route_stops" on route_stops for update
  using (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role_id = 'admin'))
  with check (exists (select 1 from user_roles ur where ur.user_id = auth.uid() and ur.role_id = 'admin'));
