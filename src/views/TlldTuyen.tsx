import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { CategoryTabs } from "../components/CategoryTabs";
import { TlldCard } from "../components/TlldCard";
import { TlldReport, LongTrend } from "../components/TlldReport";
import { TlldClusterReport } from "../components/TlldClusterReport";
import { TlldSucKhoe } from "../components/TlldSucKhoe";
import { DieuChinhReport } from "../components/DieuChinhReport";
import { SuggestDrop } from "../components/SuggestDrop";
import { Collapsible } from "../components/Collapsible";
import { useTlld } from "../lib/useTlld";
import { useAllRoutes } from "../lib/allRoutes";
import { normCode, type TlldRoute } from "../lib/tlld";
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
export function TlldTuyen({
  data,
  regionLabel,
  category,
  setCategory,
  search,
  setSearch,
  view = "tong-quan",
}: {
  data: SheetData;
  regionLabel: string;
  category: string;
  setCategory: (c: string) => void;
  search: string;
  setSearch: (s: string) => void;
  /** Sub-tab trong "TLLD Tuyến": "tong-quan" = KPI + duyệt/tìm tuyến (như cũ);
   *  "bao-cao" = chỉ biểu đồ tổng hợp + nhận định AI (TlldReport), gọn cho việc đọc báo cáo nhanh. */
  view?: "tong-quan" | "bao-cao";
}) {
  const { index, loading, error, refresh } = useTlld();
  const allRoutes = useAllRoutes(); // lịch toàn vùng (realtime) để khớp lộ trình + tải trọng

  // Gợi ý tên tuyến / bưu cục cho ô tìm kiếm.
  const [sugOpen, setSugOpen] = useState(false);
  const sugNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of allRoutes.values()) { if (r.route) s.add(r.route); if (r.bks) s.add(r.bks); for (const st of r.stops) if (st.kho) s.add(st.kho); }
    return [...s].sort((a, b) => a.localeCompare(b, "vi"));
  }, [allRoutes]);

  // Tra cứu CHI TIẾT CHUYẾN khi gõ đúng mã chuyến (ma_chuyen)
  const chuyenHit = index && search.trim() ? index.byChuyen.get(search.trim().toUpperCase()) : undefined;

  const q = normSearch(search);
  const qBks = search.toLowerCase().replace(/[^a-z0-9]/g, ""); // biển số: bỏ "-"/khoảng trắng -> khớp "50H26441" ~ "50H-26441" ~ "26441"
  // ID bưu cục (cột "ID" trong Sheet) — CHỈ coi là tìm theo ID khi cả câu tìm (bỏ khoảng trắng/dấu
  // gạch/chấm) là số THUẦN, ≥4 chữ số. Nếu chỉ lấy bừa mọi chữ số có trong câu (kể cả tên riêng có
  // số như "An Lạc 2") thì 1 chữ số lẻ sẽ khớp ID của gần như MỌI tuyến -> ra cả trăm tuyến sai.
  const qIdRaw = search.trim().replace(/[\s.\-]/g, "");
  const qId = qIdRaw.length >= 4 && /^\d+$/.test(qIdRaw) ? qIdRaw : "";

  const byCat = useMemo(
    () => (category ? data.routes.filter((r) => r.category === category) : data.routes),
    [data.routes, category]
  );

  // Khi có từ khoá: tìm trên TOÀN VÙNG (bỏ qua lọc loại tuyến) để mã chuyến/mã
  // tuyến/BIỂN SỐ luôn ra kết quả dù đang đứng ở tab loại tuyến nào.
  const filtered = useMemo(() => {
    if (!q) return byCat;
    return data.routes.filter((r) => {
      if (normSearch(r.route).includes(q)) return true;
      if (r.stops.some((s) => normSearch(s.kho).includes(q))) return true;
      if (qId && r.stops.some((s) => s.id && s.id.includes(qId))) return true;
      // khớp BIỂN SỐ (lấy từ lịch tải toàn vùng theo mã tuyến)
      const bks = allRoutes.get(normCode(r.route))?.bks;
      if (qBks && bks && bks.toLowerCase().replace(/[^a-z0-9]/g, "").includes(qBks)) return true;
      // khớp theo mã chuyến (ma_chuyen) lấy từ dữ liệu TLLD của tuyến
      const t = index?.byCode.get(normCode(r.route));
      if (t?.chuyen.some((c) => normSearch(c).includes(q))) return true;
      return false;
    });
  }, [data.routes, byCat, q, qId, qBks, allRoutes, index]);

  // Bổ sung lộ trình (giờ tới/rời, loại hình) + tải trọng từ lịch TOÀN VÙNG cho 1 tuyến, rồi ghép
  // TLLD theo mã tuyến — TÍNH 1 LẦN mỗi khi input thật sự đổi (KHÔNG mỗi lần render do cuộn trang
  // đổi `visible`, đây là nguyên nhân chính khiến duyệt/cuộn danh sách bị giật — Sếp báo 2026-08-12).
  const rows = useMemo(() => {
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
    const out: TRow[] = filtered.map((r) => ({ route: enrich(r), tlld: index?.byCode.get(normCode(r.route)) }));
    // Khi tìm kiếm: bổ sung các mã tuyến CHỈ có trong dữ liệu TLLD (không lên lịch ở
    // sheet chính) nếu khớp mã tuyến hoặc mã chuyến — dựng card từ chỉ mục TLLD.
    if (q && index) {
      const have = new Set(filtered.map((r) => normCode(r.route)));
      for (const [code, t] of index.byCode) {
        if (have.has(code)) continue;
        const hit = normSearch(code).includes(q) || t.chuyen.some((c) => normSearch(c).includes(q));
        if (!hit) continue;
        out.push({ route: enrich({ route: code, load: "", category: "", stops: [], mappedCount: 0 }), tlld: t });
      }
    }
    return out;
  }, [filtered, allRoutes, index, q]);

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

  // Chế độ DUYỆT (không tìm kiếm) -> 3 cột cảnh báo cân bằng. Tìm kiếm -> danh sách phẳng.
  const searching = !!q || !!chuyenHit;
  const columns = useMemo(() => (searching ? null : buildColumns(rows)), [searching, rows]);

  const PAGE = 30;
  const [visible, setVisible] = useState(PAGE);
  const frameRef = useRef<HTMLDivElement>(null);
  const shown = rows.slice(0, visible);

  useEffect(() => {
    setVisible(PAGE);
    if (frameRef.current) frameRef.current.scrollTop = 0;
  }, [category, search, regionLabel]);

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
            catLabel={search.trim() ? `Kết quả tìm "${search.trim()}"` : category ? (CATEGORY_LABELS[category] || category) : "Tất cả tuyến"}
          />
        </Collapsible>
      </>
    );
  }

  return (
    <>
      {/* SỨC KHOẺ VẬN HÀNH TLLD — TOÀN CỤM (không lọc theo vùng/loại tuyến đang chọn bên dưới),
          xem src/components/TlldSucKhoe.tsx. Đặt TRÊN CÙNG vì đây là bức tranh tổng trước khi
          duyệt/tìm từng tuyến ở khung region-scoped phía dưới. */}
      <TlldSucKhoe index={index} />

      <div className="kpi-row tlld" style={{ marginTop: 16 }}>
        <div className="kpi">
          <div className="lbl">Tuyến có dữ liệu TLLD</div>
          <div className="val orange">{withData.length}</div>
          <div className="note">/ {filtered.length} tuyến vùng này</div>
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
                  title={`${x.code} · ${pct(x.val)} — bấm để lọc`}
                  onClick={() => setSearch(x.code)}
                >
                  {x.code} <b>{pct(x.val)}</b>
                </button>
              ))}
              {lowCount > 8 && <span className="low-more">+{lowCount - 8} tuyến…</span>}
            </div>
          )}
        </div>
      </div>

      <CategoryTabs
        categories={data.categories}
        routes={data.routes}
        active={category}
        onChange={setCategory}
      />

      <div className="toolbar">
        <div className="search-box">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Tìm theo mã tuyến, mã chuyến, tên hoặc ID bưu cục…"
            value={search ?? ""}
            onChange={(e) => { setSearch(e.target.value); setSugOpen(true); }}
            onFocus={() => setSugOpen(true)}
            onBlur={() => setTimeout(() => setSugOpen(false), 150)}
            autoComplete="off"
          />
          {search && (
            <button type="button" className="search-clear" title="Xoá tìm kiếm" onClick={() => setSearch("")}
              style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 20, lineHeight: 1, color: "var(--muted)", padding: "0 6px" }}>×</button>
          )}
          <SuggestDrop value={search ?? ""} names={sugNames} show={sugOpen} onPick={(n) => { setSearch(n); setSugOpen(false); }} />
        </div>
        <div className="res-count">
          Kết quả: <b>{rows.length}</b> tuyến
        </div>
        <button className={"refresh-btn" + (loading ? " spin" : "")} onClick={refresh} disabled={loading}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
          </svg>
          {loading ? "Đang tải TLLD…" : "Làm mới"}
        </button>
      </div>

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

      {chuyenHit && (
        <div className="section-card chuyen-card">
          <div className="chuyen-top">
            <div>
              <div className="chuyen-lbl">🔎 Chi tiết chuyến</div>
              <div className="chuyen-code">{chuyenHit.maChuyen}</div>
            </div>
            <div className="chuyen-tlld">
              <div className="big" style={{ color: fillColor(chuyenHit.tlldWeight) }}>{pct(chuyenHit.tlldWeight)}</div>
              <div className="cap">TLLD khối lượng</div>
            </div>
          </div>
          {chuyenHit.routeText && <div className="chuyen-route">🛣️ {chuyenHit.routeText}</div>}
          <div className="chuyen-grid">
            <div><span>Mã tuyến</span><b>{chuyenHit.code || "—"}</b></div>
            <div><span>Ngày</span><b>{ddmm(chuyenHit.date || null)}</b></div>
            <div><span>Loại tải</span><b>{chuyenHit.loaiTai || "—"}</b></div>
            <div><span>TLLD thể tích</span><b style={{ color: fillColor(chuyenHit.tlldVol) }}>{pct(chuyenHit.tlldVol)}</b></div>
            <div><span>Số đơn</span><b>{chuyenHit.soDon || "—"}</b></div>
            <div><span>Khối lượng</span><b>{chuyenHit.kg ? chuyenHit.kg + " kg" : "—"}</b></div>
            <div><span>Biển số xe</span><b>{chuyenHit.bienSo || "—"}</b></div>
            <div><span>Đối tác / Xe</span><b>{[chuyenHit.partner, chuyenHit.truckCap].filter(Boolean).join(" · ") || "—"}</b></div>
          </div>
        </div>
      )}

      {rows.length === 0 && !chuyenHit ? (
        <div className="tlld-empty">Không có tuyến phù hợp ở vùng/loại tuyến này.</div>
      ) : searching ? (
        // TÌM KIẾM: danh sách phẳng + cuộn vô hạn (giữ như cũ).
        <div className="list-frame" ref={frameRef} onScroll={onListScroll}>
          <div className="tlld-list">
            {shown.map((x) => <TlldCard key={x.route.route} route={x.route} tlld={x.tlld} />)}
          </div>
          {rows.length > visible ? (
            <div className="list-frame-note">⌄ Lăn xuống để xem thêm {rows.length - visible} tuyến…</div>
          ) : rows.length > PAGE ? (
            <div className="list-frame-note done">Đã hiện hết {rows.length} tuyến</div>
          ) : null}
        </div>
      ) : (
        // DUYỆT: 2 cột cảnh báo (cực thấp / quá tải) + tuyến còn lại rải cân bằng.
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
            {columns!.map((c) => (
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
            const maxCol = Math.max(0, ...columns!.map((c) => c.items.length));
            return maxCol > visible ? (
              <div className="list-frame-note">⌄ Lăn xuống để xem thêm {maxCol - visible} tuyến mỗi cột…</div>
            ) : rows.length > PAGE ? (
              <div className="list-frame-note done">Đã hiện hết {rows.length} tuyến</div>
            ) : null;
          })()}
        </div>
      )}

      {/* Xu hướng lấp đầy DÀI HẠN (Tuần/14/30/60 ngày) của ĐÚNG nhóm đang lọc — đặt DƯỚI CÙNG trang
          Tổng Quan (sau danh sách tuyến) theo yêu cầu Sếp; tự đổi theo vùng/loại tuyến/tìm kiếm. */}
      {index && withData.length > 0 && (
        <LongTrend
          items={withData.map((x) => ({ code: x.route.route, tlld: x.tlld! }))}
          index={index}
          detailed
          scopeLabel={`${regionLabel} · ${search.trim() ? `Kết quả tìm "${search.trim()}"` : category ? (CATEGORY_LABELS[category] || category) : "Tất cả tuyến"}`}
        />
      )}
    </>
  );
}
