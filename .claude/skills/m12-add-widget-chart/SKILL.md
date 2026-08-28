---
name: m12-add-widget-chart
description: Thêm 1 widget/biểu đồ/thẻ KPI mới vào 1 view có sẵn của m12-lich-tai (không phải thêm cả trang mới). Kích hoạt khi user nói "thêm biểu đồ", "thêm gauge/donut/chart", "thêm KPI card", "vẽ thêm thống kê X vào Tổng Quan/Sản Lượng".
---

# Thêm widget / biểu đồ vào view có sẵn

Đọc [m12-conventions](../m12-conventions/SKILL.md) trước. Nếu cần cả 1 trang mới (không phải thêm vào trang
đang có), dùng skill `m12-add-dashboard-view` thay vì skill này.

## Component chart đã có sẵn — tái dùng trước khi viết mới

| Component | File | Dùng khi |
|---|---|---|
| `<Gauge>` | [src/components/Gauge.tsx](../../../src/components/Gauge.tsx) | Tỷ lệ lấp đầy/hoàn thành dạng cung nửa vòng tròn, có số giữa |
| `<Donut>` | `src/components/Donut.tsx` | Tỷ trọng cấu thành (fleet mix, phân bổ loại xe...) |
| `<TrendChart>` | `src/components/TrendChart.tsx` | Xu hướng theo thời gian (line chart) |
| `<FleetCharts>` | `src/components/FleetCharts.tsx` | Bar/donut ghép sẵn cho dữ liệu đội xe |

Tất cả đều là **SVG inline viết tay** (không dùng thư viện chart ngoài như recharts/chart.js) — nếu cần
biểu đồ dạng mới, viết theo pattern SVG này (xem cấu trúc `Gauge.tsx`: hàm `pt()`/`arc()` tính toạ độ path,
props nhận `pct`/`color`/`label`, style qua CSS variable), KHÔNG thêm dependency chart mới vào `package.json`
trừ khi user đồng ý — dự án cố tình giữ bundle nhẹ (không có framework UI, tự vẽ SVG).

## Quy trình thêm widget

1. Xác định dữ liệu nguồn — đã có sẵn qua hook nào chưa (`useSchedule`, `useTlld`, `useFleet`...) hay cần
   tính toán mới từ dữ liệu đã load trong view cha.
2. Nếu là biểu đồ dùng lại được ở nhiều nơi → tạo component riêng trong `src/components/TenWidget.tsx`.
   Nếu chỉ dùng 1 chỗ duy nhất và đơn giản → có thể viết inline trong view, không bắt buộc tách file.
3. Style bằng CSS variable đã định nghĩa (`--primary`, `--orange`, `--green`, `--ink`, v.v.) — không tự
   chế mã màu hex rời rạc, giữ đồng nhất theo bảng màu hiện có của dashboard.
4. Bọc trong `<Reveal>` (component collapsible có sẵn ở `src/components/Reveal.tsx`) nếu widget chiếm
   nhiều diện tích và không phải nội dung ưu tiên xem ngay.
5. Nếu widget cần lazy-render khi cuộn tới (danh sách dài, nhiều card) → dùng `useInView.ts` (đã có,
   dựa trên IntersectionObserver) thay vì render tất cả cùng lúc.

## Data integrity — áp dụng quy tắc "không bịa số"

Nếu widget hiển thị số liệu tính toán (%, tỷ lệ, dự báo) — không nội suy/làm tròn che giấu khi thiếu dữ
liệu. Nếu nguồn trả `null`/thiếu, hiển thị trạng thái "chưa có dữ liệu" thay vì số 0 hoặc số đoán, theo
đúng triết lý `planEngine.ts` (xem skill `m12-plan-event-forecast`).

## Kiểm tra sau khi thêm

- `npm run dev`, xác nhận widget hiển thị đúng số liệu thật (so với Google Sheet gốc nếu có thể).
- Test responsive cơ bản (thu nhỏ cửa sổ trình duyệt) — dashboard không có framework CSS, layout dựa vào
  flex/grid viết tay, dễ vỡ nếu không kiểm tra.
- Không phá layout của widget khác trong cùng view khi thêm mới.
