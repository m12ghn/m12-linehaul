/* ============================================================
   Phân tích BIẾN ĐỘNG sản lượng LẤY HÀNG theo bưu cục (cụm M12).
   Nguồn: tab "ST LAY BC" trong workbook chính (SHEET_ID, gid=BC_LAY_GID) — 1 dòng = 1 BC × 1 ngày.

   Mục tiêu: chỉ ra BC có sản lượng LỆCH NHIỀU giữa các ngày thường T2-T6
   (loại T7/CN/event vì đó là chu kỳ dự đoán được, không phải biến động
   thực sự cần lo). Đo bằng CV = std/mean; ngưỡng >50% coi là "Rất cao".

   Tuân quy tắc "không bịa số": BC thiếu ngày → tính thẳng theo ngày có
   data, KHÔNG nội suy; BC dưới ngưỡng mẫu → LOẠI KHỎI xếp hạng thay vì
   ép ra 1 con số CV nhiễu.
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import { withRetry } from "./retry";
import { bcLayCsvSources } from "../config";

/** 1 dòng dữ liệu gốc — 1 BC × 1 ngày lấy hàng. */
export interface BcRow {
  dt: string;         // YYYY-MM-DD
  wid: string;
  wname: string;
  vol: number;        // số đơn
  kg: number;         // khối lượng
}

export interface BcLayData {
  rows: BcRow[];
  lastSync: number;
}

/** Phân loại 1 ngày để tách biến động (WEEKDAY) khỏi chu kỳ (SAT/SUN) và event. */
export type Bucket = "WEEKDAY" | "SAT" | "SUN" | "EVENT";

/** 4 khu vực trọng điểm (theo yêu cầu Sếp). */
export type Loc = "HCM" | "Thủ Đức" | "Thuận An" | "Dĩ An";
export const LOCS: Loc[] = ["HCM", "Thủ Đức", "Thuận An", "Dĩ An"];

/** Phân loại ngày:
 *  - Event: ngày đôi (dd==mm), ngày 15, ngày 25 hàng tháng, KÉO DÀI thêm 1 ngày sau đó.
 *  - Thứ 7 / Chủ nhật: chu kỳ tuần.
 *  - Còn lại (T2-T6 không event): WEEKDAY — DÙNG ĐỂ ĐO BIẾN ĐỘNG.
 */
export function classifyDate(dt: string): Bucket {
  const [Y, M, D] = dt.split("-").map(Number);
  const utc = new Date(Date.UTC(Y, M - 1, D));
  const dow = utc.getUTCDay(); // 0=CN, 6=T7
  const isEventBase = (mm: number, dd: number) => dd === mm || dd === 15 || dd === 25;
  const yestUtc = new Date(Date.UTC(Y, M - 1, D - 1));
  const yestM = yestUtc.getUTCMonth() + 1;
  const yestD = yestUtc.getUTCDate();
  if (isEventBase(M, D) || isEventBase(yestM, yestD)) return "EVENT";
  if (dow === 0) return "SUN";
  if (dow === 6) return "SAT";
  return "WEEKDAY";
}

/** Ngày trong tuần dạng chữ ngắn (dùng khi hiển thị dẫn chứng). */
export function dowOf(dt: string): number {
  const [Y, M, D] = dt.split("-").map(Number);
  return new Date(Date.UTC(Y, M - 1, D)).getUTCDay();
}
export function dowLabel(d: number): string {
  return ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][d];
}

/** Rút khu vực từ tên BC. Ưu tiên Thủ Đức > Thuận An > Dĩ An > HCM (từ độc lập). */
export function locOf(name: string): Loc | null {
  const n = name || "";
  if (/Thủ Đức|Thu Duc/i.test(n)) return "Thủ Đức";
  if (/Thuận An|Thuan An/i.test(n)) return "Thuận An";
  if (/Dĩ An|Di An/i.test(n)) return "Dĩ An";
  if (/\bHCM\b/i.test(n)) return "HCM";
  return null;
}

/** "108.025,41" -> 108025.41 (Sheet VN); vẫn xử lý được số dạng US "1234.5". */
function parseNum(s: string): number {
  if (!s) return 0;
  const t = s.trim();
  if (!t) return 0;
  // Nếu có cả "." và "," -> "." là ngăn nghìn, "," là thập phân (VN)
  // Nếu chỉ có "," -> ngăn nghìn hoặc thập phân? Google Sheet gviz VN dùng "," thập phân.
  // Nếu chỉ có "." -> mặc định coi là thập phân (US) — an toàn cho export?format=csv.
  let normalized = t;
  if (t.includes(",") && t.includes(".")) {
    normalized = t.replace(/\./g, "").replace(",", ".");
  } else if (t.includes(",")) {
    normalized = t.replace(",", ".");
  }
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

async function fetchFirstOnce(urls: string[], signal?: AbortSignal): Promise<string> {
  for (const base of urls) {
    const sep = base.includes("?") ? "&" : "?";
    const res = await fetch(base + sep + "_=" + Date.now(), { cache: "no-store", signal });
    if (res.ok) {
      const t = await res.text();
      if (t.trim().length > 20 && !/Unauthorized|requires you to sign in/i.test(t.slice(0, 200))) {
        return t;
      }
    }
  }
  throw new Error("Không tải được nguồn BC Lấy");
}

async function fetchFirst(urls: string[], signal?: AbortSignal): Promise<string | null> {
  try {
    return await withRetry(() => fetchFirstOnce(urls, signal));
  } catch {
    return null;
  }
}

/** Tải & parse CSV workbook BC Lấy. */
export async function loadBcLay(signal?: AbortSignal): Promise<BcLayData> {
  const text = await fetchFirst(bcLayCsvSources(), signal);
  if (!text) return { rows: [], lastSync: Date.now() };
  const raw = parseCSV(text);
  if (raw.length < 2) return { rows: [], lastSync: Date.now() };
  const H = raw[0];
  const cDt = findCol(H, ["dt", "date", "ngay"]);
  const cWid = findCol(H, ["warehouse_id", "wid", "ma kho"]);
  const cWn = findCol(H, ["warehouse_name", "kho"]);
  const cVol = findCol(H, ["volume", "vol", "order_count", "so don"]);
  const cKg = findCol(H, ["weight_kg", "kg", "weight"]);
  const g = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] || "").trim() : "");

  const rows: BcRow[] = [];
  for (const r of raw.slice(1)) {
    const dt = g(r, cDt);
    if (!/^\d{4}-\d{2}-\d{2}/.test(dt)) continue;
    rows.push({
      dt: dt.slice(0, 10),
      wid: g(r, cWid),
      wname: g(r, cWn),
      vol: parseNum(g(r, cVol)),
      kg: parseNum(g(r, cKg)),
    });
  }
  return { rows, lastSync: Date.now() };
}

/* -------- Stats helpers -------- */
function mean(a: number[]): number {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}
function stddev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const p = (sorted.length - 1) * q;
  const lo = Math.floor(p), hi = Math.ceil(p), t = p - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

/** Stats cho 1 dãy giá trị + ngày cực trị để làm dẫn chứng. */
export interface FieldStats {
  n: number;
  mean: number;
  median: number;
  q1: number;
  q3: number;
  std: number;
  cv: number;
  min: number;
  minDt: string;
  max: number;
  maxDt: string;
}
function statsWithEvidence(records: BcRow[], field: "vol" | "kg"): FieldStats | null {
  const arr = records.map((r) => r[field]);
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = mean(arr);
  const md = quantile(sorted, 0.5);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const sd = stddev(arr);
  const cv = m > 0 ? sd / m : 0;
  let maxR = records[0];
  let minR = records[0];
  for (const r of records) {
    if (r[field] > maxR[field]) maxR = r;
    if (r[field] < minR[field]) minR = r;
  }
  return {
    n: arr.length,
    mean: m,
    median: md,
    q1,
    q3,
    std: sd,
    cv,
    min: minR[field],
    minDt: minR.dt,
    max: maxR[field],
    maxDt: maxR.dt,
  };
}

export interface BcProfile {
  wid: string;
  wname: string;
  loc: Loc;
  n: number;
  sV: FieldStats;
  sK: FieldStats;
  kgPerOrder: number;
  score: number; // max(CV_vol, CV_kg)
}

/** Ngưỡng lọc "BC lõi" — dưới ngưỡng không tính vì CV bị nhiễu do đếm số nhỏ. */
export const MIN_WEEKDAY_DAYS = 40;
export const MIN_MEDIAN_VOL = 50;

/** Xếp hạng biến động cho toàn bộ BC thuộc 4 khu vực đã lọc. */
export function computeProfiles(rows: BcRow[]): BcProfile[] {
  // Group by wid
  const byBc = new Map<string, { meta: { wname: string; loc: Loc }; recs: BcRow[] }>();
  for (const r of rows) {
    const loc = locOf(r.wname);
    if (!loc) continue;
    let entry = byBc.get(r.wid);
    if (!entry) {
      entry = { meta: { wname: r.wname, loc }, recs: [] };
      byBc.set(r.wid, entry);
    }
    entry.recs.push(r);
  }

  const profiles: BcProfile[] = [];
  for (const [wid, entry] of byBc) {
    const wkd = entry.recs.filter((r) => classifyDate(r.dt) === "WEEKDAY");
    if (wkd.length < MIN_WEEKDAY_DAYS) continue;
    const sV = statsWithEvidence(wkd, "vol");
    const sK = statsWithEvidence(wkd, "kg");
    if (!sV || !sK) continue;
    if (sV.median < MIN_MEDIAN_VOL) continue;
    const totV = wkd.reduce((s, r) => s + r.vol, 0);
    const totK = wkd.reduce((s, r) => s + r.kg, 0);
    profiles.push({
      wid,
      wname: entry.meta.wname,
      loc: entry.meta.loc,
      n: sV.n,
      sV,
      sK,
      kgPerOrder: totV > 0 ? totK / totV : 0,
      score: Math.max(sV.cv, sK.cv),
    });
  }
  profiles.sort((a, b) => b.score - a.score);
  return profiles;
}

/** Đếm BC theo khu vực (dựa trên tên BC — bao gồm cả BC nhỏ chưa vào lõi). */
export function countByLoc(rows: BcRow[]): Record<Loc, number> {
  const set: Record<Loc, Set<string>> = {
    "HCM": new Set(), "Thủ Đức": new Set(), "Thuận An": new Set(), "Dĩ An": new Set(),
  };
  for (const r of rows) {
    const loc = locOf(r.wname);
    if (!loc) continue;
    set[loc].add(r.wid);
  }
  return {
    "HCM": set["HCM"].size,
    "Thủ Đức": set["Thủ Đức"].size,
    "Thuận An": set["Thuận An"].size,
    "Dĩ An": set["Dĩ An"].size,
  };
}

/** 1 điểm trên chart: 1 ngày trong tháng, ứng với 1 BC hoặc tổng cụm. */
export interface DayPoint {
  day: number;      // 1..31
  dt: string;
  dow: number;
  bucket: Bucket;
  vol: number;
  kg: number;
}

export interface MonthMeta {
  key: string;      // "2026-04"
  label: string;    // "04/2026"
  dim: number;
  satDays: number[];
  sunDays: number[];
  evDays: number[];
}

/** Tính số ngày trong tháng (JavaScript date magic: day=0 của tháng SAU = ngày cuối tháng NÀY). */
function daysInMonth(monthKey: string): number {
  const [Y, M] = monthKey.split("-").map(Number);
  return new Date(Y, M, 0).getDate();
}

/** Tất cả các tháng có dữ liệu, sắp tăng dần. */
export function monthsOf(rows: BcRow[]): string[] {
  return [...new Set(rows.map((r) => r.dt.slice(0, 7)))].sort();
}

export function buildMonthMeta(monthKey: string): MonthMeta {
  const [Y, M] = monthKey.split("-").map(Number);
  const dim = daysInMonth(monthKey);
  const satDays: number[] = [], sunDays: number[] = [], evDays: number[] = [];
  for (let d = 1; d <= dim; d++) {
    const dt = `${Y}-${String(M).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const b = classifyDate(dt);
    if (b === "EVENT") evDays.push(d);
    else if (b === "SUN") sunDays.push(d);
    else if (b === "SAT") satDays.push(d);
  }
  return {
    key: monthKey,
    label: `${String(M).padStart(2, "0")}/${Y}`,
    dim, satDays, sunDays, evDays,
  };
}

/** Tổng cụm theo ngày trong 1 tháng (chỉ tính BC thuộc 4 khu vực đã lọc). */
export function clusterByMonth(rows: BcRow[], monthKey: string): DayPoint[] {
  const points = new Map<string, DayPoint>();
  for (const r of rows) {
    if (!r.dt.startsWith(monthKey)) continue;
    if (!locOf(r.wname)) continue;
    let p = points.get(r.dt);
    if (!p) {
      p = {
        day: +r.dt.slice(-2),
        dt: r.dt,
        dow: dowOf(r.dt),
        bucket: classifyDate(r.dt),
        vol: 0, kg: 0,
      };
      points.set(r.dt, p);
    }
    p.vol += r.vol;
    p.kg += r.kg;
  }
  return [...points.values()].sort((a, b) => a.day - b.day);
}

/** Chuỗi ngày trong tháng cho 1 BC cụ thể (để vẽ line từng BC top 20). */
export function bcByMonth(rows: BcRow[], wid: string, monthKey: string): DayPoint[] {
  const points: DayPoint[] = [];
  for (const r of rows) {
    if (r.wid !== wid) continue;
    if (!r.dt.startsWith(monthKey)) continue;
    points.push({
      day: +r.dt.slice(-2),
      dt: r.dt,
      dow: dowOf(r.dt),
      bucket: classifyDate(r.dt),
      vol: r.vol,
      kg: r.kg,
    });
  }
  return points.sort((a, b) => a.day - b.day);
}
