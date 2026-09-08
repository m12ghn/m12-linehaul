-- ============================================================
-- TICKET VẬN TẢI — trạng thái xử lý + nhật ký ghi chú (07/09/2026, yêu cầu #4).
--
-- Ticket Vận Tải (src/lib/ticket.ts) đọc SỐNG từ Sheet log Telegram, KHÔNG có
-- bảng lưu trữ riêng -> không có chỗ nào để "nhớ" ticket đã Done hay chưa, ai
-- xử lý, note gì. 2 bảng dưới đây lưu phần TRẠNG THÁI đó, khớp theo đúng khoá
-- hiển thị của ticket (groupId + "#" + messageId, xem Ticket.id trong
-- src/lib/ticket.ts) — KHÔNG đụng gì tới cách đọc/gộp luồng Sheet hiện có.
--
-- Không cần bảng "tickets" riêng: id vẫn suy ra sống từ Sheet mỗi lần tải,
-- 2 bảng này chỉ CỘNG THÊM trạng thái/ghi chú theo đúng id đó.
-- ============================================================

set search_path = m12, public;

-- ------------------------------------------------------------
-- 1. Trạng thái từng ticket (1 dòng/ticket, ghi đè khi đổi trạng thái).
-- ------------------------------------------------------------
create table if not exists ticket_status (
  id          text primary key,               -- groupId + "#" + messageId
  status      text not null default 'open' check (status in ('open','in_progress','done')),
  done_by     text,                            -- email GSVT bấm "Đã xử lý" lần gần nhất
  done_at     timestamptz,
  updated_by  text,                            -- email thao tác đổi trạng thái gần nhất
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create trigger ticket_status_touch before update on ticket_status
  for each row execute function m12.m12_touch();
create trigger ticket_status_audit after insert or update or delete on ticket_status
  for each row execute function m12.m12_audit();

-- ------------------------------------------------------------
-- 2. Nhật ký ghi chú xử lý — NHIỀU dòng/ticket theo thời gian (không ghi đè),
--    chốt qua AskUserQuestion 07/09/2026: "lưu log ai xử, xử ngày nào".
-- ------------------------------------------------------------
create table if not exists ticket_notes (
  id          bigserial primary key,
  ticket_id   text not null,                  -- groupId + "#" + messageId
  author      text not null,                  -- email GSVT ghi note
  note        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists ticket_notes_ticket_idx on ticket_notes (ticket_id, created_at);
create trigger ticket_notes_audit after insert or update or delete on ticket_notes
  for each row execute function m12.m12_audit();

-- ------------------------------------------------------------
-- 3. RLS — cùng mô hình "khoá kín, đi qua API" của 0003_rls.sql (bảng mới nên
--    KHÔNG nằm trong vòng lặp của file đó, phải tự bật ở đây).
-- ------------------------------------------------------------
alter table ticket_status enable row level security;
alter table ticket_status force row level security;
alter table ticket_notes  enable row level security;
alter table ticket_notes  force row level security;

do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on m12.ticket_status from %I', r);
      execute format('revoke all on m12.ticket_notes  from %I', r);
    end if;
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on table m12.ticket_status to service_role;
    grant all on table m12.ticket_notes  to service_role;
    grant all on sequence m12.ticket_notes_id_seq to service_role;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. Quyền: module mới "ticket-vt" trong ma trận Phân quyền.
--    - action "view"  = xem tab Ticket Vận Tải (giữ ĐÚNG hành vi hiện tại: tab
--      này trước giờ KHÔNG bị khoá, mọi vai trò đang có đều xem được).
--    - action "edit"  = MỚI — đổi trạng thái Mở/Đang xử lý/Đã xử lý + ghi note.
--      Mặc định TẮT với mọi vai trò trừ admin; Sếp bật cho vai trò phù hợp
--      (vd "Giám sát vận tải") qua Phân quyền -> Ma trận Quyền, giống mọi
--      quyền khác trong hệ thống — không hardcode 1 role cụ thể ở đây.
-- ------------------------------------------------------------
insert into perm_modules (module, sub, module_label, sub_label, sort) values
  ('ticket-vt', '*', 'Ticket Vận Tải', 'Ticket vận tải (Telegram)', 100)
on conflict (module, sub) do nothing;

insert into role_permissions (role_id, module, sub, action, allowed)
select r.id, 'ticket-vt', '*', 'view', true
from roles r
on conflict do nothing;

insert into role_permissions (role_id, module, sub, action, allowed)
select 'admin', 'ticket-vt', '*', a, true
from unnest(array['view','edit']) a
on conflict do nothing;
