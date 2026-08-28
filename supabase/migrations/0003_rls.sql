-- ============================================================
-- M12 LỊCH TẢI — BẢO MẬT HÀNG (Row Level Security)
--
-- MÔ HÌNH ĐÃ CHỌN: "khoá kín, đi qua API".
--   - Trình duyệt KHÔNG nói chuyện thẳng với Supabase.
--   - Mọi truy cập đi qua Vercel API routes, dùng SUPABASE_SERVICE_ROLE_KEY
--     (service_role bỏ qua RLS) + phiên đăng nhập ký HMAC của chính app.
--   - Bật RLS + KHÔNG tạo policy nào cho anon/authenticated
--     => kể cả lộ ANON KEY ra ngoài cũng không đọc/ghi được gì.
--
-- Đây là lý do lớp API vẫn phải tự kiểm tra quyền (api/_lib/auth.ts).
-- Nếu sau này muốn dùng Supabase Auth + gọi thẳng từ trình duyệt, hãy bật
-- các policy "GIAI ĐOẠN 2" ở cuối file (đang comment sẵn).
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'regions','warehouses','warehouse_aliases','suppliers','routes','stops',
    'loai_hinh_values','vehicles','tc_trips','tc_events','xin_tang_cuong',
    'dieu_chinh_ncc','tlld_daily','san_luong_bc','san_luong_kho','fc_daily',
    'gsvt_roster','roles','accounts','role_permissions','login_otp','login_fails',
    'user_activity','qa_threads','qa_messages','knowledge','ai_context_sources',
    'ai_daily','overview_snapshots','reports','app_secrets','app_kv','audit_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Thu hồi quyền mặc định của 2 role công khai — chắc chắn không rò rỉ qua PostgREST.
-- (Bọc trong DO để file vẫn chạy được trên Postgres thường, nơi chưa có 2 role này.)
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables    in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
    end if;
  end loop;
end $$;

-- app_secrets: ngay cả service_role cũng chỉ nên đọc qua lớp API. Ghi log mọi lần đổi khoá.
create or replace function m12_secret_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  insert into audit_log(actor, action, table_name, row_id, changes)
  values (m12_actor(), 'update', 'app_secrets', new.key,
          jsonb_build_object('rotated', true));   -- KHÔNG ghi giá trị khoá vào log
  return new;
end $$;
create trigger app_secrets_touch before update on app_secrets
  for each row execute function m12_secret_touch();

-- ------------------------------------------------------------
-- GIAI ĐOẠN 2 (tuỳ chọn) — nếu chuyển sang Supabase Auth và gọi thẳng từ browser.
-- Bỏ comment và điều chỉnh khi cần. `auth.jwt() ->> 'email'` là email người đăng nhập.
-- ------------------------------------------------------------
-- create or replace function m12_role_of(p_email text)
-- returns text language sql stable security definer as $$
--   select role_id from accounts where email_lc = lower(btrim(p_email)) and not disabled
-- $$;
--
-- create or replace function m12_can(p_module text, p_action text)
-- returns boolean language sql stable security definer as $$
--   select coalesce((
--     select rp.allowed from role_permissions rp
--      where rp.role_id = m12_role_of(auth.jwt() ->> 'email')
--        and rp.module = p_module and rp.action = p_action
--   ), false)
-- $$;
--
-- create policy routes_read on routes for select to authenticated
--   using (m12_can('lich-tai','view'));
-- create policy routes_write on routes for all to authenticated
--   using (m12_can('lich-tai','edit')) with check (m12_can('lich-tai','edit'));
