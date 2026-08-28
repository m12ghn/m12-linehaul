# CỤM 12 · LỊCH TẢI MIỀN NAM

Dashboard nội bộ GHN (M12SC) hiển thị **lịch tải Miền Nam** theo thời gian thực, đọc trực tiếp từ Google Sheet và tự vẽ lộ trình từng tuyến trên bản đồ.

- ⚛️ React + TypeScript + Vite (SPA tĩnh, deploy mọi nơi)
- 🔄 Tự đồng bộ mỗi 60 giây + nút **Làm mới** thủ công
- 🗺️ Bản đồ Leaflet (OpenStreetMap) — tự vẽ lộ trình theo toạ độ trích từ Google MyMap, kèm chế độ xem **MyMap** gốc
- 📋 Menu 3 cấp: **Mục đích** (Lịch Tải / Lộ trình / TLLD Tuyến) → **Vùng** (6 tab) → **Loại tuyến**

---

## 1. Cấu trúc dữ liệu

- **Google Sheet** (`SHEET_ID` trong `src/config.ts`) — 6 tab = 6 vùng. Cột chính: `Tên tuyến · Tải trọng · Tên kho · Loại hình · Tới điểm · Rời điểm · Loại tuyến`. Các tab có bố cục cột hơi khác nhau — app tự dò cột theo tiêu đề.
- **Google MyMap** (`MAP_MID`) — chứa toạ độ các Bưu Cục. Script `build:geo` tải KML và trích toạ độ ra `src/data/geo.json`.
- ⚠️ Sheet phải để **Chia sẻ → "Bất kỳ ai có liên kết" → Người xem**.

---

## 2. Chạy ở máy (development)

```bash
npm install
npm run build:geo     # sinh src/data/geo.json từ MyMap (chạy lại khi MyMap đổi)
npm run dev           # mở http://localhost:5173
```

## 3. Build production

```bash
npm run build         # tạo thư mục dist/ (prebuild tự chạy build:geo)
npm run preview       # xem thử bản build
```

---

## 4. Deploy

### A. Vercel (khuyến nghị — nhanh nhất)
```bash
npm i -g vercel
vercel                # lần đầu: làm theo hướng dẫn; có sẵn HTTPS + domain
vercel --prod
```
`vercel.json` đã cấu hình SPA rewrite + serverless proxy `api/sheet.ts` (dự phòng CORS).

### B. Netlify
Kéo-thả thư mục `dist/` vào Netlify, hoặc:
```bash
npm i -g netlify-cli && netlify deploy --prod --dir=dist
```

### C. VPS / Nginx
```bash
npm run build
# copy dist/ lên server, trỏ Nginx vào đó (xem nginx.conf mẫu)
```

### D. Docker
```bash
docker build -t m12-lich-tai .
docker run -p 8080:80 m12-lich-tai     # mở http://localhost:8080
```

---

## 5. Bảo trì

- **Khớp toạ độ bản đồ:** tên Bưu Cục giữa Sheet và MyMap được khớp bằng chuẩn hoá + fuzzy (~85% tab Nội Thành HCM). Điểm chưa khớp hiện ở dải trạng thái ("N điểm chưa có toạ độ"). Bổ sung thủ công vào `ALIASES` trong `src/lib/geo.ts` (`"tên trong Sheet": "tên trong MyMap"`).
- **Đổi tần suất đồng bộ / sheet / bản đồ:** sửa `src/config.ts`.
- **MyMap thay đổi điểm:** chạy lại `npm run build:geo`.

---

## 6. Cấu trúc thư mục

```
src/
  config.ts          # SHEET_ID, 6 tab, menu, tần suất, MyMap
  lib/               # csv, normalize, sheet (đọc+gom), geo (khớp toạ độ), useSchedule (polling)
  components/        # Header, NavBar, SheetTabs, CategoryTabs, RouteList/Card, MapPanel, StatusBar
  views/             # LichTai, LoTrinh, TlldTuyen
  data/geo.json      # toạ độ Bưu Cục (sinh bởi build:geo)
scripts/build-geo.mjs
api/sheet.ts         # proxy dự phòng (Vercel)
```
