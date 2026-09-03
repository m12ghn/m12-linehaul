-- ============================================================
-- VIEW tlld_trip — MỘT DÒNG MỖI CHUYẾN, dựng trên tlld_daily (mức điểm dừng).
--
-- VÌ SAO CẦN VIEW NÀY:
--   Dashboard hiển thị TLLD theo TUYẾN/NGÀY (giống hệt cách workbook Sheet cũ
--   trình bày: mỗi dòng = 1 chuyến). Nhưng tlld_daily lưu mức điểm dừng (0004) —
--   một chuyến 5 điểm dừng ra 5 dòng. Đọc thẳng bảng đó cho giao diện thì:
--     • tốn băng thông gấp nhiều lần không cần thiết (ngày 30/08: 2.647 điểm dừng
--       nhưng chỉ 809 chuyến — gấp 3.3 lần),
--     • và bắt frontend phải tự khử trùng lặp mỗi lần đọc.
--   Đưa việc khử trùng lặp vào ĐÚNG MỘT CHỖ (view này), theo đúng nguyên tắc ở
--   0004: "lưu ở mức thấp nhất mà nguồn cho, gộp lên mức khác thì lúc nào cũng
--   làm được".
--
-- QUY TẮC CHỌN DÒNG ĐẠI DIỆN: DISTINCT ON (ngay, ma_chuyen) ... ORDER BY thu_tu ASC
-- -> lấy ĐIỂM DỪNG ĐẦU TIÊN của mỗi chuyến.
--   - tlld_weight_chuyen / tlld_vol_chuyen là số CẢ CHUYẾN (tính theo quãng đường
--     từng chặng), về lý thuyết GIỐNG NHAU ở mọi điểm dừng của cùng một chuyến ->
--     lấy điểm nào cũng ra cùng một số.
--   - loai_tai thì NGƯỢC LẠI — đây là công tắc chọn số TẠI TỪNG ĐIỂM DỪNG (xem
--     comment ở 0004), nên CÓ THỂ đổi giữa Xuất/Nhập dọc theo các điểm dừng của
--     một chuyến. Lấy điểm đầu tiên là một GIẢ ĐỊNH, CHƯA kiểm chứng bằng dữ liệu
--     thật — xem endpoint api/cron/tlld.ts?che_do=chieu (kiểm tra thực nghiệm,
--     cùng tinh thần với che_do=kho ở trên). Nếu kiểm tra cho thấy giả định sai,
--     sửa lại ORDER BY ở đây, KHÔNG sửa ở tầng frontend.
--
-- security_invoker=true: view chạy dưới quyền người GỌI, không phải người TẠO
-- view -> RLS của tlld_daily vẫn có hiệu lực đúng cho ai gọi view. (Trong dự án
-- này mọi lời gọi đều qua service_role nên RLS bị bỏ qua như thường lệ — cờ này
-- là để làm đúng, phòng sau này có vai trò khác gọi view.)
-- ============================================================

set search_path = m12, public;

create or replace view m12.tlld_trip
with (security_invoker = true) as
select distinct on (ngay, ma_chuyen)
  ngay,
  ma_chuyen,
  ma_tuyen,
  code_norm,
  loai_lich,
  loai_tai,
  hub,
  bien_so,
  partner_code,
  partner_type,
  tai_trong_xe,
  is_van,
  is_special,
  ky_tieu_chuan,
  don_tieu_chuan,
  so_diem_dung,
  tong_quang_duong,
  khoiluong_kg,
  so_don_hang,
  tlld_weight_chuyen,
  tlld_vol_chuyen,
  kho          as kho_dau,
  updated_at
from m12.tlld_daily
order by ngay, ma_chuyen, thu_tu asc;

-- Chỉ service_role đọc (đúng luật đã áp cho mọi bảng/view khác trong schema —
-- xem chốt chặn cuối 0003/0004). View phụ thuộc tlld_daily nên PostgreSQL tự
-- đòi hỏi quyền SELECT trên bảng gốc cho ai được cấp SELECT trên view.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on m12.tlld_trip to service_role;
  end if;
end $$;

do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on m12.tlld_trip from %I', r);
    end if;
  end loop;
end $$;
