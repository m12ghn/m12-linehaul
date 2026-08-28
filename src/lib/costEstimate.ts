/* CHI PHÍ TĂNG CƯỜNG NCC — bảng giá tham khảo + đơn giá dùng để tính (2026-07-21).
   Nguồn bảng giá: Bang_Gia_Tong_Hop_NCC_M12.xlsx (Sếp cung cấp) — suy từ 7.235 chuyến
   THỰC TẾ tháng 6/2026 (khử trùng từ 4 file THCP_TẢI_LM12SC) + ảnh biểu giá 1.9T nội thành
   HCM (21/04/2026) + thông tin Sếp cho qua chat. Đơn giá CHƯA VAT (VAT 8% -> ×1,08 ra giá
   đã VAT). File TỰ NHẬN "CHƯA phải bảng giá chính thức — cần đối chiếu & chốt với NCC" nên
   PRICE_TABLE giữ nguyên các cảnh báo "ít mẫu"/"mâu thuẫn" của file gốc (reliability "thấp"),
   không tự ý làm mượt hay chọn hộ số khi file đã nói rõ chưa chắc. */
import { TON_ORDER, TON_LABEL, TON_SHORT, tonBucket, type TonKey, type FleetMix } from "./fleetMix";

export interface CostRates { t19: number; t50: number; t80near: number; t80far: number }
/** t80far = 2.500.000đ theo XÁC NHẬN của Sếp (2026-07-21) — dữ liệu 7.235 chuyến thực tế T6
 *  cho thấy mức PHỔ BIẾN hơn là 2.000.000đ (xem PRICE_TABLE dòng 8T 50–100km), Sếp đã xem
 *  cả 2 số và chọn GIỮ 2.500.000đ — không tự ý đổi theo data khi đã hỏi & có câu trả lời rõ. */
export const DEFAULT_COST_RATES: CostRates = { t19: 390738, t50: 592082, t80near: 1900000, t80far: 2500000 };

/** Đơn giá áp cho 1 xe theo tải trọng (dùng khi CHỈ biết tải trọng, không biết cự ly cụ thể —
 *  đúng tình huống của tcEvent.ts/xinTangCuong.ts, cả 2 đều không ghi cự ly từng chuyến).
 *  "van" chưa có giá riêng trong bảng gốc (xe nhỏ nhất khảo sát là 1.9T) -> tạm dùng giá 1.9T
 *  (gần nhất, không suy ra số mới). "t80" dùng mức <50km (near) vì tăng cường trong cụm M12
 *  chủ yếu là tuyến nội vùng ngắn, không phải liên tỉnh xa. */
export function tonRate(tk: TonKey, rates: CostRates): number {
  switch (tk) {
    case "van": return rates.t19;
    case "t19": return rates.t19;
    case "t50": return rates.t50;
    case "t80": return rates.t80near;
  }
}

export interface CostEstimateResult {
  min: number; minLabel: string;
  max: number; maxLabel: string;
  note: string;
  /** Phân bổ xe THIẾU theo tải trọng (chỉ có khi ước tính được tỷ lệ tham chiếu — xem estimateCost). */
  byTon?: { key: TonKey; label: string; n: number; rate: number; cost: number }[];
  mid?: number; // ước tính TRUNG TÂM (khi có byTon) — min/max chỉ còn là biên ±10%, không phải khoảng rẻ/đắt cực đoan.
  basis?: "ncc-booked" | "fixed-fleet";
}

/** Phân bổ 1 số lượng `total` theo tỷ lệ `source` (đếm theo tải trọng) — làm tròn kiểu "largest
 *  remainder" để tổng SAU LÀM TRÒN luôn đúng bằng `total` (không lệch do cộng dồn số lẻ). */
function apportion(total: number, source: Record<TonKey, number>): Record<TonKey, number> {
  const grand = TON_ORDER.reduce((a, k) => a + source[k], 0);
  const shares = TON_ORDER.map((k) => { const exact = (total * source[k]) / grand; return { key: k, floor: Math.floor(exact), rem: exact % 1 }; });
  const remaining = total - shares.reduce((a, s) => a + s.floor, 0);
  [...shares].sort((a, b) => b.rem - a.rem).slice(0, remaining).forEach((s) => { s.floor += 1; });
  return shares.reduce((a, s) => { a[s.key] = s.floor; return a; }, {} as Record<TonKey, number>);
}

/** Ước tính chi phí bù xe thiếu ngày đỉnh (plan.gap) — RÀ LẠI 2026-07-21 (v2, Sếp phản hồi khoảng
 *  "rẻ nhất...đắt nhất" cũ quá rộng, ~6 lần chênh lệch, không dùng được): thay vì giả định cực đoan
 *  "toàn bộ 1 loại xe rẻ nhất" vs "toàn bộ 1 loại xe đắt nhất", PHÂN BỔ xe thiếu theo ĐÚNG TỶ LỆ tải
 *  trọng đang thật sự vận hành cho kỳ này — ưu tiên tỷ lệ NCC ĐANG BOOK kỳ này (layTon+giaoTon, phản
 *  ánh đúng mix tăng cường THẬT của kỳ), fallback tỷ lệ đội xe CỐ ĐỊNH (fleet.inUse, Lịch Tải) khi kỳ
 *  CHƯA book NCC nào. Từ tỷ lệ đó ra 1 số TRUNG TÂM (mid) chính xác hơn nhiều, dao động ±10% (đơn giá
 *  còn phụ thuộc cự ly cụ thể từng chuyến trong CÙNG 1 mức tải — chưa biết trước khi book thật, không
 *  phải sai số do không biết LOẠI xe như trước). Không có fleet/tỷ lệ nào (kỳ chưa có dữ liệu đội xe)
 *  → fallback nguyên khoảng rẻ nhất/đắt nhất cũ (KHÔNG bịa tỷ lệ khi không có cơ sở). */
export function estimateCost(gap: number, rates: CostRates, fleet?: FleetMix | null): CostEstimateResult | null {
  if (gap <= 0) return null;
  if (fleet) {
    const booked = TON_ORDER.reduce((a, k) => { a[k] = fleet.layTon[k] + fleet.giaoTon[k]; return a; }, {} as Record<TonKey, number>);
    const bookedTotal = TON_ORDER.reduce((a, k) => a + booked[k], 0);
    const source = bookedTotal > 0 ? booked : fleet.inUse;
    const sourceTotal = TON_ORDER.reduce((a, k) => a + source[k], 0);
    if (sourceTotal > 0) {
      const basis: "ncc-booked" | "fixed-fleet" = bookedTotal > 0 ? "ncc-booked" : "fixed-fleet";
      const counts = apportion(gap, source);
      const byTon = TON_ORDER.map((k) => { const n = counts[k]; const rate = tonRate(k, rates); return { key: k, label: TON_SHORT[k], n, rate, cost: n * rate }; }).filter((r) => r.n > 0);
      const mid = byTon.reduce((a, r) => a + r.cost, 0);
      const basisTxt = basis === "ncc-booked" ? "tỷ lệ tải trọng ĐANG BOOK NCC kỳ này" : "tỷ lệ tải trọng đội xe cố định (Lịch Tải — kỳ này chưa book NCC)";
      const breakdownTxt = byTon.map((r) => `${r.n} xe ${r.label}`).join(", ");
      return {
        min: mid * 0.9, minLabel: "biên dưới (-10%)",
        max: mid * 1.1, maxLabel: "biên trên (+10%)",
        mid, byTon, basis,
        note: `Ước tính bù ${gap} xe thiếu NGÀY ĐỈNH theo ${basisTxt}: ${breakdownTxt}. Dao động ±10% vì đơn giá còn phụ thuộc cự ly cụ thể từng chuyến (chưa biết trước khi book thật).`,
      };
    }
  }
  // Fallback: KHÔNG có tỷ lệ tải trọng tham chiếu nào (chưa có dữ liệu đội xe/NCC cho kỳ này) —
  // giữ khoảng rẻ nhất/đắt nhất cũ, KHÔNG tự bịa 1 tỷ lệ khi không có cơ sở thật.
  return {
    min: gap * rates.t19, minLabel: `nếu bù toàn bộ bằng xe 1.9T (gói ≤15km)`,
    max: gap * rates.t80far, maxLabel: `nếu bù toàn bộ bằng xe 8T (50–100km)`,
    note: `Ước tính bù ${gap} xe thiếu NGÀY ĐỈNH × đơn giá tham khảo — CHƯA có tỷ lệ tải trọng tham chiếu (đội xe/NCC kỳ này chưa có dữ liệu) nên chỉ đưa khoảng rẻ nhất/đắt nhất, chỉ THAM KHẢO biên độ.`,
  };
}

/** Bảng giá NCC tham khảo — TOÀN BỘ dữ liệu từ file Excel, giữ nguyên cảnh báo độ tin cậy gốc.
 *  rate=null nghĩa là file gốc CHƯA gộp được 1 mức chung (giá theo từng tuyến cụ thể) — hiển
 *  thị rateLabel dạng khoảng, KHÔNG tự bịa 1 số duy nhất khi nguồn không cho phép. */
export interface PriceRow {
  vehicle: string; zone: string; method: string; distance: string;
  rate: number | null; rateLabel: string; note: string; reliability: "cao" | "thấp";
}
export const PRICE_TABLE: PriceRow[] = [
  { vehicle: "1.9T", zone: "Nội thành HCM", method: "Theo km (bậc thang)", distance: "1–15km", rate: 390738, rateLabel: "390.738đ/chuyến (trọn 15km đầu)", note: "Biểu giá 21/04/2026; khớp 73% chuyến T6. VD: 27km = 390.738 + 12×15.675 = 578.838", reliability: "cao" },
  { vehicle: "1.9T", zone: "Nội thành HCM", method: "Theo km (cộng thêm)", distance: "15–30km", rate: 15675, rateLabel: "15.675đ/km (cộng vào giá mở cửa)", note: "", reliability: "cao" },
  { vehicle: "1.9T", zone: "Nội thành HCM", method: "Theo km (cộng thêm)", distance: "≥30km", rate: 15177, rateLabel: "15.177đ/km", note: "", reliability: "cao" },
  { vehicle: "1.9T", zone: "Nội thành HCM", method: "Theo km (chiều về)", distance: "chuyến 2 chiều", rate: 10982, rateLabel: "10.982đ/km chiều về", note: "", reliability: "cao" },
  { vehicle: "1.9T", zone: "Nội thành/lân cận", method: "Đồng giá/chuyến", distance: "15–100km", rate: 921613, rateLabel: "921.613đ/chuyến", note: "Mức trọn gói phổ biến cao nhất; tuyến ngắn <15km ~473.664đ", reliability: "cao" },
  { vehicle: "5T", zone: "Nội thành HCM", method: "Đồng giá/chuyến", distance: "<15km", rate: 592082, rateLabel: "592.082đ/chuyến", note: "Mức phổ biến nhất", reliability: "cao" },
  { vehicle: "5T", zone: "Nội thành HCM", method: "Đồng giá/chuyến", distance: "15–30km", rate: 778128, rateLabel: "778.128đ/chuyến", note: "", reliability: "cao" },
  { vehicle: "5T", zone: "Nội thành HCM", method: "Đồng giá/chuyến", distance: "30–50km", rate: 922678, rateLabel: "922.678đ/chuyến", note: "", reliability: "cao" },
  { vehicle: "5T", zone: "Liên tỉnh (xa)", method: "Theo km", distance: ">200km", rate: 7106, rateLabel: "7.106đ/km", note: "⚠ Ít mẫu (~39 chuyến) — cần xác nhận", reliability: "thấp" },
  { vehicle: "6.5T", zone: "Liên tỉnh (xa)", method: "Theo km", distance: "~200km", rate: 20589, rateLabel: "20.589đ/km", note: "⚠ Rất ít mẫu (31 chuyến)", reliability: "thấp" },
  { vehicle: "8T", zone: "Nội vùng", method: "Đồng giá/chuyến", distance: "<50km", rate: 1900000, rateLabel: "1.900.000đ/chuyến", note: "Data thực tế 1,89–2,00tr — tạm lấy 1,9tr", reliability: "cao" },
  { vehicle: "8T", zone: "Nội vùng", method: "Đồng giá/chuyến", distance: "50–100km", rate: 2500000, rateLabel: "2.500.000đ/chuyến", note: "⚠ Data thực tế phổ biến 2.000.000đ — Sếp đã xem cả 2 số và XÁC NHẬN GIỮ 2.500.000đ (2026-07-21)", reliability: "thấp" },
  { vehicle: "8T", zone: "Liên vùng", method: "Đồng giá/chuyến", distance: "100–200km", rate: 3800000, rateLabel: "3.800.000đ/chuyến", note: "", reliability: "cao" },
  { vehicle: "8T", zone: "Liên tỉnh xa", method: "Đồng giá/chuyến", distance: ">200km", rate: null, rateLabel: "15–17,5 triệu/chuyến (theo từng tuyến)", note: "Chưa gộp thành 1 mức chung", reliability: "thấp" },
  { vehicle: "8T", zone: "Liên tỉnh", method: "Theo km", distance: "~115km", rate: 21225, rateLabel: "21.225đ/km", note: "⚠ Ít mẫu (28 chuyến)", reliability: "thấp" },
  { vehicle: "≥55m³", zone: "Nội vùng", method: "Đồng giá/chuyến", distance: "<50km", rate: 1894662, rateLabel: "1.894.662đ/chuyến", note: "Bằng mức 8T tuyến ngắn", reliability: "cao" },
  { vehicle: "≥55m³", zone: "Nội vùng", method: "Đồng giá/chuyến", distance: "50–100km", rate: 2500000, rateLabel: "2.500.000đ/chuyến", note: "Trùng đúng mức Sếp từng nói cho \"8T 50–100km\" — có thể trước đây đang nhớ nhầm 2 loại xe", reliability: "cao" },
  { vehicle: "≥55m³", zone: "Liên vùng", method: "Đồng giá/chuyến", distance: "100–200km", rate: 4293559, rateLabel: "4.293.559đ/chuyến", note: "", reliability: "cao" },
  { vehicle: "≥55m³", zone: "Liên tỉnh xa", method: "Đồng giá/chuyến", distance: ">200km", rate: null, rateLabel: "4,5–7 triệu/chuyến (theo từng tuyến)", note: "", reliability: "thấp" },
  { vehicle: "≥55m³", zone: "Liên tỉnh", method: "Theo km", distance: "~440km", rate: 13455, rateLabel: "13.455đ/km", note: "⚠ Ít mẫu (31 chuyến)", reliability: "thấp" },
];
export const PRICE_SOURCE_NOTE = "Suy từ 7.235 chuyến thực tế T6/2026 + biểu giá 1.9T nội thành HCM (21/04/2026) + thông tin Sếp cung cấp. Giá CHƯA VAT (VAT 8% → nhân ×1,08 ra giá đã VAT). Đây CHƯA phải bảng giá chính thức — cần đối chiếu & chốt với NCC trước khi dùng làm báo giá thật. Tăng cường & GHN (xe nhà) áp CÙNG biểu giá theo vùng nếu kích hoạt.";
export const PRICE_OPEN_ISSUES = [
  "Xe 8T tuyến >200km (liên tỉnh xa): giá đi theo từng tuyến cụ thể, chưa gộp được thành 1 mức chung.",
  "Vài dòng \"ít mẫu\"/\"rất ít mẫu\" (5T/6.5T/8T/≥55m³ liên tỉnh) độ tin cậy thấp — ưu tiên đối chiếu với NCC trước khi dùng.",
];

/* ============================================================
   SO SÁNH TỔNG XE + CHI PHÍ TĂNG CƯỜNG (cố định + phát sinh) GIỮA 2 KỲ.
   fixedRoutes: các dòng "Lưu trữ TC EVENT" đúng kỳ (đã lọc bỏ GHN — GHN xe nhà không tính
   chi phí thuê ngoài). adhocCount: số lượt "BC xin tăng cường" phát sinh trong kỳ (KHÔNG có
   field tải trọng riêng -> áp giá BÌNH QUÂN/xe của phần CỐ ĐỊNH cùng kỳ, vì đây là cùng 1 khu
   vực/kiểu tăng cường, gần đúng hơn là đoán 1 loại xe cố định cho toàn bộ phát sinh). Khi kỳ
   CHƯA có xe cố định nào (fixedRoutes rỗng) -> dùng tạm giá 1.9T (loại phổ biến nhất cho xe
   LẤY hàng tại BC, thường tuyến ngắn nội thành) làm giá bình quân, có ghi rõ giả định. */
export interface SurgeCostBreakdown {
  byTon: { key: TonKey; label: string; n: number; rate: number; cost: number }[];
  unknownN: number; unknownCost: number;
  fixedTotal: number; fixedCost: number;
  adhocTotal: number; adhocCost: number; adhocRate: number;
  totalVeh: number; totalCost: number;
}
/** Lõi tính chi phí từ SỐ ĐẾM theo từng mức tải (dùng chung cho cả nguồn "route đã lưu trữ" lẫn
 *  nguồn "đếm sẵn từ fleet live" — xem `surgeCostOf`/`surgeCostFromCounts`). */
export function surgeCostFromCounts(counts: Record<TonKey, number>, unknownN: number, adhocCount: number, rates: CostRates): SurgeCostBreakdown {
  const byTon = TON_ORDER.map((key) => {
    const n = counts[key] || 0;
    const rate = tonRate(key, rates);
    return { key, label: TON_LABEL[key], n, rate, cost: n * rate };
  });
  const fixedTotal = byTon.reduce((a, b) => a + b.n, 0) + unknownN;
  const unknownCost = unknownN * rates.t19; // chưa rõ tải -> tạm tính giá 1.9T (rẻ nhất, tránh thổi phồng chi phí)
  const fixedCost = byTon.reduce((a, b) => a + b.cost, 0) + unknownCost;
  const adhocRate = fixedTotal > 0 ? fixedCost / fixedTotal : rates.t19;
  const adhocCost = adhocCount * adhocRate;
  return {
    byTon, unknownN, unknownCost, fixedTotal, fixedCost,
    adhocTotal: adhocCount, adhocCost, adhocRate,
    totalVeh: fixedTotal + adhocCount, totalCost: fixedCost + adhocCost,
  };
}
export function surgeCostOf(fixedRoutes: { tai: string }[], adhocCount: number, rates: CostRates): SurgeCostBreakdown {
  const counts: Record<TonKey, number> = { van: 0, t19: 0, t50: 0, t80: 0 };
  let unknownN = 0;
  for (const r of fixedRoutes) { const k = tonBucket(r.tai); if (k) counts[k]++; else unknownN++; }
  return surgeCostFromCounts(counts, unknownN, adhocCount, rates);
}
