/* ============================================================
   Đọc "Data hàng" — khối lượng hàng THẬT (Tấn) theo NGÀY × khu vực CK nội thành
   HCM (15 khu gom hàng, vd "(HCM) CK Bình Thạnh"). Dùng đối chiếu xu hướng khối
   lượng với nhu cầu xin tăng cường quanh event (xem weightXtcCorr trong PlanEvent).
   LƯU Ý: đây là mức KHU VỰC (CK) — KHÔNG có bảng ánh xạ CK <-> từng bưu cục lẻ
   trong "xin tăng cường", nên chỉ đối chiếu được ở mức TỔNG CỤM (không tách theo
   từng BC/khu vực — tránh suy diễn sai khi không có khoá nối đáng tin cậy).
   ============================================================ */
import { parseCSV } from "./csv";
import { parseVN } from "./sanluong";
import { withRetry } from "./retry";
import { csvSources } from "../config";

export interface DataHangRow { date: string; warehouse: string; weightTon: number; }
export interface DataHangData { rows: DataHangRow[]; lastSync: number; }

const VN_MONTHS: Record<string, number> = {
  "một": 1, "hai": 2, "ba": 3, "tư": 4, "năm": 5, "sáu": 6, "bảy": 7, "tám": 8, "chín": 9,
  "mười": 10, "mười một": 11, "mười hai": 12,
};
/** "Tháng Bảy 18, 2026" -> "2026-07-18". CSV của Google Sheets trả tiếng Việt dạng NFD (vd "a" + dấu
 *  kết hợp thay vì "á" liền) — PHẢI normalize("NFC") trước khi so khớp regex/bảng tên tháng viết tay
 *  (NFC), nếu không match sẽ âm thầm fail (nhìn y hệt khi in ra nhưng khác chuỗi ký tự). */
function parseVNLongDate(s: string): string {
  const m = (s || "").trim().normalize("NFC").match(/^Th[áa]ng\s+(.+?)\s+(\d{1,2}),\s*(\d{4})$/i);
  if (!m) return "";
  const mon = VN_MONTHS[m[1].trim().toLowerCase()];
  if (!mon) return "";
  return `${m[3]}-${String(mon).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

const GID = "2102157637";
let cache: DataHangData | null = null;
let inflight: Promise<DataHangData> | null = null;

export async function loadDataHang(signal?: AbortSignal): Promise<DataHangData> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const text = await withRetry(async () => {
        let lastErr: unknown;
        for (const base of csvSources(GID)) {
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
      const rows: DataHangRow[] = [];
      for (const r of raw.slice(1)) {
        const date = parseVNLongDate(r[0]);
        const warehouse = (r[1] || "").trim();
        if (!date || !warehouse) continue;
        rows.push({ date, warehouse, weightTon: parseVN(r[2] || "0") });
      }
      const d = { rows, lastSync: Date.now() };
      cache = d;
      return d;
    } catch {
      return { rows: [], lastSync: Date.now() };
    }
  })();
  try { return await inflight; } finally { inflight = null; }
}
