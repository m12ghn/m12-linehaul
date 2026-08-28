/* ============================================================
   NĂNG LỰC CẤP XE CỐ ĐỊNH theo NCC × tải trọng × vùng — TÍNH TỪ
   LỊCH TẢI THẬT (không phải NCC tự khai ở tab TT NCC).

   Đọc RIÊNG ở cấp DÒNG CSV THÔ, KHÔNG tái dùng Route[] của loadSheet()
   (src/lib/sheet.ts): ở đó route.category chỉ giữ giá trị KHÔNG RỖNG
   ĐẦU TIÊN gặp được — 1 tuyến có thể có nhiều dòng gắn "Loại tuyến"
   khác nhau (tuyến bị liệt kê ở nhiều mục trong sheet) nên merge kiểu
   đó làm mất thông tin cần để loại trừ đúng. Ở đây gom lại TỰ, giữ
   FULL tập hợp Loại tuyến của từng tuyến.

   LOẠI TRỪ (đã chốt với Sếp — 3 điều kiện, HỢP tất cả):
   1) Toàn bộ vùng "Nội Vùng HCM" — M12 không phụ trách.
   2) Tuyến có ĐIỂM ĐẦU (dừng đầu tiên sau khi sắp theo giờ, xử lý qua
      đêm giống sheet.ts) = "Kho Trung Chuyển Hồ Chí Minh 01".
   3) Tuyến có BẤT KỲ dòng nào gắn Loại tuyến ∈ {Nội thành CK 1, Nội
      thành CK2, 01_FW_20}.
   Đã kiểm chứng trên dữ liệu thật (849 tuyến/6 vùng): loại 341, còn
   508 tuyến tính năng lực cố định.
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import { timeToMin, normalizeName } from "./normalize";
import { csvSources, SHEETS, EXCLUDED_REGION_KEYS } from "../config";
import { withRetry } from "./retry";
import { tonBucket, TON_ORDER, type TonKey } from "./fleetMix";
import { normNcc, isHouseOrJunk } from "./nccName";

const HCM01_KHO = normalizeName("Kho Trung Chuyển Hồ Chí Minh 01");
export const EXCLUDED_CATEGORIES = ["Nội thành CK 1", "Nội thành CK2", "01_FW_20"];
const EXCLUDED_CATEGORIES_NORM = EXCLUDED_CATEGORIES.map(normalizeName);

interface RawStop { kho: string; toi: string; roi: string }
interface RawRoute { route: string; load: string; ncc: string; cats: Set<string>; stops: RawStop[] }

async function fetchCsv(gid: string, signal?: AbortSignal): Promise<string> {
  return withRetry(async () => {
    for (const base of csvSources(gid)) {
      try {
        const url = base + (base.includes("?") ? "&" : "?") + "_=" + Date.now();
        const res = await fetch(url, { cache: "no-store", signal });
        if (!res.ok) continue;
        const text = await res.text();
        if (text.trim().length > 5 && !/^\s*<(!doctype html|!DOCTYPE|html)/i.test(text.slice(0, 200))) return text;
      } catch { /* thử nguồn kế */ }
    }
    throw new Error("Không tải được sheet " + gid);
  });
}

function groupRawRoutes(text: string): RawRoute[] {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const H = rows[0];
  const col = {
    // KHÔNG dùng "tuyen" trơ trọi: tab "Nội Thành HCM" có cột "Loại tuyến" khớp nhầm trước khi
    // rơi về fallback cột 0 (xem ghi chú đầy đủ ở sheet.ts, phát hiện 2026-08-04).
    route: (() => { const c = findCol(H, ["ten tuyen", "ma tuyen"]); return c >= 0 ? c : 0; })(),
    load: findCol(H, ["tai trong", "trong tai"]),
    kho: findCol(H, ["ten kho", "kho", "buu cuc"]),
    toi: findCol(H, ["toi diem", "gio toi", "gio den"]),
    roi: findCol(H, ["roi diem", "gio roi", "gio di"]),
    cat: findCol(H, ["loai tuyen"]),
    ncc: findCol(H, ["ncc"]),
  };
  const g = (r: string[], idx: number) => (idx >= 0 && idx < r.length ? (r[idx] || "").trim() : "");
  const map = new Map<string, RawRoute>();
  for (const r of rows.slice(1)) {
    const routeName = g(r, col.route);
    const kho = g(r, col.kho);
    if (!routeName && !kho) continue;
    const key = routeName || "(Không tên)";
    if (!map.has(key)) map.set(key, { route: key, load: "", ncc: "", cats: new Set(), stops: [] });
    const rt = map.get(key)!;
    if (!rt.load && g(r, col.load)) rt.load = g(r, col.load);
    if (!rt.ncc && g(r, col.ncc)) rt.ncc = g(r, col.ncc);
    if (g(r, col.cat)) rt.cats.add(g(r, col.cat));
    rt.stops.push({ kho, toi: g(r, col.toi), roi: g(r, col.roi) });
  }
  const routes = [...map.values()];
  // Sắp điểm dừng theo giờ tới — CÙNG logic overnight với sheet.ts (để "điểm đầu" khớp
  // đúng thứ tự lộ trình thật, không bị đảo bởi giờ rạng sáng của tuyến qua đêm).
  routes.forEach((rt) => {
    const hasLate = rt.stops.some((s) => { const m = timeToMin(s.toi || s.roi); return m !== 999999 && m >= 18 * 60; });
    const hasEarly = rt.stops.some((s) => timeToMin(s.toi || s.roi) < 6 * 60);
    const overnight = hasLate && hasEarly;
    const tkey = (s: RawStop) => { const m = timeToMin(s.toi || s.roi); return overnight && m < 6 * 60 ? m + 1440 : m; };
    rt.stops.sort((a, b) => tkey(a) - tkey(b));
  });
  return routes;
}

function isExcludedByRule2or3(rt: RawRoute): boolean {
  const firstKho = rt.stops[0]?.kho || "";
  if (normalizeName(firstKho) === HCM01_KHO) return true;
  return [...rt.cats].some((c) => EXCLUDED_CATEGORIES_NORM.includes(normalizeName(c)));
}

export interface NccUsageRow { name: string; routes: number; stops: number }
export interface NccCapacityCell { name: string; region: string; ton: TonKey; cot: number }
export interface NccCapacityData {
  usage: NccUsageRow[];         // TOÀN BỘ 6 vùng, KHÔNG loại trừ -> xếp "NCC đang dùng nhiều/ít"
  capacity: NccCapacityCell[];  // ĐÃ áp loại trừ -> năng lực cố định theo tải trọng × vùng
  excludedRoutes: number;
  totalRoutes: number;
  lastSync: number;
}

/** Tải + tính năng lực cấp xe cố định từ lịch tải thật (6 vùng, gọi trực tiếp — không qua cache loadSheet). */
export async function loadNccFixedCapacity(signal?: AbortSignal): Promise<NccCapacityData> {
  // BỎ NGAY TỪ ĐẦU vùng bị loại trừ (Nội Vùng HCM — tab đã đổi cấu trúc, KHÔNG còn dữ liệu tuyến,
  // Sếp báo 2026-08-25 Dash "load mãi": tab này giờ không tồn tại nữa ở Google Sheets API (404),
  // trước đây vẫn CỐ fetch nó rồi mới loại ở bước tổng hợp bên dưới -> tốn 3 lần thử lại (gviz/export
  // dự phòng cũng lỗi vì bị chặn đăng nhập) mỗi lần Performance NCC tải dữ liệu, gây chậm/kẹt tải.
  // Không cần đếm excludedRoutes cho vùng này nữa vì nó KHÔNG PHẢI route data để mà đếm.
  const regionData = await Promise.all(
    SHEETS.filter((s) => !EXCLUDED_REGION_KEYS.includes(s.key)).map(async (s) => {
      try { return { key: s.key, label: s.label, routes: groupRawRoutes(await fetchCsv(s.gid, signal)) }; }
      catch { return { key: s.key, label: s.label, routes: [] as RawRoute[] }; }
    })
  );

  const usageMap = new Map<string, NccUsageRow>();
  const capMap = new Map<string, NccCapacityCell>();
  let excludedRoutes = 0, totalRoutes = 0;

  for (const region of regionData) {
    const regionExcluded = EXCLUDED_REGION_KEYS.includes(region.key);
    for (const rt of region.routes) {
      // RÀ LẠI 2026-07-21 (Sếp báo "Lịch tải đang tính sai"): vùng bị loại trừ (Nội Vùng HCM — tab đã
      // đổi cấu trúc, KHÔNG còn là dữ liệu tuyến) phải bỏ NGAY TỪ ĐẦU, kể cả phần "NCC đang dùng" bên
      // dưới — trước đây chỉ bỏ ở bước tính năng lực (2), khiến "NCC đang dùng" vẫn lẫn tên rác đọc
      // nhầm từ cột "NCC" của bảng BC↔NCC↔chat_id (cấu trúc khác hoàn toàn "Loại tuyến"/NCC thật).
      if (regionExcluded) { excludedRoutes++; continue; }
      totalRoutes++;
      const nccName = normNcc(rt.ncc);
      if (isHouseOrJunk(nccName)) continue; // GHN/nội bộ/chưa gán -> không phải NCC thuê ngoài

      // 1) "NCC đang dùng" — đếm mọi tuyến CÒN LẠI sau khi đã loại vùng không phụ trách ở trên
      //    (để xếp thứ tự danh sách).
      let u = usageMap.get(nccName);
      if (!u) { u = { name: nccName, routes: 0, stops: 0 }; usageMap.set(nccName, u); }
      u.routes++; u.stops += rt.stops.length;

      // 2) Năng lực CỐ ĐỊNH — áp thêm 2 điều kiện loại trừ còn lại (vùng đã loại ở trên rồi).
      if (isExcludedByRule2or3(rt)) { excludedRoutes++; continue; }
      const ton = tonBucket(rt.load);
      if (!ton) continue;
      const ck = `${nccName}|${region.label}|${ton}`;
      let c = capMap.get(ck);
      if (!c) { c = { name: nccName, region: region.label, ton, cot: 0 }; capMap.set(ck, c); }
      c.cot += rt.stops.length; // "cột" = 1 dòng/điểm dừng = 1 cột (đã chốt với Sếp)
    }
  }

  const usage = [...usageMap.values()].sort((a, b) => b.stops - a.stops);
  const capacity = [...capMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "vi") || TON_ORDER.indexOf(a.ton) - TON_ORDER.indexOf(b.ton) || a.region.localeCompare(b.region, "vi")
  );
  return { usage, capacity, excludedRoutes, totalRoutes, lastSync: Date.now() };
}

let fwRouteNamesCache: Set<string> | null = null;
/** Set TÊN tuyến (chưa normCode, gọi normCode ở nơi dùng) gắn Loại tuyến "01_FW_20" ở BẤT KỲ
 *  dòng nào (1 tuyến có thể có nhiều Loại tuyến khác nhau theo dòng, xem comment groupRawRoutes) —
 *  dùng để loại khỏi báo cáo TLLD cụm (xem src/lib/tlldExclude.ts), CÙNG quy tắc "01_FW_20 không
 *  thuộc M12" đã chốt với Sếp ở EXCLUDED_CATEGORIES phía trên. */
export async function loadFwRouteNames(signal?: AbortSignal): Promise<Set<string>> {
  if (fwRouteNamesCache) return fwRouteNamesCache;
  const target = normalizeName("01_FW_20");
  const regionRoutes = await Promise.all(
    SHEETS.filter((s) => !EXCLUDED_REGION_KEYS.includes(s.key)).map(async (s) => { try { return groupRawRoutes(await fetchCsv(s.gid, signal)); } catch { return [] as RawRoute[]; } })
  );
  const s = new Set<string>();
  for (const routes of regionRoutes) for (const rt of routes) if ([...rt.cats].some((c) => normalizeName(c) === target)) s.add(rt.route);
  fwRouteNamesCache = s;
  return s;
}
