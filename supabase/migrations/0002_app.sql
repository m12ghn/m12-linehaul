-- ============================================================
-- M12 LỊCH TẢI — SCHEMA ỨNG DỤNG (thay toàn bộ Cloudflare KV)
--
-- Bỏ Cloudflare = mất KV. Bảng dưới đây thay thế 1-1 từng key KV cũ:
--   accounts:v1        -> accounts
--   rbac:v1            -> roles + role_permissions
--   qa:list            -> qa_threads + qa_messages
--   kb:list            -> knowledge
--   report:<key>       -> reports
--   users:list         -> user_activity
--   visits:total       -> app_kv['visits:total']
--   daily:<id>         -> ai_daily
--   ovsnap:<date>      -> overview_snapshots
--   extra:<id>         -> ai_context_sources
--   cfg:*  / oauth:*   -> app_secrets  (⚠ chỉ đọc bằng service_role)
--   ltedit:log:*       -> audit_log
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tài khoản & vai trò
-- ------------------------------------------------------------
create table if not exists roles (
  id         text primary key,                 -- 'admin' | 'manager' | 'staff' | ...
  label      text not null,
  sort       int  not null default 0,
  system     boolean not null default false,   -- vai trò lõi, không cho xoá
  created_at timestamptz not null default now()
);
insert into roles (id, label, sort, system) values
  ('admin',   'Quản trị',      1, true),
  ('manager', 'Quản lý',       2, true),
  ('leader',  'Trưởng nhóm',   3, false),
  ('staff',   'Nhân viên',     4, true),
  ('viewer',  'Chỉ xem',       5, false)
on conflict (id) do nothing;

create table if not exists accounts (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  email_lc     text generated always as (lower(btrim(email))) stored,
  name         text not null default '',
  role_id      text not null default 'staff' references roles(id) on update cascade,
  pw_salt      text,                            -- hex; null = chưa đặt mật khẩu (đăng nhập OTP)
  pw_hash      text,                            -- hex PBKDF2-SHA256 100k vòng
  disabled     boolean not null default false,
  last_login   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists accounts_email_uidx on accounts (email_lc);
create trigger accounts_touch before update on accounts
  for each row execute function m12_touch();

-- Ma trận quyền: 1 dòng = (vai trò × module × CHỨC NĂNG CON × hành động).
-- Thay cho blob JSON "rbac:v1" -> truy vấn/kiểm tra được bằng SQL.
--
-- ⚠ PHẢI có cấp `sub`: src/lib/rbac.ts đã mô hình hoá 4 cấp
--   role -> module -> sub -> action  (vd "ds-ncc" có sub "contact"/"gd" khoá riêng
--   thông tin liên hệ & giám đốc NCC). Bỏ cấp sub là mất luôn các khoá đó.
-- Quy ước: sub = '*' nghĩa là quyền áp cho CẢ module (dùng cho module chưa chia sub).
create table if not exists role_permissions (
  role_id text not null references roles(id) on delete cascade on update cascade,
  module  text not null,                        -- 'lich-tai', 'tang-cuong', 'plan-event', ...
  sub     text not null default '*',            -- 'lich', 'gsvt', 'contact', ... hoặc '*'
  action  text not null,                        -- view | create | edit | delete | approve | export
  allowed boolean not null default false,
  primary key (role_id, module, sub, action)
);
create index if not exists role_perm_lookup_idx
  on role_permissions (role_id, module, action) where allowed;

-- Danh mục module/sub — nguồn sự thật để dựng ma trận mặc định và bù ô còn thiếu
-- khi thêm module mới. Khớp MODULES trong src/lib/rbac.ts.
create table if not exists perm_modules (
  module text not null,
  sub    text not null,
  module_label text,
  sub_label    text,
  sort   int not null default 0,
  primary key (module, sub)
);
insert into perm_modules (module, sub, module_label, sub_label, sort) values
  ('tong-quan','health','Tổng Quan','Sức khoẻ cụm',1),
  ('tong-quan','alerts','Tổng Quan','Cảnh báo lãng phí / vượt tải',2),
  ('tong-quan','ask','Tổng Quan','Hỏi nhanh (AI)',3),
  ('lich-tai','lich','Lịch Tải','Lịch tải tuyến',10),
  ('lich-tai','gsvt','Lịch Tải','GSVT · lịch trực',11),
  ('lich-tai','cong','Lịch Tải','Cổng Xuất',12),
  ('lich-tai','veh','Lịch Tải','Biển số & SĐT tài xế',13),
  ('lich-tai','excel','Lịch Tải','Xuất Excel lịch',14),
  ('tlld-tuyen','table','TLLD Tuyến','Bảng TLLD tuyến',20),
  ('tlld-tuyen','ai','TLLD Tuyến','Nhận định AI',21),
  ('tlld-tuyen','exclude','TLLD Tuyến','Loại trừ tuyến',22),
  ('tang-cuong','lay','Vùng HCM','TC - Lấy',30),
  ('tang-cuong','giao','Vùng HCM','TC - Giao',31),
  ('tang-cuong','ps','Vùng HCM','TC - Phát sinh (xin xe)',32),
  ('tang-cuong','am','Vùng HCM','TT - AM (danh bạ điểm)',33),
  ('tang-cuong','ncc','Vùng HCM','TC - NCC',34),
  ('san-luong','dash','Sản Lượng','Dashboard sản lượng',40),
  ('san-luong','ai','Sản Lượng','Phân tích AI',41),
  ('san-luong','manual','Sản Lượng','Nhập tay',42),
  ('ds-ncc','list','Performance NCC','Hồ sơ & danh sách NCC',50),
  ('ds-ncc','contact','Performance NCC','Liên hệ & SĐT',51),
  ('ds-ncc','gd','Performance NCC','Thông tin giám đốc',52),
  ('plan-event','plan','Plan Event','Lập kế hoạch',60),
  ('plan-event','review','Plan Event','Đánh giá sau event',61),
  ('plan-event','fleet','Plan Event','Dự trù xe',62),
  ('sap-lich-tai','sched','Trợ lý Lịch Tải','Sắp lịch',70),
  ('sap-lich-tai','ghep','Trợ lý Lịch Tải','Ghép tải',71),
  ('sap-lich-tai','teach','Trợ lý Lịch Tải','Dạy kiến thức',72),
  ('cong-xuat','board','Cổng Xuất','Bảng cổng xuất',80),
  ('cong-xuat','assign','Cổng Xuất','Gán biển số',81),
  ('phan-quyen','accounts','Phân quyền','Tài khoản nhân sự',90),
  ('phan-quyen','depts','Phân quyền','Danh mục Bộ phận',91),
  ('phan-quyen','matrix','Phân quyền','Ma trận Quyền',92),
  ('phan-quyen','roles','Phân quyền','Vai trò (Roles)',93)
on conflict (module, sub) do nothing;

-- Quyền mặc định: admin làm được mọi thứ.
insert into role_permissions (role_id, module, sub, action, allowed)
select 'admin', pm.module, pm.sub, a, true
from perm_modules pm
cross join unnest(array['view','create','edit','delete','approve','export']) a
on conflict do nothing;

-- Các vai trò còn lại: mặc định chỉ XEM, và KHÔNG thấy mục Phân quyền
-- (cùng tinh thần bản cũ: chỉ admin cấu hình quyền).
insert into role_permissions (role_id, module, sub, action, allowed)
select r.id, pm.module, pm.sub, 'view', true
from roles r
cross join perm_modules pm
where r.id <> 'admin' and pm.module <> 'phan-quyen'
on conflict do nothing;

-- Thông tin nhạy cảm của NCC (SĐT liên hệ, giám đốc): mặc định TẮT với vai trò thường,
-- admin bật thủ công cho ai cần — giữ đúng ý đồ phân quyền chi tiết của bản cũ.
update role_permissions set allowed = false
 where role_id <> 'admin' and module = 'ds-ncc' and sub in ('contact','gd');

-- Mã OTP đăng nhập email (thay key KV tạm thời).
create table if not exists login_otp (
  email_lc   text primary key,
  code_hash  text not null,
  expires_at timestamptz not null,
  tries      int not null default 0,
  sent_at    timestamptz not null default now()
);

-- Chống dò mật khẩu (thay loginLockedMs/recordLoginFail trong _session.ts).
create table if not exists login_fails (
  email_lc    text primary key,
  fails       int not null default 0,
  locked_until timestamptz
);

-- Ai đang dùng dashboard (thay users:list).
create table if not exists user_activity (
  email_lc   text primary key,
  name       text,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  hits       int not null default 1
);

-- ------------------------------------------------------------
-- 2. Hỏi đáp / góp ý (thay qa:list)
-- ------------------------------------------------------------
create table if not exists qa_threads (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default '',
  email      text,
  msg        text not null,
  answered   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists qa_threads_created_idx on qa_threads (created_at desc);
create trigger qa_threads_touch before update on qa_threads
  for each row execute function m12_touch();

create table if not exists qa_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references qa_threads(id) on delete cascade,
  by_role    text not null check (by_role in ('user','admin')),
  name       text not null default '',
  text       text not null,
  created_at timestamptz not null default now()
);
create index if not exists qa_messages_thread_idx on qa_messages (thread_id, created_at);

-- ------------------------------------------------------------
-- 3. Trợ lý AI: kiến thức, nguồn nạp thêm, phân tích hằng ngày
-- ------------------------------------------------------------
create table if not exists knowledge (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  cat        text,
  source     text not null default 'nhap-tay',  -- 'nhap-tay' | 'daily-sync'
  created_at timestamptz not null default now()
);
create index if not exists knowledge_created_idx on knowledge (created_at desc);

create table if not exists ai_context_sources (
  id         uuid primary key default gen_random_uuid(),
  scope      text not null,                     -- id mục dashboard, '_shared' = dùng chung
  source     text not null,
  text       text not null,
  chars      int generated always as (length(text)) stored,
  created_at timestamptz not null default now()
);
create index if not exists ai_ctx_scope_idx on ai_context_sources (scope, created_at desc);

create table if not exists ai_daily (
  scope      text not null,                     -- id mục
  ngay       date not null,
  text       text not null,
  status     text not null default 'ok',
  created_at timestamptz not null default now(),
  primary key (scope, ngay)
);

create table if not exists overview_snapshots (
  ngay       date primary key,
  ref_date   date,
  stat       jsonb not null default '{}'::jsonb,
  alerts     jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists reports (
  key        text primary key,
  text       text not null default '',
  by_email   text,
  updated_at timestamptz not null default now()
);
create trigger reports_touch before update on reports
  for each row execute function m12_touch();

-- ------------------------------------------------------------
-- 4. Khoá cấu hình + KV tổng hợp
--    app_secrets: KHÔNG BAO GIỜ trả về client. Chỉ service_role đọc.
-- ------------------------------------------------------------
create table if not exists app_secrets (
  key        text primary key,                  -- 'gemini', 'gmaps', 'google_refresh_token', ...
  value      text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists app_kv (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into app_kv (key, value) values ('visits:total', '{"total":0}'::jsonb)
on conflict (key) do nothing;

-- Tăng bộ đếm lượt truy cập nguyên tử (thay read-modify-write trên KV, vốn hay mất số).
create or replace function bump_visits()
returns bigint language sql volatile as $$
  update app_kv
     set value = jsonb_set(value, '{total}',
                 to_jsonb(coalesce((value->>'total')::bigint, 0) + 1)),
         updated_at = now()
   where key = 'visits:total'
  returning (value->>'total')::bigint;
$$;

-- ------------------------------------------------------------
-- 5. NHẬT KÝ THAY ĐỔI — bắt buộc khi đảo chiều
--    Sheet cũ có lịch sử phiên bản của Google; Postgres thì không, nên
--    mọi thay đổi dữ liệu vận hành phải được ghi lại ở đây.
-- ------------------------------------------------------------
create table if not exists audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text,                              -- email người thao tác
  action     text not null,                     -- 'insert' | 'update' | 'delete'
  table_name text not null,
  row_id     text,
  changes    jsonb not null default '{}'::jsonb,-- { field: {from, to} }
  context    jsonb not null default '{}'::jsonb -- { region_key, route_code, ... }
);
create index if not exists audit_at_idx  on audit_log (at desc);
create index if not exists audit_row_idx on audit_log (table_name, row_id, at desc);

-- Ai đang thao tác? Hai đường, thử lần lượt:
--   1. GUC `m12.actor`  — khi chạy SQL/rpc trực tiếp (script ETL, psql).
--   2. Header `x-actor` — khi đi qua PostgREST: PostgREST đổ toàn bộ header
--      request vào GUC `request.headers`, lớp API luôn gửi kèm email người dùng.
create or replace function m12_actor()
returns text language plpgsql stable as $$
declare a text;
begin
  a := nullif(current_setting('m12.actor', true), '');
  if a is not null then return a; end if;
  begin
    a := nullif(current_setting('request.headers', true)::json ->> 'x-actor', '');
  exception when others then a := null;
  end;
  return a;
end $$;

-- Trigger audit dùng chung: ghi diff của mọi cột thay đổi.
create or replace function m12_audit()
returns trigger language plpgsql as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_old jsonb;
  v_new jsonb;
  k text;
  v_actor text := m12_actor();
begin
  if tg_op = 'INSERT' then
    insert into audit_log(actor, action, table_name, row_id, changes)
    values (v_actor, 'insert', tg_table_name, (to_jsonb(new)->>'id'), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into audit_log(actor, action, table_name, row_id, changes)
    values (v_actor, 'delete', tg_table_name, (to_jsonb(old)->>'id'), to_jsonb(old));
    return old;
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at') and v_old->k is distinct from v_new->k then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old->k, 'to', v_new->k));
      end if;
    end loop;
    if v_changes <> '{}'::jsonb then
      insert into audit_log(actor, action, table_name, row_id, changes)
      values (v_actor, 'update', tg_table_name, (v_new->>'id'), v_changes);
    end if;
    return new;
  end if;
end $$;

create trigger routes_audit          after insert or update or delete on routes           for each row execute function m12_audit();
create trigger stops_audit           after insert or update or delete on stops            for each row execute function m12_audit();
create trigger tc_trips_audit        after insert or update or delete on tc_trips         for each row execute function m12_audit();
create trigger xin_tc_audit          after insert or update or delete on xin_tang_cuong   for each row execute function m12_audit();
create trigger dieu_chinh_ncc_audit  after insert or update or delete on dieu_chinh_ncc   for each row execute function m12_audit();
create trigger accounts_audit        after insert or update or delete on accounts         for each row execute function m12_audit();
create trigger suppliers_audit       after insert or update or delete on suppliers        for each row execute function m12_audit();
