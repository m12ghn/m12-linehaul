/* ============================================================
   Đọc FORECAST VOLUME (FC) theo ngày × kho — workbook chính.
   Tab "FC HCM20" & "FC ST": Forecast Volume / Thực tế Volume / FC Hàng CK /
   Thực tế CK / FC Weight / Thực tế Weight. Số kiểu VN ("." ngăn nghìn).
   Dùng cho Plan Event (số xe theo FC thật) & so dự báo vs thực tế.
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import { parseVN } from "./sanluong";
import { withRetry } from "./retry";
import { csvSourcesByName } from "../config";

export interface FCRow {
  date: string; // YYYY-MM-DD
  thu: string; // Thứ
  fcVol: number | null; actVol: number | null;
  fcCK: number | null; actCK: number | null;
  fcW: number | null; actW: number | null;
}
export interface FCData { rows: FCRow[]; lastSync: number; }

function parseDMY(s: string): string {
  const m = (s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}
const numOrNull = (s: string): number | null => {
  const t = (s || "").trim();
  if (!t) return null;
  const n = parseVN(t);
  return Number.isFinite(n) ? n : null;
};

const cache = new Map<string, FCData>();

export async function loadFC(sheetName: string, signal?: AbortSignal): Promise<FCData> {
  if (cache.has(sheetName)) return cache.get(sheetName)!;
  const urls = csvSourcesByName(sheetName);
  try {
    // Tự thử lại khi Google lỗi tạm thời (chớp nhoáng trả trang đăng nhập/redirect).
    const text = await withRetry(async () => {
      let lastErr: unknown;
      for (const base of urls) {
        try {
          const url = base + (base.includes("?") ? "&" : "?") + "_=" + Date.now();
          const res = await fetch(url, { cache: "no-store", signal });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const t = await res.text();
          if (/^\s*<!doctype html|requires you to sign in|Unauthorized/i.test(t.slice(0, 200))) throw new Error("PRIVATE");
          return t;
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error("Không có nguồn dữ liệu");
    });
    const raw = parseCSV(text);
    if (raw.length < 2) return { rows: [], lastSync: Date.now() };
    const H = raw[0];
    const c = {
      ngay: findCol(H, ["ngay", "ngày"]),
      fcVol: findCol(H, ["forecast volume", "fc volume"]),
      actVol: findCol(H, ["thuc te volume", "thực tế volume"]),
      fcCK: findCol(H, ["fc hang ck", "fc hàng ck"]),
      actCK: findCol(H, ["thuc te ck", "thực tế ck"]),
      fcW: findCol(H, ["fc weight"]),
      actW: findCol(H, ["thuc te weight", "thực tế weight"]),
    };
    const g = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i] : "");
    const rows: FCRow[] = [];
    for (const r of raw.slice(1)) {
      const date = parseDMY(g(r, c.ngay));
      if (!date) continue;
      rows.push({
        date, thu: (g(r, 0) || "").trim(),
        fcVol: numOrNull(g(r, c.fcVol)), actVol: numOrNull(g(r, c.actVol)),
        fcCK: numOrNull(g(r, c.fcCK)), actCK: numOrNull(g(r, c.actCK)),
        fcW: numOrNull(g(r, c.fcW)), actW: numOrNull(g(r, c.actW)),
      });
    }
    const d = { rows, lastSync: Date.now() };
    if (rows.length) cache.set(sheetName, d);
    return d;
  } catch {
    return { rows: [], lastSync: Date.now() };
  }
}

/** Độ chính xác FC trong quá khứ: TB |thực tế - fc| / fc (chỉ ngày có cả 2). */
export function fcAccuracy(rows: FCRow[]): { mape: number | null; n: number } {
  const both = rows.filter((r) => r.fcVol != null && r.actVol != null && r.fcVol > 0);
  if (!both.length) return { mape: null, n: 0 };
  const e = both.reduce((a, r) => a + Math.abs((r.actVol as number) - (r.fcVol as number)) / (r.fcVol as number), 0) / both.length;
  return { mape: e, n: both.length };
}
