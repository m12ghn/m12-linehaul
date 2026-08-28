/* ============================================================
   Đọc dữ liệu CỔNG XUẤT từ tab Nội Thành HCM (gid=0) của workbook chính.
   - Cổng xuất (col "Cổng xuất") = cổng của cả tuyến.
   - Mã port (col "Mã port", vd "11-G-90") -> Số = phần sau "G-".
   - "Tới điểm" = giờ tới tại kho "Hồ Chí Minh 20" của tuyến đó.
   - Ca Ngày / Ca Đêm phân theo giờ tới HCM20 (6h–18h = ngày).
   - Chỉ lấy bưu cục CÓ mã port. Realtime (đọc lại mỗi 60s).
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import { csvSources } from "../config";

export interface CongEntry {
  cong: string; // số cổng (Cổng xuất)
  tuyen: string; // mã tuyến
  kho: string; // tên bưu cục / điểm
  maPort: string; // mã port đầy đủ
  so: string; // số (sau "G-")
  toiHCM20: string; // giờ tới kho HCM20 của tuyến
  ca: "ngay" | "dem"; // ca ngày / ca đêm
}
export interface CongXuatData {
  entries: CongEntry[];
  lastSync: number;
}

async function fetchFirst(sources: string[], signal?: AbortSignal): Promise<string | null> {
  for (const base of sources) {
    try {
      const sep = base.includes("?") ? "&" : "?";
      const res = await fetch(base + sep + "_=" + Date.now(), { cache: "no-store", signal });
      if (res.ok) {
        const t = await res.text();
        if (t.trim().length > 5 && !/Unauthorized|requires you to sign in/i.test(t.slice(0, 200))) return t;
      }
    } catch {
      /* nguồn kế tiếp */
    }
  }
  return null;
}

/** Số sau "G-" trong mã port: "11-G-90" -> "90". */
function soFromPort(maPort: string): string {
  const parts = maPort.split(/G-/i);
  if (parts.length > 1) return parts[1].replace(/^[-\s]+/, "").trim();
  const m = maPort.match(/(\d+)\s*$/);
  return m ? m[1] : "";
}

/** Giờ "12:10" -> ca ngày nếu 6 <= giờ < 18, ngược lại ca đêm. */
function caOf(toi: string): "ngay" | "dem" {
  const m = (toi || "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return "ngay";
  const h = parseInt(m[1], 10);
  return h >= 6 && h < 18 ? "ngay" : "dem";
}

export async function loadCongXuat(signal?: AbortSignal): Promise<CongXuatData> {
  const text = await fetchFirst(csvSources("0"), signal);
  if (!text) return { entries: [], lastSync: Date.now() };
  const rows = parseCSV(text);
  if (rows.length < 2) return { entries: [], lastSync: Date.now() };

  const H = rows[0];
  // KHÔNG dùng "tuyen" trơ trọi: tab này có cột "Loại tuyến" khớp nhầm trước khi rơi về fallback
  // cột 0 (xem ghi chú đầy đủ ở sheet.ts, phát hiện 2026-08-04).
  const cR = findCol(H, ["ten tuyen", "ma tuyen"]) >= 0 ? findCol(H, ["ten tuyen", "ma tuyen"]) : 0;
  const cK = findCol(H, ["ten kho", "kho", "buu cuc"]) >= 0 ? findCol(H, ["ten kho", "kho", "buu cuc"]) : 3;
  const cToi = findCol(H, ["toi diem", "gio den", "gio toi"]) >= 0 ? findCol(H, ["toi diem", "gio den", "gio toi"]) : 5;
  const cCong = findCol(H, ["cong xuat", "cong"]) >= 0 ? findCol(H, ["cong xuat", "cong"]) : 8;
  const cPort = findCol(H, ["ma port", "port"]) >= 0 ? findCol(H, ["ma port", "port"]) : 9;
  const cLoai = findCol(H, ["loai hinh"]) >= 0 ? findCol(H, ["loai hinh"]) : 4;
  const g = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] || "").trim() : "");

  // Gom theo tuyến để lấy giờ tới HCM20 + cổng của tuyến
  const byRoute = new Map<string, { rows: string[][]; hcm20: string; cong: string }>();
  for (const r of rows.slice(1)) {
    const code = g(r, cR);
    if (!code) continue;
    let e = byRoute.get(code);
    if (!e) { e = { rows: [], hcm20: "", cong: "" }; byRoute.set(code, e); }
    e.rows.push(r);
    if (!e.hcm20 && /h[oồ]\s*ch[ií]\s*minh\s*20/i.test(g(r, cK))) e.hcm20 = g(r, cToi);
    if (!e.cong && g(r, cCong)) e.cong = g(r, cCong);
  }

  const entries: CongEntry[] = [];
  for (const [code, e] of byRoute) {
    for (const r of e.rows) {
      const maPort = g(r, cPort);
      if (!maPort) continue; // chỉ bưu cục có mã port
      // Cổng xuất = điểm GIAO: chỉ lấy "Giao" / "Giao và lấy", bỏ điểm chỉ "Lấy".
      if (!/giao/i.test(g(r, cLoai))) continue;
      const toi = e.hcm20 || g(r, cToi);
      entries.push({
        cong: e.cong || g(r, cCong),
        tuyen: code,
        kho: g(r, cK),
        maPort,
        so: soFromPort(maPort),
        toiHCM20: toi,
        ca: caOf(toi),
      });
    }
  }
  return { entries, lastSync: Date.now() };
}
