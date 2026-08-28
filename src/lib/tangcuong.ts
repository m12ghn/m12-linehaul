/* ============================================================
   Đọc lịch TẢI TĂNG CƯỜNG từ tab chung (gid 414498895) — realtime.
   Sheet dạng BẢNG CHUẨN (1 dòng = 1 điểm dừng), phân biệt Lấy/Giao bằng cột
   "Loại vận hành": LẤY (bưu cục) · Giao (bưu cục) · Phân Loại (kho trung chuyển).
   - TC LẤY: điểm đầu = bưu cục → kho (Phân Loại) ở cuối.
   - TC GIAO: điểm đầu = kho (Phân Loại) → các điểm giao sau.
   1 "Tên lịch trình" = 1 xe (gồm nhiều dòng điểm). Thông tin xe ở các cột BSX/Tên TX/SĐT.
   ============================================================ */
import { parseCSV, findCol } from "./csv";
import { lookupCoord } from "./geo";
import { sheetCsvSources } from "../config";

export interface TCStop {
  name: string; // tên điểm / kho
  id: string; // cột "ID" trong Sheet (mã bưu cục GHN) — rỗng nếu sheet không có cột này (layout cũ)
  den: string; // giờ đến (Tới điểm)
  di: string; // giờ đi (Rời điểm)
  quan: string; // quận/huyện
  isKho: boolean; // điểm là KHO trung chuyển (Loại vận hành = Phân Loại)
  coord: [number, number] | null; // toạ độ (để vẽ bản đồ)
}
export interface TCRoute {
  code: string; // Tên lịch trình (SG_TCEV_xx / TC_ST_xx…)
  trongTai: string; // trọng tải xe
  ncc: string; // nhà cung cấp
  bks: string; // biển số
  tx: string; // tên tài xế
  sdt: string; // số điện thoại
  from: string; // Từ Ngày (thô, dd/mm/yy) — RÀ LẠI 2026-07-21: trước đây có đọc cột này nhưng chỉ
  to: string;   // gộp thành 1 dải ngày CHUNG cho cả sheet (dateRange()), bỏ luôn info theo TỪNG
                // route -> không tách được "route nào thuộc ngày nào" khi sheet live gộp NHIỀU kỳ
                // chưa dọn (vd Giao còn sót ngày kỳ trước, Lấy đã sang kỳ mới) — nay giữ per-route.
  stops: TCStop[];
}
export interface TangCuongData {
  date: string; // dải ngày vận hành (từ cột Từ Ngày / Đến ngày)
  routes: TCRoute[];
  ok: boolean; // false nếu không tải được nguồn (vd sheet chưa công khai)
  lastSync: number;
}

const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();

/** Trích số điện thoại VN (9–11 số, thêm '0' nếu thiếu) — lấy số ĐẦU tiên (SĐT tài xế). */
function cleanPhone(blob: string): string {
  const chunks = (blob || "").replace(/\D+/g, " ").trim().split(/\s+/).filter(Boolean);
  const cand = chunks.filter((c) => c.length >= 9 && c.length <= 11);
  if (!cand.length) return "";
  let p = cand[0];
  if (p.length === 9) p = "0" + p;
  return p;
}

const RE_PLATE = /\d{2}\s?[A-Za-z]{1,2}[-.\s]?\d{3}\.?\d{0,3}/;

/** Tách biển số / tài xế / SĐT từ các cột BSX ("BSX: 61H-00961"), Tên TX ("Tài xế: Tên (SĐT)"). */
function parseVehicle(bksCell: string, txCell: string, sdtCell: string): { bks: string; tx: string; sdt: string } {
  const pm = (bksCell || "").match(RE_PLATE);
  const bks = pm ? pm[0].replace(/\s+/g, "").replace(/\.$/, "").toUpperCase() : "";
  // Bỏ nhãn dẫn đầu kiểu "Tài xế:" nếu có.
  const dc = (txCell || "").replace(/^\s*[^:]*:\s*/, "").trim();
  const sdt = cleanPhone(dc) || cleanPhone(sdtCell);
  const tx = dc
    .replace(/\(.*$/, "") // bỏ "(SĐT)"
    .replace(/[0-9].*$/, "") // bỏ số & phần đuôi
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/).filter((w) => w.length > 1).join(" ")
    .trim();
  return { bks, tx, sdt };
}

async function fetchFirst(sources: string[], signal?: AbortSignal): Promise<string | null> {
  for (const base of sources) {
    try {
      const sep = base.includes("?") ? "&" : "?";
      const res = await fetch(base + sep + "_=" + Date.now(), { cache: "no-store", signal });
      if (res.ok) {
        const t = await res.text();
        if (t.trim().length > 5 && !/^\s*<!doctype html|requires you to sign in|Unauthorized/i.test(t.slice(0, 200))) return t;
      }
    } catch {
      /* nguồn kế tiếp */
    }
  }
  return null;
}

/** Parse "d/m/yy" | "d/m/yyyy" -> {d,m,y} (null nếu sai). */
function parseDMY(s: string): { d: number; m: number; y: number } | null {
  const mm = (s || "").trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!mm) return null;
  let y = parseInt(mm[3], 10);
  if (y < 100) y += 2000;
  return { d: parseInt(mm[1], 10), m: parseInt(mm[2], 10), y };
}
/** Dải ngày vận hành từ các cột Từ Ngày / Đến ngày -> "6–10/7/2026". */
function dateRange(dates: string[]): string {
  const ds = dates.map(parseDMY).filter((x): x is { d: number; m: number; y: number } => !!x);
  if (!ds.length) return "";
  const key = (x: { d: number; m: number; y: number }) => x.y * 10000 + x.m * 100 + x.d;
  const min = ds.reduce((a, b) => (key(b) < key(a) ? b : a));
  const max = ds.reduce((a, b) => (key(b) > key(a) ? b : a));
  if (key(min) === key(max)) return `${min.d}/${min.m}/${min.y}`;
  if (min.m === max.m && min.y === max.y) return `${min.d}–${max.d}/${min.m}/${min.y}`;
  return `${min.d}/${min.m}–${max.d}/${max.m}/${max.y}`;
}

export async function loadTangCuong(sheetId: string, gid: string, kindLabel: string, signal?: AbortSignal): Promise<TangCuongData> {
  if (!sheetId || !gid) return { date: "", routes: [], ok: false, lastSync: Date.now() };
  const text = await fetchFirst(sheetCsvSources(sheetId, gid), signal);
  if (!text) return { date: "", routes: [], ok: false, lastSync: Date.now() };
  const rows = parseCSV(text);
  if (rows.length < 2) return { date: "", routes: [], ok: false, lastSync: Date.now() };

  const H = rows[0];
  // Sheet cũ (vd "Event T6") KHÔNG có tiêu đề "Trọng tải" lẫn "Loại vận hành" (tiêu đề bị gộp ô/
  // để trống) -> layout THẬT là (code, diem, tai, toi, roi, ...), KHÁC layout chuẩn hiện tại
  // (code, tai, diem, vh, toi, roi, ...). Nếu suy đoán nhầm layout, "tai"/"diem" đọc lộn cột (số
  // trọng tải và tên kho tráo cho nhau), "vh" đọc trúng cột GIỜ -> hasLay/hasGiao luôn false ->
  // loadTangCuong() trả về 0 tuyến (đã xảy ra thật với "Event T6", xem [[m12-plan-event]] khi rà lại).
  // Phát hiện: CẢ 2 tiêu đề đều không tìm thấy theo tên -> chắc chắn là layout CŨ, đổi fallback.
  const cTaiByName = findCol(H, ["trong tai", "tai trong"]);
  const cVhByName = findCol(H, ["loai van hanh"]);
  const legacyLayout = cTaiByName < 0 && cVhByName < 0;
  const col = {
    code: (() => { const c = findCol(H, ["ten lich trinh", "ten tuyen", "ma tuyen", "tuyen"]); return c >= 0 ? c : 0; })(),
    tai: cTaiByName >= 0 ? cTaiByName : (legacyLayout ? 2 : 1),
    diem: (() => { const c = findCol(H, ["lo trinh", "ten diem", "diem", "buu cuc"]); if (c >= 0) return c; return legacyLayout ? 1 : 2; })(),
    vh: cVhByName, // -1 nếu layout cũ -> coi như KHÔNG có, dùng vị trí kho (đầu/cuối) để suy Lấy/Giao thay vì đọc text.
    toi: (() => { const c = findCol(H, ["toi diem", "gio den"]); if (c >= 0) return c; return legacyLayout ? 3 : 4; })(),
    roi: (() => { const c = findCol(H, ["roi diem", "gio di"]); if (c >= 0) return c; return legacyLayout ? 4 : 5; })(),
    tuNgay: findCol(H, ["tu ngay"]),
    denNgay: findCol(H, ["den ngay"]),
    quan: findCol(H, ["quan", "huyen"]),
    id: findCol(H, ["id"]), // -1 nếu sheet không có cột này (vd layout cũ) -> id luôn rỗng, không đoán vị trí
    ncc: findCol(H, ["ncc"]),
    bks: findCol(H, ["bsx", "bien so", "bks"]),
    tx: findCol(H, ["ten tx", "tai xe", "lai xe"]),
    sdt: findCol(H, ["sdt tai", "so dt", "sdt", "dien thoai"]),
  };
  const g = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] || "").replace(/\n/g, " ").trim() : "");

  // Gom dòng theo Tên lịch trình (giữ thứ tự xuất hiện), bỏ dòng tiêu đề lặp lại.
  // Sheet cũ (vd "Event T6") chỉ ghi "Tên lịch trình" ở DÒNG ĐẦU của mỗi tuyến — các dòng điểm dừng
  // tiếp theo để TRỐNG cột này (ngầm hiểu tiếp nối tuyến ngay phía trên). Nếu bỏ qua dòng trống này
  // (như code cũ `if (!code) continue`) sẽ MẤT các điểm dừng phụ (thường là điểm kho ở cuối/đầu) ->
  // 1 tuyến chỉ còn đúng 1 điểm -> không đủ dữ liệu suy Lấy/Giao. Carry-forward mã tuyến gần nhất
  // khi gặp dòng trống — KHÔNG ảnh hưởng sheet mới (luôn ghi mã trên MỌI dòng, dòng trống hiếm khi
  // xảy ra và nếu có sẽ bị lọc ở bước `.filter((s) => s.name)` phía dưới).
  const order: string[] = [];
  const groups = new Map<string, string[][]>();
  let lastCode = "";
  for (const r of rows.slice(1)) {
    let code = g(r, col.code);
    if (!code) {
      if (!lastCode) continue;
      code = lastCode;
    } else {
      const nc = norm(code);
      if (nc === "tuyen" || nc.includes("ten lich") || nc.includes("lo trinh") || nc.includes("tang cuong")) continue;
      lastCode = code;
    }
    if (!groups.has(code)) { groups.set(code, []); order.push(code); }
    groups.get(code)!.push(r);
  }

  const isGiaoTab = /giao/i.test(kindLabel);
  const routes: TCRoute[] = [];
  for (const code of order) {
    const rs = groups.get(code)!;

    const stops: TCStop[] = rs.map((r) => {
      const vh = norm(g(r, col.vh));
      const name = g(r, col.diem);
      const isKho = vh.includes("phan loai") || (vh === "" && /kho|phan loai/i.test(name));
      let quan = g(r, col.quan);
      if (/t[ừu]\s*ng[àa]y|đ[ếe]n\s*ng[àa]y|\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(quan)) quan = "";
      return { name, id: g(r, col.id), den: g(r, col.toi), di: g(r, col.roi), quan, isKho, coord: lookupCoord(name) || null };
    }).filter((s) => s.name);
    if (!stops.length) continue;

    let hasLay: boolean, hasGiao: boolean;
    if (col.vh >= 0) {
      const vhs = rs.map((r) => norm(g(r, col.vh)));
      hasLay = vhs.some((v) => v.includes("lay"));
      hasGiao = vhs.some((v) => v.includes("giao"));
    } else {
      // Sheet cũ KHÔNG có cột "Loại vận hành" -> suy Lấy/Giao từ VỊ TRÍ điểm kho trong tuyến, đúng
      // quy ước đã ghi ở đầu file: Lấy = bưu cục...kho ở CUỐI; Giao = kho ở ĐẦU...bưu cục ở sau.
      hasLay = !stops[0].isKho && stops[stops.length - 1].isKho;
      hasGiao = stops[0].isKho && !stops[stops.length - 1].isKho;
    }
    // Lọc theo tab: tab Giao giữ tuyến có điểm Giao; tab Lấy giữ tuyến có điểm Lấy.
    if (isGiaoTab ? !hasGiao : !hasLay) continue;

    // Đảm bảo ĐIỂM ĐẦU đúng: Lấy -> kho ở CUỐI; Giao -> kho ở ĐẦU (giữ thứ tự trong từng nhóm).
    const khoStops = stops.filter((s) => s.isKho);
    const other = stops.filter((s) => !s.isKho);
    const ordered = isGiaoTab ? [...khoStops, ...other] : [...other, ...khoStops];

    const trongTai = rs.map((r) => g(r, col.tai)).find(Boolean) || "";
    const ncc = rs.map((r) => g(r, col.ncc)).find(Boolean) || "";
    const from = rs.map((r) => g(r, col.tuNgay)).find(Boolean) || "";
    const to = rs.map((r) => g(r, col.denNgay)).find(Boolean) || "";
    const veh = rs.map((r) => parseVehicle(g(r, col.bks), g(r, col.tx), g(r, col.sdt))).find((v) => v.bks || v.tx || v.sdt) || { bks: "", tx: "", sdt: "" };
    routes.push({ code, trongTai, ncc, from, to, ...veh, stops: ordered });
  }

  const date = dateRange([...rows.slice(1).map((r) => g(r, col.tuNgay)), ...rows.slice(1).map((r) => g(r, col.denNgay))]);
  return { date, routes, ok: true, lastSync: Date.now() };
}
