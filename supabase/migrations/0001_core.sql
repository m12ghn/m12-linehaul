-- ============================================================
-- M12 LỊCH TẢI — SCHEMA LÕI (dữ liệu vận hành)
-- Supabase / PostgreSQL 15+
--
-- NGUYÊN TẮC ĐẢO CHIỀU: từ nay Postgres là NGUỒN SỰ THẬT DUY NHẤT.
-- Google Sheet chỉ còn là ĐÍCH XUẤT khi cần (xem api/export-sheet.ts),
-- không còn được đọc realtime, không ai nhập trên Sheet nữa.
--
-- Chạy: psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_core.sql
--   hoặc dán vào Supabase Studio → SQL Editor.
-- ============================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "unaccent";   -- chuẩn hoá tên kho tiếng Việt

-- ------------------------------------------------------------
-- 0. Tiện ích dùng chung
-- ------------------------------------------------------------

-- unaccent() mặc định là STABLE (phụ thuộc search_path) -> KHÔNG dùng được trong
-- generated column / index. Bọc lại thành IMMUTABLE bằng cách chỉ đích danh từ điển.
create or replace function m12_unaccent(txt text)
returns text language sql immutable parallel safe as $$
  select public.unaccent('public.unaccent'::regdictionary, coalesce(txt, ''))
$$;

-- Chuẩn hoá tên kho/bưu cục: bỏ dấu, thường hoá, gom khoảng trắng.
-- PHẢI khớp logic normalizeName() trong src/lib/normalize.ts — sửa 1 bên thì sửa bên kia
-- (đúng quy ước đã có ở skill m12-conventions mục 3).
create or replace function m12_norm(txt text)
returns text language sql immutable parallel safe as $$
  select btrim(regexp_replace(
           lower(m12_unaccent(coalesce(txt, ''))),
           '[^a-z0-9]+', ' ', 'g'
         ))
$$;

-- Trigger tự cập nhật updated_at.
create or replace function m12_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ------------------------------------------------------------
-- 1. VÙNG (thay 6 tab Google Sheet)
--    Giữ nguyên `key` và `gid` cũ để code frontend/URL cũ không gãy.
-- ------------------------------------------------------------
create table if not exists regions (
  key         text primary key,               -- "noi-thanh-hcm", ...
  legacy_gid  text unique,                    -- gid tab Sheet cũ (tương thích ngược)
  label       text not null,
  sort        int  not null default 0,
  hidden      boolean not null default false, -- ẩn khỏi bộ chọn vùng trên UI
  excluded    boolean not null default false, -- loại khỏi mọi số liệu TỔNG cấp cụm
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger regions_touch before update on regions
  for each row execute function m12_touch();

insert into regions (key, legacy_gid, label, sort, hidden, excluded) values
  ('noi-thanh-hcm',     '0',          'Nội Thành HCM',     1, false, false),
  ('noi-vung-hcm',      '961518640',  'Nội Vùng HCM',      2, true,  true),
  ('lien-vung-mn',      '84848529',   'Liên Vùng MN',      3, false, false),
  ('mbh-song-than',     '541305122',  'MBH Sóng Thần',     4, false, false),
  ('mbh-tan-tao',       '1937583700', 'MBH Tân Tạo',       5, false, false),
  ('mbh-tan-thuan-q7',  '722712650',  'MBH Tân Thuận Q7',  6, false, false)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 2. KHO / BƯU CỤC + TOẠ ĐỘ (thay sheet "Toạ độ kho/BC" + geo.json)
-- ------------------------------------------------------------
create table if not exists warehouses (
  id            uuid primary key default gen_random_uuid(),
  warehouse_id  text unique,                  -- mã kho GHN (nếu có)
  name          text not null,
  name_norm     text generated always as (m12_norm(name)) stored,
  district_name text,
  province_name text,
  lat           double precision,
  lng           double precision,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists warehouses_name_norm_idx on warehouses (name_norm);
create trigger warehouses_touch before update on warehouses
  for each row execute function m12_touch();

-- Bí danh tên kho (thay ALIASES hardcode trong src/lib/geo.ts) — sửa được trên dashboard.
create table if not exists warehouse_aliases (
  id           uuid primary key default gen_random_uuid(),
  alias        text not null,
  alias_norm   text generated always as (m12_norm(alias)) stored,
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  created_at   timestamptz not null default now()
);
create unique index if not exists warehouse_aliases_norm_uidx on warehouse_aliases (alias_norm);

-- ------------------------------------------------------------
-- 3. NHÀ CUNG CẤP VẬN TẢI (NCC)
-- ------------------------------------------------------------
create table if not exists suppliers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  name_norm    text generated always as (m12_norm(name)) stored,
  short_name   text,
  phone        text,
  contact      text,
  fixed_capacity int,                        -- năng lực xe cố định/ngày
  note         text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists suppliers_name_norm_uidx on suppliers (name_norm);
create trigger suppliers_touch before update on suppliers
  for each row execute function m12_touch();

-- ------------------------------------------------------------
-- 4. TUYẾN + ĐIỂM DỪNG  ← TRÁI TIM CỦA VIỆC ĐẢO CHIỀU
--    1 tuyến = 1 dòng `routes`; mỗi điểm dừng = 1 dòng `stops`.
--    (Trên Sheet cũ: N dòng cùng "Tên tuyến" = 1 tuyến — nay tách chuẩn hoá.)
-- ------------------------------------------------------------
create table if not exists routes (
  id           uuid primary key default gen_random_uuid(),
  region_key   text not null references regions(key) on update cascade,
  code         text not null,                 -- "Tên tuyến" / mã tuyến
  code_norm    text generated always as (upper(regexp_replace(coalesce(code,''), '\s+', '', 'g'))) stored,
  category     text,                          -- "Loại tuyến" (menu cấp 3)
  load         text,                          -- "Tải trọng": số kg hoặc "Van"
  load_kg      int generated always as (
                 case when load ~ '^\d{1,6}$' then load::int else null end
               ) stored,
  supplier_id  uuid references suppliers(id) on delete set null,
  ncc          text,                          -- tên NCC dạng chữ (giữ để tương thích Sheet cũ)
  bks          text,                          -- biển số, đã làm sạch dạng "50H-19133"
  driver       text,
  driver_phone text,
  sort         int not null default 0,
  active       boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text
);
create unique index if not exists routes_region_code_uidx on routes (region_key, code);
create index if not exists routes_code_norm_idx on routes (code_norm);
create index if not exists routes_category_idx on routes (region_key, category);
create trigger routes_touch before update on routes
  for each row execute function m12_touch();

create table if not exists stops (
  id           uuid primary key default gen_random_uuid(),
  route_id     uuid not null references routes(id) on delete cascade,
  seq          int  not null default 0,        -- thứ tự điểm dừng trong tuyến
  kho          text not null,                  -- tên kho/BC như nhập
  warehouse_id uuid references warehouses(id) on delete set null,  -- khớp toạ độ
  loai_hinh    text,                           -- Phân loại | Lấy | Giao | Giao và lấy
  toi          text,                           -- giờ tới điểm "HH:MM"
  roi          text,                           -- giờ rời điểm "HH:MM"
  ext_id       text,                           -- cột "ID" cũ trên Sheet (xuất Excel)
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint stops_toi_fmt check (toi is null or toi = '' or toi ~ '^\d{1,2}:\d{2}$'),
  constraint stops_roi_fmt check (roi is null or roi = '' or roi ~ '^\d{1,2}:\d{2}$')
);
create index if not exists stops_route_idx on stops (route_id, seq);
create trigger stops_touch before update on stops
  for each row execute function m12_touch();

-- Danh mục giá trị hợp lệ cho "Loại hình" (thay hằng LOAI_HINH_VALUES hardcode).
create table if not exists loai_hinh_values (
  value text primary key,
  sort  int not null default 0
);
insert into loai_hinh_values (value, sort) values
  ('Phân loại', 1), ('Lấy', 2), ('Giao', 3), ('Giao và lấy', 4)
on conflict (value) do nothing;

-- ------------------------------------------------------------
-- 5. THÔNG TIN XE (thay workbook điều phối VEHICLE_SHEET_ID + GXT)
-- ------------------------------------------------------------
create table if not exists vehicles (
  id           uuid primary key default gen_random_uuid(),
  route_code   text not null,
  code_norm    text generated always as (upper(regexp_replace(coalesce(route_code,''), '\s+', '', 'g'))) stored,
  bks          text,
  driver       text,
  phone        text,
  source       text,                            -- 'dieu-phoi' | 'gxt' | 'nhap-tay'
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists vehicles_code_norm_idx on vehicles (code_norm);
create trigger vehicles_touch before update on vehicles
  for each row execute function m12_touch();

-- ------------------------------------------------------------
-- 6. TĂNG CƯỜNG
-- ------------------------------------------------------------

-- Chuyến tăng cường theo ngày (tab "Tăng Cường Lấy/Giao" cũ).
create table if not exists tc_trips (
  id           uuid primary key default gen_random_uuid(),
  ngay         date not null,
  kind         text not null check (kind in ('lay','giao')),
  code         text,                            -- SG_TCEV_xx / TC_*
  kho          text,
  warehouse_id uuid references warehouses(id) on delete set null,
  supplier_id  uuid references suppliers(id) on delete set null,
  ncc          text,
  bks          text,
  driver       text,
  phone        text,
  tai_trong    text,
  gio_di       text,
  gio_den      text,
  trang_thai   text not null default 'ke-hoach'  -- ke-hoach | da-chay | huy
                 check (trang_thai in ('ke-hoach','da-chay','huy')),
  note         text,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now(),
  updated_by   text
);
create index if not exists tc_trips_ngay_idx on tc_trips (ngay, kind);
create index if not exists tc_trips_code_idx on tc_trips (code);
create trigger tc_trips_touch before update on tc_trips
  for each row execute function m12_touch();

-- Lịch TC cố định của kỳ event (tab "Lưu trữ TC EVENT" — mỗi SG_TCEV = 1 xe).
create table if not exists tc_events (
  id           uuid primary key default gen_random_uuid(),
  ky           text not null,                   -- 'T6', 'T8', '9.9'...
  code         text not null,                   -- SG_TCEV_xx
  ngay         date,
  kho          text,
  ncc          text,
  supplier_id  uuid references suppliers(id) on delete set null,
  tai_trong    text,
  so_xe        int  not null default 1,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists tc_events_ky_code_ngay_uidx
  on tc_events (ky, code, (coalesce(ngay, '1900-01-01'::date)));
create trigger tc_events_touch before update on tc_events
  for each row execute function m12_touch();

-- Phiếu XIN TĂNG CƯỜNG (tab "BC xin tăng cường" — form ticket).
-- Đây là bảng ĐƯỢC NHẬP NHIỀU NHẤT trên dashboard sau khi đảo chiều.
create table if not exists xin_tang_cuong (
  id            uuid primary key default gen_random_uuid(),
  ngay          date not null,
  ca            text,                            -- ca/khung giờ
  kho           text,
  warehouse_id  uuid references warehouses(id) on delete set null,
  region_key    text references regions(key) on update cascade,
  loai_xe       text,
  so_xe         int not null default 1,
  ly_do         text,
  san_luong_du  int,
  nguoi_xin     text,                            -- email người tạo
  trang_thai    text not null default 'cho-duyet'
                  check (trang_thai in ('cho-duyet','da-duyet','tu-choi','da-dieu-xe','huy')),
  nguoi_duyet   text,
  duyet_at      timestamptz,
  ncc_dieu      text,
  bks           text,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists xin_tc_ngay_idx on xin_tang_cuong (ngay desc, trang_thai);
create trigger xin_tc_touch before update on xin_tang_cuong
  for each row execute function m12_touch();

-- Nhật ký ĐIỀU CHỈNH — BÁO NCC (tab "Điều chỉnh - Báo NCC").
create table if not exists dieu_chinh_ncc (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  ngay_ap_dung date,
  region_key   text references regions(key) on update cascade,
  route_code   text,
  loai         text not null check (loai in ('mo-moi','huy','dieu-chinh','doi-gio','doi-ncc','khac')),
  ncc          text,
  supplier_id  uuid references suppliers(id) on delete set null,
  noi_dung     text,
  nguoi_bao    text,
  da_bao_ncc   boolean not null default false,
  bao_luc      timestamptz,
  trang_thai   text not null default 'moi' check (trang_thai in ('moi','da-bao','da-xac-nhan','huy')),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists dcn_at_idx on dieu_chinh_ncc (at desc);
create trigger dcn_touch before update on dieu_chinh_ncc
  for each row execute function m12_touch();

-- ------------------------------------------------------------
-- 7. SỐ LIỆU ĐO LƯỜNG (nạp bằng ETL — read-mostly, không nhập tay)
-- ------------------------------------------------------------

-- TLLD = tỷ lệ lấp đầy theo tuyến/ngày (4 hub).
create table if not exists tlld_daily (
  ngay        date not null,
  hub         text not null,                   -- HCM01 | HCM20 | Sóng Thần | Tân Tạo
  route_code  text not null,
  code_norm   text generated always as (upper(regexp_replace(coalesce(route_code,''), '\s+', '', 'g'))) stored,
  tlld_weight numeric(6,4),                    -- 0..1
  weight_kg   numeric(12,2),
  capacity_kg numeric(12,2),
  so_don      int,
  source      text not null default 'etl',
  updated_at  timestamptz not null default now(),
  primary key (ngay, hub, route_code)
);
create index if not exists tlld_code_idx on tlld_daily (code_norm, ngay desc);

-- Sản lượng LẤY HÀNG theo bưu cục/ngày (tab "ST LAY BC").
create table if not exists san_luong_bc (
  ngay           date not null,
  warehouse_code text not null,                -- warehouse_id trên sheet
  warehouse_name text,
  district_name  text,
  category       text not null default '1. Lấy hàng',
  volume         int,
  weight_kg      numeric(12,2),
  updated_at     timestamptz not null default now(),
  primary key (ngay, warehouse_code, category)
);
create index if not exists san_luong_bc_ngay_idx on san_luong_bc (ngay desc);

-- Sản lượng theo kho tổng (SL HCM20 / SL ST).
create table if not exists san_luong_kho (
  ngay       date not null,
  kho_key    text not null,                    -- 'ktc-hcm20' | 'ktc-st'
  metric     text not null,                    -- 'don' | 'kg' | 'chuyen'
  value      numeric(14,2),
  updated_at timestamptz not null default now(),
  primary key (ngay, kho_key, metric)
);

-- Dự báo (FC HCM20 / FC ST) + thực tế để tính độ chính xác.
create table if not exists fc_daily (
  ngay       date not null,
  kho_key    text not null,
  forecast   numeric(14,2),
  actual     numeric(14,2),
  updated_at timestamptz not null default now(),
  primary key (ngay, kho_key)
);

-- Lịch trực GSVT (tab "LỊCH TRỰC GSVT").
create table if not exists gsvt_roster (
  id         uuid primary key default gen_random_uuid(),
  ca         text not null,
  khung_gio  text,
  ho_ten     text not null,
  sdt        text,
  hieu_luc_tu date,
  sort       int not null default 0,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 8. VIEW TƯƠNG THÍCH — trả đúng hình dạng mà frontend cũ mong đợi
--    (1 dòng = 1 điểm dừng, kèm cột tuyến) để giảm việc sửa code đọc.
-- ------------------------------------------------------------
create or replace view v_lich_tai as
select
  r.region_key,
  rg.legacy_gid,
  rg.label       as region_label,
  r.id           as route_id,
  r.code         as route,
  r.category,
  r.load,
  r.ncc,
  r.bks,
  r.sort         as route_sort,
  s.id           as stop_id,
  s.seq,
  s.kho,
  s.loai_hinh,
  s.toi,
  s.roi,
  s.ext_id,
  w.lat,
  w.lng
from routes r
join regions rg on rg.key = r.region_key
left join stops s on s.route_id = r.id
left join warehouses w on w.id = s.warehouse_id
where r.active
order by r.sort, r.code, s.seq;
