-- ============================================================
-- TICKET XIN TĂNG CƯỜNG — bổ sung các cột còn thiếu so với sheet "Nội thành"
-- gốc (09/2026, theo yêu cầu "build lại giống với sheet") để bảng
-- addon_trip_ticket khớp ĐẦY ĐỦ layout sheet, không chỉ tập con ban đầu.
--
-- 5 cột mới (cột U/X/Y/AA/AE của sheet — xem phân tích CSV thật):
--   - note               : cột "Note" — dữ liệu tự do (quan sát thực tế đa số
--                          là SĐT phụ, có thể trống) — nhập cùng lúc đăng ký.
--   - da_thong_bao_tele   : cột "Đã thông báo tele" — cờ tự động (Apps Script)
--                          đánh dấu đã gửi Telegram cho ticket này.
--   - bl                  : cột "bl" — cờ tự động chặn theo blacklist (Y/N).
--   - blacklist           : cột "blacklist" — lý do/nội dung blacklist (thường
--                          trống, chỉ có khi bị chặn).
--   - hinh_kho            : cột "Hình kho" — link ảnh kho chụp lúc đăng ký.
--
-- KHÔNG thêm cột "Date" (cột AB gốc) — trùng lặp hoàn toàn với "Timestamp" đã
-- có ở created_at, giữ nguyên quyết định đã chốt lúc làm CSV import.
--
-- Vẫn giữ nguyên tắc TÁCH BIỆT HOÀN TOÀN với bảng `tickets` (project
-- tai-tang-cuong-vercel) — file này chỉ alter thêm cột, không đụng gì khác.
-- ============================================================

set search_path = m12, public;

alter table addon_trip_ticket
  add column if not exists note               text,
  add column if not exists da_thong_bao_tele   boolean not null default false,
  add column if not exists bl                  boolean not null default false,
  add column if not exists blacklist           text,
  add column if not exists hinh_kho            text;
