---
name: m12-fix-geo-alias
description: Sửa lỗi khớp toạ độ kho/bưu cục trên bản đồ m12-lich-tai — khi StatusBar báo "N điểm chưa có toạ độ", route không vẽ được trên map, hoặc tên kho trong Sheet không khớp tên trong Google MyMap. Kích hoạt khi user nói "bản đồ thiếu điểm", "kho X không lên map", "sai toạ độ", "thêm alias kho".
---

# Sửa lỗi khớp toạ độ kho (geo alias)

Đọc [m12-conventions](../m12-conventions/SKILL.md) mục 3 (đồng bộ normalize.ts ↔ build-geo.mjs) trước.

## Cơ chế khớp tên (để hiểu tại sao thiếu điểm)

1. [scripts/build-geo.mjs](../../../scripts/build-geo.mjs) tải KML từ Google MyMap (`MAP_MID` trong `config.ts`),
   trích toạ độ từng Placemark, chuẩn hoá tên bằng `normalizeName()`, ghi ra `src/data/geo.json`
   (key = tên đã chuẩn hoá, value = `[lat, lng]`).
2. [src/lib/geo.ts](../../../src/lib/geo.ts) → `lookupCoord(name)` tra theo thứ tự:
   - Alias thủ công trong `ALIASES` (nếu tên Sheet có mapping riêng) → chuẩn hoá → tra tuyệt đối trong `geo.json`.
   - Nếu không có → fuzzy match theo Jaccard similarity trên tập token, ngưỡng `FUZZY_THRESHOLD = 0.82`.
   - Tên có dưới 3 token bị bỏ qua fuzzy (`a.size < 3 → return undefined`) — quá ngắn dễ khớp sai.
3. `normalizeName()` (dùng chung logic ở cả `src/lib/normalize.ts` VÀ `scripts/build-geo.mjs`): bỏ dấu,
   chữ thường, cắt tiền tố mã số đầu chuỗi (`^\d{3,}[-_().\s]+`), gộp ký tự không phải a-z0-9 thành khoảng trắng.

## Quy trình chẩn đoán

1. Chạy `npm run build:geo` — output in ra:
   ```
   → Khớp tuyệt đối Sheet(gid0): <hit>/<total> (<%>).
     Chưa khớp tuyệt đối (<n>) — sẽ thử fuzzy lúc chạy. Vd: [...]
   ```
   Đây chỉ đối chiếu tab `gid=0` (Nội Thành HCM) làm mẫu nhanh, không phải toàn bộ dữ liệu.
2. Mở dashboard (`npm run dev`), xem `StatusBar` báo "N điểm chưa có toạ độ" ở vùng/tab đang mở — đây là
   nguồn chính xác nhất vì tính trên toàn bộ route đang hiển thị (`missingGeo[]` trả về từ `loadSheetUncached()`
   trong `src/lib/sheet.ts`).
3. Với mỗi tên kho bị thiếu: tìm tên tương ứng thật trong Google MyMap (mở MyMap, tìm placemark gần đúng).

## Cách sửa — theo mức độ lệch tên

- **Lệch nhẹ** (viết tắt/khác dấu, fuzzy match lẽ ra bắt được nhưng dưới ngưỡng 0.82, hoặc tên quá ngắn
  <3 token): thêm entry vào `ALIASES` trong `src/lib/geo.ts`:
  ```ts
  export const ALIASES: Record<string, string> = {
    "Tên kho viết trong Sheet (nguyên văn)": "Tên kho viết trong MyMap (nguyên văn)",
  };
  ```
  Key/value là tên GỐC (chưa chuẩn hoá) — `lookupCoord()` tự chuẩn hoá cả hai vế.
- **Viết tắt kho lặp lại nhiều nơi** (kiểu HCM20/TT/Q7 dùng trong tên tuyến, tìm kiếm, không phải tên
  Placemark cụ thể): thêm vào `KHO_ALIASES` trong [src/lib/normalize.ts](../../../src/lib/normalize.ts)
  (dùng bởi `expandAliases()`), KHÔNG nhầm với `ALIASES` trong `geo.ts` (2 cơ chế khác nhau, đọc kỹ
  comment ở đầu mỗi file).
- **MyMap vừa có điểm mới/đổi tên**: chạy lại `npm run build:geo` để regenerate `src/data/geo.json` — đây
  là bước bắt buộc mỗi khi Sếp sửa MyMap, không tự động.

## Lưu ý bắt buộc

- Sửa `normalizeName()` ở 1 trong 2 file (`normalize.ts` hoặc `build-geo.mjs`) → PHẢI sửa cả file kia
  (comment gốc: *"logic này được nhân bản... sửa ở đây thì sửa luôn bên đó"*). Không đồng bộ sẽ làm tên
  khớp được lúc build nhưng lệch lúc chạy app (hoặc ngược lại).
- Không hạ `FUZZY_THRESHOLD` xuống thấp hơn 0.82 để "vá tạm" 1 trường hợp — sẽ gây khớp sai hàng loạt cho
  các tên khác. Ưu tiên thêm `ALIASES` cụ thể.
- Sau khi sửa, chạy lại `npm run build:geo` rồi `npm run dev`, xác nhận điểm đã lên map và số "chưa có
  toạ độ" giảm đúng như kỳ vọng.
