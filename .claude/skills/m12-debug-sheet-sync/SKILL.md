---
name: m12-debug-sheet-sync
description: Debug dữ liệu Google Sheet hiển thị cũ, không cập nhật, hoặc lỗi tải trên dashboard m12-lich-tai. Kích hoạt khi user báo "dữ liệu bị cũ", "sheet không cập nhật", "route bị thiếu/sai", "dashboard load lỗi", "StatusBar báo lỗi đồng bộ".
---

# Debug lỗi đồng bộ dữ liệu Google Sheet

Đọc [m12-conventions](../m12-conventions/SKILL.md) trước.

## Thứ tự nguồn CSV (fallback chain) — kiểm tra lần lượt

[src/config.ts](../../../src/config.ts) `csvSources(gid)` thử theo thứ tự:

1. `gviz/tq?tqx=out:csv&gid=...` — đọc trực tiếp model sheet, **gần realtime nhất**, nhưng có thể bị
   Google giới hạn quota nếu gọi quá dày.
2. `export?format=csv&gid=...` — Google redirect qua `googleusercontent`, có cache snapshot → **edit mới
   có thể trễ vài phút**. Đây thường là nguyên nhân "dữ liệu cũ" dù Sheet đã sửa.
3. `/api/sheet?gid=...` — proxy dự phòng cuối (chỉ hoạt động trên Vercel qua `api/sheet.ts`; trên
   Cloudflare Pages route này KHÔNG tồn tại trừ khi tự thêm Function tương ứng).

`fetchCsv()` trong [src/lib/sheet.ts](../../../src/lib/sheet.ts) thử lần lượt, dừng ở nguồn đầu tiên
thành công — nếu nguồn 1 (gviz) lỗi tạm thời, app tự rơi xuống nguồn 2 (có thể cũ hơn), giải thích tại
sao đôi khi thấy dữ liệu trễ dù gviz "thường realtime".

## Cache TTL — kiểm tra trước khi kết luận "sheet không đồng bộ"

- `SHEET_TTL = 40000` (40s) trong `sheet.ts` — request lặp lại trong 40s dùng cache, không gọi lại Sheet.
  Nếu vừa sửa Sheet và bấm đi bấm lại trong dashboard chưa quá 40s, đó là cache, không phải lỗi.
- Có gộp request trùng (`sheetInflight`) — nhiều nơi cùng gọi 1 `gid` trong lúc đang tải sẽ dùng chung
  1 Promise, không gọi API nhiều lần thừa.
- Nút "Làm mới" thủ công gọi `loadSheet(gid, signal, force=true)` — bỏ qua cache hoàn toàn, dùng để test
  xem dữ liệu Sheet thật đã cập nhật chưa (loại trừ nguyên nhân cache phía app).
- `REFRESH_MS = 60000` (60s) trong `config.ts` — chu kỳ tự động poll lại của `useSchedule`.

## Checklist chẩn đoán theo thứ tự

1. **Quyền chia sẻ Sheet** — mở URL CSV trực tiếp trên trình duyệt ẩn danh
   (`https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&gid=<gid>`). Nếu thấy trang yêu cầu
   đăng nhập → Sheet chưa để "Bất kỳ ai có liên kết → Người xem". `sheet.ts` có check riêng lỗi này
   (`SheetPrivateError`, nhận diện qua text `Unauthorized|requires you to sign in`).
2. **Test cache**: bấm "Làm mới" (force=true) trên dashboard — nếu dữ liệu vẫn cũ sau force refresh thì
   lỗi nằm ở phía Google/nguồn CSV, không phải cache app.
3. **Kiểm tra tên cột**: nếu route/kho hiện sai giá trị (không phải cũ, mà lệch cột) — Sheet có thể đã đổi
   tên tiêu đề cột. Xem `findCol()` trong `src/lib/csv.ts` và mảng từ khoá trong `col = {...}` của
   `sheet.ts` — thêm từ khoá mới nếu tab đổi tên cột.
3b. **Route bị nhân đôi/thiếu điểm dừng**: xem logic dedupe trong `loadSheetUncached()` — lọc theo chữ ký
   `kho|loaiHinh|toi|roi|id`. Nếu 1 route xuất hiện ở nhiều "Loại tuyến" trong Sheet với dữ liệu điểm dừng
   khác nhau nhẹ (sai chính tả giờ), dedupe sẽ KHÔNG coi là trùng → hiện lặp. Sửa tận gốc ở dữ liệu Sheet
   nếu có thể, hoặc mở rộng chữ ký dedupe nếu là lỗi hệ thống.
4. **Network tab trình duyệt**: xem request thật sự gọi tới nguồn nào (gviz/export/proxy), status code,
   độ trễ — dùng preview_network nếu đang debug qua Claude Code preview.
5. **Console log**: `sheet.ts` không log lỗi ra console theo thiết kế (silent fail, hiện qua `error` state
   thay vì console noise) — nếu cần debug sâu, tạm thêm `console.warn` rồi XOÁ lại trước khi commit/deploy.

## Không tự ý sửa khi debug

- Không hạ `SHEET_TTL`/`REFRESH_MS` xuống rất thấp để "chắc ăn" — tăng tải gọi Google Sheet không cần
  thiết, có thể chạm quota. Nếu thực sự cần đồng bộ nhanh hơn, hỏi user trước khi đổi hằng số này.
- Không thêm nguồn CSV thứ 4 hoặc đổi thứ tự fallback mà không hiểu rõ trade-off (comment trong
  `config.ts` giải thích rõ tại sao thứ tự là gviz → export → proxy).
