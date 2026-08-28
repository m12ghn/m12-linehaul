---
name: m12-add-sheet-source
description: Thêm vùng/kho mới (tab Google Sheet), thêm loại tuyến (category) mới, hoặc thêm workbook dữ liệu mới vào dashboard m12-lich-tai. Kích hoạt khi user nói "thêm vùng mới", "thêm tab sheet", "Sếp mở thêm kho X", "thêm loại tuyến", hoặc yêu cầu dashboard đọc thêm 1 sheet/tab Google Sheets mới.
---

# Thêm nguồn dữ liệu Google Sheet mới

Đọc [m12-conventions](../m12-conventions/SKILL.md) trước nếu chưa đọc trong phiên này.

## Bối cảnh

Toàn bộ nguồn dữ liệu Sheet khai báo tập trung ở [src/config.ts](../../../src/config.ts). App tự dò cột
theo tiêu đề (không phụ thuộc thứ tự cột), nên thêm tab mới thường CHỈ cần sửa `config.ts` + optional UI label.

## A. Thêm 1 vùng (tab) mới vào "Lịch Tải" (6 tab hiện có)

1. Lấy `gid` của tab mới trong Google Sheet (mở tab → xem URL `#gid=...`).
2. Sheet phải ở chế độ chia sẻ **"Bất kỳ ai có liên kết → Người xem"** — nếu chưa, báo user bật trước khi test.
3. Thêm 1 phần tử vào mảng `SHEETS` trong `src/config.ts`:
   ```ts
   export const SHEETS: SheetDef[] = [
     ...,
     { key: "ten-vung-moi", gid: "123456789", label: "Tên Vùng Mới" },
   ];
   ```
   `key` dùng nội bộ (kebab-case, không dấu), `label` hiển thị trên `SheetTabs.tsx`.
4. KHÔNG cần sửa `sheet.ts` — hàm `loadSheetUncached()` tự dò cột theo từ khoá tiêu đề
   (`ten tuyen`, `tai trong`, `ten kho`, `loai hinh`, `toi diem`, `roi diem`, `loai tuyen`...).
   Nếu tab mới có tên cột khác hẳn các từ khoá hiện có, thêm từ khoá vào mảng tương ứng trong
   `col = {...}` ở [src/lib/sheet.ts](../../../src/lib/sheet.ts) (dùng `findCol(H, [...])`).
5. Chạy `npm run dev`, mở tab mới trong `SheetTabs`, kiểm tra:
   - Route/kho hiển thị đúng.
   - `StatusBar` báo bao nhiêu điểm "chưa có toạ độ" — nếu nhiều, xem skill `m12-fix-geo-alias`.

## B. Thêm workbook hoàn toàn mới (không phải tab trong SHEET_ID chính)

Ví dụ như TLLD_SHEET_ID, VEHICLE_SHEET_ID, GXT_SHEET_ID, KNOWLEDGE_SHEET_ID đã có — pattern:

1. Khai báo `<TEN>_SHEET_ID` (hằng số) trong `config.ts`.
2. Khai báo danh sách tab: `<TEN>_TABS: string[]` hoặc `{gid, hub}[]` nếu cần gắn nhãn hub.
3. Viết hàm nguồn CSV riêng theo pattern có sẵn (ưu tiên gviz, fallback export):
   ```ts
   export function tenCsvSources(gid: string): string[] {
     return [
       `https://docs.google.com/spreadsheets/d/${TEN_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`,
       `https://docs.google.com/spreadsheets/d/${TEN_SHEET_ID}/export?format=csv&gid=${gid}`,
     ];
   }
   ```
   Hoặc dùng thẳng `sheetCsvSources(sheetId, gid)` đã có sẵn generic trong `config.ts` nếu không cần logic đặc thù.
4. Viết loader riêng trong `src/lib/<ten>.ts` (theo mẫu `tlld.ts`, `fc.ts`, `fleet.ts`) — parse CSV bằng
   `parseCSV`/`findCol` từ `src/lib/csv.ts`, KHÔNG viết parser CSV mới.
5. Nếu cần hiển thị realtime + cache, bọc bằng custom hook `use<Ten>.ts` theo mẫu `useTlld.ts`/`useFleet.ts`.

## C. Thêm loại tuyến (category) mới

Category lấy trực tiếp từ cột "Loại tuyến" trong Sheet — **không cần sửa code** để category mới xuất hiện,
nhưng để nó có nhãn đẹp và đúng vị trí sắp xếp:

1. Thêm entry vào `CATEGORY_LABELS` trong `config.ts` (key = giá trị nguyên văn trong Sheet, value = nhãn hiển thị).
2. Thêm vào `CATEGORY_ORDER` (mảng string) theo đúng vị trí ưu tiên mong muốn — category không có trong mảng
   này tự động xếp cuối theo alphabet (logic ở `sortCategories()` trong `sheet.ts`).

## Kiểm tra sau khi thêm

- `npm run dev`, xác nhận tab/loại tuyến mới hiển thị đúng dữ liệu, không phá các tab khác.
- Nếu vùng mới có tên kho chưa từng xuất hiện trong MyMap → chạy `npm run build:geo` (xem skill `m12-fix-geo-alias`).
- KHÔNG tự ý xoá hay đổi thứ tự các tab/category cũ khi chỉ được yêu cầu thêm mới.
