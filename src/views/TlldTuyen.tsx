import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { CategoryTabs } from "../components/CategoryTabs";
import { TlldCard } from "../components/TlldCard";
import { TlldReport, LongTrend } from "../components/TlldReport";
import { TlldClusterReport } from "../components/TlldClusterReport";
import { TlldSucKhoe } from "../components/TlldSucKhoe";
import { DieuChinhReport } from "../components/DieuChinhReport";
import { Collapsible } from "../components/Collapsible";
import { useTlld, useTlldRegion } from "../lib/useTlld";
import { useAllRoutes } from "../lib/allRoutes";
import {
  normCode,
  fetchDiemDungChuyen,
  fetchTlldRange,
  addDaysISO,
  type TlldRoute,
  type TlldDiemDung,
  type TlldRangeRow,
} from "../lib/tlld";
import { normSearch } from "../lib/normalize";
import { CATEGORY_LABELS } from "../config";
import type { Route, SheetData } from "../types";

const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");
const fillColor = (v: number | null) =>
  v == null ? "var(--muted)" : v >= 0.85 ? "var(--green)" : v >= 0.6 ? "var(--orange)" : "var(--red)";
function ddmm(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
/** Hôm nay theo giờ LOCAL, dạng YYYY-MM-DD — dùng làm mặc định "Đến ngày" khi bấm Tra cứu mà
 *  chưa chọn khoảng ngày (thêm 03/09/2026, bộ lọc Tra cứu TLLD Tuyến). */
function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

type TRow = { route: Route; tlld?: TlldRoute };
const getV = (t?: TlldRoute): number | null => (t ? (t.n1 ?? t.avg7) : null);
function avgOf(rows: TRow[], sel: (t: TlldRoute) => number | null): number | null {
  const vals = rows.map((x) => (x.tlld ? sel(x.tlld) : null)).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
interface TCol { key: string; title: string; hint: string; warn: TRow[]; items: TRow[]; restStart: number; }

/**
 * Chia tuyến thành 2 cột CẢNH BÁO:
 *  - "low" : TLLD cực thấp 1%–<40% (lãng phí) — thấp→cao
 *  - "over": Quá tải >90% — cao→thấp
 * Các tuyến CÒN LẠI (40–90%, rỗng <1%, chưa có dữ liệu) được rải vào cột NGẮN nhất,
 * sau một vạch ngăn "— Tuyến khác —", để lấp ô trống và cân bằng 2 cột.
 */
function buildColumns(rows: TRow[]): TCol[] {
  const low: TRow[] = [], over: TRow[] = [], normal: TRow[] = [], empty: TRow[] = [], nodata: TRow[] = [];
  for (const x of rows) {
    const v = getV(x.tlld);
    if (v == null) nodata.push(x);          // chưa có dữ liệu TLLD
    else if (v < 0.01) empty.push(x);       // rỗng <1%
    else if (v < 0.4) low.push(x);          // cực thấp 1%–<40%
    else if (v > 0.9) over.push(x);         // quá tải >90%
    else normal.push(x);                    // còn lại 40–90%
  }
  low.sort((a, b) => getV(a.tlld)! - getV(b.tlld)!);    // thấp → cao
  over.sort((a, b) => getV(b.tlld)! - getV(a.tlld)!);   // cao → thấp
  normal.sort((a, b) => getV(b.tlld)! - getV(a.tlld)!); // 40–90%: cao → thấp
  empty.sort((a, b) => getV(a.tlld)! - getV(b.tlld)!);
  nodata.sort((a, b) => a.route.route.localeCompare(b.route.route));
  const rest = [...normal, ...empty, ...nodata]; // tuyến còn lại (lấp ô trống)

  const cols: TCol[] = [
    { key: "low", title: "⚠️ TLLD cực thấp", hint: "1%–40%, thấp nhất lên đầu — lãng phí, nên ghép tải.", warn: low, items: [...low], restStart: low.length },
    { key: "over", title: "🔴 Quá tải", hint: ">90%, cao nhất lên đầu — thiếu xe, dễ rớt cut-off.", warn: over, items: [...over], restStart: over.length },
  ];
  const shortest = () => (cols[0].items.length <= cols[1].items.length ? cols[0] : cols[1]);
  for (const x of rest) shortest().items.push(x);
  return cols;
}

/**
 * TLLD Tuyến: menu vùng/loại tuyến như Lịch Tải; mỗi tuyến hiển thị
 * tỷ lệ lấp đầy (tlld_weight) ngày N-1 + trung bình 7 ngày gần nhất.
 */
/** Hub gộp mới (08/09) — trang "🌐 Toàn hub LM12SC" lấy THẲNG từ TLLD Supabase (index.byCode),
 *  không qua route Sheet nào cả (xem M12_WAREHOUSE_IDS/qualifying_trips ở api/_lib/tlldQuery.ts —
 *  đã mở rộng OR hub='LM12SC' cùng ngày để chuyến thuộc hub này không bị sót khi nạp). */
const HUB_LM12SC = "LM12SC";

/** Band tỷ lệ lấp đầy dùng cho bộ lọc "nhóm tlld" ở thanh Tra cứu (thêm 08/09, Sếp yêu cầu) —
 *  nửa khoảng [min, max), riêng band cuối ">50%" cố ý dùng > (không ≥) để không trùng biên với
 *  band liền trước "30–50%" (đã bao gồm đúng 50%). */
const TLLD_BANDS: { key: string; label: string; test: (v: number) => boolean }[] = [
  { key: "0-10", label: "0 – 10%", test: (v) => v >= 0 && v < 0.10 },
  { key: "10-20", label: "10 – 20%", test: (v) => v >= 0.10 && v < 0.20 },
  { key: "20-30", label: "20 – 30%", test: (v) => v >= 0.20 && v < 0.30 },
  { key: "30-50", label: "30 – 50%", test: (v) => v >= 0.30 && v <= 0.50 },
  { key: "50+", label: "> 50%", test: (v) => v > 0.50 },
];

/** "Nguồn khớp" — Sếp yêu cầu 08/09: lọc chuyến ở tab "🌐 Toàn hub LM12SC" theo ĐÚNG 3 điều kiện OR
 *  đang dùng ở qualifying_trips (api/_lib/tlldQuery.ts): hub='LM12SC', hoặc đi qua kho Tân Tạo/Tân
 *  Thuận. Multiple choice — chọn nhiều thì OR (khớp ít nhất 1 trong các mục đã chọn).
 *  ⚠ Cùng giới hạn với cột "hub"/"kho_dau" đã có từ trước: view tlld_trip chỉ giữ ĐIỂM DỪNG ĐẦU TIÊN
 *  của mỗi chuyến làm đại diện (xem 0005_tlld_trip_view.sql), nên "Tân Tạo"/"Tân Thuận" ở đây nghĩa
 *  là "điểm dừng ĐẦU của chuyến là kho đó" — KHÔNG phải "chuyến có ghé qua kho đó ở bất kỳ điểm nào
 *  dọc đường". Muốn đúng "bất kỳ điểm nào" phải thêm cột ở tầng SQL/view, chưa làm ở lần này. */
const NGUON_KHOP_DEFS: { key: string; label: string; test: (r: TlldRangeRow) => boolean }[] = [
  { key: "hub", label: "LM12SC (hub)", test: (r) => r.hub === HUB_LM12SC },
  { key: "tantao", label: "Tân Tạo", test: (r) => normSearch(r.khoDau).includes("tan tao") },
  { key: "tanthuan", label: "Tân Thuận", test: (r) => normSearch(r.khoDau).includes("tan thuan") },
];

export function TlldTuyen({
  data,
  regionLabel,
  category,
  setCategory,
  search: _search,
  setSearch: _setSearch,
  view = "tong-quan",
  hubMode = false,
}: {
  data: SheetData;
  regionLabel: string;
  category: string;
  setCategory: (c: string) => void;
  /** Không còn dùng để lọc TLLD Tuyến nữa (03/09 — Sếp chọn thay hẳn bằng bộ lọc Tra cứu riêng bên
   *  dưới), vẫn khai báo vì App.tsx truyền chung state này cho cả Lịch Tải lẫn TLLD Tuyến. */
  search: string;
  setSearch: (s: string) => void;
  /** Sub-tab trong "TLLD Tuyến": "tong-quan" = KPI + duyệt tuyến (như cũ);
   *  "bao-cao" = chỉ biểu đồ tổng hợp + nhận định AI (TlldReport), gọn cho việc đọc báo cáo nhanh. */
  view?: "tong-quan" | "bao-cao";
  /** true = đang xem tab "🌐 Toàn hub LM12SC" (thêm 08/09) — TÁCH BIỆT HOÀN TOÀN với 4 tab vùng
   *  cũ (Sếp yêu cầu): danh sách tuyến lấy THẲNG từ index.byCode lọc hub===LM12SC, không qua
   *  data.routes/CategoryTabs của vùng đang chọn. Định dạng khung (KPI, Sức khoẻ, 2 cột cảnh báo,
   *  Xu hướng dài hạn) giữ NGUYÊN như 4 tab cũ — chỉ khác NGUỒN danh sách tuyến. */
  hubMode?: boolean;
}) {
  const { index, loading, error, refresh } = useTlld();
  const allRoutes = useAllRoutes(); // lịch toàn vùng (realtime) để khớp lộ trình + tải trọng

  // Mã tuyến thuộc phạm vi đang xem — dùng để LỌC khung "🩺 Sức khoẻ vận hành TLLD" (Sếp yêu cầu
  // 01/09: đổi tab vùng phải đổi số). Bình thường lấy từ `data.routes` của vùng/tab Lịch Tải đang
  // chọn; ở tab "🌐 Toàn hub LM12SC" (hubMode) lấy thẳng các mã tuyến có hub===LM12SC trong index
  // TLLD toàn cục — KHÔNG phụ thuộc Sheet nào (đúng ý "tách biệt hoàn toàn với 4 tab cũ").
  const hubCodes = useMemo(() => {
    const s = new Set<string>();
    if (!hubMode || !index) return s;
    for (const [code, r] of index.byCode) if (r.hub === HUB_LM12SC) s.add(code);
    return s;
  }, [hubMode, index]);
  const regionCodes = useMemo(
    () => (hubMode ? hubCodes : new Set(data.routes.map((r) => normCode(r.route)).filter(Boolean))),
    [hubMode, hubCodes, data.routes]
  );
  const { index: regionIndex } = useTlldRegion(regionCodes);

  // ============================================================================================
  // BỘ LỌC "TRA CỨU" (khoảng ngày từ-đến + mã tuyến + mã chuyến) — thêm 03/09/2026, THAY HẲN ô tìm
  // kiếm chung cũ của trang này (Sếp chọn qua AskUserQuestion: "Thay hẳn ô tìm kiếm cũ"). CHỈ DÙNG
  // ĐỂ TRA CỨU (phương án khuyến nghị Sếp chọn) — TÁCH RIÊNG hoàn toàn khỏi index/regionIndex ở
  // trên: khung "🩺 Sức khoẻ vận hành TLLD", KPI vùng, và danh sách 2 cột cảnh báo bên dưới VẪN
  // tính như cũ (cuốn chiếu quanh "hôm nay", KHÔNG đổi theo bộ lọc này). Bộ lọc gọi RIÊNG
  // fetchTlldRange() (1 lần gọi /api/tlld-live?tu=&den= mỗi lần tra cứu), dựng 1 khu vực kết quả
  // RIÊNG bên dưới — không ghi đè rows/columns/withData mà các khung phía trên đang dùng.
  // ============================================================================================
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fMaTuyen, setFMaTuyen] = useState("");
  const [fMaChuyen, setFMaChuyen] = useState("");
  // Thêm 08/09 (Sếp yêu cầu): lọc theo biển số xe + "nhóm tlld" (băng tỷ lệ lấp đầy) — áp cho CẢ
  // 2 chỉ số (khối lượng/volume), có ô chọn chỉ số nào để áp band. fMetric mặc định "weight" —
  // khớp đúng chỉ số đang hiển thị khắp trang này ("Lấp đầy theo khối lượng tlld_weight").
  const [fBsx, setFBsx] = useState("");
  const [fBand, setFBand] = useState(""); // "" = không lọc nhóm; khác thì là band.key ở TLLD_BANDS
  const [fMetric, setFMetric] = useState<"weight" | "vol">("weight");
  // "Nguồn khớp" (thêm 08/09) — CHỈ áp dụng/hiện ở hubMode (tab "🌐 Toàn hub LM12SC"), không có ý
  // nghĩa ở 4 tab vùng cũ (đã lọc theo Sheet route rồi). Set rỗng = không lọc (như các ô khác).
  // ⚠ Sếp phản hồi 08/09: tick checkbox mà "chưa apply" — vì các ô khác (ngày/mã tuyến/BSX/band) đều
  // cần bấm "🔎 Tra cứu" mới chạy, checkbox này lúc đầu làm GIỐNG vậy nên im lặng không thấy gì đổi.
  // Checkbox là thao tác rời rạc (không gõ từng phím như ô text) nên tự CHẠY LUÔN khi tick, không bắt
  // bấm thêm nút — khác 3 ô kia (vẫn giữ nguyên hành vi cũ, tránh gọi API dồn dập khi đang gõ).
  const [fNguon, setFNguon] = useState<Set<string>>(new Set());
  function toggleNguon(key: string) {
    const s = new Set(fNguon);
    if (s.has(key)) s.delete(key); else s.add(key);
    setFNguon(s);
    runLookup({ nguon: s });
  }
  const [lookupRows, setLookupRows] = useState<TlldRangeRow[] | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const lookupTouched = !!(fFrom || fTo || fMaTuyen.trim() || fMaChuyen.trim() || fBsx.trim() || fBand || fNguon.size);

  async function runLookup(over?: { from?: string; to?: string; maTuyen?: string; maChuyen?: string; bsx?: string; band?: string; metric?: "weight" | "vol"; nguon?: Set<string> }) {
    const from = over?.from ?? fFrom;
    const to = over?.to ?? fTo;
    const maTuyen = over?.maTuyen ?? fMaTuyen;
    const maChuyen = over?.maChuyen ?? fMaChuyen;
    const bsx = over?.bsx ?? fBsx;
    const band = over?.band ?? fBand;
    const metric = over?.metric ?? fMetric;
    const nguon = over?.nguon ?? fNguon;
    if (!from && !to && !maTuyen.trim() && !maChuyen.trim() && !bsx.trim() && !band && !nguon.size) {
      setLookupRows(null); setLookupErr(null); return;
    }
    setLookupLoading(true); setLookupErr(null);
    try {
      // Chưa chọn ngày nào -> mặc định 30 ngày gần nhất (kể cả hôm nay), tránh kéo cả lịch sử.
      const to2 = to || todayISO();
      const from2 = from || addDaysISO(to2, -29);
      const den = addDaysISO(to2, 1); // API lọc nửa khoảng [tu, den) -> +1 ngày để BAO GỒM "Đến ngày"
      const raw = await fetchTlldRange(from2, den);
      const codeQ = normCode(maTuyen);
      const chQ = normSearch(maChuyen);
      const bsxQ = normSearch(bsx);
      const bandDef = band ? TLLD_BANDS.find((b) => b.key === band) : undefined;
      let out = raw.filter((r) => {
        if (codeQ && !normCode(r.maTuyen).includes(codeQ)) return false;
        if (chQ && !normSearch(r.maChuyen).includes(chQ)) return false;
        if (bsxQ && !normSearch(r.bienSo || "").includes(bsxQ)) return false;
        if (bandDef) {
          const v = metric === "weight" ? r.tlldWeight : r.tlldVol;
          if (v == null || !bandDef.test(v)) return false;
        }
        // "Nguồn khớp" — multiple choice, OR: khớp ít nhất 1 mục đã chọn.
        if (nguon.size && !NGUON_KHOP_DEFS.some((d) => nguon.has(d.key) && d.test(r))) return false;
        return true;
      });
      out = out.sort((a, b) => b.ngay.localeCompare(a.ngay) || a.maChuyen.localeCompare(b.maChuyen));
      setLookupRows(out);
    } catch (e) {
      setLookupErr(e instanceof Error ? e.message : String(e));
      setLookupRows(null);
    } finally {
      setLookupLoading(false);
    }
  }
  function clearLookup() {
    setFFrom(""); setFTo(""); setFMaTuyen(""); setFMaChuyen(""); setFBsx(""); setFBand("");
    setFNguon(new Set());
    setLookupRows(null); setLookupErr(null);
  }
  // Bấm chip "Tuyến lấp đầy <60%" ở KPI (bên dưới) -> tra cứu NGAY tuyến đó, mặc định 30 ngày gần nhất.
  function lookupRouteChip(code: string) {
    setFMaTuyen(code); setFMaChuyen(""); setFFrom(""); setFTo(""); setFBsx(""); setFBand("");
    setFNguon(new Set());
    runLookup({ maTuyen: code, maChuyen: "", from: "", to: "", bsx: "", band: "", nguon: new Set() });
  }

  // Đúng 1 chuyến khớp bộ lọc -> coi là "đang tra 1 chuyến cụ thể", hiện thẻ chi tiết FULL TRIP.
  const lookupHit = lookupRows && lookupRows.length === 1 ? lookupRows[0] : null;
  const lookupHitRouteText = lookupHit ? index?.byCode.get(normCode(lookupHit.maTuyen))?.routeText : undefined;

  // Xem TLLD theo TỪNG ĐIỂM DỪNG của chuyến đang tra (lookupHit) — bấm mở, tải theo yêu cầu, KHÔNG
  // tải sẵn (cùng cách làm với TlldSucKhoe.tsx).
  const [diemOpen, setDiemOpen] = useState(false);
  const [diemRows, setDiemRows] = useState<TlldDiemDung[] | null>(null);
  const [diemLoading, setDiemLoading] = useState(false);
  const [diemErr, setDiemErr] = useState<string | null>(null);
  useEffect(() => { setDiemOpen(false); setDiemRows(null); setDiemErr(null); }, [lookupHit?.maChuyen]);
  async function toggleDiemLookupHit() {
    if (diemOpen) { setDiemOpen(false); return; }
    setDiemOpen(true);
    if (diemRows || diemLoading) return; // đã tải/đang tải rồi -> khỏi gọi lại
    setDiemLoading(true); setDiemErr(null);
    try {
      setDiemRows(await fetchDiemDungChuyen(lookupHit!.maChuyen));
    } catch (e) {
      setDiemErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDiemLoading(false);
    }
  }

  // ============================================================================================
  // Danh sách tuyến theo VÙNG + LOẠI TUYẾN đang chọn (KPI + 2 cột cảnh báo) — KHÔNG lọc theo bộ lọc
  // Tra cứu ở trên (đúng nguyên tắc "chỉ dùng để tra cứu"): luôn hiện ĐỦ tuyến của vùng/loại tuyến
  // đang chọn, y hệt hành vi "duyệt" trước đây khi ô tìm kiếm cũ còn trống.
  // Ở hubMode (tab "🌐 Toàn hub LM12SC") KHÔNG dùng data.routes/category — xem nhánh `rows` bên
  // dưới lấy thẳng từ hubCodes/index.
  // ============================================================================================
  const byCat = useMemo(
    () => (category ? data.routes.filter((r) => r.category === category) : data.routes),
    [data.routes, category]
  );

  // Bổ sung lộ trình (giờ tới/rời, loại hình) + tải trọng từ lịch TOÀN VÙNG cho 1 tuyến, rồi ghép
  // TLLD theo mã tuyến — TÍNH 1 LẦN mỗi khi input thật sự đổi (KHÔNG mỗi lần render do cuộn trang
  // đổi `visible`, đây là nguyên nhân chính khiến duyệt/cuộn danh sách bị giật — Sếp báo 2026-08-12).
  const rows = useMemo(() => {
    if (hubMode) {
      // Không có "Route" Sheet nào cho các mã tuyến này (đến thẳng từ TLLD) — dựng stub tối thiểu
      // đủ để TlldCard/buildColumns dùng được (route.route/stops — stops rỗng thì TlldCard tự
      // fallback đọc lộ trình từ tlld.routeText, xem components/TlldCard.tsx).
      const out: TRow[] = [];
      for (const code of hubCodes) {
        const tlld = index?.byCode.get(code);
        if (!tlld) continue;
        out.push({ route: { route: code, load: "", category: "", stops: [], mappedCount: 0 }, tlld });
      }
      return out;
    }
    const enrich = (r: Route): Route => {
      const g = allRoutes.get(normCode(r.route));
      if (!g) return r;
      const hasTimesHere = r.stops.some((s) => s.toi || s.roi);
      return {
        ...r,
        load: r.load || g.load,
        category: r.category || g.category,
        stops: hasTimesHere ? r.stops : (g.stops.length ? g.stops : r.stops),
      };
    };
    return byCat.map((r) => ({ route: enrich(r), tlld: index?.byCode.get(normCode(r.route)) }));
  }, [hubMode, hubCodes, byCat, allRoutes, index]);

  // KPI vùng (chỉ tính tuyến có dữ liệu)
  const withData = useMemo(() => rows.filter((x) => x.tlld && (x.tlld.n1 != null || x.tlld.avg7 != null)), [rows]);
  const avgN1 = useMemo(() => avgOf(withData, (t) => t.n1), [withData]);
  const avg7 = useMemo(() => avgOf(withData, (t) => t.avg7), [withData]);
  // Các tuyến lấp đầy < 60% (theo N-1), xếp thấp nhất lên đầu.
  const lowRoutes = useMemo(
    () =>
      withData
        .map((x) => ({ code: x.route.route, val: x.tlld!.n1 ?? x.tlld!.avg7 ?? 1 }))
        .filter((x) => x.val < 0.6)
        .sort((a, b) => a.val - b.val),
    [withData]
  );
  const lowCount = lowRoutes.length;

  const columns = useMemo(() => buildColumns(rows), [rows]);

  const PAGE = 30;
  const [visible, setVisible] = useState(PAGE);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisible(PAGE);
    if (frameRef.current) frameRef.current.scrollTop = 0;
  }, [category, regionLabel]);

  // Lăn chuột / kéo thanh trong khung tới gần đáy -> hiện thêm.
  function onListScroll() {
    const el = frameRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 320) {
      setVisible((v) => (v < rows.length ? Math.min(rows.length, v + PAGE) : v));
    }
  }
  // Bảo đảm khung LUÔN đủ cao để cuộn (màn hình cao / ít tuyến) + khi đổi cỡ màn hình.
  useEffect(() => {
    function fill() {
      const el = frameRef.current;
      if (el && el.scrollHeight <= el.clientHeight + 4) {
        setVisible((v) => (v < rows.length ? Math.min(rows.length, v + PAGE) : v));
      }
    }
    fill();
    window.addEventListener("resize", fill);
    return () => window.removeEventListener("resize", fill);
  }, [visible, rows.length]);

  // Sub-tab "Báo Cáo": TỔNG QUAN trước (Tổng TLLD của Cụm — gộp toàn bộ 4 hub, không phụ
  // thuộc vùng/loại tuyến đang chọn), rồi tới CHI TIẾT (báo cáo theo vùng+loại tuyến đang chọn,
  // gấp gọn mặc định vì đã có bức tranh tổng ở trên).
  if (view === "bao-cao") {
    return (
      <>
        <TlldClusterReport />
      <DieuChinhReport />
        <Collapsible
          className="tlld-cum-detail"
          style={{ marginTop: 12 }}
          title="📍 Báo cáo theo vùng & loại tuyến đang chọn"
          sub={`${regionLabel} · ${category ? (CATEGORY_LABELS[category] || category) : "Tất cả tuyến"}`}
        >
          <CategoryTabs
            categories={data.categories}
            routes={data.routes}
            active={category}
            onChange={setCategory}
          />
          <TlldReport
            items={withData.map((x) => ({ code: x.route.route, tlld: x.tlld! }))}
            index={index}
            regionLabel={regionLabel}
            catLabel={category ? (CATEGORY_LABELS[category] || category) : "Tất cả tuyến"}
          />
        </Collapsible>
      </>
    );
  }

  return (
    <>
      {/* BỘ LỌC "TRA CỨU" — thay ô tìm kiếm cũ, đóng băng ở ĐẦU TRANG khi cuộn (03/09; đưa lên trên
          cùng — TRƯỚC cả khung Sức khoẻ + KPI — theo phản hồi Sếp sau khi xem bản đầu đặt dưới 2
          khung đó). CHỈ DÙNG ĐỂ TRA CỨU — không đụng index/regionIndex hay bất kỳ tính toán nào bên
          dưới, xem chi tiết ở khối state runLookup() phía trên. */}
      <div className="toolbar tlld-lookup-bar">
        <div className="tlld-lookup-fields">
          <label className="tlld-lookup-f">
            <span>Từ ngày</span>
            <input type="date" value={fFrom} max={fTo || undefined} onChange={(e) => setFFrom(e.target.value)} />
          </label>
          <label className="tlld-lookup-f">
            <span>Đến ngày</span>
            <input type="date" value={fTo} min={fFrom || undefined} onChange={(e) => setFTo(e.target.value)} />
          </label>
          <label className="tlld-lookup-f">
            <span>Mã tuyến</span>
            <input
              type="text"
              placeholder="VD: HCM01-…"
              value={fMaTuyen}
              onChange={(e) => setFMaTuyen(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runLookup(); }}
            />
          </label>
          <label className="tlld-lookup-f">
            <span>Mã chuyến</span>
            <input
              type="text"
              placeholder="VD: CH…"
              value={fMaChuyen}
              onChange={(e) => setFMaChuyen(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runLookup(); }}
            />
          </label>
          <label className="tlld-lookup-f">
            <span>Biển số xe</span>
            <input
              type="text"
              placeholder="VD: 51D-…"
              value={fBsx}
              onChange={(e) => setFBsx(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runLookup(); }}
            />
          </label>
          <label className="tlld-lookup-f">
            <span>Nhóm TLLD</span>
            <select value={fBand} onChange={(e) => setFBand(e.target.value)}>
              <option value="">Tất cả</option>
              {TLLD_BANDS.map((b) => (
                <option key={b.key} value={b.key}>{b.label}</option>
              ))}
            </select>
          </label>
          {fBand && (
            <label className="tlld-lookup-f">
              <span>Theo chỉ số</span>
              <select value={fMetric} onChange={(e) => setFMetric(e.target.value as "weight" | "vol")}>
                <option value="weight">Khối lượng</option>
                <option value="vol">Số đơn (volume)</option>
              </select>
            </label>
          )}
          {/* "Nguồn khớp" — thêm 08/09, CHỈ ở tab "🌐 Toàn hub LM12SC" (không có ý nghĩa ở 4 tab vùng
              cũ, đã lọc theo Sheet route rồi). Multiple choice — chọn nhiều thì OR. */}
          {hubMode && (
            <div className="tlld-lookup-f tlld-lookup-nguon">
              <span>Nguồn khớp</span>
              <div className="tlld-lookup-nguon-opts">
                {NGUON_KHOP_DEFS.map((d) => (
                  <label key={d.key}>
                    <input
                      type="checkbox"
                      checked={fNguon.has(d.key)}
                      onChange={() => toggleNguon(d.key)}
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
          )}
          <button type="button" className="refresh-btn" onClick={() => runLookup()} disabled={lookupLoading}>
            {lookupLoading ? "Đang tra…" : "🔎 Tra cứu"}
          </button>
          {lookupTouched && (
            <button type="button" className="refresh-btn" onClick={clearLookup}>Xoá lọc</button>
          )}
        </div>
        <button className={"refresh-btn" + (loading ? " spin" : "")} onClick={refresh} disabled={loading}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
          </svg>
          {loading ? "Đang tải TLLD…" : "Làm mới"}
        </button>
      </div>

      {/* SỨC KHOẺ VẬN HÀNH TLLD — LỌC THEO VÙNG đang chọn (regionIndex, đổi theo sheetKey/tab —
          Sếp yêu cầu 01/09), KHÔNG còn xem toàn cụm như bản đầu. Ở hubMode lọc theo hubCodes (toàn
          hub LM12SC) thay vì vùng Sheet. Xem src/components/TlldSucKhoe.tsx + useTlldRegion() ở
          lib/useTlld.ts. KHÔNG bị ảnh hưởng bởi bộ lọc Tra cứu ở trên (03/09 — chỉ dùng để tra
          cứu, không đụng khung này). */}
      <TlldSucKhoe index={regionIndex} />

      <div className="kpi-row tlld" style={{ marginTop: 16 }}>
        <div className="kpi">
          <div className="lbl">Tuyến có dữ liệu TLLD</div>
          <div className="val orange">{withData.length}</div>
          <div className="note">/ {hubMode ? hubCodes.size : byCat.length} tuyến {hubMode ? "thuộc hub LM12SC" : "vùng này"}</div>
        </div>
        <div className="kpi blue">
          <div className="lbl">TB lấp đầy N-1</div>
          <div className="val">{pct(avgN1)}</div>
          <div className="note">ngày {ddmm(index?.refDate ?? null)}</div>
        </div>
        <div className="kpi green">
          <div className="lbl">TB lấp đầy 7 ngày</div>
          <div className="val">{pct(avg7)}</div>
          <div className="badge">{index ? `${index.last7.length} ngày gần nhất` : "—"}</div>
        </div>
        <div className="kpi ink kpi-low">
          <div className="kpi-low-main">
            <div className="lbl">Tuyến lấp đầy &lt; 60%</div>
            <div className="val" style={{ color: lowCount ? "var(--red)" : "var(--ink)" }}>
              {lowCount}
            </div>
            <div className="note">cần chú ý (theo N-1)</div>
          </div>
          {lowCount > 0 && (
            <div className="kpi-low-list">
              {lowRoutes.slice(0, 8).map((x) => (
                <button
                  key={x.code}
                  className="low-chip"
                  title={`${x.code} · ${pct(x.val)} — bấm để tra cứu`}
                  onClick={() => lookupRouteChip(x.code)}
                >
                  {x.code} <b>{pct(x.val)}</b>
                </button>
              ))}
              {lowCount > 8 && <span className="low-more">+{lowCount - 8} tuyến…</span>}
            </div>
          )}
        </div>
      </div>

      {/* Ẩn ở hubMode: tab "🌐 Toàn hub LM12SC" gộp TOÀN BỘ tuyến của hub, không tách theo loại
          tuyến (Sếp yêu cầu — tách biệt hoàn toàn với 4 tab vùng cũ, vốn vẫn giữ CategoryTabs). */}
      {!hubMode && (
        <CategoryTabs
          categories={data.categories}
          routes={data.routes}
          active={category}
          onChange={setCategory}
        />
      )}

      <div className="statusbar">
        {error ? (
          <span className="pill warn">
            <span className="blink" /> Lỗi tải TLLD: {error}
          </span>
        ) : loading && !index ? (
          <span className="pill idle">
            <span className="blink" /> Đang tải dữ liệu TLLD…
          </span>
        ) : (
          <span className="pill">
            <span className="blink" /> TLLD · N-1 = {ddmm(index?.refDate ?? null)} · 7 ngày{" "}
            {ddmm(index?.last7[0] ?? null)}–{ddmm(index?.refDate ?? null)}
          </span>
        )}
        <span className="pill idle" title="Lấp đầy theo khối lượng (tlld_weight)">
          🟢 ≥85% · 🟠 60–85% · 🔴 &lt;60%
        </span>
      </div>

      {/* KẾT QUẢ TRA CỨU — chỉ hiện khi có nhập ít nhất 1 trong 4 ô lọc phía trên. Hoàn toàn TÁCH
          RIÊNG khỏi index/rows/columns (khung Sức khoẻ + KPI + 2 cột cảnh báo phía trên/dưới không
          đổi theo khu vực này). */}
      {lookupTouched && (
        <div className="section-card tlld-lookup-results" style={{ marginTop: 12 }}>
          <div className="tlld-lookup-results-head">
            <b>🔍 Kết quả tra cứu</b>
            <span className="res-count">
              {lookupLoading ? (
                "Đang tra…"
              ) : lookupErr ? (
                <span style={{ color: "var(--red)" }}>Lỗi tra cứu: {lookupErr}</span>
              ) : (
                <>Tìm thấy <b>{lookupRows?.length ?? 0}</b> chuyến</>
              )}
            </span>
          </div>

          {!lookupLoading && !lookupErr && lookupHit && (
            <div className="chuyen-card" style={{ marginTop: 10, marginBottom: 0, paddingLeft: 12 }}>
              <div className="chuyen-top">
                <div>
                  <div className="chuyen-lbl">🔎 Chi tiết chuyến (FULL TRIP)</div>
                  <div className="chuyen-code">{lookupHit.maChuyen}</div>
                </div>
                <div className="chuyen-tlld">
                  <div className="big" style={{ color: fillColor(lookupHit.tlldWeight) }}>{pct(lookupHit.tlldWeight)}</div>
                  <div className="cap">TLLD khối lượng</div>
                </div>
              </div>
              {lookupHitRouteText && <div className="chuyen-route">🛣️ {lookupHitRouteText}</div>}
              <div className="chuyen-grid">
                <div><span>Mã tuyến</span><b>{lookupHit.maTuyen || "—"}</b></div>
                <div><span>Ngày</span><b>{ddmm(lookupHit.ngay)}</b></div>
                <div><span>Loại tải</span><b>{lookupHit.loaiTai || "—"}</b></div>
                <div><span>TLLD Volume (số đơn)</span><b style={{ color: fillColor(lookupHit.tlldVol) }}>{pct(lookupHit.tlldVol)}</b></div>
                <div><span>Số đơn</span><b>{lookupHit.soDon || "—"}</b></div>
                <div><span>Khối lượng</span><b>{lookupHit.kg ? lookupHit.kg + " kg" : "—"}</b></div>
                <div><span>Biển số xe</span><b>{lookupHit.bienSo || "—"}</b></div>
                <div><span>Đối tác / Xe</span><b>{[lookupHit.partner, lookupHit.truckCap].filter(Boolean).join(" · ") || "—"}</b></div>
              </div>
              <button type="button" className="cat-chip" style={{ marginTop: 10 }} onClick={toggleDiemLookupHit}>
                {diemOpen ? "▾" : "▸"} Xem theo TỪNG ĐIỂM DỪNG
              </button>
              {diemOpen && (
                <div style={{ marginTop: 8 }}>
                  {diemLoading ? (
                    <span style={{ color: "var(--muted)" }}>Đang tải chi tiết điểm dừng…</span>
                  ) : diemErr ? (
                    <span style={{ color: "var(--red)" }}>Lỗi tải điểm dừng: {diemErr}</span>
                  ) : !diemRows || diemRows.length === 0 ? (
                    <span style={{ color: "var(--muted)" }}>Không có dữ liệu điểm dừng.</span>
                  ) : (
                    <div className="tc-wrap scroll-frame">
                      <table className="tc-grid" style={{ width: "100%" }}>
                        <thead>
                          <tr><th>#</th><th>Kho</th><th>Loại tải</th><th>TLLD KL (điểm)</th><th>TLLD VOL (điểm)</th><th>Khối lượng</th><th>Số đơn</th></tr>
                        </thead>
                        <tbody>
                          {diemRows.map((d) => (
                            <tr key={d.thuTu}>
                              <td className="num">{d.thuTu}</td>
                              <td>{d.kho || "—"}</td>
                              <td>{d.loaiTai || "—"}</td>
                              <td className="num" style={{ color: fillColor(d.tlldWeightDiem) }}>{pct(d.tlldWeightDiem)}</td>
                              <td className="num" style={{ color: fillColor(d.tlldVolDiem) }}>{pct(d.tlldVolDiem)}</td>
                              <td className="num">{d.khoiluongKg != null ? d.khoiluongKg + " kg" : "—"}</td>
                              <td className="num">{d.soDonHang ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!lookupLoading && !lookupErr && lookupRows && lookupRows.length > 1 && (
            <div className="tc-wrap scroll-frame" style={{ marginTop: 10 }}>
              <table className="tc-grid" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Ngày</th><th>Mã chuyến</th><th>Mã tuyến</th><th>Loại tải</th><th>Hub</th>
                    <th>TLLD KL</th><th>TLLD VOL</th><th>Khối lượng</th><th>Số đơn</th><th>Biển số</th>
                  </tr>
                </thead>
                <tbody>
                  {lookupRows.slice(0, 300).map((r) => (
                    <tr key={r.ngay + "|" + r.maChuyen} onClick={() => { setFMaChuyen(r.maChuyen); runLookup({ maChuyen: r.maChuyen }); }}>
                      <td className="num">{ddmm(r.ngay)}</td>
                      <td>{r.maChuyen}</td>
                      <td>{r.maTuyen || "—"}</td>
                      <td>{r.loaiTai || "—"}</td>
                      <td>{r.hub || "—"}</td>
                      <td className="num" style={{ color: fillColor(r.tlldWeight) }}>{pct(r.tlldWeight)}</td>
                      <td className="num" style={{ color: fillColor(r.tlldVol) }}>{pct(r.tlldVol)}</td>
                      <td className="num">{r.kg ? r.kg + " kg" : "—"}</td>
                      <td className="num">{r.soDon || "—"}</td>
                      <td>{r.bienSo || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lookupRows.length > 300 && (
                <div className="list-frame-note">
                  Chỉ hiện 300/{lookupRows.length} chuyến đầu — thu hẹp khoảng ngày hoặc nhập thêm mã để lọc chính xác hơn.
                </div>
              )}
            </div>
          )}

          {!lookupLoading && !lookupErr && lookupRows && lookupRows.length === 0 && (
            <div className="tlld-empty" style={{ marginTop: 10 }}>Không tìm thấy chuyến nào khớp bộ lọc.</div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="tlld-empty">Không có tuyến phù hợp ở vùng/loại tuyến này.</div>
      ) : (
        // DUYỆT: 2 cột cảnh báo (cực thấp / quá tải) + tuyến còn lại rải cân bằng. Luôn ở chế độ
        // này (03/09 — bỏ chế độ "tìm kiếm" cũ, xem bộ lọc Tra cứu riêng ở trên).
        // Phân trang: chỉ render `visible` card mỗi cột (lăn xuống tải thêm) -> NHẸ, không dựng cả 555 card.
        <div className="list-frame" ref={frameRef} onScroll={onListScroll}>
          <style>{`
            .tlld-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}
            @media (max-width:760px){.tlld-cols{grid-template-columns:1fr}}
            .tlld-col{display:flex;flex-direction:column;gap:8px;min-width:0}
            .tlld-col-h{position:sticky;top:0;z-index:2;background:var(--bg,var(--surface-sunken));padding:7px 9px;border-radius:9px;border:1px solid rgba(0,0,0,.06)}
            .tlld-col-h .t{font-weight:800;font-size:13px}
            .tlld-col-h .c{font-weight:600;color:var(--muted)}
            .tlld-col-h .h{font-size:11px;color:var(--muted);margin-top:2px;line-height:1.35}
            .tlld-col-div{font-size:11px;color:var(--muted);text-align:center;margin:4px 0;opacity:.85;border-top:1px dashed rgba(0,0,0,.12);padding-top:6px}
            .tlld-col-none{font-size:12px;color:var(--muted);text-align:center;padding:14px 0}
            /* Nhấn mở 1 tuyến trong cột: chi tiết XẾP DỌC để hiện đủ thông tin trong khung cột (không bị cắt). */
            .tlld-col .tlld-card.open{grid-column:auto}
            .tlld-col .tlld-detail{grid-template-columns:1fr;gap:12px}
            .tlld-col .tlld-route{overflow-x:auto}
          `}</style>
          <div className="tlld-cols">
            {columns.map((c) => (
              <div key={c.key} className="tlld-col">
                <div className="tlld-col-h">
                  <div className="t">{c.title} <span className="c">({c.warn.length})</span></div>
                  <div className="h">{c.hint}</div>
                </div>
                {c.items.length === 0 ? (
                  <div className="tlld-col-none">Không có tuyến</div>
                ) : (
                  c.items.slice(0, visible).map((x, i) => (
                    <Fragment key={x.route.route}>
                      {i === c.restStart && c.items.length > c.restStart && (
                        <div className="tlld-col-div">— Tuyến khác (40–90% · rỗng · chưa có dữ liệu) —</div>
                      )}
                      <TlldCard route={x.route} tlld={x.tlld} />
                    </Fragment>
                  ))
                )}
              </div>
            ))}
          </div>
          {(() => {
            const maxCol = Math.max(0, ...columns.map((c) => c.items.length));
            return maxCol > visible ? (
              <div className="list-frame-note">⌄ Lăn xuống để xem thêm {maxCol - visible} tuyến mỗi cột…</div>
            ) : rows.length > PAGE ? (
              <div className="list-frame-note done">Đã hiện hết {rows.length} tuyến</div>
            ) : null;
          })()}
        </div>
      )}

      {/* Xu hướng lấp đầy DÀI HẠN (Tuần/14/30/60 ngày) của ĐÚNG nhóm đang lọc — đặt DƯỚI CÙNG trang
          Tổng Quan (sau danh sách tuyến) theo yêu cầu Sếp; tự đổi theo vùng/loại tuyến. */}
      {index && withData.length > 0 && (
        <LongTrend
          items={withData.map((x) => ({ code: x.route.route, tlld: x.tlld! }))}
          index={index}
          detailed
          scopeLabel={`${regionLabel} · ${category ? (CATEGORY_LABELS[category] || category) : "Tất cả tuyến"}`}
        />
      )}
    </>
  );
}
