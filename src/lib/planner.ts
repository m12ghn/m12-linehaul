/* ============================================================
   Sắp Lịch tải — tự dựng lịch từ khung nhập tay.
   - Xếp điểm tối ưu quãng đường (nearest-neighbor theo đường chim bay)
   - Lấy km + phút chạy thực tế (OSRM) cho thứ tự đã chọn
   - Tính giờ đến / giờ rời từng điểm theo quy ước thời gian dừng
   ============================================================ */
import { lookupCoord, haversineKm, initLiveGeo } from "./geo";
import { fetchRoadLegsFull } from "./route-distance";

/** Bỏ tiền tố "ID - " khi Sếp chọn gợi ý dạng "2451 - (HCM) Đông Hưng Thuận 2" (xem PlaceInput.tsx)
 *  — ID chỉ để hiển thị phân biệt các điểm dễ trùng tên, tra toạ độ vẫn phải dùng đúng tên thật. */
function stripIdPrefix(s: string): string {
  return (s || "").replace(/^\s*\d+\s*-\s*/, "").trim();
}

/** Hệ số đệm giờ chạy thực tế — OSRM (miễn phí, router.project-osrm.org) tính giờ theo TỐC ĐỘ GIỚI
 *  HẠN đường, KHÔNG có dữ liệu kẹt xe/đèn đỏ thật nên luôn ra nhanh hơn thực tế. Sếp phát hiện
 *  2026-08-23 (đoạn HCM20 → KD Bình Trị Đông Dash báo 10' nhưng thực tế lâu hơn nhiều).
 *
 *  PHẦN THEO CỰ LY — ĐÃ ĐO THẬT: đối chiếu tay 4 chặng trên Google Maps (có traffic thật) vs OSRM
 *  cùng toạ độ: 16p/9p≈1.78 (6.4km) · 26p/14p≈1.86 (10.5km) · 19p/11p≈1.73 (7.8km) · 58p/42p≈1.38
 *  (33.9km) — chặng ngắn nội thành (nhiều đèn đỏ/giao cắt trên mỗi km) lệch nhiều hơn hẳn chặng dài
 *  ra xa lộ (ít giao cắt hơn). Chia 2 mức theo cự ly khớp đúng số đã đo: ≤15km lấy 1.8, còn lại 1.4.
 *
 *  PHẦN THEO GIỜ TRONG NGÀY — ƯỚC LƯỢNG THEO KINH NGHIỆM VẬN HÀNH CHUNG, KHÔNG PHẢI SỐ ĐO THẬT
 *  (Sếp yêu cầu 2026-08-23 thêm biến giờ cao điểm/thấp điểm): Sài Gòn kẹt nặng nhất giờ đi làm/tan
 *  tầm, thông thoáng hẳn về đêm. Nhân thêm hệ số theo khung giờ XUẤT PHÁT của từng chặng (giờ chạy
 *  thực của đồng hồ lịch, không phải giờ lúc Sếp bấm tính) lên trên mức theo cự ly ở trên.
 *  Đây KHÔNG phải traffic thời gian thực (như Google Maps Directions API) — cách đó chính xác hơn
 *  nhưng cần bật billing trả phí trên Google Cloud (API key riêng, không dùng chung OAuth Sheets
 *  đang có). Sếp muốn dùng real-time thật thì báo em bật, còn hiện tại dùng công thức miễn phí này.
 *  Nếu vận hành thực tế thấy khung giờ/hệ số nào chưa đúng, chỉnh lại ngay các hằng số bên dưới. */
const DIST_TIER_KM = 15; // ≤ ngưỡng này coi là chặng ngắn nội thành, > coi là chặng dài ra xa lộ
const DIST_FACTOR_SHORT = 1.8;
const DIST_FACTOR_LONG = 1.4;
const PEAK_FACTOR = 1.2; // nhân thêm giờ cao điểm (kẹt nặng hơn mức bình thường ở trên)
const NIGHT_FACTOR = 0.75; // nhân thêm đêm khuya (thông thoáng hơn mức bình thường ở trên)

/** Khung giờ cao điểm Sài Gòn: sáng đi làm 6:30–8:30, chiều tan tầm 16:30–19:30.
 *  Đêm khuya đường vắng: 22:00–5:00. Còn lại là giờ bình thường (hệ số ×1). */
function timeOfDayFactor(minuteOfDay: number): number {
  const h = minuteOfDay / 60;
  const inPeak = (h >= 6.5 && h < 8.5) || (h >= 16.5 && h < 19.5);
  const inNight = h >= 22 || h < 5;
  return inPeak ? PEAK_FACTOR : inNight ? NIGHT_FACTOR : 1;
}

/** Hệ số đệm cho 1 chặng cụ thể = mức theo cự ly (đã đo thật) × mức theo giờ xuất phát (ước lượng). */
function trafficBuffer(km: number, departMinuteOfDay: number): number {
  const distFactor = km <= DIST_TIER_KM ? DIST_FACTOR_SHORT : DIST_FACTOR_LONG;
  return distFactor * timeOfDayFactor(departMinuteOfDay);
}

/** Cấu hình xe tải: [tải trọng, số đơn tiêu chuẩn, số kg tiêu chuẩn]. */
export const VEHICLE_CONFIG: { cap: number; don: number; kg: number }[] = [
  { cap: 1700, don: 1000, kg: 1600 },
  { cap: 1900, don: 1000, kg: 1600 },
  { cap: 2000, don: 1000, kg: 1700 },
  { cap: 2100, don: 1000, kg: 1700 },
  { cap: 2300, don: 1000, kg: 1700 },
  { cap: 2400, don: 1000, kg: 1700 },
  { cap: 3500, don: 1500, kg: 2500 },
  { cap: 5000, don: 2000, kg: 3400 },
  { cap: 6000, don: 2750, kg: 4750 },
  { cap: 6500, don: 2750, kg: 4750 },
  { cap: 8000, don: 3500, kg: 6100 },
  { cap: 8001, don: 5000, kg: 7100 },
  { cap: 10000, don: 4000, kg: 6600 },
  { cap: 15000, don: 5000, kg: 8000 },
  { cap: 40000, don: 8000, kg: 11200 },
];

export const DWELL_KHO = 20; // (cũ) — nay tính theo bảng dwellMin bên dưới

const _strip = (x: string) => (x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
/** Nhóm tải trọng: small (nhóm 1900: ≤2400), mid (nhóm 5000: 3500–6000), big (6500/8000+). */
function capClass(cap: number): "small" | "mid" | "big" {
  if (cap >= 6500) return "big";
  if (cap >= 3500) return "mid";
  return "small";
}
/**
 * THỜI GIAN DỪNG (phút) theo quy ước vận hành M12:
 * - KHO (lên & xuống cùng bảng): 1900→20, 5000→40, 6500/8000→60.
 * - BƯU CỤC LÊN hàng (Lấy): 1900→(1 điểm 15, ≥2 điểm 10), 5000→30, 6500/8000→60.
 * - BƯU CỤC XUỐNG hàng (Giao): 1900→15, 5000→40, 6500/8000→60; tuyến "giao và lấy"→15.
 */
export function dwellMin(cap: number, name: string, loaiHinh: string, bcPickupCount: number): number {
  const c = capClass(cap);
  const lh = _strip(loaiHinh);
  const isKho = lh.includes("phan loai") || _strip(name).includes("kho");
  if (isKho) return c === "big" ? 60 : c === "mid" ? 40 : 20;
  const isGiaoLay = lh.includes("giao") && lh.includes("lay");
  if (isGiaoLay) return 15; // tuyến giao và lấy
  const isLay = lh.includes("lay"); // bưu cục LÊN hàng
  if (isLay) return c === "big" ? 60 : c === "mid" ? 30 : (bcPickupCount >= 2 ? 10 : 15);
  return c === "big" ? 60 : c === "mid" ? 40 : 15; // bưu cục XUỐNG hàng (giao)
}

export interface PlanPoint {
  name: string;
  kg: number;
  cutoff?: string; // giờ chốt (HH:MM)
  loaiHinh?: string; // Phân loại / Giao / Lấy / Giao và lấy (rỗng = theo chiều tuyến)
}
export interface PlanInput {
  mode: "Giao" | "Lấy";
  vehicleCap: number; // tải trọng xe đã chọn
  startName: string; // điểm đầu (Điểm 1)
  startTime: string; // "HH:MM" — giờ đến điểm đầu
  startLoaiHinh?: string; // loại hình tại điểm đầu (rỗng = Phân loại)
  startKg?: number; // kg tại điểm đầu (nếu điểm đầu cũng lấy/giao hàng)
  endName: string; // điểm cuối tuỳ chọn (rỗng = dừng ở điểm cuối danh sách)
  points: PlanPoint[]; // các điểm tiếp theo + kg
  keepOrder?: boolean; // true = giữ NGUYÊN thứ tự points (không tối ưu lại)
}
export interface PlanRow {
  name: string;
  loaiHinh: string; // Phân loại / Giao / Lấy
  toi: string;
  roi: string;
  km: number | null;
  min?: number; // số phút di chuyển (đường ô tô) tới điểm này
  coord?: [number, number];
  kg?: number;
  cutoff?: string; // giờ chốt
  late?: boolean; // tới sau cut-off
}
export interface PlanResult {
  rows: PlanRow[];
  totalKm: number;
  totalMin: number;
  endTime: string;
  stdKg: number;
  totalKg: number;
  over: boolean;
  missing: string[]; // điểm không tìm thấy toạ độ
  lateCount: number; // số điểm trễ cut-off
}

/** Chọn xe NHỎ NHẤT có tải chuẩn ≥ kg. Nếu vượt xe lớn nhất -> nhiều xe. */
export function pickVehicle(kg: number): { cap: number; kg: number; don: number; soXe: number } {
  const fit = VEHICLE_CONFIG.find((c) => c.kg >= kg);
  if (fit) return { ...fit, soXe: kg > 0 ? 1 : 0 };
  const max = VEHICLE_CONFIG[VEHICLE_CONFIG.length - 1];
  return { ...max, soXe: Math.max(1, Math.ceil(kg / max.kg)) };
}

/** 1 dòng template (đã chuẩn hoá tên cột). */
export interface TemplateRow {
  group: string;
  mode: string; // Giao / Lấy
  khoDau: string;
  khoCuoi: string;
  name: string; // tên bưu cục
  klLay: number;
  klGiao: number;
  startTime: string;
  cutoff: string; // giờ chốt nhận/xuất của bưu cục (HH:MM)
}

export interface GroupPlan {
  group: string;
  mode: "Giao" | "Lấy";
  totalKg: number;
  vehicle: { cap: number; kg: number; soXe: number };
  result: PlanResult;
}

const p2 = (n: number) => String(n).padStart(2, "0");
function toMin(hhmm: string): number {
  const m = (hhmm || "").match(/(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
}
function toHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
}
/** Làm tròn phút về bội số 5 gần nhất — hệ thống công ty chỉ ghi nhận giờ tròn 5 phút
 *  (:00, :05, :10…), không ghi nhận :01–:04/:06–:09… Áp NGAY lên đồng hồ chạy (t) sau mỗi lần
 *  cộng dồn (giờ bắt đầu, chạy xe, dừng) — không chỉ làm tròn lúc hiển thị — để mọi mốc TỚI/RỜI
 *  đều là số hợp lệ và các điểm sau cộng nối tiếp đúng từ mốc đã tròn, không lệch dần vài phút. */
function round5(min: number): number {
  return Math.round(min / 5) * 5;
}

/** Quy `t` (đồng hồ chạy, có thể vượt 1440 nếu lịch chạy qua nửa đêm) về đúng phút-trong-ngày
 *  (0–1439) — dùng để tra khung giờ cao điểm/thấp điểm (xem timeOfDayFactor()), KHÔNG được bỏ qua
 *  bước này nếu không lịch qua ngày hôm sau sẽ bị tính nhầm khung giờ (vd 6h sáng hôm sau đọc thành
 *  "sau 22h" nếu không quy về 0–1439 trước). */
function dayMinute(t: number): number {
  return ((Math.round(t) % 1440) + 1440) % 1440;
}

/** Sắp xếp điểm theo lân cận gần nhất bắt đầu từ kho đầu. */
function nearestOrder<T extends { coord: [number, number] }>(start: [number, number], pts: T[]): T[] {
  const order: T[] = [];
  const rem = [...pts];
  let cur = start;
  while (rem.length) {
    let bi = 0;
    let bd = Infinity;
    for (let j = 0; j < rem.length; j++) {
      const d = haversineKm(cur, rem[j].coord);
      if (d < bd) { bd = d; bi = j; }
    }
    order.push(rem[bi]);
    cur = rem[bi].coord;
    rem.splice(bi, 1);
  }
  return order;
}

export async function planSchedule(input: PlanInput): Promise<PlanResult> {
  // LUÔN nạp lại toạ độ REALTIME (không chỉ 1 lần đầu phiên) trước khi tra bất kỳ điểm nào — Sếp
  // yêu cầu 2026-08-23 "Dash phải luôn đồng bộ, kể cả sau này điều chỉnh thêm bưu cục". Thiếu bước
  // này, tính lịch NGAY lúc vừa mở tab (trước khi sheet toạ độ toàn quốc kịp tải) sẽ phải fuzzy-match
  // tạm ra 1 điểm GẦN ĐÚNG TÊN (vd "Bình Trị Đông 2" thay vì đúng "KD Bình Trị Đông"), và nếu Sếp
  // vừa sửa toạ độ trên sheet thì lần tính tiếp theo phải thấy NGAY, không đợi tới vòng poll kế tiếp.
  // initLiveGeo() có cache 5 phút ở PHÍA SERVER (functions/api/geo.ts) nên gọi lại không tốn quota
  // Google Sheets, chỉ thêm 1 round-trip nhẹ tới Cloudflare KV.
  await initLiveGeo();
  const missing: string[] = [];
  const startCoord = lookupCoord(stripIdPrefix(input.startName));
  if (!startCoord) missing.push(input.startName + " (kho đầu)");

  const pts = input.points
    .filter((p) => p.name.trim())
    .map((p) => {
      const coord = lookupCoord(stripIdPrefix(p.name));
      if (!coord) missing.push(p.name);
      return { name: p.name.trim(), kg: p.kg || 0, cutoff: p.cutoff || "", loaiHinh: p.loaiHinh || "", coord };
    })
    .filter((p): p is { name: string; kg: number; cutoff: string; loaiHinh: string; coord: [number, number] } => !!p.coord);

  const endName = input.endName.trim(); // TRỐNG = KHÔNG có chặng về kho cuối (tuyến dừng ở điểm cuối)
  const endCoord = endName ? lookupCoord(stripIdPrefix(endName)) : undefined;

  const cfg = VEHICLE_CONFIG.find((c) => c.cap === input.vehicleCap) ?? VEHICLE_CONFIG[1];
  const totalKg = input.points.reduce((a, p) => a + (p.kg || 0), 0) + (input.startKg || 0);
  const stdKg = cfg.kg;


  // Xếp thứ tự + chuỗi toạ độ: kho đầu -> các bưu cục (tối ưu) -> kho cuối
  const rows: PlanRow[] = [];
  if (!startCoord || pts.length === 0) {
    return { rows, totalKm: 0, totalMin: 0, endTime: input.startTime, stdKg, totalKg, over: totalKg > stdKg, missing, lateCount: 0 };
  }
  const ordered = input.keepOrder ? pts : nearestOrder(startCoord, pts);
  const seq: { name: string; coord: [number, number]; loaiHinh: string; kg?: number; cutoff?: string }[] = [
    { name: input.startName.trim(), coord: startCoord, loaiHinh: input.startLoaiHinh || "Phân loại", kg: input.startKg },
    ...ordered.map((p) => ({ name: p.name, coord: p.coord, loaiHinh: p.loaiHinh || input.mode, kg: p.kg, cutoff: p.cutoff })),
  ];
  if (endCoord) seq.push({ name: endName, coord: endCoord, loaiHinh: "Phân loại" });

  const legs = await fetchRoadLegsFull(seq.map((s) => s.coord));

  const t0 = round5(toMin(input.startTime));
  let t = t0;
  let totalKm = 0;
  let lateCount = 0;
  for (let i = 0; i < seq.length; i++) {
    const s = seq[i];
    let toi: string;
    let km: number | null = null;
    let driveMin = 0;
    if (i === 0) {
      toi = toHHMM(t); // đến kho đầu
    } else {
      const leg = legs?.[i - 1];
      driveMin = leg ? leg.min * trafficBuffer(leg.km, dayMinute(t)) : (haversineKm(seq[i - 1].coord, s.coord) / 30) * 60; // fallback ~30km/h
      km = leg ? leg.km : haversineKm(seq[i - 1].coord, s.coord);
      totalKm += km;
      t = round5(t + driveMin);
      toi = toHHMM(t);
    }
    const late = !!(s.cutoff && i > 0 && t > toMin(s.cutoff));
    if (late) lateCount++;
    const dwell = dwellMin(input.vehicleCap, s.name, s.loaiHinh, pts.length);
    t = round5(t + dwell);
    rows.push({ name: s.name, loaiHinh: s.loaiHinh, toi, roi: toHHMM(t), km, min: i === 0 ? 0 : Math.round(driveMin), coord: s.coord, kg: s.kg, cutoff: s.cutoff, late });
  }

  return {
    rows,
    totalKm,
    totalMin: t - t0,
    endTime: rows.length ? rows[rows.length - 1].roi : input.startTime,
    stdKg,
    totalKg,
    over: totalKg > stdKg,
    missing,
    lateCount,
  };
}

/**
 * Tính giờ/km theo MỘT chuỗi điểm CỐ ĐỊNH (giữ nguyên thứ tự + loại hình).
 * Dùng cho Ghép Tải: giữ nguyên tuyến gốc, chỉ chèn thêm điểm.
 */
export async function planRouteFixed(
  seq: { name: string; loaiHinh: string; coord: [number, number] }[],
  startTime: string,
  cap = 1900
): Promise<PlanResult> {
  const valid = seq.filter((s) => s.coord);
  if (valid.length === 0)
    return { rows: [], totalKm: 0, totalMin: 0, endTime: startTime, stdKg: 0, totalKg: 0, over: false, missing: [], lateCount: 0 };
  const legs = await fetchRoadLegsFull(valid.map((s) => s.coord));
  const isKho = (s: { name: string; loaiHinh: string }) => /phan loai/i.test(s.loaiHinh) || /kho/i.test(s.name);
  const bcCount = valid.filter((s) => !isKho(s)).length;

  const rows: PlanRow[] = [];
  const t0 = round5(toMin(startTime));
  let t = t0;
  let totalKm = 0;
  for (let i = 0; i < valid.length; i++) {
    const s = valid[i];
    let toi: string;
    let km: number | null = null;
    let driveMin = 0;
    if (i === 0) {
      toi = toHHMM(t);
    } else {
      const leg = legs?.[i - 1];
      driveMin = leg ? leg.min * trafficBuffer(leg.km, dayMinute(t)) : (haversineKm(valid[i - 1].coord, s.coord) / 30) * 60;
      km = leg ? leg.km : haversineKm(valid[i - 1].coord, s.coord);
      totalKm += km;
      t = round5(t + driveMin);
      toi = toHHMM(t);
    }
    t = round5(t + dwellMin(cap, s.name, s.loaiHinh, bcCount));
    rows.push({ name: s.name, loaiHinh: s.loaiHinh, toi, roi: toHHMM(t), km, min: i === 0 ? 0 : Math.round(driveMin), coord: s.coord });
  }
  return {
    rows,
    totalKm,
    totalMin: t - t0,
    endTime: rows.length ? rows[rows.length - 1].roi : startTime,
    stdKg: 0,
    totalKg: 0,
    over: false,
    missing: [],
    lateCount: 0,
  };
}

/** Kiểm tra điểm thiếu toạ độ trong template (nhanh, không gọi OSRM). LUÔN nạp lại toạ độ REALTIME
 *  trước khi tra — tránh báo "thiếu toạ độ" oan (hoặc bỏ sót điểm vừa sửa toạ độ) cho các điểm chỉ
 *  có trên sheet toàn quốc (xem initLiveGeo() ở geo.ts, cùng gốc lỗi "tính 2 lần ra 2 kết quả"). */
export async function validateTemplate(rows: TemplateRow[]): Promise<{ group: string; name: string }[]> {
  await initLiveGeo();
  const miss: { group: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const nm of [r.khoDau, r.khoCuoi, r.name]) {
      const n = (nm || "").trim();
      if (!n) continue;
      const key = (r.group || "") + "|" + n;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!lookupCoord(n)) miss.push({ group: r.group || "(không nhóm)", name: n });
    }
  }
  return miss;
}

/** Gom nhóm tuyến -> sắp lịch từng nhóm + chọn xe. */
export async function planFromTemplate(rows: TemplateRow[]): Promise<GroupPlan[]> {
  // Nhánh chia nhiều xe bên dưới tự tra lookupCoord() để CỤM điểm gần nhau (không đi qua
  // planSchedule()) — phải nạp toạ độ REALTIME trước, cùng lý do như planSchedule() ở trên.
  await initLiveGeo();
  const groups = new Map<string, TemplateRow[]>();
  for (const r of rows) {
    if (!r.name.trim() && !r.khoDau.trim()) continue;
    const g = (r.group || "Lịch 1").trim() || "Lịch 1";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }

  const out: GroupPlan[] = [];
  for (const [group, grows] of groups) {
    const mode: "Giao" | "Lấy" =
      grows.find((r) => /giao/i.test(r.mode))?.mode && !grows.some((r) => /lay|lấy/i.test(r.mode))
        ? "Giao"
        : grows.some((r) => /giao/i.test(r.mode)) && !grows.some((r) => /lay|lấy/i.test(r.mode))
        ? "Giao"
        : "Lấy";
    const khoDau = grows.map((r) => r.khoDau).find((x) => x.trim()) || "";
    const khoCuoi = grows.map((r) => r.khoCuoi).find((x) => x.trim()) || "";
    const startTime = grows.map((r) => r.startTime).find((x) => x.trim()) || "19:30";
    const points = grows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name, kg: mode === "Giao" ? r.klGiao || r.klLay : r.klLay || r.klGiao, cutoff: r.cutoff }));
    const totalKg = points.reduce((a, p) => a + (p.kg || 0), 0);
    const need = pickVehicle(totalKg);

    if (need.soXe <= 1) {
      // 1 xe đủ tải
      const result = await planSchedule({ mode, vehicleCap: need.cap, startName: khoDau, startTime, endName: khoCuoi, points });
      out.push({ group, mode, totalKg, vehicle: { cap: need.cap, kg: need.kg, soXe: 1 }, result });
    } else {
      // Vượt tải xe lớn nhất -> CHIA nhiều xe theo cụm gần nhau
      const startCoord = lookupCoord(khoDau);
      const withCoord = points
        .map((p) => ({ ...p, coord: lookupCoord(p.name) }))
        .filter((p): p is typeof p & { coord: [number, number] } => !!p.coord);
      const ordered = startCoord ? nearestOrder(startCoord, withCoord) : withCoord;
      const size = Math.ceil(ordered.length / need.soXe);
      for (let k = 0; k < need.soXe; k++) {
        const chunk = ordered.slice(k * size, (k + 1) * size);
        if (!chunk.length) continue;
        const cKg = chunk.reduce((a, p) => a + (p.kg || 0), 0);
        const cVeh = pickVehicle(cKg);
        const result = await planSchedule({
          mode,
          vehicleCap: cVeh.cap,
          startName: khoDau,
          startTime,
          endName: khoCuoi,
          points: chunk.map((p) => ({ name: p.name, kg: p.kg, cutoff: p.cutoff })),
        });
        out.push({ group: `${group} · Xe ${k + 1}`, mode, totalKg: cKg, vehicle: { cap: cVeh.cap, kg: cVeh.kg, soXe: 1 }, result });
      }
    }
  }
  return out;
}
