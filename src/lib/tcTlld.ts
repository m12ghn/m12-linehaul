/* ============================================================
   TLLD tuyến TĂNG CƯỜNG theo ngày event — đọc Sheet 17 (workbook TLLD, pivot).
   Khối bên phải: cột 13 = mã SG_TCEV; mỗi ngày event có 2 số % (cột đôi) →
   lấy số LỚN HƠN làm TLLD (theo yêu cầu). Dòng 1 chứa ngày (7/7, 8/7, 9/7).
   CHỈ dùng số có sẵn, KHÔNG bịa; ngày thường / T6 chưa có data → bỏ qua.
   ============================================================ */
import { parseCSV } from "./csv";
import { tlldCsvSources, TC_TLLD_GID } from "../config";

const parsePct = (s: string): number | null => {
  const t = (s || "").trim();
  if (!t || !t.includes("%")) return null;
  const v = parseFloat(t.replace("%", "").replace(",", "."));
  return isNaN(v) ? null : v / 100;
};
const dmShort = (s: string): string => { const m = (s || "").match(/(\d{1,2})\/(\d{1,2})/); return m ? `${m[1]}/${m[2]}` : (s || "").trim(); };

export interface TcTlldRoute { code: string; days: (number | null)[]; avg: number | null; }
export interface TcTlldData { routes: TcTlldRoute[]; dateLabels: string[]; ok: boolean; lastSync: number; }

export async function loadTcTlld(signal?: AbortSignal): Promise<TcTlldData> {
  let text: string | null = null;
  for (const base of tlldCsvSources(TC_TLLD_GID)) {
    try {
      const res = await fetch(base + "&_=" + Date.now(), { cache: "no-store", signal });
      if (res.ok) { const t = await res.text(); if (t.trim().length > 5 && !/^\s*<!doctype/i.test(t.slice(0, 60))) { text = t; break; } }
    } catch { /* nguồn kế tiếp */ }
  }
  if (!text) return { routes: [], dateLabels: [], ok: false, lastSync: Date.now() };
  const rows = parseCSV(text);
  if (rows.length < 3) return { routes: [], dateLabels: [], ok: false, lastSync: Date.now() };

  // Ngày event ở dòng index 1, các cột 14 / 16 / 18.
  const dRow = rows[1] || [];
  const dateLabels = [dmShort(dRow[14] || ""), dmShort(dRow[16] || ""), dmShort(dRow[18] || "")].filter(Boolean);

  const routes: TcTlldRoute[] = [];
  for (const r of rows) {
    const code = (r[13] || "").trim();
    if (!/^SG_TCEV/i.test(code)) continue;
    // Mỗi ngày = cặp cột (14,15) (16,17) (18,19) -> lấy số LỚN HƠN.
    const dayMax = (i: number): number | null => {
      const a = parsePct(r[i]), b = parsePct(r[i + 1]);
      if (a == null && b == null) return null;
      return Math.max(a ?? -Infinity, b ?? -Infinity);
    };
    const days = [dayMax(14), dayMax(16), dayMax(18)];
    const valid = days.filter((v): v is number => v != null);
    const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    routes.push({ code, days, avg });
  }
  return { routes, dateLabels, ok: true, lastSync: Date.now() };
}

export interface TcTlldStats {
  n: number;                 // số tuyến TC có TLLD
  avg: number | null;        // TLLD trung bình toàn bộ tuyến (theo avg mỗi tuyến)
  low: number;               // số tuyến rỗng (<60%)
  over: number;              // số tuyến quá tải (>100%)
  lowRoutes: { code: string; avg: number }[];
  overRoutes: { code: string; avg: number }[];
}
export function tcTlldStats(routes: TcTlldRoute[]): TcTlldStats {
  const withAvg = routes.filter((r) => r.avg != null) as { code: string; avg: number }[];
  const n = withAvg.length;
  const avg = n ? withAvg.reduce((a, r) => a + r.avg, 0) / n : null;
  const lowRoutes = withAvg.filter((r) => r.avg < 0.6).sort((a, b) => a.avg - b.avg);
  const overRoutes = withAvg.filter((r) => r.avg > 1).sort((a, b) => b.avg - a.avg);
  return { n, avg, low: lowRoutes.length, over: overRoutes.length, lowRoutes, overRoutes };
}
