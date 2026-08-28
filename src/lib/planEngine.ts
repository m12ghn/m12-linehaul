/* ============================================================
   BỘ MÁY TÍNH KẾ HOẠCH TẢI EVENT (deterministic — KHÔNG bịa).
   Triết lý: phép tính nặng để CODE lo (chính xác), trợ lý AI chỉ lo
   nhận định & tư vấn trên số đã tính.

   Cách tính số xe (theo KG — chuẩn nhất):
   - Năng lực THỰC mỗi xe/ngày tự HIỆU CHỈNH từ ngày thường:
       capThực = (kg ngày thường toàn cụm) ÷ (số xe chạy ngày thường)
     → đã phản ánh đúng số chuyến/ngày & tỷ lệ lấp đầy thực tế, không cần đoán.
   - Xe cần ngày d = ceil(kg FC ngày d × hệ số an toàn ÷ capThực).
   - Xe tăng cường = xe cần đỉnh − đội nền đang chạy.
   - Hiện KHÔNG còn xe nằm bãi (đội nền chạy hết) → dư địa = xe đã book NCC.
     Chiến lược: BOOK NCC CỐ ĐỊNH theo cot cho phần tăng cường, GIỮ xe nhà GHN
     làm DỰ PHÒNG PHÁT SINH (đơn vượt kế hoạch).
   ============================================================ */
import { BASE_FLEET_TOTAL, BASE_FLEET_IDLE, type FleetMix } from "./fleetMix";

export interface PlanParams {
  safety: number; // hệ số an toàn (1.0 = sát, 1.1 = +10% dự phòng)
  /** RÀ LẠI 2026-07-21 (Phương án 3, Sếp chọn sau backtest 3 phương án trên dữ liệu thật — xem
   *  vehicleElasticity.ts): độ co giãn xe/hàng ĐO TỪ LỊCH SỬ (không phải suy lý thuyết). `null`/
   *  `undefined` = chưa đủ dữ liệu lịch sử để đo -> tự rơi về công thức cũ (kg ÷ effectiveCap,
   *  qua gốc toạ độ) làm phương án dự phòng, KHÔNG throw/chặn trang. */
  elasticity?: number | null;
}
export const DEFAULT_PARAMS: PlanParams = { safety: 1.1 };
/** Ngưỡng tải để tính là "ngày cao điểm" (đưa vào cửa sổ tính elasticity) — khớp thực tế đo được:
 *  NCC book HẰNG SỐ suốt các ngày cao điểm của 1 đợt (không dao động lên xuống theo từng ngày như
 *  công thức cũ vẽ ra), nên các ngày ≥ ngưỡng này dùng CHUNG 1 mức xe (xem computePlan). */
export const SURGE_DAY_THRESHOLD = 1.05;

/** Tỷ lệ dự trù PHÁT SINH (đơn/xe vượt kế hoạch) — chuẩn ngành ~12–15% cao điểm. */
export const SURGE_BUFFER = 0.15;

export interface DayPlan {
  date: string;
  demandKg: number; demandVol: number;
  hcmKg: number; stKg: number;
  hcmRatio: number; stRatio: number; // so ngày thường (kho)
  vehNeeded: number;                 // xe cần ngày đó (toàn cụm)
  loadRatio: number;                 // demand / baseline toàn cụm
}

export interface PlanResult {
  days: DayPlan[];
  peak: DayPlan | null;
  activeNormal: number;   // xe chạy ngày thường (đội nền − xe nằm bãi)
  idle: number;           // xe 1.900 nằm bãi (dư địa lớp 1)
  nccBooked: number;      // xe đã book NCC (lấy+giao)
  ghn: number;            // xe GHN tăng cường
  effectiveCap: number;   // kg/xe/ngày (hiệu chỉnh) — vẫn hiện để tham khảo dù dùng elasticity hay không
  calibrated: boolean;    // true nếu cap suy từ baseline thật
  baselineKg: number;     // kg ngày thường toàn cụm
  elasticityUsed: number | null; // độ co giãn ĐO TỪ LỊCH SỬ đã áp dụng (null = đang dùng công thức cũ kg÷cap)
  peakNeeded: number;     // xe cần ngày đỉnh
  peakExtra: number;      // xe tăng cường cần (đỉnh)
  availExtra: number;     // dư địa = idle + nccBooked
  gap: number;            // còn THIẾU (>0) hay DƯ (0)
  coveragePct: number;    // % đáp ứng phần tăng cường
  // -- Elasticity & dự trù phát sinh --
  volSurgePct: number;    // hàng ngày đỉnh tăng bao nhiêu % so ngày thường
  vehSurgePct: number;    // xe ngày đỉnh tăng bao nhiêu % so đội nền
  phatSinhVeh: number;    // xe dự trù cho PHÁT SINH (ngoài kế hoạch) = ceil(peakNeeded × buffer)
  bookFixed: number;      // xe nên BOOK NCC CỐ ĐỊNH theo cot (= peakExtra)
  reserveGhn: number;     // xe nhà GHN giữ làm dự phòng
}

const FALLBACK_CAP = 7000; // kg/xe/ngày khi chưa có baseline thật

/** Ngày có demandKg cao nhất trong mảng — dùng làm cửa sổ tham chiếu khi KHÔNG có ngày nào vượt
 *  SURGE_DAY_THRESHOLD (vd kỳ có tải tăng nhẹ, không đủ ngưỡng "cao điểm" rõ rệt). */
function peakRawDay<T extends { demandKg: number }>(arr: T[]): T | null {
  return arr.reduce<T | null>((m, d) => (d.demandKg > (m?.demandKg ?? -1) ? d : m), null);
}

/** Đội nền THẬT chạy ngày thường (Lấy+Giao thật đếm từ Lịch Tải, trừ xe nằm bãi) — xuất công khai để
 *  `vehicleElasticity.ts`/`PlanEvent.tsx` dùng CHUNG cách tính này khi đo elasticity lịch sử, tránh
 *  suy ra 1 con số activeNormal KHÁC với chính computePlan() đang dùng cho kỳ hiện tại. */
export function activeNormalOf(fleet: FleetMix | null): number {
  // RÀ LẠI 2026-07-21 (Sếp xác nhận, xem [[m12-plan-event]]): đội nền TỔNG dùng số THẬT đếm từ Lịch
  // Tải (fleet.fixedByDir — Lấy 294 + Giao/khác 253 = 547, xem fleetMix.ts isLayCategory()) thay cho
  // BASE_FLEET_TOTAL (209, tham chiếu thủ công cũ theo TẢI TRỌNG — SAI trục, không phải theo HƯỚNG
  // Lấy/Giao) — chỉ fallback về 209 khi fleet CHƯA load xong (tránh activeNormal=0 lúc đầu trang).
  const activeFleetTotal = fleet ? fleet.fixedByDir.lay + fleet.fixedByDir.other : BASE_FLEET_TOTAL;
  return Math.max(1, activeFleetTotal - BASE_FLEET_IDLE);
}

export function computePlan(
  fc: {
    hcm?: { days: { date: string; vol: number | null; weight: number | null }[]; baseW: number | null };
    st?: { days: { date: string; vol: number | null; weight: number | null }[]; baseW: number | null };
  } | null,
  fleet: FleetMix | null,
  p: PlanParams = DEFAULT_PARAMS
): PlanResult | null {
  if (!fc) return null;
  const idle = BASE_FLEET_IDLE;
  const activeNormal = activeNormalOf(fleet);
  const nccBooked = fleet?.totalNcc || 0;
  const ghn = fleet?.ghnTC || 0;

  const hcmBase = fc.hcm?.baseW || 0;
  const stBase = fc.st?.baseW || 0;
  const baselineKg = hcmBase + stBase;
  const calibrated = baselineKg > 0;
  const effectiveCap = calibrated ? baselineKg / activeNormal : FALLBACK_CAP;
  const safety = p.safety > 0 ? p.safety : 1;

  const dates = [...new Set([...(fc.hcm?.days || []), ...(fc.st?.days || [])].map((d) => d.date))].sort();
  // Pass 1: dựng demandKg/loadRatio từng ngày (CHƯA có vehNeeded — cần loadRatio của TẤT CẢ ngày
  // trước để gộp "cửa sổ cao điểm" ở Pass 2).
  const rawDays = dates.map((dt) => {
    const h = fc.hcm?.days.find((x) => x.date === dt);
    const s = fc.st?.days.find((x) => x.date === dt);
    const hcmKg = h?.weight || 0, stKg = s?.weight || 0;
    const demandKg = hcmKg + stKg;
    const demandVol = (h?.vol || 0) + (s?.vol || 0);
    return {
      date: dt, demandKg, demandVol, hcmKg, stKg,
      hcmRatio: hcmBase > 0 ? hcmKg / hcmBase : 1,
      stRatio: stBase > 0 ? stKg / stBase : 1,
      loadRatio: baselineKg > 0 ? demandKg / baselineKg : 1,
    };
  });
  // Pass 2: xe cần mỗi ngày.
  // - CÓ elasticity đo được (Phương án 3 — Sếp chọn 2026-07-21, xem vehicleElasticity.ts): các ngày
  //   "cao điểm" (loadRatio ≥ SURGE_DAY_THRESHOLD) dùng CHUNG 1 mức xe DUY NHẤT, tính từ TB kg của
  //   CHÍNH các ngày cao điểm đó — khớp thực tế NCC book HẰNG SỐ suốt cả đợt (không dao động lên
  //   xuống theo từng ngày như công thức cũ). Ngày KHÔNG cao điểm dùng thẳng đội nền (đủ sức tự lo).
  // - KHÔNG có elasticity (chưa đủ dữ liệu lịch sử) -> rơi về công thức CŨ (kg ÷ effectiveCap, qua
  //   gốc toạ độ) làm phương án dự phòng duy nhất còn lại.
  const elasticity = calibrated ? (p.elasticity ?? null) : null;
  let windowVehNeeded = activeNormal;
  if (elasticity != null) {
    const surgeDays = rawDays.filter((d) => d.loadRatio >= SURGE_DAY_THRESHOLD);
    const refDays = surgeDays.length ? surgeDays : (peakRawDay(rawDays) ? [peakRawDay(rawDays)!] : []);
    const windowKg = refDays.length ? refDays.reduce((a, d) => a + d.demandKg, 0) / refDays.length : 0;
    const surgeRatio = baselineKg > 0 ? Math.max(0, windowKg / baselineKg - 1) : 0;
    windowVehNeeded = Math.ceil(activeNormal * (1 + elasticity * surgeRatio * safety));
  }
  const days: DayPlan[] = rawDays.map((d) => ({
    ...d,
    vehNeeded: elasticity != null
      ? (d.loadRatio >= SURGE_DAY_THRESHOLD ? windowVehNeeded : activeNormal)
      : (effectiveCap > 0 ? Math.ceil((d.demandKg * safety) / effectiveCap) : 0),
  }));

  const peak = days.reduce<DayPlan | null>((m, d) => (d.demandKg > (m?.demandKg ?? -1) ? d : m), null);
  const peakNeeded = days.reduce((a, d) => Math.max(a, d.vehNeeded), 0);
  const peakExtra = Math.max(0, peakNeeded - activeNormal);
  const availExtra = idle + nccBooked;
  const gap = Math.max(0, peakExtra - availExtra);
  const coveragePct = peakExtra > 0 ? Math.round((availExtra / peakExtra) * 100) : 100;

  // Elasticity: hàng (kg) ngày đỉnh tăng bao nhiêu % -> xe tăng bao nhiêu %.
  const volSurgePct = peak && baselineKg > 0 ? Math.round((peak.demandKg / baselineKg - 1) * 100) : 0;
  const vehSurgePct = activeNormal > 0 ? Math.round((peakNeeded / activeNormal - 1) * 100) : 0;
  // Dự trù PHÁT SINH: book NCC cố định theo cot cho phần tăng cường, giữ xe nhà GHN dự phòng.
  const phatSinhVeh = Math.ceil(peakNeeded * SURGE_BUFFER);
  const bookFixed = peakExtra;
  const reserveGhn = ghn;

  return {
    days, peak, activeNormal, idle, nccBooked, ghn, effectiveCap, calibrated, baselineKg,
    elasticityUsed: elasticity,
    peakNeeded, peakExtra, availExtra, gap, coveragePct,
    volSurgePct, vehSurgePct, phatSinhVeh, bookFixed, reserveGhn,
  };
}

/** Tóm tắt kế hoạch dạng text để NẠP cho trợ lý (nguồn số THẬT, không bịa). */
export function planDigest(r: PlanResult | null): string {
  if (!r) return "";
  const n = (v: number) => Math.round(v).toLocaleString("vi-VN");
  const L: string[] = [];
  L.push(`\n[KẾ HOẠCH XE ĐÃ TÍNH SẴN BẰNG CODE — số THẬT, DÙNG ĐÚNG, KHÔNG bịa]`);
  L.push(`- Năng lực hiệu chỉnh: ${n(r.effectiveCap)} kg/xe/ngày${r.calibrated ? " (suy từ ngày thường thật)" : " (ước lượng)"}; đội nền chạy ngày thường ${r.activeNormal} xe.`);
  L.push(r.elasticityUsed != null
    ? `- Xe cần theo ngày dùng ĐỘ CO GIÃN đo từ lịch sử (${(r.elasticityUsed * 100).toFixed(0)}% xe/100% hàng tăng) — ngày cao điểm dùng CHUNG 1 mức xe (không dao động theo từng ngày, khớp cách NCC book thật).`
    : `- CHƯA đủ dữ liệu lịch sử để đo độ co giãn — đang dùng công thức dự phòng (kg ÷ năng lực/xe).`);
  L.push(`- Xe cần ngày ĐỈNH: ${r.peakNeeded} xe (${r.peak ? r.peak.date.slice(8) + "/" + r.peak.date.slice(5, 7) : "—"}, ${n(r.peak?.demandKg || 0)} kg).`);
  L.push(`- Xe TĂNG CƯỜNG cần (đỉnh): ${r.peakExtra} xe. Dư địa hiện có: ${r.nccBooked} xe đã book NCC (KHÔNG còn xe nằm bãi — đội nền đã chạy hết).`);
  L.push(`- ${r.gap > 0 ? `CÒN THIẾU ${r.gap} xe → cần book thêm NCC/thuê ngoài.` : `ĐỦ (dư ${r.availExtra - r.peakExtra} xe), đáp ứng ${r.coveragePct}%.`}`);
  L.push(`- ĐỘ CO GIÃN: hàng ngày đỉnh +${r.volSurgePct}% so ngày thường → xe +${r.vehSurgePct}% (xe tăng chậm hơn hàng nhờ tối ưu lấp đầy — hợp lý nếu xe% ≈ 0.6–0.9 × hàng%).`);
  L.push(`- DỰ TRÙ PHÁT SINH (~${Math.round(SURGE_BUFFER * 100)}%): BOOK NCC CỐ ĐỊNH theo cot ${r.bookFixed} xe cho phần tăng cường; GIỮ ${r.reserveGhn} xe nhà GHN làm dự phòng; chuẩn bị thêm ~${r.phatSinhVeh} xe (NCC bỏ cot/thuê nóng) cho đơn vượt kế hoạch.`);
  L.push(`- Số xe cần theo NGÀY: ` + r.days.map((d) => `${d.date.slice(8)}/${d.date.slice(5, 7)}=${d.vehNeeded}`).join(", ") + ".");
  L.push(`Nhiệm vụ trợ lý: GIẢI THÍCH & TƯ VẤN dựa trên các số này (vì sao, rủi ro, thứ tự huy động: đội nền → book NCC cố định theo cot → xe nhà GHN dự phòng → thuê nóng, plan A/B/C); TUYỆT ĐỐI không đổi số.`);
  return L.join("\n");
}
