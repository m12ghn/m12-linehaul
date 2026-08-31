/* ============================================================
   Tổng hợp ĐỘI XE cho Plan Event (số liệu THẬT, realtime):
   - Xe đang dùng theo TẢI TRỌNG  -> đếm tuyến từ Lịch Tải toàn cụm (6 vùng).
   - Xe book NCC                  -> đếm tuyến theo NCC từ Tăng Cường Lấy.
   - Đội xe nền "đang có"          -> tham chiếu kỳ event gần đây (10/10, 11/11).
   ============================================================ */
import { loadSheet } from "./sheet";
import { loadTangCuong } from "./tangcuong";
import { SHEETS, SHEET_ID, TANG_CUONG_LAY_GID, EVENT_T6_GID, EXCLUDED_REGION_KEYS } from "../config";

/** Ngưỡng tải NHỎ (nội thành, van/1.9T) vs LỚN (5T/8T…) = 2.000kg. */
const SMALL_MAX_KG = 2000;
/** Trọng tải chuỗi -> kg. "1900"/"1.9"/"5" -> số kg. 0 nếu trống. */
function loadKg(raw: string): number {
  const num = parseFloat((raw || "").replace(/[^\d.]/g, ""));
  if (!num || isNaN(num)) return 0;
  return num < 100 ? num * 1000 : num;
}
/** Phân loại 1 xe theo trọng tải: "small" (<2T, gồm cả ô trống=mặc định 1.9T) | "large" (≥2T). */
function sizeClass(raw: string): "small" | "large" {
  const kg = loadKg(raw);
  return kg >= SMALL_MAX_KG ? "large" : "small";
}

export type TonKey = "van" | "t19" | "t50" | "t80";
export const TON_LABEL: Record<TonKey, string> = { van: "Van", t19: "1.900", t50: "5.000", t80: "8.000" };
/** Nhãn NGẮN dùng cho text/breakdown (khác TON_LABEL — dùng cho trục biểu đồ) — dùng chung ở
 *  FleetCharts.tsx, costEstimate.ts, PlanVerdict.tsx để không lặp định nghĩa rải rác. */
export const TON_SHORT: Record<TonKey, string> = { van: "Van", t19: "1.9T", t50: "5T", t80: "8T" };
export const TON_ORDER: TonKey[] = ["van", "t19", "t50", "t80"];
/** Màu THEO TẢI TRỌNG dùng chung mọi chart trong Plan Event (trước đây khai riêng trong
 *  FleetCharts.tsx) — dùng lại để 1 tải trọng LUÔN cùng 1 màu xuyên suốt các biểu đồ. */
export const TON_COLOR: Record<TonKey, string> = { van: "var(--chart-2)", t19: "var(--chart-1)", t50: "var(--color-success)", t80: "var(--color-danger)" };

/** Phân loại chuỗi tải trọng về 4 nhóm Van / 1.900 / 5.000 / 8.000. */
export function tonBucket(raw: string): TonKey | null {
  const s = (raw || "").toLowerCase();
  if (/van|950/.test(s)) return "van";
  const num = parseFloat((raw || "").replace(/[^\d.]/g, ""));
  if (!num || isNaN(num)) return null; // ô trống / "0" -> chưa rõ
  const kg = num < 100 ? num * 1000 : num; // "1.9" -> 1900
  if (kg <= 1200) return "van";
  if (kg <= 2500) return "t19"; // 1.700 / 1.900
  if (kg <= 5500) return "t50"; // 5.000
  return "t80"; // 6.500 / 8.000 / 15.000
}

/** Đếm xe theo ĐỦ 4 mức tải trọng (Van/1.900/5.000/8.000) + "unknown" (chưa ghi/không nhận diện được). */
export interface TonBreakdown { van: number; t19: number; t50: number; t80: number; unknown: number; total: number }
export const emptyTonBreakdown = (): TonBreakdown => ({ van: 0, t19: 0, t50: 0, t80: 0, unknown: 0, total: 0 });
function addTonBreakdown(b: TonBreakdown, raw: string): void {
  const k = tonBucket(raw);
  if (k) b[k]++; else b.unknown++;
  b.total++;
}
function sumTonBreakdown(list: TonBreakdown[]): TonBreakdown {
  const out = emptyTonBreakdown();
  for (const b of list) { out.van += b.van; out.t19 += b.t19; out.t50 += b.t50; out.t80 += b.t80; out.unknown += b.unknown; out.total += b.total; }
  return out;
}

export interface NccCount {
  name: string;
  count: number;
  lay: number;   // số chuyến Lấy
  giao: number;  // số chuyến Giao
  small: number; // xe tải NHỎ (<2T) — nội thành, van/1.9T
  large: number; // xe tải LỚN (≥2T) — 5T/8T, gom/trục
  layTon: TonBreakdown;  // xe LẤY theo ĐỦ 4 mức tải trọng
  giaoTon: TonBreakdown; // xe GIAO theo ĐỦ 4 mức tải trọng
  quans: string[]; // các quận/vùng phục vụ (gọn, distinct)
}

/** Đối chiếu SỐ CHUYẾN (tuyến/booking) vs SỐ XE RIÊNG BIỆT (theo biển số) — 1 xe có thể
 *  chạy NHIỀU chuyến/vòng trong ngày nên 2 con số này KHÁC NHAU thật, không phải lỗi.
 *  coveragePct THẤP nghĩa là phần lớn dòng CHƯA ghi biển số -> distinctBks/multiRouteBks
 *  chỉ là quan sát trên MẪU đã ghi, KHÔNG đại diện cho toàn bộ chuyến. */
export interface VehCoverage {
  routes: number;       // tổng số chuyến/tuyến (đếm như cũ)
  withBks: number;      // trong đó có ghi biển số
  noBks: number;        // CHƯA ghi biển số (không rõ là xe nào)
  distinctBks: number;  // số xe RIÊNG BIỆT (trên phần đã ghi biển số)
  multiRouteBks: number; // số xe chạy ≥2 chuyến/tuyến khác nhau (1 xe nhiều vòng)
  coveragePct: number;  // % chuyến có ghi biển số (độ tin cậy của distinctBks/multiRouteBks)
}
function vehCoverageOf(bksList: (string | undefined)[]): VehCoverage {
  const withBksList = bksList.filter((b): b is string => !!b);
  const count = new Map<string, number>();
  for (const b of withBksList) count.set(b, (count.get(b) || 0) + 1);
  return {
    routes: bksList.length,
    withBks: withBksList.length,
    noBks: bksList.length - withBksList.length,
    distinctBks: count.size,
    multiRouteBks: [...count.values()].filter((n) => n >= 2).length,
    coveragePct: bksList.length ? Math.round((withBksList.length / bksList.length) * 100) : 0,
  };
}
/** Tách GHN (xe nhà) vs NCC (thuê ngoài) cho 1 khối xe (cố định HOẶC event). */
export interface FleetSplit {
  veh: VehCoverage;    // TẤT CẢ (GHN + NCC gộp)
  ghnVeh: VehCoverage; // riêng xe GHN (nhà)
  nccVeh: VehCoverage; // riêng xe NCC (thuê ngoài)
}

/** Tóm tắt 1 kỳ tăng cường để SO SÁNH (kỳ hiện tại vs EVENT T6). */
export interface PeriodSummary {
  date: string;
  totalNcc: number; // tổng xe book NCC (không tính GHN)
  small: number;    // xe tải nhỏ (<2T)
  large: number;    // xe tải lớn (≥2T)
  ghn: number;      // xe GHN nhà
  nccCount: number; // số NCC
  byNcc: { name: string; count: number }[];
  layTon: TonBreakdown;  // NCC Lấy theo đủ 4 mức tải trọng (không tính GHN)
  giaoTon: TonBreakdown; // NCC Giao theo đủ 4 mức tải trọng (không tính GHN)
  totalTon: TonBreakdown; // layTon + giaoTon gộp
  ghnLay: number; ghnGiao: number; // xe GHN tách riêng Lấy/Giao (thường không ghi biển số/tải trọng rõ)
}

export interface LiveTcRoute { code: string; ncc: string; tai: string; from: string; to: string }

/** Phân loại tuyến CỐ ĐỊNH theo "Loại tuyến" thành Lấy (chở hàng từ bưu cục về kho) hay không —
 *  cột "Loại tuyến" ("Loại tuyến" trong Lịch Tải, xem config.ts CATEGORY_LABELS) đã có sẵn giá trị
 *  thật "Lấy HCM01/HCM20/2 Kho/Chiều/MBH TT/ST/Q7" (Lấy) vs "Nội thành CA1/CA2/01_FW_20/GHN/rỗng"
 *  (Giao/khác) — RÀ LẠI 2026-07-21: đây LÀ số thật, không phải "không tách được" như nhận định sai
 *  trước đó (dựa trên báo cáo Explore agent chưa đọc kỹ sheet.ts/config.ts). */
export function isLayCategory(cat: string): boolean { return /^l[aấ]y/i.test((cat || "").trim()); }

/** RÀ LẠI 2026-07-21 (v2, Sếp xác nhận sau khi soát lại đầy đủ tên tuyến): cột "Loại tuyến" CHỈ TỒN
 *  TẠI ở sheet "Nội Thành HCM" (443/547 tuyến, header 4 sheet còn lại KHÔNG có cột này) — dùng
 *  isLayCategory() một mình sẽ bỏ sót tuyến Lấy THẬT ở 4 sheet kia (vd "SG_LAY_MHST_51-58" ở MBH
 *  Sóng Thần, "SG_LAY01_111/112" ở MBH Tân Tạo). Đã kiểm chứng: TÊN TUYẾN chứa "LAY" khớp 293/294
 *  tuyến Lấy theo category CHÍNH trong Nội Thành HCM (lệch đúng 1) -> dùng được làm tín hiệu fallback
 *  cho tuyến KHÔNG có category. */
export function isLayByName(routeName: string): boolean { return /lay/i.test(routeName || ""); }
/** Tuyến NỘI BỘ (mã có token "NB" riêng, vd "NB_250_01") — chung kho, không phải tuyến vận chuyển
 *  thật, KHÔNG tính vào đội nền Lấy/Giao. Cùng quy tắc/regex đã chốt ở tlldExclude.ts (NB_RE) và
 *  nccFixedCapacity.ts — dùng lại nguyên văn để nhất quán, không viết lại lỏng hơn. */
export function isNbRoute(routeName: string): boolean { return /(^|_)NB(_|$)/.test(routeName || ""); }

export interface FleetMix {
  inUse: Record<TonKey, number>; // số tuyến/chuyến theo tải (lịch tải toàn cụm)
  totalInUse: number;
  unknownLoad: number; // tuyến chưa ghi tải
  fixedByDir: { lay: number; other: number }; // đội nền CỐ ĐỊNH thật, tách theo "Loại tuyến" Lấy vs
                                              // Giao/khác (đếm tuyến từ Lịch Tải toàn cụm — LIVE, không
                                              // hardcode). Đây là số THẬT thay cho tham chiếu thủ công cũ.
  ncc: NccCount[]; // xe book theo NCC (Tăng Cường Lấy), GHN tách riêng
  ghnTC: number; // số tuyến tăng cường chạy xe GHN (xe nhà)
  totalNcc: number;
  small: number; // tổng xe NCC tải nhỏ (<2T) kỳ hiện tại
  large: number; // tổng xe NCC tải lớn (≥2T) kỳ hiện tại
  layTon: TonBreakdown;  // NCC Lấy kỳ hiện tại theo đủ 4 mức tải trọng (không tính GHN)
  giaoTon: TonBreakdown; // NCC Giao kỳ hiện tại theo đủ 4 mức tải trọng (không tính GHN)
  tcDate: string; // dải ngày tăng cường
  liveRoutes: LiveTcRoute[]; // route Tăng Cường LIVE kèm from/to THẬT (non-GHN) — để lọc/chia theo
                             // ngày đúng kỳ đang xem (xem PlanEvent.tsx surgeCostTimeline), vì sheet
                             // live không có nhãn kỳ như "Lưu trữ TC Event", có thể lẫn ngày nhiều kỳ.
  eventT6: PeriodSummary | null; // kỳ T6 để so sánh
  lastSync: number;
  /** CỐ ĐỊNH (Lịch Tải toàn cụm — chạy hàng ngày, không phải event) vs EVENT (Tăng Cường —
   *  đặt THÊM cho kỳ cao điểm). Đây là cơ sở so sánh "xe cố định" vs "xe xin event".
   *  LƯU Ý: KHÔNG cộng fixed.veh + event.veh thành "tổng xe cụm" — 1 xe có thể vừa chạy
   *  lịch cố định vừa được đặt thêm event nên sẽ trùng, cộng vào sẽ bịa cao hơn thực tế. */
  fixed: FleetSplit;
  event: FleetSplit;
}

/** Đội xe nền "đang có" — tham chiếu THẬT từ các kỳ event gần đây (a Làng). */
export interface BaseFleetRow { label: string; n: number; idle?: number; note?: string; ton: TonKey }
export const BASE_FLEET: BaseFleetRow[] = [
  { label: "Van 950kg", n: 40, ton: "van", note: "giao nội thành" },
  { label: "1.700kg", n: 10, ton: "t19" },
  { label: "1.900kg", n: 150, ton: "t19", note: "đội nền chủ lực — hiện chạy hết, không còn xe nằm bãi" },
  { label: "GHN tự có", n: 9, ton: "t50", note: "xe nhà >300.000km — GIỮ làm dự phòng phát sinh, cần gara dự phòng" },
];
export const BASE_FLEET_TOTAL = BASE_FLEET.reduce((a, r) => a + r.n, 0);

/** Trong xe GHN dự phòng ở trên, riêng phần LẤY HÀNG hiện có ~10 xe trống (không xếp lịch cố định) —
 *  số THAM CHIẾU Sếp cung cấp trực tiếp (không phải số live từ Sheet). Mỗi xe chạy được 2-3 lượt/ngày
 *  (khoảng, không phải số cố định — Sếp xác nhận lại 2026-07-21) -> dự phòng ra 1 KHOẢNG 20-30 lượt. */
export const RESERVE_PICKUP_IDLE = 10;
export const RESERVE_PICKUP_TRIPS_PER_VEH_MIN = 2;
export const RESERVE_PICKUP_TRIPS_PER_VEH_MAX = 3;
export const RESERVE_PICKUP_TRIPS_TOTAL_MIN = RESERVE_PICKUP_IDLE * RESERVE_PICKUP_TRIPS_PER_VEH_MIN;
export const RESERVE_PICKUP_TRIPS_TOTAL_MAX = RESERVE_PICKUP_IDLE * RESERVE_PICKUP_TRIPS_PER_VEH_MAX;
export const BASE_FLEET_IDLE = BASE_FLEET.reduce((a, r) => a + (r.idle || 0), 0);

const norm = (s: string) => (s || "").trim().toUpperCase().replace(/\s+/g, " ");

export async function loadFleetMix(signal?: AbortSignal): Promise<FleetMix> {
  // 1) Lịch tải toàn cụm -> đếm tuyến theo tải trọng + tách GHN/NCC + gom biển số (xe CỐ ĐỊNH).
  const inUse: Record<TonKey, number> = { van: 0, t19: 0, t50: 0, t80: 0 };
  let unknownLoad = 0;
  let fixedLay = 0, fixedOther = 0;
  const fixedBksGhn: string[] = [];
  const fixedBksNcc: string[] = [];
  // Loại vùng M12 không phụ trách (vd "Nội Vùng HCM" — xem EXCLUDED_REGION_KEYS trong config.ts)
  // khỏi TỔNG HỢP cụm — cùng chính sách đã áp cho nccFixedCapacity.ts, tránh đếm nhầm tuyến
  // ngoài phạm vi (hoặc dữ liệu tab đã đổi cấu trúc) thành "chưa ghi tải trọng".
  const regionData = await Promise.all(
    SHEETS.filter((s) => !EXCLUDED_REGION_KEYS.includes(s.key)).map((s) => loadSheet(s.gid, signal).catch(() => null))
  );
  for (const rd of regionData) {
    if (!rd) continue;
    for (const r of rd.routes) {
      const b = tonBucket(r.load);
      if (b) inUse[b]++;
      else unknownLoad++;
      // RÀ LẠI 2026-07-21 (v2, Sếp xác nhận sau khi soát lại đầy đủ): cột "Loại tuyến" CHỈ TỒN TẠI
      // trong sheet "Nội Thành HCM" — dùng category khi CÓ (443 tuyến), fallback theo TÊN TUYẾN chứa
      // "LAY" cho 4 sheet còn lại (không có cột category) — KHÔNG bỏ qua hoàn toàn như bản v1 (bản đó
      // bỏ sót tuyến Lấy thật ở MBH Sóng Thần/Tân Tạo, vd "SG_LAY_MHST_51-58"). Loại tuyến NỘI BỘ
      // (isNbRoute) khỏi CẢ 2 phía — chung kho, không phải tuyến vận chuyển thật.
      if (!isNbRoute(r.route)) {
        if (r.category) { if (isLayCategory(r.category)) fixedLay++; else fixedOther++; }
        else { if (isLayByName(r.route)) fixedLay++; else fixedOther++; }
      }
      if ((r.ncc || "").trim()) fixedBksNcc.push(r.bks || "");
      else fixedBksGhn.push(r.bks || "");
    }
  }
  const totalInUse = inUse.van + inUse.t19 + inUse.t50 + inUse.t80;
  const fixed: FleetSplit = {
    veh: vehCoverageOf([...fixedBksGhn, ...fixedBksNcc]),
    ghnVeh: vehCoverageOf(fixedBksGhn),
    nccVeh: vehCoverageOf(fixedBksNcc),
  };

  // 2) Tăng Cường (Lấy + Giao) -> đếm tuyến theo NCC, TÁCH RIÊNG Lấy/Giao + đủ 4 mức tải trọng +
  //    vùng/quận + biển số (xe EVENT). Dùng CHUNG 1 hàm cho kỳ hiện tại VÀ EVENT T6 (mục 3) để
  //    không lặp code — xem loadTcPeriod().
  const nccMap = new Map<string, { count: number; lay: number; giao: number; small: number; large: number; layTon: TonBreakdown; giaoTon: TonBreakdown; quans: Set<string> }>();
  let ghnTC = 0;
  let tcDate = "";
  const eventBksGhn: string[] = [];
  const eventBksNcc: string[] = [];
  // Route LIVE kèm from/to (RÀ LẠI 2026-07-21) — sheet "Tăng Cường" live KHÔNG có nhãn "kỳ event"
  // như "Lưu trữ TC Event" (chỉ là 1 sổ chép tay, không tách theo kỳ) nên có thể còn LẪN route của
  // NHIỀU kỳ khác nhau chưa dọn (vd Giao còn ghi ngày kỳ trước, Lấy đã sang kỳ mới) — giữ nguyên
  // from/to THẬT của từng route để nơi gọi (PlanEvent.tsx) tự lọc đúng khung ngày kỳ đang xem,
  // KHÔNG cộng dồn mù theo tổng cả sheet như trước.
  const liveRoutes: LiveTcRoute[] = [];
  try {
    const [tcLay, tcGiao] = await Promise.all([
      loadTangCuong(SHEET_ID, TANG_CUONG_LAY_GID, "Lấy", signal),
      loadTangCuong(SHEET_ID, TANG_CUONG_LAY_GID, "Giao", signal).catch(() => null),
    ]);
    tcDate = tcLay.date || tcGiao?.date || "";
    const tag = (routes: typeof tcLay.routes, kind: "lay" | "giao") => {
      for (const r of routes) {
        const name = norm(r.ncc);
        if (!name) continue;
        if (name === "GHN") { ghnTC++; eventBksGhn.push(r.bks); continue; }
        eventBksNcc.push(r.bks);
        liveRoutes.push({ code: r.code, ncc: name, tai: r.trongTai, from: r.from, to: r.to });
        let e = nccMap.get(name);
        if (!e) { e = { count: 0, lay: 0, giao: 0, small: 0, large: 0, layTon: emptyTonBreakdown(), giaoTon: emptyTonBreakdown(), quans: new Set() }; nccMap.set(name, e); }
        e.count++; e[kind]++;
        if (sizeClass(r.trongTai) === "large") e.large++; else e.small++;
        addTonBreakdown(kind === "lay" ? e.layTon : e.giaoTon, r.trongTai);
        for (const s of r.stops) { const q = (s.quan || "").trim(); if (q && !/kho/i.test(s.name)) e.quans.add(q); }
      }
    };
    tag(tcLay.routes, "lay");
    if (tcGiao) tag(tcGiao.routes, "giao");
  } catch { /* giữ rỗng nếu sheet chưa mở */ }
  const event: FleetSplit = {
    veh: vehCoverageOf([...eventBksGhn, ...eventBksNcc]),
    ghnVeh: vehCoverageOf(eventBksGhn),
    nccVeh: vehCoverageOf(eventBksNcc),
  };
  const ncc: NccCount[] = [...nccMap.entries()]
    .map(([name, v]) => ({ name, count: v.count, lay: v.lay, giao: v.giao, small: v.small, large: v.large, layTon: v.layTon, giaoTon: v.giaoTon, quans: [...v.quans].sort((a, b) => a.localeCompare(b, "vi")) }))
    .sort((a, b) => b.count - a.count);
  const totalNcc = ncc.reduce((a, r) => a + r.count, 0);
  const small = ncc.reduce((a, r) => a + r.small, 0);
  const large = ncc.reduce((a, r) => a + r.large, 0);
  const layTon = sumTonBreakdown(ncc.map((r) => r.layTon));
  const giaoTon = sumTonBreakdown(ncc.map((r) => r.giaoTon));

  // 3) EVENT T6 (tháng trước) -> tóm tắt để SO SÁNH số xe, CÙNG cấu trúc Lấy/Giao × tải trọng ở trên.
  let eventT6: PeriodSummary | null = null;
  try {
    const [l6, g6] = await Promise.all([
      loadTangCuong(SHEET_ID, EVENT_T6_GID, "Lấy", signal),
      loadTangCuong(SHEET_ID, EVENT_T6_GID, "Giao", signal).catch(() => null),
    ]);
    const m6 = new Map<string, number>();
    let ghn6Lay = 0, ghn6Giao = 0, small6 = 0, large6 = 0;
    const layTon6 = emptyTonBreakdown(), giaoTon6 = emptyTonBreakdown();
    const tag6 = (routes: typeof l6.routes, kind: "lay" | "giao") => {
      for (const r of routes) {
        const name = norm(r.ncc);
        if (!name) continue;
        if (name === "GHN") { if (kind === "lay") ghn6Lay++; else ghn6Giao++; continue; }
        m6.set(name, (m6.get(name) || 0) + 1);
        if (sizeClass(r.trongTai) === "large") large6++; else small6++;
        addTonBreakdown(kind === "lay" ? layTon6 : giaoTon6, r.trongTai);
      }
    };
    tag6(l6.routes, "lay"); if (g6) tag6(g6.routes, "giao");
    const byNcc = [...m6.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    const total6 = byNcc.reduce((a, r) => a + r.count, 0);
    if (total6 > 0 || ghn6Lay > 0 || ghn6Giao > 0) {
      eventT6 = {
        date: l6.date || g6?.date || "", totalNcc: total6, small: small6, large: large6,
        ghn: ghn6Lay + ghn6Giao, ghnLay: ghn6Lay, ghnGiao: ghn6Giao, nccCount: byNcc.length, byNcc,
        layTon: layTon6, giaoTon: giaoTon6, totalTon: sumTonBreakdown([layTon6, giaoTon6]),
      };
    }
  } catch { /* không có T6 -> bỏ so sánh */ }

  return { inUse, totalInUse, unknownLoad, fixedByDir: { lay: fixedLay, other: fixedOther }, ncc, ghnTC, totalNcc, small, large, layTon, giaoTon, tcDate, liveRoutes, eventT6, lastSync: Date.now(), fixed, event };
}
