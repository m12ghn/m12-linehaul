-- ============================================================
-- TLLD — DỰNG LẠI Ở MỨC ĐIỂM DỪNG
--
-- VÌ SAO DỰNG LẠI CHỨ KHÔNG VÁ CỘT:
--   Bảng tlld_daily ở 0001 thiết kế theo mức "mỗi tuyến mỗi ngày một dòng", làm
--   theo hình dung ban đầu là dữ liệu lấy từ Google Sheet. Nhưng nguồn thật
--   (Data API / Trino, bảng dtm_logistics_trip_detail) trả về MỖI ĐIỂM DỪNG MỘT
--   DÒNG, và có hai mức tỷ lệ khác nhau — tại điểm và cả chuyến. Ép dữ liệu đó
--   vào bảng cũ là mất sạch chi tiết.
--   Bảng cũ CHƯA CÓ DÒNG NÀO (chưa nạp lần nào) nên xoá đi làm lại là an toàn.
--
-- NGUYÊN TẮC: lưu ở mức thấp nhất mà nguồn cho. Gộp lên mức chuyến/tuyến/ngày
-- thì lúc nào cũng làm được; đã gộp rồi thì không tách ngược ra được.
--
-- Câu SQL sinh ra dữ liệu cho bảng này: scripts/tlld.sql
-- ============================================================

set search_path = m12, public;

-- Bảng cũ chưa từng có dữ liệu -> xoá thẳng. (Có dữ liệu thì PHẢI đổi tên để
-- giữ lại, đừng chạy lệnh này.)
drop table if exists m12.tlld_daily cascade;

create table if not exists m12.tlld_daily (
  id            uuid primary key default gen_random_uuid(),

  -- ---- khoá nghiệp vụ ----
  -- Ngày lấy theo lần check-in ĐẦU của chuyến (không phải load_date kế hoạch).
  -- Ngày = date(first_check_in), CHỐT dùng thẳng, không đổi múi giờ.
  -- KHÔNG dùng load_date: đó là ngày bản ghi được chạm lần cuối, không phải ngày
  -- chuyến chạy (chuyến E2608231HDJ88WW chạy 23/08 nhưng load_date ghi 30/08).
  ngay          date not null,
  ma_chuyen     text not null,                  -- code, ví dụ E2608231HDJ88WW
  thu_tu        int  not null,                  -- actual_sort_number: thứ tự CHẠY THẬT
                                                -- (không phải sort_number kế hoạch — xe đảo điểm là hai cái lệch)
  -- Một chuyến có thể ghé cùng một kho hai lần -> khoá phải có thu_tu,
  -- lấy tên kho làm khoá là trùng dòng, chạy nạp lần hai sẽ đè mất.
  constraint tlld_daily_uidx unique (ngay, ma_chuyen, thu_tu),

  -- ---- thuộc tính CHUYẾN (lặp lại ở mọi điểm dừng của chuyến) ----
  -- route_code, lấy từ bảng dtm_logistics_trip_filledrate — khoá nối sang m12.routes
  ma_tuyen      text,
  code_norm     text generated always as (upper(regexp_replace(coalesce(ma_tuyen,''), '\s+', '', 'g'))) stored,

  -- HAI CỘT KHÁC NHAU, đừng gộp. Nguồn từng đặt cả hai cùng tên `loai_tai`
  -- nên đã gây nhầm một lần:
  loai_lich     text,                           -- 'Cố định' | 'Tăng cường' — suy từ scheduler_name
  loai_tai      text,                           -- 'Xuất' | 'Nhập' — suy từ volume_ordercode_picked.
                                                -- Đây là CÔNG TẮC chọn số: Xuất thì lấy số tại điểm
                                                -- này, Nhập thì lấy số mang tới từ điểm trước.

  hub           text,
  bien_so       text,
  partner_code  text,
  partner_type  text,                           -- 'GHN' | 'NCC'
  tai_trong_xe  numeric(10,2),                  -- truck_capacity_weight, tải trọng hệ thống

  -- Bảng cấu hình xe tải có 9 bậc: 2 bậc đầu tra theo BIỂN SỐ, 7 bậc sau theo tải trọng.
  -- Lưu lại cờ để sau này đối chiếu được vì sao một xe ra mẫu số đó.
  is_van        boolean not null default false, -- bậc riêng 900 / 900
  is_special    boolean not null default false, -- bậc riêng 2550 đơn / 6100 kg
  ky_tieu_chuan  numeric(10,2),                 -- mẫu số kg đã tra xong
  don_tieu_chuan numeric(10,2),                 -- mẫu số đơn đã tra xong
  so_diem_dung  int,
  tong_quang_duong numeric(12,2),               -- L = L1 + ... + L(n-1)

  -- ---- thuộc tính ĐIỂM DỪNG ----
  kho             text,                         -- stoppoint_name
  warehouse_ext_id text,                        -- warehouse_id bên hệ thống nguồn (text, không phải FK)
  warehouse_id    uuid references m12.warehouses(id) on delete set null,  -- khớp sang kho của mình
  warehouse_type  text,
  kho_truoc_do    text,
  kho_tiep_theo   text,
  quang_duong_den_diem numeric(12,2),           -- est_distance: quãng đường điểm trước -> điểm này

  -- ---- số liệu KHI RỜI ĐIỂM ----
  khoiluong_kg  numeric(12,2),                  -- total_weight_converted
  so_don_hang   numeric(12,2),                  -- volume_ordercode

  -- ---- tỷ lệ lấp đầy, lưu dạng TỶ LỆ 0..n (không phải %) ----
  -- Lưu tỷ lệ chứ không lưu %: tính toán về sau đỡ nhân chia lung tung.
  -- Vượt 1.0 là BÌNH THƯỜNG — xe chở quá số ký tiêu chuẩn, thực tế thấy 3.0+.
  tlld_weight_diem   numeric(8,4),
  tlld_vol_diem      numeric(8,4),
  tlld_weight_chuyen numeric(8,4),
  tlld_vol_chuyen    numeric(8,4),

  -- ---- lưới an toàn ----
  -- Nguyên si dòng gốc từ Data API. Nguồn thêm cột mới thì dữ liệu cột đó ĐƯỢC
  -- LƯU NGAY, kể cả khi chưa kịp thêm cột thật — khỏi mất mấy tháng dữ liệu.
  raw           jsonb,

  source        text not null default 'data-api',
  updated_at    timestamptz not null default now()
);

-- Nối TLLD sang lịch tải: luôn tra theo mã tuyến đã chuẩn hoá.
create index if not exists tlld_daily_tuyen_idx  on m12.tlld_daily (code_norm, ngay);
create index if not exists tlld_daily_ngay_idx   on m12.tlld_daily (ngay desc);
create index if not exists tlld_daily_hub_idx    on m12.tlld_daily (hub, ngay desc);
create index if not exists tlld_daily_chuyen_idx on m12.tlld_daily (ma_chuyen);

create trigger tlld_daily_touch before update on m12.tlld_daily
  for each row execute function m12.m12_touch();

-- ------------------------------------------------------------
-- BẢO MẬT: bảng mới PHẢI tự bật RLS ngay tại đây.
-- 0003 có khối chốt chặn quét lại toàn schema và báo lỗi nếu còn bảng chưa bật —
-- đã một lần quên (bảng perm_modules) và chỉ lộ ra khi chạy trên Supabase thật.
-- ------------------------------------------------------------
alter table m12.tlld_daily enable row level security;
alter table m12.tlld_daily force  row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on m12.tlld_daily to service_role;
  end if;
end $$;

do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on m12.tlld_daily from %I', r);
    end if;
  end loop;
end $$;

-- Chốt chặn lại lần nữa cho chính file này.
do $$
declare thieu text;
begin
  select string_agg(tablename, ', ') into thieu
    from pg_tables where schemaname = 'm12' and not rowsecurity;
  if thieu is not null then
    raise exception 'Còn bảng CHƯA bật RLS trong schema m12: %', thieu;
  end if;
end $$;

-- ------------------------------------------------------------
-- GHI CHÚ CHO NGƯỜI ĐỌC SAU:
-- scripts/import-sheets.mjs vẫn còn bước `tlld` ghi theo cột CŨ (route_code,
-- tlld_weight...). Bước đó giờ KHÔNG chạy được nữa. Nguồn TLLD chuyển hẳn sang
-- Data API — xem scripts/tlld.sql. Khi đường ống mới chạy ổn thì xoá bước `tlld`
-- khỏi import-sheets.mjs cho khỏi ai chạy nhầm.
-- ------------------------------------------------------------
