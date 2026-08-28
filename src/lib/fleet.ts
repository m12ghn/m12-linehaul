/* ============================================================
   Đọc THÔNG TIN XE theo mã tuyến từ workbook điều phối (realtime).
   Gộp nhiều tab có cột BKS/TÊN TX/SDT -> Map<mã tuyến chuẩn hoá, {...}>.
   Dữ liệu lộn xộn (SĐT có ';' đầu, có ô nhồi cả biển số+tên+SĐT) -> làm sạch.
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import {
  VEHICLE_TABS,
  vehicleCsvSources,
  GXT_TABS,
  gxtCsvSources,
} from "../config";
import { normCode } from "./tlld";
import { fetchWithTimeout } from "./fetchTimeout";

export interface Vehicle {
  bks: string; // biển số
  tx: string; // tên tài xế
  sdt: string; // số điện thoại (đã chuẩn hoá)
  ncc: string; // nhà cung cấp
}

/** Lấy biển số sạch từ chuỗi (có thể nhồi cả tên/SĐT). */
function cleanPlate(s: string): string {
  let x = (s || "").replace(/^[\s;:,.]+/, "").trim();
  const m = x.match(/^\d{2}[A-Za-z]{1,2}[-\s.]?\d[\d.\s]{2,6}/);
  if (m) return m[0].replace(/\s+/g, "").replace(/[.\s]+$/, "").toUpperCase();
  return x.split(",")[0].trim().toUpperCase();
}

/** Trích số điện thoại VN (chuỗi 9–11 số, thêm '0' nếu thiếu). */
function cleanPhone(...sources: string[]): string {
  for (const src of sources) {
    const chunks = (src || "").replace(/\D+/g, " ").trim().split(/\s+/).filter(Boolean);
    const cand = chunks.filter((c) => c.length >= 9 && c.length <= 11);
    if (cand.length) {
      let p = cand[cand.length - 1];
      if (p.length === 9) p = "0" + p;
      return p;
    }
  }
  return "";
}

async function fetchFrom(sources: string[], signal?: AbortSignal): Promise<string | null> {
  for (const base of sources) {
    try {
      const res = await fetchWithTimeout(base + "&_=" + Date.now(), { cache: "no-store", signal });
      if (res.ok) {
        const t = await res.text();
        if (t.trim().length > 5) return t;
      }
    } catch {
      /* nguồn kế tiếp */
    }
  }
  return null;
}

// Cào bảng GXT (dữ liệu nhồi trong ô): quét mọi dòng, bắt cặp mã tuyến ↔ biển số.
const RE_ROUTE = /\b(?:SG|XA|LA|GHN|HCM)[A-Z0-9]*(?:_[A-Z0-9]+)+\b/gi;
const RE_PLATE = /\b\d{2}[A-Z]{1,2}[-.\s]?\d{3}\.?\d{1,3}\b/g;
function scanRows(rows: string[][], byRoute: Map<string, Vehicle>): void {
  for (const row of rows) {
    const joined = row.join(" ");
    const routes = [...new Set((joined.match(RE_ROUTE) || []).map((x) => normCode(x)))];
    if (!routes.length) continue;
    const plates = (joined.match(RE_PLATE) || []).map((p) => p.replace(/\s+/g, "").toUpperCase());
    if (!plates.length) continue;
    const bks = plates[0];
    for (const r of routes) if (!byRoute.has(r)) byRoute.set(r, { bks, tx: "", sdt: "", ncc: "" });
  }
}

export interface FleetIndex {
  byRoute: Map<string, Vehicle>;
  lastSync: number;
}

// ----- CACHE + GỘP REQUEST (giống sheet.ts) — trước đây KHÔNG có, mỗi lần vào "Lịch Tải" hoặc mỗi
// nhịp poll 60s đều bắn lại đủ 8 nguồn (4 VEHICLE_TABS + 4 GXT_TABS) dù dữ liệu BKS/tài xế gần như
// không đổi -> đây là nguyên nhân chính gây "load lâu" khi Sếp báo 2026-08-12.
const FLEET_TTL = 40000;
let fleetCache: { at: number; data: FleetIndex } | null = null;
let fleetInflight: Promise<FleetIndex> | null = null;

export async function loadFleet(signal?: AbortSignal, force = false): Promise<FleetIndex> {
  if (!force) {
    if (fleetCache && Date.now() - fleetCache.at < FLEET_TTL) return fleetCache.data;
    if (fleetInflight) return fleetInflight;
  }
  const run = loadFleetUncached(signal).then((data) => {
    fleetCache = { at: Date.now(), data };
    return data;
  });
  fleetInflight = run;
  try { return await run; } finally { fleetInflight = null; }
}

async function loadFleetUncached(signal?: AbortSignal): Promise<FleetIndex> {
  const byRoute = new Map<string, Vehicle>();

  // 1) Nguồn có cấu trúc (BKS/TÊN TX/SDT) — ưu tiên (có SĐT).
  const vTexts = await Promise.all(VEHICLE_TABS.map((gid) => fetchFrom(vehicleCsvSources(gid), signal)));
  for (const text of vTexts) {
    if (!text) continue;
    const rows = parseCSV(text);
    if (rows.length < 2) continue;
    const H = rows[0];
    const rc = findCol(H, ["ten tuyen", "ma tuyen", "tuyen"]);
    const bc = findCol(H, ["bks", "bien so"]);
    const tc = findCol(H, ["ten tx", "tai xe", "lai xe"]);
    const sc = findCol(H, ["sdt", "so dt", "dien thoai"]);
    const nc = findCol(H, ["ncc"]);
    if (rc < 0) continue;
    const g = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] || "").trim() : "");
    for (const r of rows.slice(1)) {
      const code = normCode(g(r, rc));
      if (!code || !/^[A-Z0-9]/.test(code)) continue;
      const bksRaw = g(r, bc);
      const tx = g(r, tc);
      const sdt = cleanPhone(g(r, sc), bksRaw);
      const bks = cleanPlate(bksRaw);
      if (!bks && !sdt && !tx) continue;
      if (!byRoute.has(code)) byRoute.set(code, { bks, tx, sdt, ncc: g(r, nc) });
    }
  }

  // 2) Nguồn GXT (cào) — bổ sung biển số cho tuyến chưa có (không SĐT).
  const gTexts = await Promise.all(GXT_TABS.map((gid) => fetchFrom(gxtCsvSources(gid), signal)));
  for (const text of gTexts) {
    if (!text) continue;
    const rows = parseCSV(text);
    if (rows.length) scanRows(rows, byRoute);
  }

  return { byRoute, lastSync: Date.now() };
}
