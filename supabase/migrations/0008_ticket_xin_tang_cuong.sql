-- ============================================================
-- TICKET XIN TĂNG CƯỜNG — tab mới (09/2026), cùng cấp "TLLD Tuyến"/"Ticket Vận
-- Tải" trên menu. Thay dần luồng đăng ký + GSVT phản hồi + tạo app tăng cường
-- ad hoc hiện đang chạy trên Google Sheet "Nội thành"/"Nội vùng" (xem project
-- riêng tai-tang-cuong-vercel + bot Playwright tangcuong_adhoc_bot.py).
--
-- CỐ Ý TÁCH BIỆT HOÀN TOÀN với bảng `tickets` bên project tai-tang-cuong-vercel
-- (cùng chung Supabase project/schema `m12`, KHÁC bảng) — theo đúng yêu cầu đã
-- chốt: không FK, không phụ thuộc, an toàn để build/test song song mà không
-- đụng dữ liệu ticket TTC- đang chạy thật.
--
-- Bảng addon_trip_ticket ĐÃ được tạo thủ công qua SQL Editor trước migration
-- này — file dùng "if not exists" nên chạy lại an toàn (đồng bộ vào lịch sử
-- migration của repo), rồi bổ sung phần còn thiếu để khớp quy ước dự án:
-- trigger touch/audit, RLS force + revoke/grant, đăng ký vào ma trận quyền.
-- ============================================================

set search_path = m12, public;

-- ------------------------------------------------------------
-- 1. Bảng (idempotent — khớp cấu trúc đã chạy tay trước đó)
-- ------------------------------------------------------------
create table if not exists addon_trip_ticket (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),

  -- === Dữ liệu ticket gốc (copy từ sheet Nội thành A-M, KHÔNG liên kết bảng tickets) ===
  ticket_id          text unique not null,
  region             text,
  warehouse_name     text,
  warehouse_khac     text,
  lo_trinh           text,
  msnv               text,
  telegram           text,
  sdt                text,
  so_kien            integer,
  the_tich           text,
  ngay_mong_muon     text,
  gio_mong_muon      text,
  ghi_chu            text,

  -- === GSVT phản hồi + trạng thái duyệt (cột N-U của sheet) ===
  trang_thai         text,
  ngay_duyet         text,
  gio_toi            text,
  ma_chuyen          text,
  ten_ncc            text,
  bks                text,
  tai_trong          text,
  thong_tin_tx       text,
  ve_ktc             text,

  -- === Riêng cho flow tạo chuyến ad hoc (bot Playwright tangcuong_adhoc_bot.py) ===
  thu_tu_diem        integer,
  warehouse          text,
  tao_app_trigger    boolean not null default false,
  da_tao_app         text,

  updated_at         timestamptz not null default now()
);

create unique index if not exists idx_addon_trip_ticket_ticket_id
  on addon_trip_ticket (ticket_id);
create index if not exists idx_addon_trip_ticket_region
  on addon_trip_ticket (region);

-- ------------------------------------------------------------
-- 2. Trigger touch (updated_at) + audit (nhật ký diff), khớp quy ước chung
--    (m12_touch/m12_audit định nghĩa ở 0001_core.sql/0002_app.sql).
-- ------------------------------------------------------------
drop trigger if exists addon_trip_ticket_touch on addon_trip_ticket;
create trigger addon_trip_ticket_touch before update on addon_trip_ticket
  for each row execute function m12.m12_touch();

drop trigger if exists addon_trip_ticket_audit on addon_trip_ticket;
create trigger addon_trip_ticket_audit after insert or update or delete on addon_trip_ticket
  for each row execute function m12.m12_audit();

-- ------------------------------------------------------------
-- 3. RLS — cùng mô hình "khoá kín, đi qua API" của 0003_rls.sql (bảng mới nên
--    KHÔNG nằm trong vòng lặp của file đó, phải tự bật ở đây, giống 0007).
-- ------------------------------------------------------------
alter table addon_trip_ticket enable row level security;
alter table addon_trip_ticket force row level security;

do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on m12.addon_trip_ticket from %I', r);
    end if;
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table m12.addon_trip_ticket to service_role;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. Quyền: module mới "ticket-xtc" trong ma trận Phân quyền.
--    - action "view" = xem tab (mặc định mở cho mọi vai trò đang có, giống
--      "ticket-vt" — trang mới, chưa có dữ liệu nhạy cảm nhiều hơn tab cũ).
--    - action "edit" = sửa/nhập GSVT phản hồi + bật cờ "Tạo App". Mặc định
--      TẮT với mọi vai trò trừ admin; Sếp bật cho vai trò phù hợp (vd "Giám
--      sát vận tải"/GSVT) qua Phân quyền -> Ma trận Quyền.
-- ------------------------------------------------------------
insert into perm_modules (module, sub, module_label, sub_label, sort) values
  ('ticket-xtc', '*', 'Ticket xin tăng cường', 'Ticket xin tăng cường (Nội thành/Nội vùng)', 105)
on conflict (module, sub) do nothing;

insert into role_permissions (role_id, module, sub, action, allowed)
select r.id, 'ticket-xtc', '*', 'view', true
from roles r
on conflict do nothing;

insert into role_permissions (role_id, module, sub, action, allowed)
select 'admin', 'ticket-xtc', '*', a, true
from unnest(array['view','edit']) a
on conflict do nothing;
