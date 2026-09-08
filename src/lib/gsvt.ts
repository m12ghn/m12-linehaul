/* ============================================================
   GSVT — Giám Sát Vận Tải.
   1) LỊCH TRỰC 3 ca: mặc định (danh sách cứng) + đọc đè từ tab
      "LỊCH TRỰC GSVT" trong workbook chính (theo TÊN tab, không cần gid).
      Cột kỳ vọng: Ca | Khung giờ | Họ tên | SĐT. Chưa tạo tab -> dùng mặc định.
   2) Gom TOÀN BỘ xe (mỗi tuyến = 1 xe) toàn cụm, tính GIỜ ĐẾN KHO ĐẦU,
      rồi chia cho ca trực theo mốc cắt 07:00 / 15:00 / 23:00.
   ============================================================ */
import { useEffect, useState } from "react";
import { loadRegion } from "./db/lichTaiApi"; // 01/09/2026: Lịch Tải đã chuyển sang Supabase
import { startPoll } from "./poll";
import { normCode } from "./tlld";
import { parseCSV, findCol } from "./csv";
import { stripAccents } from "./normalize";
import { SHEETS, REFRESH_MS, GSVT_ROSTER_SHEET, EXCLUDED_REGION_KEYS, csvSourcesByName } from "../config";
import type { Route } from "../types";

export type ShiftKey = "Ca1" | "Ca2" | "Ca3";

export interface GsvtPerson { name: string; phone: string; }
export interface GsvtShift {
  key: ShiftKey;
  label: string; // "Ca 1"
  hours: string; // khung giờ trực hiển thị (có thể chồng lấn) — "07:00 - 16:00"
  people: GsvtPerson[];
}

// ----- LỊCH TRỰC MẶC ĐỊNH (dùng khi chưa có tab sheet) -----
const DEFAULT_ROSTER: GsvtShift[] = [
  { key: "Ca1", label: "Ca 1", hours: "07:00 - 16:00", people: [
    { name: "Phạm Ngọc Huy", phone: "0961574483" },
    { name: "Võ Dương Trường Thọ", phone: "0399329313" },
  ] },
  { key: "Ca2", label: "Ca 2", hours: "15:00 - 23:00", people: [
    { name: "Huỳnh Lê Cẩm Tú", phone: "0376658858" },
    { name: "Huỳnh Hữu Kháng", phone: "0879697044" },
  ] },
  { key: "Ca3", label: "Ca 3", hours: "23:00 - 07:00", people: [
    { name: "Nguyễn Thị Hà", phone: "0352348150" },
  ] },
];

// ----- MỐC CẮT chia xe (không chồng lấn) -----
// Ca1 [07:00,15:00) · Ca2 [15:00,23:00) · Ca3 [23:00,07:00)
const CUT1 = 7 * 60, CUT2 = 15 * 60, CUT3 = 23 * 60;

/** Chuỗi "HH:MM" -> số phút trong ngày (null nếu không có giờ). */
export function toMinutes(s: string): number | null {
  const m = (s || "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Phút trong ngày -> thuộc ca nào (theo mốc cắt). */
export function shiftOf(min: number): ShiftKey {
  const m = ((min % 1440) + 1440) % 1440;
  if (m >= CUT1 && m < CUT2) return "Ca1";
  if (m >= CUT2 && m < CUT3) return "Ca2";
  return "Ca3"; // [23:00,24:00) ∪ [00:00,07:00)
}

/** Ca đang trực NGAY BÂY GIỜ (theo giờ máy). */
export function currentShift(now = new Date()): ShiftKey {
  return shiftOf(now.getHours() * 60 + now.getMinutes());
}

// ----- ĐỌC LỊCH TRỰC TỪ SHEET (theo tên tab) -----
async function loadRoster(signal?: AbortSignal): Promise<{ roster: GsvtShift[]; fromSheet: boolean }> {
  if (!GSVT_ROSTER_SHEET) return { roster: DEFAULT_ROSTER, fromSheet: false };
  try {
    let text = "";
    for (const base of csvSourcesByName(GSVT_ROSTER_SHEET)) {
      try {
        const url = base + (base.includes("?") ? "&" : "?") + "_=" + Date.now();
        const res = await fetch(url, { cache: "no-store", signal });
        if (!res.ok) continue;
        text = await res.text();
        if (text.trim()) break;
      } catch { /* thử nguồn kế */ }
    }
    if (!text.trim()) return { roster: DEFAULT_ROSTER, fromSheet: false };
    const raw = parseCSV(text);
    if (raw.length < 2) return { roster: DEFAULT_ROSTER, fromSheet: false };
    const H = raw[0];
    const cCa = findCol(H, ["ca truc", "ca lam", "kip truc", "ca", "kip"]);
    const cGio = findCol(H, ["khung gio", "gio truc", "thoi gian", "gio"]);
    const cTen = findCol(H, ["ho va ten", "ho ten", "nhan vien", "gsvt", "ten"]);
    const cSdt = findCol(H, ["so dien thoai", "dien thoai", "sdt", "so dt"]);
    // GUARD: tab lịch trực CHƯA tồn tại -> gviz trả về sheet mặc định (lịch tải).
    // Bắt buộc có đủ cột Ca + Họ tên + SĐT (khớp theo TÊN cột, không fallback) mới nhận.
    if (cCa < 0 || cTen < 0 || cSdt < 0) return { roster: DEFAULT_ROSTER, fromSheet: false };
    const g = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] || "").trim() : "");
    // Bắt đầu từ bản mặc định (giữ khung giờ/label) rồi thay danh sách người theo sheet.
    const map = new Map<ShiftKey, GsvtShift>(DEFAULT_ROSTER.map((s) => [s.key, { ...s, people: [] as GsvtPerson[] }]));
    let any = false;
    for (const r of raw.slice(1)) {
      const caRaw = g(r, cCa);
      const dm = caRaw.match(/[123]/);
      if (!dm) continue;
      const key = ("Ca" + dm[0]) as ShiftKey;
      const sh = map.get(key);
      if (!sh) continue;
      const name = g(r, cTen);
      const phone = g(r, cSdt).replace(/[^\d]/g, "");
      const hours = g(r, cGio);
      if (hours) sh.hours = hours;
      if (name) { sh.people.push({ name, phone }); any = true; }
    }
    if (!any) return { roster: DEFAULT_ROSTER, fromSheet: false };
    // Ca nào sheet không khai người -> giữ mặc định của ca đó.
    const roster = DEFAULT_ROSTER.map((d) => {
      const s = map.get(d.key)!;
      return s.people.length ? s : d;
    });
    return { roster, fromSheet: true };
  } catch {
    return { roster: DEFAULT_ROSTER, fromSheet: false };
  }
}

// ----- GOM XE TOÀN CỤM + CHIA CA -----
export interface GsvtVehicle {
  code: string;      // mã tuyến
  region: string;    // vùng (nhãn sheet)
  load: string;      // tải trọng (kg, chuỗi gốc)
  ncc: string;       // nhà cung cấp
  kho: string;       // tên kho đầu
  gioDen: string;    // giờ đến kho đầu (chuỗi gốc)
  min: number | null;
  shift: ShiftKey | "unknown";
  route: Route;      // tuyến đầy đủ (để hiển thị thẻ lịch giống Lịch Tải + vẽ bản đồ)
}

/** Điểm "chi tiết" để chọn bản đầy đủ nhất khi 1 mã tuyến xuất hiện ở nhiều vùng. */
const score = (r: Route) => r.stops.length * 10 + (r.load ? 5 : 0) + r.stops.filter((s) => s.toi || s.roi).length;

const isKhoStop = (kho: string, lh: string) =>
  /kho|phan loai|phân loại/i.test((kho || "") + " " + (lh || ""));

/** Giờ xe ĐẾN kho đầu: ưu tiên điểm kho/phân loại đầu tiên có giờ tới; fallback điểm có giờ đầu tiên. */
function khoDauInfo(r: Route): { kho: string; toi: string; min: number | null } {
  const khoStop = r.stops.find((s) => isKhoStop(s.kho, s.loaiHinh) && toMinutes(s.toi) != null);
  if (khoStop) return { kho: khoStop.kho, toi: khoStop.toi, min: toMinutes(khoStop.toi) };
  const anyStop = r.stops.find((s) => toMinutes(s.toi) != null);
  if (anyStop) return { kho: anyStop.kho, toi: anyStop.toi, min: toMinutes(anyStop.toi) };
  const first = r.stops[0];
  return { kho: first ? first.kho : "", toi: "", min: null };
}

export async function loadGsvtVehicles(signal?: AbortSignal): Promise<GsvtVehicle[]> {
  // Loại vùng M12 không phụ trách (vd "Nội Vùng HCM" — tab đã đổi cấu trúc, không còn là dữ liệu
  // tuyến) khỏi TỔNG HỢP toàn cụm — RÀ LẠI 2026-07-21 (Sếp báo "Lịch tải đang tính sai"): cùng bug
  // đã sửa ở fleetMix.ts trước đây nhưng sót file này.
  const perRegion = await Promise.all(
    SHEETS.filter((s) => !EXCLUDED_REGION_KEYS.includes(s.key)).map(async (s) => ({ label: s.label, res: await loadRegion(s.key, signal).catch(() => null) })),
  );
  // 1 mã tuyến = 1 xe (dedup toàn cụm, giữ bản chi tiết nhất + vùng của bản đó).
  const best = new Map<string, { v: GsvtVehicle; sc: number }>();
  for (const { label, res } of perRegion) {
    if (!res) continue;
    for (const r of res.routes) {
      const key = normCode(r.route);
      if (!key) continue;
      const sc = score(r);
      const prev = best.get(key);
      if (prev && sc <= prev.sc) continue;
      const info = khoDauInfo(r);
      best.set(key, {
        sc,
        v: {
          code: r.route, region: label, load: r.load || "", ncc: r.ncc || "",
          kho: info.kho, gioDen: info.toi, min: info.min,
          shift: info.min != null ? shiftOf(info.min) : "unknown",
          route: r,
        },
      });
    }
  }
  return [...best.values()].map((x) => x.v)
    .sort((a, b) => (a.min ?? 1e9) - (b.min ?? 1e9) || a.code.localeCompare(b.code, "vi"));
}

export interface GsvtData {
  roster: GsvtShift[];
  rosterFromSheet: boolean;
  vehicles: GsvtVehicle[];
  byShift: Record<ShiftKey | "unknown", GsvtVehicle[]>;
  lastSync: number;
}

let cache: GsvtData | null = null;
let cachedAt = 0;

function group(vehicles: GsvtVehicle[]): GsvtData["byShift"] {
  const b: GsvtData["byShift"] = { Ca1: [], Ca2: [], Ca3: [], unknown: [] };
  for (const v of vehicles) b[v.shift].push(v);
  return b;
}

export async function loadGsvt(signal?: AbortSignal): Promise<GsvtData> {
  const [{ roster, fromSheet }, vehicles] = await Promise.all([loadRoster(signal), loadGsvtVehicles(signal)]);
  const data: GsvtData = { roster, rosterFromSheet: fromSheet, vehicles, byShift: group(vehicles), lastSync: Date.now() };
  cache = data; cachedAt = Date.now();
  return data;
}

/** Hook: nạp lịch trực + xe toàn cụm, tự làm mới realtime. */
export function useGsvt(): { data: GsvtData | null; refreshing: boolean } {
  const [data, setData] = useState<GsvtData | null>(cache);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let alive = true;
    const run = () => {
      setRefreshing(true);
      loadGsvt().then((d) => { if (alive) setData(d); }).catch(() => {}).finally(() => { if (alive) setRefreshing(false); });
    };
    if (!cache || Date.now() - cachedAt > REFRESH_MS) run(); else setData(cache);
    const stop = startPoll(run, REFRESH_MS);
    return () => { alive = false; stop(); };
  }, []);
  return { data, refreshing };
}

// ----- PHÂN LOẠI GIAO / LẤY + THỐNG KÊ THEO CA -----
export type VehKind = "lay" | "giao" | "both" | "other";
export const KIND_LABEL: Record<VehKind, string> = { lay: "Lấy", giao: "Giao", both: "Cả hai", other: "Khác" };

/** Tuyến chủ yếu Lấy / Giao / cả hai — dựa vào loại hình các điểm (bỏ điểm kho "Phân loại"). */
export function vehicleKind(v: GsvtVehicle): VehKind {
  const lh = v.route.stops.map((s) => stripAccents(s.loaiHinh)).join("|");
  const lay = /lay/.test(lh), giao = /giao/.test(lh);
  return lay && giao ? "both" : lay ? "lay" : giao ? "giao" : "other";
}

export interface CaStats {
  total: number;
  kind: Record<VehKind, number>;
  ton: Record<string, number>; // tải trọng -> số tuyến
}
export function caStats(list: GsvtVehicle[]): CaStats {
  const kind: Record<VehKind, number> = { lay: 0, giao: 0, both: 0, other: 0 };
  const ton: Record<string, number> = {};
  for (const v of list) {
    kind[vehicleKind(v)]++;
    const t = v.load || "—";
    ton[t] = (ton[t] || 0) + 1;
  }
  return { total: list.length, kind, ton };
}

/** Ngữ cảnh gọn cho trợ lý AI: ai trực + số xe + chia theo loại (giao/lấy) & tải trọng mỗi ca. */
export function gsvtDigest(d: GsvtData): string {
  const lines = d.roster.map((s) => {
    const list = d.byShift[s.key];
    const st = caStats(list);
    const who = s.people.map((p) => `${p.name}${p.phone ? ` (${p.phone})` : ""}`).join(", ") || "—";
    const kinds = (["lay", "giao", "both", "other"] as VehKind[]).filter((k) => st.kind[k]).map((k) => `${KIND_LABEL[k]} ${st.kind[k]}`).join(", ");
    const tons = Object.entries(st.ton).sort((a, b) => (parseFloat(b[0]) || 0) - (parseFloat(a[0]) || 0)).map(([t, n]) => `${t}kg: ${n}`).join(", ");
    return `${s.label} (${s.hours}) — GSVT: ${who} — ${st.total} xe [loại: ${kinds || "—"}] [tải: ${tons || "—"}].`;
  });
  const unk = d.byShift.unknown.length;
  return `LỊCH TRỰC GSVT & phân xe theo giờ ĐẾN kho đầu (mốc 07:00/15:00/23:00):\n${lines.join("\n")}${unk ? `\nChưa rõ giờ: ${unk} xe.` : ""}`;
}
