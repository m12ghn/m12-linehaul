-- ============================================================
-- GỘP 2 VÙNG "MBH Tân Tạo" + "MBH Tân Thuận Q7" -> 1 vùng "Mobile Hub"
--
-- 01/09/2026, Sếp xác nhận: cấu trúc sheet Lịch Tải thật KHÔNG còn 2 tab
-- riêng "MBH Tân Tạo" (gid 1937583700) và "MBH Tân Thuận Q7" (gid 722712650)
-- nữa — đã gộp thành 1 tab duy nhất "Mobile Hub", nạp qua file mbh.csv. Điều
-- này khớp đúng với điều đã thấy ở "sự cố #3" tối 01/09 (tải mbh.csv cho gid
-- Tân Tạo ra nội dung "gộp nhiều mobile hub trong cùng 1 tab") — lúc đó tưởng
-- là hiểu lầm tạm thời, hoá ra chính là cấu trúc thật.
--
-- `mbh-tan-tao` CHƯA từng nạp dữ liệu (luôn bị --csv-dir bỏ qua vì thiếu file
-- riêng, xem trạng thái migration) -> xoá vùng này AN TOÀN, không có gì mất.
-- `mbh-tan-thuan-q7` ĐÃ nạp thật (11 tuyến, 32 điểm dừng, tối 01/09) -> Sếp
-- CHỌN xoá sạch để nạp lại dưới vùng mới (tránh trùng lặp tuyến trên UI giữa
-- vùng cũ còn sót và vùng "Mobile Hub" mới), thay vì giữ song song.
--
-- `routes.region_key` có khoá ngoại tới `regions(key)` (0001) -> phải xoá
-- routes (kéo theo stops qua on delete cascade) TRƯỚC khi xoá dòng regions
-- tương ứng, nếu không Postgres sẽ chặn (đúng ý muốn — thà lỗi rõ ràng còn
-- hơn để sót tham chiếu). Chưa có script nạp nào cho xin_tang_cuong/
-- dieu_chinh_ncc (2 bảng còn lại tham chiếu regions(key)) nên không có gì để
-- dọn ở 2 bảng đó; nếu sau này có dữ liệu tham chiếu 2 vùng cũ, migration này
-- sẽ tự chặn lại bằng lỗi khoá ngoại thay vì âm thầm để sót.
--
-- Chưa có gid thật cho tab "Mobile Hub" (sheet Lịch Tải không public — vẫn
-- đang nạp qua CSV tải tay, xem scripts/import-sheets.mjs) -> legacy_gid để
-- NULL, cập nhật sau nếu/khi có.
-- ============================================================

set search_path = m12, public;

-- 1) Xoá dữ liệu tuyến/điểm dừng CŨ của 2 vùng bị gộp (cascade xoá cả stops).
delete from m12.routes where region_key in ('mbh-tan-tao', 'mbh-tan-thuan-q7');

-- 2) Xoá 2 vùng cũ khỏi danh mục — an toàn vì bước 1 đã dọn hết tham chiếu.
delete from m12.regions where key in ('mbh-tan-tao', 'mbh-tan-thuan-q7');

-- 3) Thêm vùng mới, giữ đúng vị trí thứ tự cũ (sort=5, ngay sau MBH Sóng Thần).
insert into m12.regions (key, legacy_gid, label, sort, hidden, excluded) values
  ('mobile-hub', null, 'Mobile Hub', 5, false, false)
on conflict (key) do nothing;
