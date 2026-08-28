/* ============================================================
   Lịch TT + thông tin AM (phụ trách điểm) — đọc tab chính (gid=0).
   Mỗi tuyến gồm nhiều điểm; sau MỖI bưu cục có: ID AM · Tên AM · SDT AM.
   Cột: 0=Tên tuyến · 1=Tải trọng · 3=Tên kho · 4=Loại hình ·
        5=Tới · 6=Rời · 7=Loại tuyến · 12=ID AM · 13=Tên AM · 14=SDT AM.
   Realtime (poll 60s qua hook).
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import { timeToMin } from "./normalize";
import { csvSources } from "../config";

/** gid của tab chứa cột AM (Nội Thành HCM — workbook chính). */
export const AM_GID = "0";

export interface AmStop {
  kho: string;     // tên bưu cục / kho
  id: string;      // cột "ID" (mã bưu cục GHN, KHÁC "ID AM")
  loaiHinh: string;
  toi: string;     // giờ tới
  roi: string;     // giờ rời
  idAm: string;    // ID AM
  tenAm: string;   // Tên AM
  sdtAm: string;   // SDT AM
}
export interface AmRoute {
  code: string;    // tên tuyến
  load: string;    // tải trọng
  category: string; // loại tuyến
  stops: AmStop[];
}
export interface AmData { routes: AmRoute[]; ok: boolean; lastSync: number; }

/** Chuẩn hoá SĐT VN (thêm '0' nếu mất số 0 đầu do Sheets). */
function cleanPhone(s: string): string {
  const x = (s || "").replace(/[^\d]/g, "");
  if (!x) return "";
  return x.length === 9 ? "0" + x : x;
}

async function fetchFirst(signal?: AbortSignal): Promise<string | null> {
  for (const base of csvSources(AM_GID)) {
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

export async function loadAm(signal?: AbortSignal): Promise<AmData> {
  const text = await fetchFirst(signal);
  if (!text) return { routes: [], ok: false, lastSync: Date.now() };
  const rows = parseCSV(text);
  if (rows.length < 2) return { routes: [], ok: false, lastSync: Date.now() };

  const H = rows[0];
  // KHÔNG dùng "tuyen" trơ trọi: tab này có cột "Loại tuyến" (vd "Nội thành CA1", chỉ 12 giá trị)
  // và cột Tên Tuyến thật để trống tiêu đề (cột 0) -> khớp nhầm sang "Loại tuyến" trước khi rơi về
  // fallback cột 0, gộp nhầm hàng trăm mã tuyến thật vào 12 "tuyến" theo Loại tuyến (xem sheet.ts).
  const cRoute = (() => { const c = findCol(H, ["ten tuyen", "ma tuyen"]); return c >= 0 ? c : 0; })();
  const cLoad = findCol(H, ["tai trong", "trong tai"]);
  const cKho = findCol(H, ["ten kho", "kho", "buu cuc"]);
  const cId = findCol(H, ["id"]); // cột "ID" bưu cục — tách khỏi "ID AM" nhờ findCol khớp tuyệt đối trước
  const cLh = findCol(H, ["loai hinh"]);
  const cToi = findCol(H, ["toi diem", "gio toi", "gio den"]);
  const cRoi = findCol(H, ["roi diem", "gio roi", "gio di"]);
  const cCat = findCol(H, ["loai tuyen"]);
  const cIdAm = findCol(H, ["id am"]);
  const cTenAm = findCol(H, ["ten am"]);
  const cSdtAm = findCol(H, ["sdt am", "so dt am", "dien thoai am"]);
  const g = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] || "").trim() : "");

  const order: string[] = [];
  const map = new Map<string, AmRoute>();
  for (const r of rows.slice(1)) {
    const code = g(r, cRoute);
    const kho = g(r, cKho);
    if (!code && !kho) continue;
    const key = code || "(Không tên)";
    if (!map.has(key)) { map.set(key, { code: key, load: g(r, cLoad), category: g(r, cCat), stops: [] }); order.push(key); }
    const route = map.get(key)!;
    if (!route.load && g(r, cLoad)) route.load = g(r, cLoad);
    if (!route.category && g(r, cCat)) route.category = g(r, cCat);
    route.stops.push({
      kho,
      id: g(r, cId),
      loaiHinh: g(r, cLh),
      toi: g(r, cToi),
      roi: g(r, cRoi),
      idAm: g(r, cIdAm),
      tenAm: g(r, cTenAm),
      sdtAm: cleanPhone(g(r, cSdtAm)),
    });
  }

  const routes = order.map((k) => map.get(k)!);
  routes.forEach((rt) => {
    // Bỏ điểm trùng hệt (1 tuyến có thể lặp ở nhiều "Loại tuyến").
    const seen = new Set<string>();
    rt.stops = rt.stops.filter((s) => {
      const sig = `${s.kho}|${s.loaiHinh}|${s.toi}|${s.roi}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
    rt.stops.sort((a, b) => timeToMin(a.toi || a.roi) - timeToMin(b.toi || b.roi));
  });

  return { routes, ok: true, lastSync: Date.now() };
}
