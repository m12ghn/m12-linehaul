/* ============================================================
   "Lưu trữ TC EVENT" — lịch TĂNG CƯỜNG CỐ ĐỊNH, TÍCH LUỸ NHIỀU KỲ EVENT
   (mỗi kỳ đánh dấu bằng cột "EVENT", vd "7/7", "6/6", "15/7", "15/6"…).
   Mỗi mã lịch trình (SG_TCEV_xx) = 1 XE, có thể nhiều dòng (điểm dừng) ->
   gộp theo mã, lấy field không rỗng đầu tiên tìm thấy giữa các dòng.
   - "Đã điều được xe" = ô BSX/Gửi tin có biển số HOẶC ghi "Đáp ứng".
   - Đọc cột theo TÊN (findCol), không hardcode vị trí — sheet từng đổi cột
     (chèn thêm "EVENT"+"Loại tải" ở đầu từng làm lệch hết index cũ) nên
     PHẢI tra theo tên để khỏi lặp lại lỗi đọc nhầm NCC/ngày/mã tuyến.
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import { SHEET_ID, TC_EVENT_GID, sheetCsvSources } from "../config";

const RE_PLATE = /\d{2}\s?[A-Za-z]{1,2}[-.\s]?\d{3}/; // biển số xe VN

export interface TcEvRoute {
  code: string;   // Tên lịch trình (SG_TCEV_xx…)
  event: string;  // nhãn kỳ event (cột "EVENT", vd "7/7")
  ncc: string;    // nhà cung cấp
  from: string;   // Từ ngày (thô, dd/mm/yy)
  to: string;     // Đến ngày (thô)
  ok: boolean;    // đã điều được xe (có biển số / "Đáp ứng")
  tai: string;    // Trọng tải (cột "Trọng tải", vd "1900"/"5000"/"8000") — dùng để lọc tuyến trục ≥5.000kg
}
export interface TcEvData { routes: TcEvRoute[]; allRoutes: TcEvRoute[]; mainBucket: string; ok: boolean; lastSync: number; }

async function fetchFirst(signal?: AbortSignal): Promise<string | null> {
  for (const base of sheetCsvSources(SHEET_ID, TC_EVENT_GID)) {
    try {
      const res = await fetch(base + (base.includes("?") ? "&" : "?") + "_=" + Date.now(), { cache: "no-store", signal });
      if (res.ok) {
        const t = await res.text();
        if (t.trim().length > 5 && !/^\s*<!doctype html|requires you to sign in|Unauthorized/i.test(t.slice(0, 200))) return t;
      }
    } catch { /* nguồn kế tiếp */ }
  }
  return null;
}

export async function loadTcEvent(signal?: AbortSignal): Promise<TcEvData> {
  const text = await fetchFirst(signal);
  if (!text) return { routes: [], allRoutes: [], mainBucket: "", ok: false, lastSync: Date.now() };
  const rows = parseCSV(text);
  if (rows.length < 2) return { routes: [], allRoutes: [], mainBucket: "", ok: false, lastSync: Date.now() };
  const H = rows[0];
  const g = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] || "").trim() : "");

  // Tra theo TÊN cột; fallback về vị trí hiện tại nếu không thấy (sheet đổi tên cột).
  const cEvent = (() => { const c = findCol(H, ["event"]); return c >= 0 ? c : 0; })();
  const cCode = (() => { const c = findCol(H, ["ten lich trinh"]); return c >= 0 ? c : 2; })();
  const cFrom = (() => { const c = findCol(H, ["tu ngay"]); return c >= 0 ? c : 8; })();
  const cTo = (() => { const c = findCol(H, ["den ngay"]); return c >= 0 ? c : 9; })();
  const cNcc = (() => { const c = findCol(H, ["ncc"]); return c >= 0 ? c : 12; })(); // "ncc" khớp đúng trước "ncc cu 1/2/3"
  const cGuiTin = (() => { const c = findCol(H, ["gui tin"]); return c >= 0 ? c : 18; })();
  const cBsx = (() => { const c = findCol(H, ["bsx"]); return c >= 0 ? c : 19; })();
  const cTai = (() => { const c = findCol(H, ["trong tai"]); return c >= 0 ? c : 3; })();

  // Gom theo (MÃ + KỲ EVENT) — mã lịch trình (vd SG_TCEV_01) LẶP LẠI ở NHIỀU kỳ event
  // khác nhau (mỗi kỳ tự có NCC/ngày/xe riêng), nên gộp CHỈ theo mã sẽ trộn lẫn dữ liệu
  // của các kỳ khác nhau vào 1 route. 1 mã có thể nhiều dòng/điểm dừng trong CÙNG 1 kỳ
  // -> lấy field không rỗng đầu tiên giữa các dòng đó.
  const map = new Map<string, TcEvRoute>();
  for (const r of rows.slice(1)) {
    const code = g(r, cCode);
    if (!code) continue;
    const event = g(r, cEvent);
    const key = code + "‖" + event;
    let rt = map.get(key);
    if (!rt) { rt = { code, event, ncc: "", from: "", to: "", ok: false, tai: "" }; map.set(key, rt); }
    if (!rt.ncc && g(r, cNcc)) rt.ncc = g(r, cNcc);
    if (!rt.from && g(r, cFrom)) rt.from = g(r, cFrom);
    if (!rt.to && g(r, cTo)) rt.to = g(r, cTo);
    if (!rt.tai && g(r, cTai)) rt.tai = g(r, cTai);
    const blob = g(r, cGuiTin) + " " + g(r, cBsx);
    if (/đáp ứng/i.test(blob) || RE_PLATE.test(blob)) rt.ok = true;
  }
  const allRoutes = [...map.values()];

  // Kỳ event HIỆN TẠI = nhãn EVENT mới nhất theo ngày Từ (fallback: batch ngày phổ biến nhất
  // cho các dòng chưa gán nhãn EVENT — dữ liệu cũ trước khi sheet có cột này).
  const byDateDesc = (a: string, b: string) => parseDate(b) - parseDate(a);
  const labeled = allRoutes.filter((rt) => rt.event);
  let mainBucket = "";
  let routes: TcEvRoute[];
  if (labeled.length) {
    const latestEvent = [...labeled].sort((a, b) => byDateDesc(a.from, b.from))[0].event;
    routes = allRoutes.filter((rt) => rt.event === latestEvent);
    const first = routes.find((r) => r.from);
    mainBucket = first ? `${first.from}→${first.to}` : latestEvent;
  } else {
    const bucket = new Map<string, number>();
    for (const rt of allRoutes) if (rt.from) { const k = rt.from + "→" + rt.to; bucket.set(k, (bucket.get(k) || 0) + 1); }
    mainBucket = [...bucket.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    routes = allRoutes.filter((rt) => (rt.from ? rt.from + "→" + rt.to === mainBucket : !rt.to));
  }
  return { routes, allRoutes, mainBucket, ok: true, lastSync: Date.now() };
}

function parseDate(s: string): number {
  const m = (s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return 0;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(y, Number(m[2]) - 1, Number(m[1])).getTime();
}

export interface TcEvNcc { ncc: string; xe: number; ok: number; rate: number; }
export interface TcEvStats { totalXe: number; okXe: number; rate: number; byNcc: TcEvNcc[]; }

/** Tổng xe + tỷ lệ điều được + gom theo NCC. */
export function tcEventStats(routes: TcEvRoute[]): TcEvStats {
  const totalXe = routes.length;
  const okXe = routes.filter((r) => r.ok).length;
  const m = new Map<string, { xe: number; ok: number }>();
  for (const r of routes) {
    const n = (r.ncc || "(chưa gán)").toUpperCase().trim();
    let x = m.get(n);
    if (!x) { x = { xe: 0, ok: 0 }; m.set(n, x); }
    x.xe++; if (r.ok) x.ok++;
  }
  const byNcc = [...m.entries()]
    .map(([ncc, x]) => ({ ncc, xe: x.xe, ok: x.ok, rate: x.xe ? x.ok / x.xe : 0 }))
    .sort((a, b) => b.xe - a.xe);
  return { totalXe, okXe, rate: totalXe ? okXe / totalXe : 0, byNcc };
}

/* ============================================================
   PHÂN TÍCH NHIỀU KỲ EVENT (theo tháng) — dùng allRoutes (mọi kỳ đã lưu).
   Gom theo nhãn "EVENT", suy ra tháng từ ngày Từ, sắp theo thời gian.
   ============================================================ */
export interface TcEventPeriod {
  event: string;      // nhãn gốc, vd "7/7"
  monthKey: string;   // "yyyy-mm" suy từ ngày Từ
  fromIso: string; toIso: string; // ISO để sắp xếp/hiển thị
  label: string;       // "06/07–09/07/2026"
  stats: TcEvStats;
}

/** Xuất công khai để `vehicleElasticity.ts` dùng lại (tránh viết trùng hàm parse ngày dd/mm/yy). */
export function toIsoDMY(s: string): string {
  const m = (s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return "";
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
const ddmmyyyy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

/** Gom TOÀN BỘ dữ liệu đã lưu thành các kỳ event riêng biệt, sắp theo thời gian (cũ -> mới). */
export function buildEventPeriods(allRoutes: TcEvRoute[]): TcEventPeriod[] {
  const byEvent = new Map<string, TcEvRoute[]>();
  for (const r of allRoutes) {
    const key = r.event || (r.from ? `${r.from}→${r.to}` : "");
    if (!key) continue;
    const a = byEvent.get(key); if (a) a.push(r); else byEvent.set(key, [r]);
  }
  const periods: TcEventPeriod[] = [];
  for (const [event, rs] of byEvent) {
    // BUG ĐÃ SỬA (2026-07-21): trước đây lấy from/to của "route ĐẦU TIÊN gặp" (thứ tự bất kỳ trong
    // sheet) làm đại diện cho CẢ kỳ — nhiều route CÙNG 1 nhãn event có thể chạy khác ngày nhau (vd
    // route A chạy 6/7-7/7, route B chạy 7/7-8/7, cùng gắn nhãn "7/7") nên chỉ lấy 1 route đại diện
    // cho ra khung ngày SAI (có thể hẹp hơn hoặc lệch so thực tế). Nay lấy MIN(from) và MAX(to) trên
    // TOÀN BỘ route của kỳ để ra đúng khung ngày THẬT kỳ đó đã chạy.
    const froms = rs.map((r) => toIsoDMY(r.from)).filter(Boolean).sort();
    const tos = rs.map((r) => toIsoDMY(r.to) || toIsoDMY(r.from)).filter(Boolean).sort();
    const fromIso = froms[0] || "";
    const toIso = tos[tos.length - 1] || "";
    if (!fromIso) continue; // không xác định được ngày -> bỏ (không suy đoán)
    periods.push({
      event, monthKey: fromIso.slice(0, 7), fromIso, toIso,
      label: `${ddmmyyyy(fromIso)}–${ddmmyyyy(toIso)}`.replace(/(\d{2}\/\d{2})\/\d{4}–/, "$1–"),
      stats: tcEventStats(rs),
    });
  }
  periods.sort((a, b) => a.fromIso.localeCompare(b.fromIso));
  return periods;
}

/** Liệt kê MỌI ngày ISO liên tục từ fromIso đến toIso (bao gồm 2 đầu). */
function isoDaysBetween(fromIso: string, toIso: string): string[] {
  if (!fromIso) return [];
  const end = toIso || fromIso;
  const out: string[] = [];
  const d = new Date(fromIso + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  while (d <= endD) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export interface TcEventDayBreakdown<T = TcEvRoute> { dateIso: string; label: string; routes: T[] }
/**
 * Chia 1 danh sách route CÓ from/to (route[] đã lưu trữ với nhãn event, HOẶC route live tăng cường
 * đã lọc đúng khung ngày kỳ — xem `tangcuong.ts`'s `TCRoute.from/to`, khuyến nghị đã loại GHN trước
 * khi gọi) thành TỪNG NGÀY THẬT — mỗi route dùng ĐÚNG from/to của CHÍNH NÓ (không phải khung ngày
 * chung giả định, vì các route cùng 1 nhãn event/cùng 1 sheet có thể chạy khác ngày nhau — xem bug
 * đã sửa ở `buildEventPeriods()`). TỔNG QUÁT HOÁ 2026-07-21 (nhận bất kỳ route nào có {from,to} —
 * dùng chung được cho cả `TcEvRoute` (đã lưu trữ) lẫn `TCRoute` (live, chưa lưu trữ)). Trả về NGÀY
 * LIÊN TỤC từ ngày sớm nhất tới ngày trễ nhất (kể cả ngày không route nào chạy, để phần "phát sinh"
 * filter theo cùng khung ngày này vẫn khớp đúng).
 */
export function dailyBreakdown<T extends { from: string; to: string }>(routes: T[]): TcEventDayBreakdown<T>[] {
  const withRange = routes
    .map((r) => ({ r, f: toIsoDMY(r.from), t: toIsoDMY(r.to) || toIsoDMY(r.from) }))
    .filter((x) => x.f);
  if (!withRange.length) return [];
  const froms = withRange.map((x) => x.f).sort();
  const tos = withRange.map((x) => x.t).sort();
  const minF = froms[0], maxT = tos[tos.length - 1];
  return isoDaysBetween(minF, maxT).map((dateIso) => ({
    dateIso,
    label: `${dateIso.slice(8)}/${dateIso.slice(5, 7)}`,
    routes: withRange.filter((x) => x.f <= dateIso && dateIso <= x.t).map((x) => x.r),
  }));
}

export interface TcEventPair { a: TcEventPeriod; b: TcEventPeriod; ordinal: number } // a = kỳ trước (tháng trước), b = kỳ này (tháng này)
/**
 * Ghép "kỳ thứ N trong tháng" giữa 2 tháng LIÊN TIẾP gần nhất có dữ liệu — vd kỳ 1
 * (đầu tháng) tháng này vs kỳ 1 tháng trước, kỳ 2 (giữa tháng) tháng này vs kỳ 2
 * tháng trước… Ghép theo THỨ TỰ xuất hiện trong tháng (không đoán ý nghĩa ngày),
 * nên tự đúng dù tháng sau đổi lịch event khác đi.
 */
export function pairLatestTwoMonths(periods: TcEventPeriod[]): TcEventPair[] {
  const months = [...new Set(periods.map((p) => p.monthKey))].sort();
  if (months.length < 2) return [];
  const [prevM, curM] = months.slice(-2);
  const prevList = periods.filter((p) => p.monthKey === prevM).sort((x, y) => x.fromIso.localeCompare(y.fromIso));
  const curList = periods.filter((p) => p.monthKey === curM).sort((x, y) => x.fromIso.localeCompare(y.fromIso));
  const n = Math.min(prevList.length, curList.length);
  const out: TcEventPair[] = [];
  for (let i = 0; i < n; i++) out.push({ a: prevList[i], b: curList[i], ordinal: i + 1 });
  return out;
}
