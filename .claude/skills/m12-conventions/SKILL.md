---
name: m12-conventions
description: Quy tắc bắt buộc của dự án m12-lich-tai (dashboard Lịch Tải GHN Cụm M12) — cấu hình tập trung ở src/config.ts, không bịa số liệu trong AI assistant/planEngine, đồng bộ normalize.ts với build-geo.mjs, quy ước đặt tên. LUÔN đọc skill này TRƯỚC KHI sửa bất kỳ file nào trong m12-lich-tai, dù task nhỏ đến đâu.
---

# Quy tắc dự án m12-lich-tai

Dự án: Dashboard nội bộ GHN Cụm M12 ("Lịch Tải Miền Nam") — React 18 + TypeScript (strict) + Vite,
backend là Cloudflare Pages Functions + KV, dữ liệu đọc realtime từ Google Sheets/MyMap.
Không có `CLAUDE.md`/`ROADMAP.md` riêng trong repo — các quy tắc dưới đây rút từ `README.md` và
comment trong code, coi như luật ngầm bắt buộc tuân theo.

## 1. Cấu hình tập trung — KHÔNG hardcode rải rác

- Mọi ID sheet, gid tab, tần suất đồng bộ, tâm bản đồ, danh sách menu đều khai báo ở
  [src/config.ts](../../../src/config.ts). Không hardcode Sheet ID/gid ngay trong component hay view.
- Khi cần thêm nguồn dữ liệu mới → xem skill `m12-add-sheet-source`.

## 2. Không bịa số liệu (nguyên tắc cứng của domain)

- `src/lib/planEngine.ts`: mọi phép tính kế hoạch xe/tải phải **deterministic** — code tính, AI chỉ diễn giải.
  Comment gốc: *"BỘ MÁY TÍNH KẾ HOẠCH TẢI EVENT (deterministic — KHÔNG bịa)"*.
- `functions/api/assistant.ts`: system prompt yêu cầu *"TUYỆT ĐỐI không đổi số"* — trợ lý AI không được
  tự suy diễn số liệu, chỉ dùng số thật từ Sheet/KV.
- Khi sửa logic liên quan đến số liệu (TLLD, Plan Event, sản lượng), **không** thêm ước lượng/giả định
  ngầm — nếu thiếu dữ liệu thì trả về `null`/thông báo thiếu, không suy đoán.

## 3. Đồng bộ hai file chuẩn hoá tên

`src/lib/normalize.ts` (dùng trong app) và `scripts/build-geo.mjs` (chạy Node độc lập, build lúc `npm run build:geo`)
**nhân bản cùng logic** `stripAccents()` + `normalizeName()`. Sửa 1 bên **bắt buộc** sửa bên kia, nếu không
tên kho giữa Sheet và MyMap sẽ lệch khớp. Xem chi tiết ở skill `m12-fix-geo-alias`.

## 4. Naming & style

- camelCase cho biến/hàm, PascalCase cho component/type, SCREAMING_SNAKE_CASE cho hằng số cấu hình
  (`SHEET_ID`, `REFRESH_MS`, `CATEGORY_ORDER`...).
- Toàn bộ comment và UI string viết bằng **tiếng Việt** — giữ nguyên phong cách này khi thêm code mới,
  không chuyển sang tiếng Anh.
- Domain vocab cố định: `kho` (kho/bưu cục), `tuyến` (route), `tải` (load/weight), `TLLD` (tỷ lệ lấp đầy),
  `tăng cường` (surge), `NCC` (nhà cung cấp vận tải/vendor), `BKS` (biển số xe).
- TypeScript strict mode bật (`tsconfig.json`) — không dùng `any` tuỳ tiện, ưu tiên type rõ ràng.

## 5. React patterns đã dùng trong repo — bám theo, không tự chế pattern mới

- Chỉ dùng function component + hooks, không class component.
- Logic tách vào custom hook trong `src/lib/` (ví dụ `useSchedule`, `useTlld`, `useFleet`, `useAdmin`, `useUser`).
- View mới luôn `React.lazy()` trong `App.tsx` (trừ `Overview` load ngay) để giữ bundle đầu nhỏ.
- Không dùng React Context — state được lift lên `App.tsx` và truyền qua props (app nhỏ, cố tình đơn giản
  hoá, đừng thêm Context/Redux/Zustand khi chưa được yêu cầu).
- Không có test suite trong repo — đây là điều đã biết, không cần báo lỗi "thiếu test" khi review, nhưng
  nếu thêm logic tính toán quan trọng (kiểu `planEngine.ts`) nên cân nhắc hỏi user trước khi bổ sung test
  vì đây là thay đổi ngoài phạm vi thường làm của dự án.

## 6. Bảo mật đã áp dụng — không được lùi bước

- `ADMIN_TOKEN` là Cloudflare secret (`npx wrangler pages secret put ADMIN_TOKEN`), **không** để trong
  `wrangler.toml [vars]` (plaintext, commit cùng source = lộ). Xem `wrangler.toml` dòng comment liên quan.
- Admin API check qua `functions/api/_admin.ts` → `isAdminReq()` so `x-admin-token` header với `env.ADMIN_TOKEN`.
- User gate qua email domain `@ghn.vn`/`@ghn.com`/`@ghn.com.vn` (`isGhnEmail()`), **không** phải cơ chế admin.
- Không commit thêm token/secret nào vào `wrangler.toml`, `.env`, hay source — luôn dùng `wrangler pages secret put`.

## 7. Trước khi sửa file — đọc skill liên quan

| Việc cần làm | Skill tương ứng |
|---|---|
| Thêm vùng/tab Google Sheet, thêm loại tuyến | `m12-add-sheet-source` |
| Tạo API endpoint mới (Cloudflare Function) | `m12-create-api-endpoint` |
| Bản đồ thiếu điểm / sai toạ độ kho | `m12-fix-geo-alias` |
| Build & deploy lên Cloudflare Pages | `m12-deploy-cloudflare` |
| Thêm trang/view mới vào dashboard | `m12-add-dashboard-view` |
| Thêm biểu đồ/widget trong 1 view có sẵn | `m12-add-widget-chart` |
| Sửa/mở rộng tính năng Plan Event (dự báo cao điểm) | `m12-plan-event-forecast` |
| Dữ liệu Sheet hiển thị cũ/không cập nhật | `m12-debug-sheet-sync` |
| Đổi model LLM, sửa system prompt, cập nhật kho kiến thức trợ lý | `m12-ai-assistant-ops` |
| Thêm tính năng chỉ admin mới thấy/dùng được | `m12-admin-feature` |
