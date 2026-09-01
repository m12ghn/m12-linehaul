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
function addDaysISO(iso: string, n: number): string {
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
  tlldVol: number | null; // lấp đầy theo thể tích
  tlldWeight: number | null; // lấp đầy theo khối lượng
  soDon: string; // số đơn hàng
  kg: string; // khối lượng (kg)
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

// CACHE: tránh gọi lại khi nhiều nơi cùng cần (Overview + TLLD Tuyến…) hoặc quay lại
// trang trong TTL. force=true để làm mới tay.
const TLLD_TTL = 45000; // 45s: dưới nhịp poll 60s -> vẫn realtime, nhưng chuyển/về trang dùng lại ngay.
let tlldCache: { at: number; data: TlldIndex } | null = null;
let tlldInflight: Promise<TlldIndex> | null = null;

export async function loadTlld(signal?: AbortSignal, force = false): Promise<TlldIndex> {
  if (!force) {
    if (tlldCache && Date.now() - tlldCache.at < TLLD_TTL) return tlldCache.data;
    if (tlldInflight) return tlldInflight; // đang tải -> dùng chung, KHÔNG tải 13MB lần 2
  }
  const run = loadTlldUncached(signal).then((d) => { tlldCache = { at: Date.now(), data: d }; return d; });
  tlldInflight = run;
  try { return await run; } finally { tlldInflight = null; }
}

async function loadTlldUncached(signal?: AbortSignal): Promise<TlldIndex> {
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

  // 1 dòng JSON = 1 chuyến (view đã khử trùng lặp điểm-dừng, xem 0005) -> không còn
  // phải đoán cột/tách nhiều tab hub như CSV cũ, chỉ việc gộp thẳng vào các map trên.
  function processDong(r: DongChuyenApi): void {
    const code = normCode(r.ma_tuyen || "");
    const date = r.ngay;
    const w = r.tlld_weight_chuyen;
    const mc = r.ma_chuyen || "";
    const hub = r.hub || "—";

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

    if (!code || !date || w == null) return;
    const ds = dayStat.get(date) ?? { n: 0, nz: 0 };
    ds.n++;
    if (w > 0) ds.nz++;
    dayStat.set(date, ds);
    let m = acc.get(code);
    if (!m) { m = new Map(); acc.set(code, m); }
    let e = m.get(date);
    if (!e) { e = { nhap: { s: 0, c: 0 }, xuat: { s: 0, c: 0 }, all: { s: 0, c: 0 } }; m.set(date, e); }
    e.all.s += w; e.all.c++;
    const dir = dirOf(r.loai_tai || "");
    if (dir === "xuat") { e.xuat.s += w; e.xuat.c++; }
    else if (dir === "nhap") { e.nhap.s += w; e.nhap.c++; }
  }

  for (const r of await fetchTlldLive(signal)) processDong(r);

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
    byCode.set(code, {
      n1, avg7, avg14: fortnight.avg, days14: fortnight.n, avg30: month.avg, days30: month.n,
      weekendAvg: weekend.avg, weekendDays: weekend.n,
      rollCur, rollPrev, calCur, calPrev,
      eventAvg: ev.avg, eventDays: ev.n,
      days: valid.length, trips, chuyen,
      routeText: routeTextAcc.get(code) ?? "", series, series30, seriesAll, lastVal, lastDate, hub,
    });
  }

  return { byCode, volByCode: volAcc, byChuyen, refDate, last7, last30, allDates: usable, event, lastSync: Date.now() };
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
