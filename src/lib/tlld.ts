/* ============================================================
   Đọc dữ liệu TLLD (tỷ lệ lấp đầy theo khối lượng) từ Supabase
   (api/tlld-live -> view m12.tlld_trip, một dòng mỗi CHUYẾN, xem 0005),
   gộp theo MÃ TUYẾN -> tính:
   - n1   : tỷ lệ lấp đầy ngày gần nhất (N-1)
   - avg7 : trung bình 7 ngày gần nhất
   - series: 7 điểm theo ngày (để vẽ sparkline)

   TRƯỚC 01/09/2026: đọc thẳng 4 tab CSV của workbook TLLD trên Google Sheet
   (mỗi tab 1 hub, ~17MB, phải tự đoán cột qua findCol()). Giờ nguồn thật là
   Data API (Trino) -> cron nạp vào Supabase -> đọc qua 1 endpoint JSON duy
   nhất, có tên cột rõ ràng, không cần đoán/parse CSV nữa. Toàn bộ phép tính
   BÊN DƯỚI (avg7, cuốn chiếu, tuần lịch...) giữ NGUYÊN không đổi — chỉ đổi
   phần nạp dữ liệu đầu vào.
   ============================================================ */
import { fetchWithTimeout } from "./fetchTimeout";

/** ISO yyyy-mm-dd rơi vào T7 (6) hoặc CN (0)? */
function isWeekendISO(iso: string): boolean {
  const d = new Date(iso + "T00:00:00");
  const w = d.getDay();
  return w === 0 || w === 6;
}

/** Chuẩn hoá mã tuyến để khớp (bỏ khoảng trắng, hoa hết). */
export function normCode(s: string): string {
  return (s || "").trim().toUpperCase().replace(/\s+/g, "");
}


export interface TlldRoute {
  n1: number | null; // lấp đầy ngày gần nhất
  avg7: number | null; // trung bình 7 ngày gần nhất (1 tuần)
  avg14: number | null; // trung bình 14 ngày gần nhất (2 tuần)
  days14: number; // số ngày góp vào avg14
  avg30: number | null; // trung bình tháng (tối đa 30 ngày có dữ liệu)
  days30: number; // số ngày góp vào avg30
  weekendAvg: number | null; // TB lấp đầy các ngày T7/CN (trong 30 ngày)
  weekendDays: number; // số ngày cuối tuần có dữ liệu
  // TLLD THEO VOLUME (số đơn) — SONG SONG bộ chỉ số khối lượng ở trên, thêm 01/09 khi rebuild
  // TLLD Tuyến (Sếp yêu cầu 2 góc nhìn khối lượng/Volume). Nhẹ hơn bộ khối lượng (không có
  // rollCur/rollPrev/calCur/calPrev/eventAvg — chưa có nơi nào cần so kỳ chi tiết theo Volume).
  tlldVol: {
    n1: number | null; avg7: number | null; avg14: number | null; avg30: number | null;
    weekendAvg: number | null;
    series: { date: string; val: number | null }[];
    series30: { date: string; val: number | null }[];
    lastVal: number | null; lastDate: string | null;
  };
  rollCur: (number | null)[]; // Phần 1 CUỐN CHIẾU — kỳ hiện tại [N-1, 7d, 14d, 20d] (kết thúc N-1)
  rollPrev: (number | null)[]; // Phần 1 — kỳ LIỀN TRƯỚC (back-to-back)
  calCur: (number | null)[]; // Phần 2 TUẦN LỊCH — hiện tại [N-1, tuần này, 2 tuần, 3 tuần] (T2→N-1)
  calPrev: (number | null)[]; // Phần 2 — tuần(s) TRƯỚC cùng số ngày (dịch theo tuần)
  eventAvg: number | null; // TB lấp đầy đợt event "ngày đôi" gần nhất
  eventDays: number; // số ngày có dữ liệu trong cửa sổ event
  days: number; // số ngày có dữ liệu trong 7 ngày
  trips: number; // tổng số chuyến góp vào
  chuyen: string[]; // các mã chuyến (ma_chuyen) thuộc mã tuyến này
  routeText: string; // mô tả lộ trình "1. ... -> 2. ..."
  series: { date: string; val: number | null }[]; // 7 ngày gần nhất
  series30: { date: string; val: number | null }[]; // tối đa 30 ngày gần nhất (biểu đồ theo tuần/tháng)
  seriesAll: { date: string; val: number | null }[]; // TOÀN BỘ ngày "đã chốt" có dữ liệu (không giới hạn 30 ngày)
  //  — dùng cho báo cáo Tổng TLLD cụm (gộp theo tuần/tháng xa hơn 30 ngày). KHÔNG thay avg30/series30
  //  ở trên (nhiều nơi khác đã dùng đúng ngữ nghĩa "30 ngày" của 2 field đó).
  lastVal: number | null; // TLLD của NGÀY GẦN NHẤT còn dữ liệu (kể cả cũ hơn 30 ngày) — cho tuyến chạy thưa
  lastDate: string | null; // ngày của lastVal (YYYY-MM-DD)
  hub: string; // hub nguồn (HCM01/HCM20/Sóng Thần/Tân Tạo) — tab có nhiều dòng nhất cho mã tuyến này
}

/** Cửa sổ event "ngày đôi" (d=m, vd 6/6) gần nhất + 6 ngày từ đó. null nếu chưa tới. */
export interface EventWindow {
  label: string; // vd "T6" (event tháng 6)
  range: string; // vd "06/06–11/06"
  dates: string[]; // 6 ngày YYYY-MM-DD
}
/** Export cho TlldTuyen.tsx (bộ lọc tra cứu khoảng ngày, thêm 03/09) — cộng/trừ ngày trên chuỗi ISO. */
export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function computeEventWindow(usable: string[]): EventWindow | null {
  if (!usable.length) return null;
  const last = usable[usable.length - 1];
  const years = new Set(usable.map((d) => +d.split("-")[0]));
  const cands: string[] = [];
  for (const y of years) for (let mo = 1; mo <= 12; mo++) {
    const mm = String(mo).padStart(2, "0");
    cands.push(`${y}-${mm}-${mm}`);
  }
  cands.sort();
  const past = cands.filter((c) => c <= last);
  if (!past.length) return null;
  const ev = past[past.length - 1];
  const dates = Array.from({ length: 6 }, (_, i) => addDaysISO(ev, i));
  const dd = ev.slice(8, 10), mm = ev.slice(5, 7);
  const end = dates[5];
  const label = `T${+mm}`;
  const range = `${dd}/${mm}–${end.slice(8, 10)}/${end.slice(5, 7)}`;
  return { label, range, dates };
}

/** Chi tiết 1 chuyến (1 dòng dữ liệu, tra theo ma_chuyen). */
export interface TlldChuyen {
  maChuyen: string;
  date: string; // YYYY-MM-DD
  code: string; // ma_tuyen
  routeText: string; // mô tả lộ trình "1. ... -> 2. ..."
  truckCap: string; // tải trọng xe
  bienSo: string; // biển số
  partner: string; // GHN / NCC
  loaiTai: string; // Nhập / Xuất
  tlldVol: number | null; // lấp đầy theo Volume
  tlldWeight: number | null; // lấp đầy theo khối lượng
  soDon: string; // số đơn hàng
  kg: string; // khối lượng (kg)
}

export interface TlldClusterDay {
  weightAvg: number | null; // TB lấp đầy khối lượng TOÀN CỤM ngày này (TB đơn giản qua các tuyến có chạy)
  volAvg: number | null; // TB lấp đầy Volume TOÀN CỤM ngày này
  tripCount: number; // số CHUYẾN (ma_chuyen) chạy trong ngày, TOÀN CỤM
  routeCount: number; // số TUYẾN có dữ liệu trong ngày (hợp cả tuyến chỉ có weight lẫn tuyến chỉ có volume)
}

export interface TlldIndex {
  byCode: Map<string, TlldRoute>;
  volByCode: Map<string, Map<string, { soDon: number; kg: number }>>; // tuyến -> ngày -> {số đơn, kg}
  byChuyen: Map<string, TlldChuyen>; // tra TLLD theo mã chuyến
  refDate: string | null; // ngày N-1 (mới nhất)
  last7: string[]; // 7 ngày gần nhất (tăng dần)
  last30: string[]; // tối đa 30 ngày gần nhất có dữ liệu (tăng dần) — biểu đồ theo tuần/tháng
  allDates: string[]; // TOÀN BỘ ngày "đã chốt" có dữ liệu, không giới hạn 30 ngày (tăng dần)
  event: EventWindow | null; // đợt event ngày đôi gần nhất
  // ngày -> {TB khối lượng, TB Volume, số chuyến, số tuyến} TOÀN CỤM — cho khung Tổng Quan
  // (scorecard N-1 so N-2, so cùng thứ tuần trước). Chỉ tính cho ngày "đã chốt" (usable), thêm 01/09.
  clusterDaily: Map<string, TlldClusterDay>;
  lastSync: number;
}

/** 1 dòng trả về từ api/tlld-live (= 1 chuyến, view m12.tlld_trip). */
interface DongChuyenApi {
  ngay: string;
  ma_chuyen: string;
  ma_tuyen: string | null;
  loai_tai: string | null;
  hub: string | null;
  bien_so: string | null;
  partner_type: string | null;
  tai_trong_xe: number | null;
  khoiluong_kg: number | null;
  so_don_hang: number | null;
  tlld_weight_chuyen: number | null;
  tlld_vol_chuyen: number | null;
}

async function fetchTlldLive(signal?: AbortSignal): Promise<DongChuyenApi[]> {
  // Cùng gốc (/api/...), không cần danh sách nguồn dự phòng như CSV Sheet trước đây.
  // Timeout rộng tay (30s) — dữ liệu sẽ lớn dần khi nạp thêm lịch sử các tháng trước.
  const res = await fetchWithTimeout("/api/tlld-live?_=" + Date.now(), { cache: "no-store", signal }, 30000);
  if (!res.ok) throw new Error("tlld_live_" + res.status);
  const d = await res.json();
  if (!d?.ok) throw new Error(d?.detail || d?.error || "tlld_live_loi");
  return (d.rows || []) as DongChuyenApi[];
}

/** 1 dòng CHUYẾN trả về cho bộ lọc "Tra cứu" TLLD Tuyến (khoảng ngày tự chọn + mã tuyến/mã chuyến,
 *  thêm 03/09/2026 — TlldTuyen.tsx). Nhẹ hơn TlldChuyen (không có routeText — bộ lọc chỉ TRA CỨU,
 *  không ghép với lịch toàn vùng để dựng lộ trình). KHÔNG dùng chung cache/index toàn cụm (rowsCache/
 *  tlldCache ở trên) vì khoảng ngày do Sếp tự chọn, có thể khác 30/45s TTL và khác hẳn "hôm nay" —
 *  gọi thẳng /api/tlld-live?tu=&den= mỗi lần tra cứu (đúng tinh thần "chỉ dùng để tra cứu", KHÔNG
 *  đụng vào cache/chỉ số cuốn-chiếu của các khung Sức khoẻ/KPI/2-cột cảnh báo). */
export interface TlldRangeRow {
  ngay: string;
  maChuyen: string;
  maTuyen: string;
  loaiTai: string;
  hub: string;
  bienSo: string;
  partner: string;
  truckCap: string;
  kg: string;
  soDon: string;
  tlldWeight: number | null;
  tlldVol: number | null;
}

/** Tra cứu CHUYẾN theo khoảng ngày [tu, den) tự chọn (bỏ trống = không giới hạn đầu/cuối) — dùng cho
 *  bộ lọc "Tra cứu" mới ở đầu trang TLLD Tuyến. Lọc thêm theo mã tuyến/mã chuyến làm ở phía gọi
 *  (TlldTuyen.tsx), vì đây chỉ là 1 lần gọi API thô, không gộp/tính lại như buildTlldIndex(). */
export async function fetchTlldRange(tu?: string, den?: string, signal?: AbortSignal): Promise<TlldRangeRow[]> {
  const qs = new URLSearchParams();
  if (tu) qs.set("tu", tu);
  if (den) qs.set("den", den);
  const url = "/api/tlld-live" + (qs.toString() ? "?" + qs.toString() : "");
  const res = await fetchWithTimeout(url, { cache: "no-store", signal }, 30000);
  if (!res.ok) throw new Error("tlld_live_" + res.status);
  const d = await res.json();
  if (!d?.ok) throw new Error(d?.detail || d?.error || "tlld_live_loi");
  const rows = (d.rows || []) as DongChuyenApi[];
  return rows.map((r) => ({
    ngay: r.ngay,
    maChuyen: r.ma_chuyen,
    maTuyen: r.ma_tuyen || "",
    loaiTai: r.loai_tai || "",
    hub: r.hub || "",
    bienSo: r.bien_so || "",
    partner: r.partner_type || "",
    truckCap: r.tai_trong_xe != null ? String(r.tai_trong_xe) : "",
    kg: r.khoiluong_kg != null ? String(r.khoiluong_kg) : "",
    soDon: r.so_don_hang != null ? String(r.so_don_hang) : "",
    tlldWeight: r.tlld_weight_chuyen ?? null,
    tlldVol: r.tlld_vol_chuyen ?? null,
  }));
}

// CACHE DÒNG THÔ (chưa gộp): tách riêng khỏi cache chỉ mục đã gộp bên dưới để LỌC THEO VÙNG
// (loadTlldForCodes, thêm 01/09 — xem lib/useTlld.ts useTlldRegion) dùng CHUNG 1 lần tải mạng,
// chỉ tính lại phần gộp (rẻ) thay vì gọi lại /api/tlld-live riêng cho mỗi vùng.
const TLLD_TTL = 45000; // 45s: dưới nhịp poll 60s -> vẫn realtime, nhưng chuyển/về trang dùng lại ngay.
let rowsCache: { at: number; data: DongChuyenApi[] } | null = null;
let rowsInflight: Promise<DongChuyenApi[]> | null = null;

async function loadTlldRows(signal?: AbortSignal, force = false): Promise<DongChuyenApi[]> {
  if (!force) {
    if (rowsCache && Date.now() - rowsCache.at < TLLD_TTL) return rowsCache.data;
    if (rowsInflight) return rowsInflight; // đang tải -> dùng chung, KHÔNG tải 13MB lần 2
  }
  const run = fetchTlldLive(signal).then((d) => { rowsCache = { at: Date.now(), data: d }; return d; });
  rowsInflight = run;
  try { return await run; } finally { rowsInflight = null; }
}

// CACHE CHỈ MỤC TOÀN CỤM (đã gộp, KHÔNG lọc vùng) — dùng cho tra cứu theo mã tuyến ở khắp nơi
// (Lịch Tải, Ghép Tải, GSVT, Overview…) + tab "Báo Cáo" (TlldClusterReport, CỐ Ý xem toàn cụm).
let tlldCache: { at: number; data: TlldIndex } | null = null;
let tlldInflight: Promise<TlldIndex> | null = null;

export async function loadTlld(signal?: AbortSignal, force = false): Promise<TlldIndex> {
  if (!force) {
    if (tlldCache && Date.now() - tlldCache.at < TLLD_TTL) return tlldCache.data;
    if (tlldInflight) return tlldInflight; // đang tải -> dùng chung, KHÔNG tải 13MB lần 2
  }
  const run = loadTlldRows(signal, force).then((rows) => {
    const idx = buildTlldIndex(rows);
    tlldCache = { at: Date.now(), data: idx };
    return idx;
  });
  tlldInflight = run;
  try { return await run; } finally { tlldInflight = null; }
}

/** Tải TLLD CHỈ CHO các mã tuyến cho trước (vd. đúng vùng/tab Lịch Tải đang chọn) — dùng cho khung
 *  "🩺 Sức khoẻ vận hành TLLD" (TlldSucKhoe). Sếp yêu cầu 01/09: đổi tab vùng phải đổi số, không
 *  giữ nguyên toàn cụm như bản đầu. Lọc NGAY TỪ DÒNG THÔ (1 dòng = 1 chuyến) rồi gộp lại bằng ĐÚNG
 *  buildTlldIndex() dùng chung với bản toàn cụm -> clusterDaily/byChuyen/byCode ra ĐÚNG số riêng
 *  của nhóm tuyến này, không suy ra/ước lượng từ số toàn cụm (đúng quy tắc "không bịa" của dự án —
 *  xem skill m12-conventions). Dùng CHUNG cache dòng thô ở trên (cùng TTL) -> đổi vùng KHÔNG tốn
 *  thêm request mạng, chỉ tính lại phần gộp (rẻ — mảng vài nghìn dòng). */
export async function loadTlldForCodes(allowedCodes: Set<string>, signal?: AbortSignal, force = false): Promise<TlldIndex> {
  const rows = await loadTlldRows(signal, force);
  const filtered = rows.filter((r) => allowedCodes.has(normCode(r.ma_tuyen || "")));
  return buildTlldIndex(filtered);
}

function buildTlldIndex(rows: DongChuyenApi[]): TlldIndex {
  // code -> date -> tích luỹ tlld_weight theo CHIỀU (nhập/xuất) + tổng (all).
  // Quy ước: tuyến bắt đầu từ KHO (giao) -> lấy chiều XUẤT; từ BƯU CỤC (lấy) -> chiều NHẬP.
  type DayAcc = { nhap: { s: number; c: number }; xuat: { s: number; c: number }; all: { s: number; c: number } };
  const acc = new Map<string, Map<string, DayAcc>>();
  const dirOf = (lt: string) => {
    const t = (lt || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return t.startsWith("xu") ? "xuat" : t.startsWith("nh") ? "nhap" : "all";
  };
  // code -> date -> {soDon, kg} (tổng số đơn + khối lượng mỗi tuyến/ngày)
  const volAcc = new Map<string, Map<string, { soDon: number; kg: number }>>();
  // code -> tập mã chuyến (ma_chuyen) để tìm kiếm
  const chuyenAcc = new Map<string, Set<string>>();
  // ma_chuyen -> chi tiết chuyến (tra cứu trực tiếp)
  const byChuyen = new Map<string, TlldChuyen>();
  // code -> mô tả lộ trình tiêu biểu
  const routeTextAcc = new Map<string, string>();
  // thống kê độ phủ theo ngày để loại ngày CHƯA CHỐT (đa số tlld=0)
  const dayStat = new Map<string, { n: number; nz: number }>();
  // code -> hub -> số dòng — để suy ra hub NGUỒN chính của mỗi mã tuyến (cho báo cáo Tổng cụm theo hub).
  const hubAcc = new Map<string, Map<string, number>>();
  // code -> date -> tích luỹ tlld_vol (THEO VOLUME/số đơn) — SONG SONG với `acc` (khối lượng),
  // CÙNG cấu trúc DayAcc, độc lập hoàn toàn (không phụ thuộc tlld_weight có null hay không) —
  // 01/09: rebuild TLLD Tuyến, Sếp yêu cầu thêm góc nhìn Volume bên cạnh khối lượng.
  const accTlldVol = new Map<string, Map<string, DayAcc>>();
  // ngày -> tập mã chuyến CHẠY trong ngày đó (đếm SỐ CHUYẾN/ngày cho khung Tổng Quan — không lẫn
  // với chuyenAcc bên dưới, vốn gom theo TUYẾN chứ không theo ngày).
  const tripsByDate = new Map<string, Set<string>>();
  /** Cộng 1 giá trị vào DayAcc (map[code][date]) theo đúng CHIỀU đã chọn — dùng chung cho cả
   *  tích luỹ khối lượng (acc) lẫn Volume (accTlldVol), tránh chép lại logic 2 lần. */
  function bump(target: Map<string, Map<string, DayAcc>>, code: string, date: string, val: number, dir: "xuat" | "nhap" | "all") {
    let m = target.get(code);
    if (!m) { m = new Map(); target.set(code, m); }
    let e = m.get(date);
    if (!e) { e = { nhap: { s: 0, c: 0 }, xuat: { s: 0, c: 0 }, all: { s: 0, c: 0 } }; m.set(date, e); }
    e.all.s += val; e.all.c++;
    if (dir === "xuat") { e.xuat.s += val; e.xuat.c++; }
    else if (dir === "nhap") { e.nhap.s += val; e.nhap.c++; }
  }

  // 1 dòng JSON = 1 chuyến (view đã khử trùng lặp điểm-dừng, xem 0005) -> không còn
  // phải đoán cột/tách nhiều tab hub như CSV cũ, chỉ việc gộp thẳng vào các map trên.
  function processDong(r: DongChuyenApi): void {
    const code = normCode(r.ma_tuyen || "");
    const date = r.ngay;
    const w = r.tlld_weight_chuyen;
    const vRatio = r.tlld_vol_chuyen;
    const mc = r.ma_chuyen || "";
    const hub = r.hub || "—";
    const dir = dirOf(r.loai_tai || ""); // tính 1 lần, dùng chung cho cả khối lượng lẫn Volume

    if (code) {
      let hm = hubAcc.get(code);
      if (!hm) { hm = new Map(); hubAcc.set(code, hm); }
      hm.set(hub, (hm.get(hub) || 0) + 1);
    }

    // Lập chỉ mục theo MÃ CHUYẾN (kể cả khi thiếu tlld_weight) để luôn tra được.
    if (mc) {
      const key = mc.toUpperCase();
      const existing = byChuyen.get(key);
      if (!existing || (existing.tlldWeight == null && w != null)) {
        byChuyen.set(key, {
          maChuyen: mc,
          date: date || "",
          code,
          // ⚠ Chưa có mô tả lộ trình từ nguồn Data API (khác CSV cũ có sẵn cột "route").
          // Nơi hiển thị (SapLichTai.tsx) đã có fallback dựng từ lịch tải khi rỗng.
          routeText: "",
          truckCap: r.tai_trong_xe != null ? String(r.tai_trong_xe) : "",
          bienSo: (r.bien_so || "").replace(/^_+/, ""),
          partner: r.partner_type || "",
          loaiTai: r.loai_tai || "",
          tlldVol: r.tlld_vol_chuyen,
          tlldWeight: w,
          soDon: r.so_don_hang != null ? String(r.so_don_hang) : "",
          kg: r.khoiluong_kg != null ? String(r.khoiluong_kg) : "",
        });
      }
      if (code) {
        let cs = chuyenAcc.get(code);
        if (!cs) { cs = new Set(); chuyenAcc.set(code, cs); }
        cs.add(mc);
      }
      if (date) {
        let ts = tripsByDate.get(date);
        if (!ts) { ts = new Set(); tripsByDate.set(date, ts); }
        ts.add(mc);
      }
    }

    // Gom số đơn + khối lượng theo tuyến/ngày (kể cả khi thiếu tlld_weight).
    if (code && date) {
      const soDon = r.so_don_hang || 0;
      const kg = r.khoiluong_kg || 0;
      if (soDon || kg) {
        let vm = volAcc.get(code);
        if (!vm) { vm = new Map(); volAcc.set(code, vm); }
        const ve = vm.get(date) ?? { soDon: 0, kg: 0 };
        ve.soDon += soDon; ve.kg += kg;
        vm.set(date, ve);
      }
    }

    // ---- TLLD THEO VOLUME — độc lập với khối lượng (không gộp vào gate w==null bên dưới,
    // để 1 dòng thiếu tlld_weight nhưng có tlld_vol vẫn không mất dữ liệu Volume). ----
    if (code && date && vRatio != null) bump(accTlldVol, code, date, vRatio, dir);

    // ---- TLLD THEO KHỐI LƯỢNG — GIỮ NGUYÊN hành vi cũ (gate + dayStat) không đổi. ----
    if (!code || !date || w == null) return;
    const ds = dayStat.get(date) ?? { n: 0, nz: 0 };
    ds.n++;
    if (w > 0) ds.nz++;
    dayStat.set(date, ds);
    bump(acc, code, date, w, dir);
  }

  for (const r of rows) processDong(r);

  // Ngày "đã chốt" = ≥70% dòng có giá trị > 0 (loại ngày đang nhập dở -> toàn 0).
  const complete = [...dayStat.entries()]
    .filter(([, s]) => s.n >= 5 && s.nz / s.n >= 0.7)
    .map(([d]) => d)
    .sort();
  const usable = complete.length ? complete : [...dayStat.keys()].sort();
  const refDate = usable.length ? usable[usable.length - 1] : null;
  const last7 = usable.slice(-7);
  // Cửa sổ 14 ngày lịch gần nhất (dữ liệu có) -> "TB 2 tuần".
  const cutoff14 = refDate ? addDaysISO(refDate, -13) : null;
  const last14 = cutoff14 ? usable.filter((d) => d >= cutoff14) : usable.slice(-14);
  // "TB tháng" = các ngày CÓ DỮ LIỆU nằm trong 30 ngày lịch gần nhất (tính từ ngày mới nhất).
  const cutoff30 = refDate ? addDaysISO(refDate, -29) : null;
  const last30 = cutoff30 ? usable.filter((d) => d >= cutoff30) : usable.slice(-30);
  const event = computeEventWindow(usable);

  const byCode = new Map<string, TlldRoute>();
  for (const [code, m] of acc) {
    // Chọn CHIỀU theo quy ước: tuyến có chiều XUẤT (bắt đầu từ kho/giao) -> dùng Xuất;
    // tuyến chỉ có NHẬP (bắt đầu từ bưu cục/lấy) -> dùng Nhập. Tránh gộp trùng cả 2 chiều.
    let xc = 0, nc = 0;
    for (const e of m.values()) { xc += e.xuat.c; nc += e.nhap.c; }
    const dir: "xuat" | "nhap" = xc > 0 ? "xuat" : "nhap";
    // Giá trị TLLD 1 ngày theo chiều đã chọn (fallback chiều kia / tổng nếu ngày đó thiếu).
    const dayVal = (d: string): number | null => {
      const e = m.get(d);
      if (!e) return null;
      const pri = e[dir];
      if (pri.c) return pri.s / pri.c;
      const alt = dir === "xuat" ? e.nhap : e.xuat;
      if (alt.c) return alt.s / alt.c;
      return e.all.c ? e.all.s / e.all.c : null;
    };
    const meanDays = (dates: string[]) => {
      const vs = dates.map(dayVal).filter((v): v is number => v != null);
      return { avg: vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null, n: vs.length };
    };
    const series = last7.map((d) => ({ date: d, val: dayVal(d) }));
    const series30 = last30.map((d) => ({ date: d, val: dayVal(d) })); // biểu đồ theo tuần/tháng
    const seriesAll = usable.map((d) => ({ date: d, val: dayVal(d) })); // toàn bộ lịch sử có (báo cáo Tổng cụm)
    // TLLD ngày GẦN NHẤT còn dữ liệu THỰC (duyệt TOÀN BỘ ngày của tuyến, kể cả cũ > 30 ngày).
    // Bỏ qua ngày = 0 (xe không chạy / chưa có tải) để lấy đúng lần chạy gần nhất có số.
    let lastDate: string | null = null, lastVal: number | null = null;
    for (const d of [...m.keys()].sort()) { const v = dayVal(d); if (v != null && v > 0) { lastDate = d; lastVal = v; } }
    const valid = series.filter((s) => s.val != null) as { date: string; val: number }[];
    const avg7 = valid.length ? valid.reduce((a, s) => a + s.val, 0) / valid.length : null;
    const n1 = refDate ? dayVal(refDate) : null;
    let trips = 0;
    for (const e of m.values()) trips += (dir === "xuat" ? e.xuat.c : e.nhap.c) || e.all.c;
    const chuyen = [...(chuyenAcc.get(code) ?? [])].sort();
    const fortnight = meanDays(last14);
    const month = meanDays(last30);
    const weekend = meanDays(last30.filter(isWeekendISO)); // TB lấp đầy T7/CN trong 30 ngày
    const ev = event ? meanDays(event.dates) : { avg: null, n: 0 };
    // ── SO SÁNH LẤP ĐẦY: 4 mốc (1/7/14/20 ngày) × 2 cách (cuốn chiếu / lịch cùng kỳ) ──
    // winAvg(a,b): TB lấp đầy các ngày từ (N-1)+a .. (N-1)+b (a<=b<=0).
    const winAvg = (a: number, b: number): number | null => {
      if (!refDate) return null;
      const days: string[] = [];
      for (let o = a; o <= b; o++) days.push(addDaysISO(refDate, o));
      return meanDays(days).avg;
    };
    // PHẦN 1 — CUỐN CHIẾU: [N-1] · 7 · 14 · 20 ngày gần nhất vs kỳ LIỀN TRƯỚC.
    const rollCur = [winAvg(0, 0), winAvg(-6, 0), winAvg(-13, 0), winAvg(-19, 0)];
    const rollPrev = [winAvg(-1, -1), winAvg(-13, -7), winAvg(-27, -14), winAvg(-39, -20)];
    // PHẦN 2 — TUẦN LỊCH: [N-1] · tuần này · 2 tuần · 3 tuần (đều tính T2→N-1) vs tuần(s) TRƯỚC
    // cùng số ngày (dịch theo bội số 7 để rơi đúng thứ). dw = thứ của N-1 (0=T2…6=CN).
    const dw = refDate ? (new Date(refDate + "T00:00:00").getDay() + 6) % 7 : 0;
    const calCur = [winAvg(0, 0), winAvg(-dw, 0), winAvg(-dw - 7, 0), winAvg(-dw - 14, 0)];
    const calPrev = [winAvg(-7, -7), winAvg(-dw - 7, -7), winAvg(-dw - 21, -14), winAvg(-dw - 35, -21)];
    // Hub NGUỒN chính = tab có nhiều dòng nhất cho mã tuyến này.
    const hubCounts = hubAcc.get(code);
    let hub = "—";
    if (hubCounts) { let best = -1; for (const [h, c] of hubCounts) if (c > best) { best = c; hub = h; } }

    // ── TLLD THEO VOLUME — SONG SONG với khối lượng ở trên, DÙNG CHUNG chiều `dir` đã chọn
    // (nhất quán: 1 tuyến chỉ có 1 chiều Xuất/Nhập cho cả 2 chỉ số) và CÙNG các cửa sổ ngày
    // (last7/last14/last30/refDate) đã tính 1 lần ở trên — không tính lại. ──
    const mVol = accTlldVol.get(code);
    const dayValVol = (d: string): number | null => {
      if (!mVol) return null;
      const e = mVol.get(d);
      if (!e) return null;
      const pri = e[dir];
      if (pri.c) return pri.s / pri.c;
      const alt = dir === "xuat" ? e.nhap : e.xuat;
      if (alt.c) return alt.s / alt.c;
      return e.all.c ? e.all.s / e.all.c : null;
    };
    const meanDaysVol = (dates: string[]) => {
      const vs = dates.map(dayValVol).filter((v): v is number => v != null);
      return { avg: vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null, n: vs.length };
    };
    const seriesVol = last7.map((d) => ({ date: d, val: dayValVol(d) }));
    const series30Vol = last30.map((d) => ({ date: d, val: dayValVol(d) }));
    let lastDateVol: string | null = null, lastValVol: number | null = null;
    if (mVol) for (const d of [...mVol.keys()].sort()) { const v = dayValVol(d); if (v != null && v > 0) { lastDateVol = d; lastValVol = v; } }
    const validVol = seriesVol.filter((s) => s.val != null) as { date: string; val: number }[];
    const avg7Vol = validVol.length ? validVol.reduce((a, s) => a + s.val, 0) / validVol.length : null;
    const n1Vol = refDate ? dayValVol(refDate) : null;
    const fortnightVol = meanDaysVol(last14);
    const monthVol = meanDaysVol(last30);
    const weekendVol = meanDaysVol(last30.filter(isWeekendISO));

    byCode.set(code, {
      n1, avg7, avg14: fortnight.avg, days14: fortnight.n, avg30: month.avg, days30: month.n,
      weekendAvg: weekend.avg, weekendDays: weekend.n,
      tlldVol: {
        n1: n1Vol, avg7: avg7Vol, avg14: fortnightVol.avg, avg30: monthVol.avg,
        weekendAvg: weekendVol.avg, series: seriesVol, series30: series30Vol,
        lastVal: lastValVol, lastDate: lastDateVol,
      },
      rollCur, rollPrev, calCur, calPrev,
      eventAvg: ev.avg, eventDays: ev.n,
      days: valid.length, trips, chuyen,
      routeText: routeTextAcc.get(code) ?? "", series, series30, seriesAll, lastVal, lastDate, hub,
    });
  }

  // ── TỔNG CỤM THEO NGÀY (clusterDaily) — cho khung Tổng Quan TLLD: N-1 so N-2, so cùng thứ tuần
  // trước, số chuyến/ngày. TB = trung bình ĐƠN GIẢN qua các tuyến/chuyến có chạy ngày đó (đúng quy
  // ước "TB lấp đầy" dùng xuyên suốt dự án — không trọng số theo tải trọng/số chuyến). ──
  const clusterDaily = new Map<string, TlldClusterDay>();
  for (const d of usable) {
    const wVals: number[] = [], vVals: number[] = [];
    const routesNgayDo = new Set<string>(); // hợp cả tuyến có weight LẪN tuyến chỉ có volume — tránh đếm thiếu
    for (const [code, m] of acc) { const e = m.get(d); if (e && e.all.c) { wVals.push(e.all.s / e.all.c); routesNgayDo.add(code); } }
    for (const [code, m] of accTlldVol) { const e = m.get(d); if (e && e.all.c) { vVals.push(e.all.s / e.all.c); routesNgayDo.add(code); } }
    clusterDaily.set(d, {
      weightAvg: wVals.length ? wVals.reduce((a, b) => a + b, 0) / wVals.length : null,
      volAvg: vVals.length ? vVals.reduce((a, b) => a + b, 0) / vVals.length : null,
      tripCount: tripsByDate.get(d)?.size ?? 0,
      routeCount: routesNgayDo.size,
    });
  }

  return { byCode, volByCode: volAcc, byChuyen, refDate, last7, last30, allDates: usable, event, clusterDaily, lastSync: Date.now() };
}

/* ---------- Tóm tắt TLLD theo nhóm tuyến cho trợ lý AI ---------- */
const pc = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");

/**
 * Dựng văn bản tóm tắt TLLD của một nhóm tuyến (vùng + loại tuyến đang chọn)
 * để gửi trợ lý phân tích: TB N-1/7 ngày, phân bố, TB theo ngày, tuyến thấp/cao.
 */
export function buildTlldDigest(
  items: { code: string; tlld: TlldRoute }[],
  opts: { regionLabel: string; catLabel: string; refDate: string | null; last7: string[]; eventLabel?: string }
): string {
  if (!items.length) return `Không có tuyến nào có dữ liệu TLLD ở ${opts.regionLabel} · ${opts.catLabel}.`;
  const valOf = (t: TlldRoute) => t.n1 ?? t.avg7;
  const avg = (sel: (t: TlldRoute) => number | null) => {
    const vs = items.map((x) => sel(x.tlld)).filter((v): v is number => v != null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  const high = items.filter((x) => (valOf(x.tlld) ?? 0) >= 0.85);
  const mid = items.filter((x) => { const v = valOf(x.tlld) ?? -1; return v >= 0.6 && v < 0.85; });
  const low = items.filter((x) => (valOf(x.tlld) ?? 1) < 0.6);
  const over = items.filter((x) => (valOf(x.tlld) ?? 0) > 1);

  const perDay = opts.last7.map((d) => {
    const vs = items.map((x) => x.tlld.series.find((s) => s.date === d)?.val ?? null).filter((v): v is number => v != null);
    return { d, avg: vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null };
  });

  const L: string[] = [];
  L.push(`BÁO CÁO TLLD (tỷ lệ lấp đầy theo khối lượng) — Vùng: ${opts.regionLabel}; Loại tuyến: ${opts.catLabel}.`);
  L.push(`Số tuyến có dữ liệu: ${items.length}. Ngày N-1: ${opts.refDate || "—"}.`);
  L.push(`TB lấp đầy N-1: ${pc(avg((t) => t.n1))}; TB 7 ngày: ${pc(avg((t) => t.avg7))}; TB tháng (30 ngày): ${pc(avg((t) => t.avg30))}.`);
  L.push(`Phân bố (theo N-1): TỐT ≥85%: ${high.length} tuyến; KHÁ 60–85%: ${mid.length}; THẤP <60% (lãng phí xe, nên ghép tải): ${low.length}; VƯỢT TẢI >100%: ${over.length}.`);
  L.push(`TB lấp đầy theo NGÀY (7 ngày gần nhất): ${perDay.map((x) => `${x.d.slice(5)}: ${pc(x.avg)}`).join("; ")}.`);
  if (opts.eventLabel) L.push(`TB lấp đầy đợt cao điểm ${opts.eventLabel}: ${pc(avg((t) => t.eventAvg))}.`);
  const sortLow = [...low].sort((a, b) => (valOf(a.tlld) ?? 0) - (valOf(b.tlld) ?? 0));
  L.push(`Tuyến THẤP nhất (<60%): ${sortLow.slice(0, 15).map((x) => `${x.code} ${pc(valOf(x.tlld))}`).join(", ") || "không"}.`);
  const sortHigh = [...items].sort((a, b) => (valOf(b.tlld) ?? 0) - (valOf(a.tlld) ?? 0));
  L.push(`Tuyến CAO nhất: ${sortHigh.slice(0, 8).map((x) => `${x.code} ${pc(valOf(x.tlld))}`).join(", ")}.`);
  return L.join("\n");
}

/* ============================================================
   TỔNG QUAN TLLD — Sức khoẻ vận hành: scorecard N-1/N-2/cùng thứ tuần trước,
   tuyến/chuyến lệch khối lượng-Volume, chuyến TLLD thấp, chi tiết điểm dừng.
   Thêm 01/09/2026 khi rebuild TLLD Tuyến theo yêu cầu Sếp.
   ============================================================ */

/** So sánh 1 chỉ số cụm (weightAvg/volAvg/tripCount) giữa 2 ngày — trả về cả 2 giá trị + delta. */
export interface SoSanhNgay { ngay: string | null; giaTri: number | null; ngayKia: string | null; giaTriKia: number | null; delta: number | null; deltaPct: number | null; }
function soSanh1Ngay(clusterDaily: Map<string, TlldClusterDay>, ngay: string | null, ngayKia: string | null, sel: (d: TlldClusterDay) => number | null): SoSanhNgay {
  const a = ngay ? clusterDaily.get(ngay) : undefined;
  const b = ngayKia ? clusterDaily.get(ngayKia) : undefined;
  const va = a ? sel(a) : null, vb = b ? sel(b) : null;
  return {
    ngay, giaTri: va, ngayKia, giaTriKia: vb,
    delta: va != null && vb != null ? va - vb : null,
    deltaPct: va != null && vb != null && vb !== 0 ? (va / vb - 1) : null,
  };
}

export interface TongQuanTlld {
  refDate: string | null;
  ngayTruoc: string | null; // N-2 (liền trước N-1)
  cungThuTuanTruoc: string | null; // N-1 trừ 7 ngày (cùng thứ tuần trước)
  weightSoN2: SoSanhNgay; weightSoTuanTruoc: SoSanhNgay;
  volSoN2: SoSanhNgay; volSoTuanTruoc: SoSanhNgay;
  soChuyenSoN2: SoSanhNgay; soChuyenSoTuanTruoc: SoSanhNgay;
  soChuyenN1: number | null; soTuyenN1: number | null;
}

/** Dựng khung Tổng Quan TLLD (scorecard N-1 vs N-2 + vs cùng thứ tuần trước) từ clusterDaily. */
export function buildTongQuanTlld(index: TlldIndex): TongQuanTlld {
  const refDate = index.refDate;
  const ngayTruoc = refDate ? addDaysISO(refDate, -1) : null;
  const cungThuTuanTruoc = refDate ? addDaysISO(refDate, -7) : null;
  const cd = index.clusterDaily;
  const w = (d: TlldClusterDay) => d.weightAvg;
  const v = (d: TlldClusterDay) => d.volAvg;
  const t = (d: TlldClusterDay) => d.tripCount;
  const cur = refDate ? cd.get(refDate) : undefined;
  return {
    refDate, ngayTruoc, cungThuTuanTruoc,
    weightSoN2: soSanh1Ngay(cd, refDate, ngayTruoc, w),
    weightSoTuanTruoc: soSanh1Ngay(cd, refDate, cungThuTuanTruoc, w),
    volSoN2: soSanh1Ngay(cd, refDate, ngayTruoc, v),
    volSoTuanTruoc: soSanh1Ngay(cd, refDate, cungThuTuanTruoc, v),
    soChuyenSoN2: soSanh1Ngay(cd, refDate, ngayTruoc, t),
    soChuyenSoTuanTruoc: soSanh1Ngay(cd, refDate, cungThuTuanTruoc, t),
    soChuyenN1: cur?.tripCount ?? null,
    soTuyenN1: cur?.routeCount ?? null,
  };
}

/** Danh sách CHUYẾN (không phải tuyến) có TLLD thấp — góc nhìn "1 lịch tải có nhiều chuyến theo
 *  từng ngày", khác `low`/`over` ở buildColumns() vốn tính theo TB TUYẾN. Bỏ 0% (khả năng không
 *  chạy/không có dữ liệu thật) — cùng ngưỡng với quy ước "lãng phí" dùng ở Overview.tsx. */
export function danhSachChuyenThap(
  index: TlldIndex,
  opts: { theo?: "weight" | "vol"; nguong?: number; n?: number } = {}
): TlldChuyen[] {
  const theo = opts.theo ?? "weight";
  const nguong = opts.nguong ?? 0.6;
  const n = opts.n ?? 30;
  const val = (c: TlldChuyen) => (theo === "weight" ? c.tlldWeight : c.tlldVol);
  return [...index.byChuyen.values()]
    .filter((c) => { const x = val(c); return x != null && x >= 0.005 && x < nguong; })
    .sort((a, b) => val(a)! - val(b)!)
    .slice(0, n);
}

export interface TlldLechKhoiLuongTheTich {
  code: string;
  weight: number; // avg7 (fallback n1) khối lượng
  volume: number; // avg7 (fallback n1) Volume
  lech: number; // weight - volume (âm = khối lượng thấp hơn Volume, dương = ngược lại)
}

/** Tuyến có TLLD khối lượng và Volume LỆCH NHAU đáng kể (vd đơn nhẹ-cồng kềnh: đầy Volume
 *  nhưng nhẹ cân, hoặc ngược lại đơn nặng-gọn: đầy cân nhưng thừa chỗ) — Sếp yêu cầu 01/09. */
export function computeLechKhoiLuongTheTich(index: TlldIndex, nguong = 0.15): TlldLechKhoiLuongTheTich[] {
  const out: TlldLechKhoiLuongTheTich[] = [];
  for (const [code, t] of index.byCode) {
    const w = t.avg7 ?? t.n1;
    const v = t.tlldVol.avg7 ?? t.tlldVol.n1;
    if (w == null || v == null) continue;
    const lech = w - v;
    if (Math.abs(lech) < nguong) continue;
    out.push({ code, weight: w, volume: v, lech });
  }
  return out.sort((a, b) => Math.abs(b.lech) - Math.abs(a.lech));
}

/** 1 điểm dừng của 1 chuyến — mức chi tiết nhất (tlld_daily), tải RIÊNG theo yêu cầu (không gộp
 *  sẵn như byChuyen — 1 chuyến trung bình ~3.3 điểm dừng, tải hết mọi chuyến sẽ rất nặng). */
export interface TlldDiemDung {
  ngay: string; maChuyen: string; thuTu: number;
  kho: string | null; khoTruocDo: string | null; khoTiepTheo: string | null;
  loaiTai: string | null;
  khoiluongKg: number | null; soDonHang: number | null;
  tlldWeightDiem: number | null; tlldVolDiem: number | null;
}
interface DiemDungApi {
  ngay: string; ma_chuyen: string; thu_tu: number; kho: string | null;
  kho_truoc_do: string | null; kho_tiep_theo: string | null; loai_tai: string | null;
  khoiluong_kg: number | null; so_don_hang: number | null;
  tlld_weight_diem: number | null; tlld_vol_diem: number | null;
}
/** Tải chi tiết TỪNG ĐIỂM DỪNG của 1 chuyến (theo mã chuyến) — dùng khi Sếp mở xem 1 chuyến cụ
 *  thể trong TLLD Tuyến (góc nhìn "theo điểm dừng" thay vì "cả chuyến"). Không cache — tra theo
 *  yêu cầu, khối lượng nhỏ (1 chuyến ~3-4 điểm dừng). */
export async function fetchDiemDungChuyen(maChuyen: string, signal?: AbortSignal): Promise<TlldDiemDung[]> {
  const q = maChuyen.trim();
  if (!q) return [];
  const res = await fetchWithTimeout(
    "/api/tlld-live?muc=diem&ma_chuyen=" + encodeURIComponent(q) + "&_=" + Date.now(),
    { cache: "no-store", signal },
    15000
  );
  if (!res.ok) throw new Error("tlld_diem_" + res.status);
  const d = await res.json();
  if (!d?.ok) throw new Error(d?.detail || d?.error || "tlld_diem_loi");
  return ((d.rows || []) as DiemDungApi[]).map((r) => ({
    ngay: r.ngay, maChuyen: r.ma_chuyen, thuTu: r.thu_tu,
    kho: r.kho, khoTruocDo: r.kho_truoc_do, khoTiepTheo: r.kho_tiep_theo, loaiTai: r.loai_tai,
    khoiluongKg: r.khoiluong_kg, soDonHang: r.so_don_hang,
    tlldWeightDiem: r.tlld_weight_diem, tlldVolDiem: r.tlld_vol_diem,
  }));
}
