/* ============================================================
   ĐỘ CO GIÃN XE/HÀNG ĐO TỪ LỊCH SỬ THẬT (Phương án 3 — Sếp chọn 2026-07-21 sau khi backtest 3
   phương án trên dữ liệu thật của 3 kỳ event đã lưu trữ: 6/6, 7/7, 15/7).

   BỐI CẢNH: công thức cũ (`vehNeeded = ceil(kg × safety ÷ effectiveCap)`, xem planEngine.ts) giả
   định xe co giãn TUYẾN TÍNH QUA GỐC TOẠ ĐỘ với hàng (0 hàng = 0 xe) — SAI, vì backtest cho thấy
   công thức cũ lệch +37%/+47% (dư quá nhiều) ở 2/3 kỳ đã qua. Thực tế đo được: có ~500-540 xe LUÔN
   cần chạy bất kể hàng ít hay nhiều (đội nền cố định), và phần co giãn theo hàng THÊM chỉ khoảng
   19-45%/100% hàng tăng (KHÁC XA giả định ngụ ý của công thức cũ) — vì xe được CHẤT ĐẦY HƠN lúc cao
   điểm (tăng tỷ lệ lấp đầy), không phải tăng SỐ CHUYẾN tương ứng với hàng.

   Công thức MỚI (planEngine.ts áp dụng khi có elasticity đo được):
     xe cần (cửa sổ cao điểm) = ceil(đội nền × (1 + elasticity × %hàng vượt baseline × hệ số an toàn))

   Elasticity ở đây KHÔNG hardcode — tự đo lại mỗi lần từ MỌI kỳ event đã lưu trữ trong Sheet (càng
   nhiều kỳ tích luỹ, càng chuẩn) — đúng nguyên tắc "code tính, không bịa" của dự án.
   ============================================================ */
import { toIsoDMY, type TcEvRoute } from "./tcEvent";

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoDaysBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let d = fromIso;
  while (d <= toIso) { out.push(d); d = addDays(d, 1); }
  return out;
}
const isGhn = (ncc: string) => /ghn/i.test(ncc || "");

/** Mọi ngày (ISO) có xe TĂNG CƯỜNG THẬT (non-GHN) đang hoạt động, gộp từ TẤT CẢ kỳ event đã lưu trữ
 *  — dùng để LOẠI các ngày này khi tìm baseline "ngày thường" cho MỘT kỳ khác, tránh baseline bị
 *  nhiễm dư âm của kỳ event liền trước (bug thật đã phát hiện: baseline 7 ngày trước kỳ 15/7 vô
 *  tình dính vài ngày đuôi còn tăng cường của kỳ 7/7 ngay trước đó, làm baseline bị đẩy cao giả tạo). */
export function buildPeakDaySet(allRoutes: TcEvRoute[]): Set<string> {
  const byEvent = new Map<string, TcEvRoute[]>();
  for (const r of allRoutes) {
    if (!r.event || isGhn(r.ncc)) continue;
    const k = r.event;
    const a = byEvent.get(k);
    if (a) a.push(r); else byEvent.set(k, [r]);
  }
  const days = new Set<string>();
  for (const routes of byEvent.values()) {
    const withRange = routes.map((r) => ({ f: toIsoDMY(r.from), t: toIsoDMY(r.to) || toIsoDMY(r.from) })).filter((x) => x.f);
    if (!withRange.length) continue;
    const minF = withRange.map((x) => x.f).sort()[0];
    const maxT = withRange.map((x) => x.t).sort().slice(-1)[0];
    for (const iso of isoDaysBetween(minF, maxT)) {
      if (withRange.some((x) => x.f <= iso && iso <= x.t)) days.add(iso);
    }
  }
  return days;
}

/** Tìm TB kg của N ngày "SẠCH" gần nhất TRƯỚC 1 ngày mốc — bỏ qua mọi ngày nằm trong `peakDays`
 *  (đang tăng cường ở kỳ event BẤT KỲ) và ngày không có số liệu thật. Trả `null` nếu không đủ
 *  ngày sạch trong `maxLookback` ngày tra ngược (không suy đoán khi thiếu dữ liệu). */
export function cleanBaselineKg(
  beforeIso: string,
  peakDays: Set<string>,
  kgOf: (iso: string) => number | null,
  windowDays = 7,
  maxLookback = 45
): { avgKg: number; days: string[] } | null {
  const used: string[] = [];
  let cursor = addDays(beforeIso, -1);
  let scanned = 0;
  while (used.length < windowDays && scanned < maxLookback) {
    if (!peakDays.has(cursor)) {
      const kg = kgOf(cursor);
      if (kg != null && kg > 0) used.push(cursor);
    }
    cursor = addDays(cursor, -1);
    scanned++;
  }
  if (used.length < windowDays) return null;
  const avgKg = used.reduce((a, iso) => a + (kgOf(iso) || 0), 0) / used.length;
  return { avgKg, days: used };
}

export interface ElasticitySample {
  event: string;
  baselineKg: number;
  windowKg: number;
  actualVeh: number;
  volSurgePct: number;
  vehSurgePct: number;
  elasticity: number;
}
export interface ElasticityResult { elasticity: number | null; samples: ElasticitySample[] }

/**
 * Đo elasticity (%Δxe / %Δhàng) từ MỌI kỳ event đã lưu trữ có đủ dữ liệu (baseline sạch + ngày cao
 * điểm THẬT + xe tăng cường đã book). `activeNormal` dùng chung 1 số (đội nền HIỆN TẠI) cho mọi kỳ
 * quá khứ — giới hạn đã biết (không có lịch sử đội nền cố định theo ngày, chỉ có snapshot hiện tại),
 * áp dụng ĐỀU cho mọi kỳ nên không thiên vị kỳ nào.
 */
export function computeHistoricalElasticity(
  allRoutes: TcEvRoute[],
  activeNormal: number,
  kgOf: (iso: string) => number | null
): ElasticityResult {
  const peakDays = buildPeakDaySet(allRoutes);
  const byEvent = new Map<string, TcEvRoute[]>();
  for (const r of allRoutes) {
    if (!r.event || isGhn(r.ncc)) continue;
    const a = byEvent.get(r.event); if (a) a.push(r); else byEvent.set(r.event, [r]);
  }
  const samples: ElasticitySample[] = [];
  for (const [event, routes] of byEvent) {
    const withRange = routes.map((r) => ({ f: toIsoDMY(r.from), t: toIsoDMY(r.to) || toIsoDMY(r.from) })).filter((x) => x.f);
    if (!withRange.length) continue;
    const minF = withRange.map((x) => x.f).sort()[0];
    const maxT = withRange.map((x) => x.t).sort().slice(-1)[0];
    const dayCounts = isoDaysBetween(minF, maxT).map((iso) => ({
      iso, n: withRange.filter((x) => x.f <= iso && iso <= x.t).length,
    }));
    const activeDays = dayCounts.filter((d) => d.n > 0);
    if (!activeDays.length) continue;
    const base = cleanBaselineKg(minF, peakDays, kgOf, 7);
    if (!base) continue; // không đủ baseline sạch -> bỏ qua kỳ này, không suy đoán
    const kgs = activeDays.map((d) => kgOf(d.iso)).filter((v): v is number => v != null);
    if (!kgs.length) continue;
    const windowKg = kgs.reduce((a, b) => a + b, 0) / kgs.length;
    const actualVeh = activeNormal + Math.max(...activeDays.map((d) => d.n));
    const volSurgePct = windowKg / base.avgKg - 1;
    if (volSurgePct <= 0) continue; // kỳ này hàng không tăng so baseline -> không dùng để đo co giãn
    const vehSurgePct = actualVeh / activeNormal - 1;
    samples.push({ event, baselineKg: base.avgKg, windowKg, actualVeh, volSurgePct, vehSurgePct, elasticity: vehSurgePct / volSurgePct });
  }
  if (!samples.length) return { elasticity: null, samples };
  const elasticity = samples.reduce((a, s) => a + s.elasticity, 0) / samples.length;
  return { elasticity, samples };
}
