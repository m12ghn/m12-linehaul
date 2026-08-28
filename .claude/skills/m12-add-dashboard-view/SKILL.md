---
name: m12-add-dashboard-view
description: Thêm 1 trang/view mới (menu cấp 1) vào dashboard m12-lich-tai, ví dụ mục mới ngang hàng với "Tổng Quan", "Lịch Tải", "Plan Event". Kích hoạt khi user nói "thêm mục mới vào menu", "thêm tab dashboard", "tạo trang mới", "thêm view".
---

# Thêm view (trang) mới vào dashboard

Đọc [m12-conventions](../m12-conventions/SKILL.md) trước — đặc biệt mục React pattern (lazy load, không Context).

## 5 bước bắt buộc (đúng thứ tự, thiếu bước nào view sẽ không hiện hoặc bundle phình to)

1. **Tạo file view** trong `src/views/TenView.tsx` — dùng template ở
   [assets/view-template.tsx](assets/view-template.tsx) làm điểm khởi đầu. Tham khảo view đơn giản đã có
   (`src/views/SanLuong.tsx`, `src/views/DsNcc.tsx`) nếu cần pattern gần giống.

2. **Thêm key vào type `TopMenu`** trong [src/types.ts](../../../src/types.ts) — nếu không thêm, TypeScript
   sẽ báo lỗi ở bước 4 khi so sánh `topMenu === "ten-moi"`.

3. **Đăng ký menu** trong `TOP_MENUS` ở [src/config.ts](../../../src/config.ts):
   ```ts
   export const TOP_MENUS: { key: TopMenu; label: string }[] = [
     ...,
     { key: "ten-moi", label: "Tên Hiển Thị" },
   ];
   ```
   Vị trí trong mảng = thứ tự hiển thị trên `NavBar`.

4. **Lazy import + render trong App.tsx** ([src/App.tsx](../../../src/App.tsx)) — theo đúng pattern các view
   khác (KHÔNG import thẳng, trừ `Overview` vì luôn load ngay đầu):
   ```tsx
   const TenView = lazy(() => import("./views/TenView").then((m) => ({ default: m.TenView })));
   ```
   rồi thêm nhánh render trong khối `<Suspense>`:
   ```tsx
   {topMenu === "ten-moi" && <TenView />}
   ```

5. **Nếu view cần chọn vùng** (như Lịch Tải/TLLD Tuyến dùng `SheetTabs`), thêm điều kiện hiện `SheetTabs`
   trong `App.tsx` (dòng render `<SheetTabs .../>` có điều kiện `topMenu === "..."`) — chỉ thêm nếu view
   thực sự cần lọc theo 6 vùng, không phải mặc định.

## Nếu view cần dữ liệu Sheet

- Dùng lại `useSchedule(gid)` (đã có polling 60s + cache TTL 40s) thay vì tự viết `fetch` mới — xem
  [src/lib/useSchedule.ts](../../../src/lib/useSchedule.ts).
- Nếu là dữ liệu khác (TLLD, fleet, forecast...) dùng hook tương ứng đã có (`useTlld`, `useFleet`) hoặc
  viết loader mới theo skill `m12-add-sheet-source` phần B.

## Nếu view cần quyền admin

Xem skill `m12-admin-feature` — bọc bằng `<AdminGate>` thay vì tự viết logic check quyền.

## Kiểm tra sau khi thêm

- `npm run dev`, click vào menu mới trên `NavBar`, xác nhận:
  - View load được (không lỗi trong console), có hiệu ứng "⏳ Đang mở…" khi lazy-load lần đầu.
  - Đổi menu khác rồi quay lại không bị mất state cần giữ (nếu view có state quan trọng, cân nhắc
    `usePersistent` để lưu localStorage — xem `src/lib/usePersistent.ts`).
- `npm run build` không có lỗi TypeScript liên quan `TopMenu`.
- KHÔNG xoá hay comment-out menu cũ khi chỉ được yêu cầu thêm menu mới (tham khảo cách `lo-trinh` bị ẩn
  bằng comment trong `TOP_MENUS` — đây là pattern chính thức để "ẩn nhưng giữ code" nếu user muốn tạm ẩn
  thay vì xoá).
