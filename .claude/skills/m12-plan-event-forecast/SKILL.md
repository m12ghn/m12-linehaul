---
name: m12-plan-event-forecast
description: Sửa/mở rộng tính năng "Plan Event" của m12-lich-tai — dự báo tải cao điểm, tính số xe cần, surge buffer, Plan A/B/C. Kích hoạt khi user nói "Plan Event", "dự báo cao điểm", "tính xe tăng cường", "sửa công thức kế hoạch tải", hoặc bug liên quan đến planEngine/planner.
---

# Quy trình Plan Event (dự báo tải cao điểm)

Đọc [m12-conventions](../m12-conventions/SKILL.md) mục 2 (không bịa số liệu) — bắt buộc với skill này vì
đây là nơi nguyên tắc đó áp dụng nghiêm ngặt nhất trong toàn dự án.

## Data flow (đọc theo đúng thứ tự khi debug)

```
Google Sheet "FC HCM20" + "FC ST" (Forecast Volume theo ngày/kho)
    ↓ src/lib/fc.ts          — load & parse forecast (vol + weight theo ngày, baseW = baseline ngày thường)
Google Sheet fleet (VEHICLE_SHEET_ID, GXT_SHEET_ID)
    ↓ src/lib/fleet.ts, fleetMix.ts   — BASE_FLEET_TOTAL, BASE_FLEET_IDLE, totalNcc, ghnTC
    ↓
src/lib/planEngine.ts → computePlan(fc, fleet, params)   [THUẦN TÍNH TOÁN, KHÔNG gọi AI]
    ↓
src/lib/planner.ts → surge buffer, plan digest (chuyển PlanResult thành text cho AI diễn giải)
    ↓
src/views/PlanEvent.tsx + src/components/PlanBoard.tsx, SurgePlan.tsx, TrunkPlan.tsx
```

## Công thức cốt lõi (trong `planEngine.ts` — đọc kỹ trước khi sửa số nào)

- `effectiveCap` (năng lực thực/xe/ngày) = `baselineKg / activeNormal` — **tự hiệu chỉnh từ dữ liệu ngày
  thường thực tế**, không phải số cấu hình cứng. Chỉ dùng `FALLBACK_CAP = 7000` khi chưa có baseline
  (`calibrated = false`) — nếu sửa logic, PHẢI giữ nguyên tắc "ưu tiên số thực, fallback chỉ khi thiếu dữ liệu".
- `vehNeeded` (xe cần ngày d) = `ceil(kg FC ngày d × safety ÷ effectiveCap)`.
- `peakExtra` (xe tăng cường cần) = `peakNeeded − activeNormal`.
- `SURGE_BUFFER = 0.15` — tỷ lệ dự trù phát sinh chuẩn ngành (~12-15% cao điểm), đây là **hằng số nghiệp
  vụ đã chốt với Sếp**, không tự ý đổi khi không được yêu cầu rõ.
- Chiến lược fleet: **BOOK NCC CỐ ĐỊNH** cho phần tăng cường (`bookFixed = peakExtra`), **GIỮ xe GHN làm
  dự phòng phát sinh** (`reserveGhn`) — đây là quyết định vận hành đã chốt (đọc comment đầu file
  `planEngine.ts` để hiểu lý do: hiện không còn xe nằm bãi nên không thể ưu tiên xe nhà trước).

## Khi sửa/mở rộng tính năng này

1. **Mọi phép tính số phải nằm trong `planEngine.ts`** (pure function, input → output xác định, test được
   bằng tay). KHÔNG đưa phép tính số liệu vào `assistant.ts` hay prompt AI — trợ lý AI (`SapLichTai` view,
   `EVENTPLAN` prompt) chỉ được **diễn giải** kết quả `PlanResult` đã tính sẵn qua `planDigest()`, không
   được tự tính lại hay ước lượng số khác.
2. Nếu thêm tham số mới vào `PlanParams` (như `safety`) — cập nhật cả `DEFAULT_PARAMS` và UI nhập liệu
   tương ứng trong `PlanBoard.tsx`/`PlanEvent.tsx`, không để tham số "treo" không có chỗ chỉnh.
3. Nếu forecast thiếu dữ liệu 1 kho (`fc.hcm` hoặc `fc.st` là `null`) — `computePlan()` phải xử lý graceful
   (không throw, không coi thiếu = 0), giữ đúng pattern hiện có (`hcmBase = fc.hcm?.baseW || 0`).
4. Test bằng tay: so `vehNeeded`/`peakExtra` tính ra với phép tính thủ công trên vài ngày mẫu từ Sheet, vì
   dự án không có unit test — đây là bước thay thế test tự động, không được bỏ qua khi sửa công thức.

## UI liên quan

- `PlanBoard.tsx` — chọn kỳ cao điểm, hiển thị `PlanResult` tổng quan.
- `SurgePlan.tsx` — chi tiết phương án tăng cường (Plan A/B/C).
- `TrunkPlan.tsx` — kế hoạch trục chính (tuyến liên vùng).
- Nếu thêm hiển thị mới, dùng lại `<Gauge>`/`<Donut>` có sẵn (xem skill `m12-add-widget-chart`) thay vì
  tạo chart mới.
