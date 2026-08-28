/* ============================================================
   Đọc 1 tab Google Sheet -> danh sách Route đã gom + khớp toạ độ.
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import { lookupCoord } from "./geo";
import { csvSources, CATEGORY_ORDER } from "../config";
import { withRetry } from "./retry";
import { fetchWithTimeout } from "./fetchTimeout";
import type { Route, Stop } from "../types";

class SheetPrivateError extends Error {}

/** Làm sạch biển số từ sheet lịch tải: bỏ tiền tố "_" (chống Sheets tự định dạng),
 *  viết hoa, chèn dấu "-" giữa cụm chữ và số. Vd "_50H19133" -> "50H-19133". */
function cleanBks(s: string): string {
  const x = (s || "").replace(/^[_\s]+/, "").replace(/\s+/g, "").toUpperCase();
  const m = x.match(/^(\d{2}[A-Z]{1,2})[-.]?(\d{3,6})$/);
  return m ? `${m[1]}-${m[2]}` : x;
}

/** Thử lần lượt các nguồn CSV cho tới khi 1 nguồn chạy được (1 lượt). */
async function fetchCsvOnce(gid: string, signal?: AbortSignal): Promise<string> {
  let lastErr: unknown;
  for (const base of csvSources(gid)) {
    try {
      const url = base + (base.includes("?") ? "&" : "?") + "_=" + Date.now();
      const res = await fetchWithTimeout(url, { cache: "no-store", signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      const head = text.slice(0, 500);
      // HTML = sheet riêng tư / Google chặn / SPA fallback (index.html) -> KHÔNG parse thành tuyến.
      if (/^\s*<(!doctype html|!DOCTYPE|html)/i.test(head) || /requires you to sign in|Unauthorized|Temporarily unavailable/i.test(head))
        throw new SheetPrivateError("PRIVATE");
      if (text.trim().length < 5) throw new Error("Sheet trống");
      return text;
    } catch (e) {
      if (e instanceof SheetPrivateError) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error("Không có nguồn dữ liệu");
}

/** Như trên nhưng TỰ THỬ LẠI khi lỗi tạm thời (kể cả Google chớp nhoáng trả trang đăng nhập). */
function fetchCsv(gid: string, signal?: AbortSignal): Promise<string> {
  return withRetry(() => fetchCsvOnce(gid, signal));
}

export interface ParsedSheet {
  routes: Route[];
  categories: string[];
  missingGeo: string[];
}

/** Sắp xếp danh mục theo CATEGORY_ORDER, phần còn lại theo alphabet. */
function sortCategories(values: string[]): string[] {
  return [...values].sort((a, b) => {
    let ia = CATEGORY_ORDER.indexOf(a);
    let ib = CATEGORY_ORDER.indexOf(b);
    if (ia < 0) ia = 999;
    if (ib < 0) ib = 999;
    return ia - ib || a.localeCompare(b, "vi");
  });
}

// ----- CACHE + GỘP REQUEST (tránh tải lại sheet khi chuyển mục / nhiều nơi cùng cần) -----
const SHEET_TTL = 40000; // 40s: còn realtime (poll 60s) nhưng chuyển mục/đổi vùng dùng lại ngay.
const sheetCache = new Map<string, { at: number; data: ParsedSheet }>();
const sheetInflight = new Map<string, Promise<ParsedSheet>>();

/** Tải 1 tab sheet — có cache TTL + gộp request trùng. force=true để bỏ qua cache (làm mới tay). */
export async function loadSheet(gid: string, signal?: AbortSignal, force = false): Promise<ParsedSheet> {
  if (!force) {
    const c = sheetCache.get(gid);
    if (c && Date.now() - c.at < SHEET_TTL) return c.data;
    const p = sheetInflight.get(gid);
    if (p) return p; // đang tải gid này -> dùng chung promise
  }
  const run = loadSheetUncached(gid, signal).then((data) => {
    sheetCache.set(gid, { at: Date.now(), data });
    return data;
  });
  sheetInflight.set(gid, run);
  try { return await run; } finally { sheetInflight.delete(gid); }
}

async function loadSheetUncached(gid: string, signal?: AbortSignal): Promise<ParsedSheet> {
  const text = await fetchCsv(gid, signal);
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("Sheet trống");

  const H = rows[0];
  const col = {
    // Các tab có bố cục cột khác nhau -> dò theo từ khoá tiêu đề.
    // Tab "MBH Tân Tạo" để trống tiêu đề cột tuyến -> fallback về cột 0.
    // KHÔNG dùng từ khoá "tuyen" trơ trọi làm fallback: tab "Nội Thành HCM" có cột "Loại tuyến"
    // (vd "Nội thành CA1", chỉ 12 giá trị) và cột Tên Tuyến thật lại để trống tiêu đề (cột 0) ->
    // "tuyen" khớp nhầm substring vào "Loại tuyến" TRƯỚC KHI rơi về fallback cột 0, gộp nhầm 428
    // mã tuyến thật (SG_CA1_001, SG_CA1_002...) thành 12 "tuyến" khổng lồ theo Loại tuyến (đã xác
    // nhận trên dữ liệu thật 2026-08-04, Sếp phát hiện qua tuyến "Nội thành CA1" 142 điểm dừng).
    route: (() => { const c = findCol(H, ["ten tuyen", "ma tuyen"]); return c >= 0 ? c : 0; })(),
    load: findCol(H, ["tai trong", "trong tai"]),
    kho: findCol(H, ["ten kho", "kho", "buu cuc"]),
    loaiHinh: findCol(H, ["loai hinh"]),
    toi: findCol(H, ["toi diem", "gio toi", "gio den"]),
    roi: findCol(H, ["roi diem", "gio roi", "gio di"]),
    cat: findCol(H, ["loai tuyen"]),
    id: findCol(H, ["id"]),
    ncc: findCol(H, ["ncc"]),
    bks: findCol(H, ["bks", "bien so"]),
  };
  const g = (r: string[], idx: number) => (idx >= 0 && idx < r.length ? (r[idx] || "").trim() : "");

  const missing = new Set<string>();
  const map = new Map<string, Route>();

  for (const r of rows.slice(1)) {
    const routeName = g(r, col.route);
    const kho = g(r, col.kho);
    if (!routeName && !kho) continue;
    const key = routeName || "(Không tên)";
    if (!map.has(key)) {
      map.set(key, { route: key, load: g(r, col.load), category: g(r, col.cat), ncc: "", bks: "", stops: [], mappedCount: 0 });
    }
    const route = map.get(key)!;
    if (!route.load && g(r, col.load)) route.load = g(r, col.load);
    if (!route.category && g(r, col.cat)) route.category = g(r, col.cat);
    if (!route.ncc && g(r, col.ncc)) route.ncc = g(r, col.ncc);
    if (!route.bks && g(r, col.bks)) route.bks = cleanBks(g(r, col.bks));

    const coord = lookupCoord(kho);
    if (kho) {
      if (coord) route.mappedCount++;
      else missing.add(kho);
    }
    const stop: Stop = {
      kho,
      loaiHinh: g(r, col.loaiHinh),
      toi: g(r, col.toi),
      roi: g(r, col.roi),
      coord,
      id: g(r, col.id),
    };
    route.stops.push(stop);
  }

  const routes = [...map.values()];
  routes.forEach((rt) => {
    // BỎ điểm TRÙNG HỆT (cùng kho + loại hình + giờ tới + giờ rời + id).
    // Lý do: 1 tuyến có thể được liệt kê ở NHIỀU "Loại tuyến" trong sheet (vd SG_LAY01_111 ở cả
    // "Lấy HCM01" và "GHN") -> nếu không lọc sẽ bị nhân đôi số điểm dừng.
    const seen = new Set<string>();
    rt.stops = rt.stops.filter((s) => {
      const sig = `${s.kho}|${s.loaiHinh}|${s.toi}|${s.roi}|${s.id || ""}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
    rt.mappedCount = rt.stops.filter((s) => s.coord).length;
    // KHÔNG tự sắp lại điểm dừng theo giờ nữa (đã bỏ, 2026-07-20 — sếp phát hiện đảo lộ trình).
    // Lý do: tuyến liên vùng (MBH...) thường chạy XUYÊN NHIỀU NGÀY, Sheet KHÔNG có cột ngày riêng
    // cho từng điểm dừng — chỉ có giờ trong ngày. Cách cũ cộng 24h cho giờ "<6h" khi tuyến có giờ
    // muộn (≥18h) chỉ xử lý được ĐÚNG 1 lần qua đêm; tuyến 2-3+ ngày (vd rời kho lúc 18h, tới điểm
    // kế NGÀY HÔM SAU lúc 7h/10h/11h — qua ngưỡng 6h nên KHÔNG được cộng 24h) bị hiểu nhầm là "sớm
    // hơn trong cùng ngày" -> đẩy lên đầu, đảo ngược thứ tự thật (vd tuyến MHQ7_HY_01: rời HCM 22:30
    // → Sóng Thần 0:10 → Hưng Yên 10:50 → Hà Nội 13:50, bị đảo thành Hưng Yên → Hà Nội → HCM → Sóng
    // Thần). Đối chiếu dữ liệu thật: thứ tự GỐC trong Sheet (theo dòng nhập) đã đúng trình tự thật —
    // giữ nguyên thứ tự đó (ops nhập tuần tự theo lộ trình thật) thay vì đoán lại bằng giờ.
  });

  const categories = sortCategories([...new Set(routes.map((r) => r.category).filter(Boolean))]);
  return { routes, categories, missingGeo: [...missing].sort((a, b) => a.localeCompare(b, "vi")) };
}
