import { useState, useEffect, useRef, useMemo } from "react";
import { CategoryTabs } from "../components/CategoryTabs";
import { RouteList } from "../components/RouteList";
import { SuggestDrop } from "../components/SuggestDrop";
import { MapPanel } from "../components/MapPanel";
import { StatusBar } from "../components/StatusBar";
import { RegionToolbar } from "../components/RouteEditor";
import { normSearch } from "../lib/normalize";
import { exportLichTai } from "../lib/exportExcel";
import { useFleet } from "../lib/useFleet";
import { usePlaceIds } from "../lib/allRoutes";
import { useTlld } from "../lib/useTlld";
import { normCode } from "../lib/tlld";
import { loadRegion, type DbRoute, type DbSheetData } from "../lib/db/lichTaiApi"; // 01/09/2026: Lịch Tải đã chuyển sang Supabase
import { VISIBLE_SHEETS } from "../config";

function KpiRow({ routes, regionLabel, category }: { routes: DbRoute[]; regionLabel: string; category: string }) {
  const stops = routes.reduce((a, r) => a + r.stops.length, 0);
  const mapped = routes.reduce((a, r) => a + r.mappedCount, 0);
  const mappedPct = stops ? Math.round((mapped / stops) * 100) : 0;
  return (
    <div className="kpi-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
      <div className="kpi">
        <div className="lbl">Tổng số tuyến</div>
        <div className="val orange">{routes.length}</div>
        <div className="note">tuyến đang hiển thị</div>
      </div>
      <div className="kpi blue">
        <div className="lbl">Tổng điểm dừng</div>
        <div className="val">{stops}</div>
        <div className="note">điểm bưu cục / kho · {mappedPct}% có toạ độ</div>
      </div>
      <div className="kpi ink">
        <div className="lbl">Vùng / Loại tuyến</div>
        <div className="val" style={{ fontSize: 18, color: "var(--ink)" }}>{regionLabel}</div>
        <div className="note">{category || "Tất cả loại tuyến"}</div>
      </div>
    </div>
  );
}

export function LichTai({
  data,
  regionLabel,
  regionKey,
  refreshing,
  onRefresh,
  category,
  setCategory,
  search,
  setSearch,
  selected,
  setSelected,
  mapMode,
  setMapMode,
  gid,
  canEdit,
  canExport,
  onSaved,
  onSwitchRegion,
}: {
  data: DbSheetData;
  regionLabel: string;
  /** Khoá vùng dùng cho Supabase (VISIBLE_SHEETS[].key) — cần cho "+ Tuyến mới"/"Xuất ra Google Sheet". */
  regionKey: string;
  refreshing: boolean;
  onRefresh: () => void;
  category: string;
  setCategory: (c: string) => void;
  search: string;
  setSearch: (s: string) => void;
  selected: string | null;
  setSelected: (s: string | null) => void;
  mapMode: "auto" | "mymap";
  setMapMode: (m: "auto" | "mymap") => void;
  gid?: string;
  canEdit?: boolean;
  canExport?: boolean;
  onSaved?: () => void;
  /** Chuyển sang vùng khác (theo gid) — dùng khi tìm không thấy ở vùng hiện tại nhưng có ở vùng khác. */
  onSwitchRegion?: (gid: string) => void;
}) {
  const tlld = useTlld().index;
  const placeIds = usePlaceIds(); // cho ô "Tìm vị trí" trên bản đồ gõ được mã ID bưu cục/kho
  // Gợi ý tên tuyến / bưu cục cho ô tìm kiếm.
  const [sugOpen, setSugOpen] = useState(false);
  const sugNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of data.routes) { if (r.route) s.add(r.route); if (r.bks) s.add(r.bks); for (const st of r.stops) if (st.kho) s.add(st.kho); }
    return [...s].sort((a, b) => a.localeCompare(b, "vi"));
  }, [data.routes]);
  const byCat = useMemo(
    () => (category ? data.routes.filter((r) => r.category === category) : data.routes),
    [data.routes, category]
  );
  const q = normSearch(search);
  const qBks = search.toLowerCase().replace(/[^a-z0-9]/g, ""); // biển số: bỏ dấu "-"/khoảng trắng để khớp "50H26441" ~ "50H-26441" ~ "26441"
  // ID bưu cục (cột "ID" trong Sheet) — CHỈ coi là tìm theo ID khi cả câu tìm (bỏ khoảng trắng/dấu
  // gạch/chấm) là số THUẦN, ≥4 chữ số. Nếu chỉ lấy bừa mọi chữ số có trong câu (kể cả tên riêng có
  // số như "An Lạc 2") thì 1 chữ số lẻ sẽ khớp ID của gần như MỌI tuyến -> ra cả trăm tuyến sai.
  const qIdRaw = search.trim().replace(/[\s.\-]/g, "");
  const qId = qIdRaw.length >= 4 && /^\d+$/.test(qIdRaw) ? qIdRaw : "";
  // Khi có từ khoá: tìm trên TOÀN VÙNG (bỏ qua lọc loại tuyến), khớp cả mã chuyến & BIỂN SỐ. Bọc
  // useMemo — trước đây tính lại mỗi render (kể cả render do cuộn danh sách đổi `visible`), khiến
  // duyệt/cuộn bị ì khi có từ khoá tìm kiếm (Sếp báo load/cuộn chậm 2026-08-12).
  const filtered = useMemo(() => {
    if (!q) return byCat;
    return data.routes.filter((r) => {
      if (normSearch(r.route).includes(q)) return true;
      if (qBks && r.bks && r.bks.toLowerCase().replace(/[^a-z0-9]/g, "").includes(qBks)) return true;
      if (r.stops.some((s) => normSearch(s.kho).includes(q))) return true;
      if (qId && r.stops.some((s) => s.id && s.id.includes(qId))) return true;
      const t = tlld?.byCode.get(normCode(r.route));
      if (t?.chuyen.some((c) => normSearch(c).includes(q))) return true;
      return false;
    });
  }, [data.routes, byCat, q, qBks, qId, tlld]);

  // Tìm KHÔNG thấy ở vùng đang xem -> thử tra CÁC VÙNG KHÁC (Sếp báo 2026-08-24: tuyến có thật
  // trên Sheet nhưng "0 tuyến" vì đang đứng nhầm vùng — dò gõ mã tuyến không biết tuyến đó thuộc
  // vùng nào). loadRegion() có cache TTL riêng nên không tốn thêm request nếu vùng đó đã được tải.
  const [crossHit, setCrossHit] = useState<{ label: string; gid: string } | null>(null);
  useEffect(() => {
    if (!q || filtered.length > 0) { setCrossHit(null); return; }
    let cancelled = false;
    (async () => {
      for (const s of VISIBLE_SHEETS) {
        if (s.gid === gid) continue; // vùng đang xem -> đã biết là 0 kết quả rồi
        try {
          const res = await loadRegion(s.key);
          const hit = res.routes.some((r) =>
            normSearch(r.route).includes(q) ||
            r.stops.some((st) => normSearch(st.kho).includes(q)) ||
            (qId && r.stops.some((st) => st.id && st.id.includes(qId)))
          );
          if (hit) { if (!cancelled) setCrossHit({ label: s.label, gid: s.gid }); return; }
        } catch { /* lỗi 1 vùng -> thử vùng tiếp theo, không chặn */ }
      }
      if (!cancelled) setCrossHit(null);
    })();
    return () => { cancelled = true; };
  }, [q, qId, filtered.length, gid]);

  // Khi đổi vùng/loại tuyến: hiện vòng xoay ~0.7s rồi báo sẵn sàng (tích thành công).
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    setChecking(true);
    const t = setTimeout(() => setChecking(false), 700);
    return () => clearTimeout(t);
  }, [regionLabel, category]);
  const ready = !checking && !data.loading && !!data.lastSync && byCat.length > 0;

  const fleet = useFleet();
  const selectedRoute = filtered.find((r) => r.route === selected) || null;
  const mapRoutes = selectedRoute ? [selectedRoute] : [];

  // Danh sách nằm trong khung cuộn; lăn xuống gần đáy là tự hiện thêm.
  const PAGE = 6;
  const [visible, setVisible] = useState(PAGE);
  const frameRef = useRef<HTMLDivElement>(null);
  const shown = filtered.slice(0, visible);

  useEffect(() => {
    setVisible(PAGE);
    if (frameRef.current) frameRef.current.scrollTop = 0;
  }, [category, search, regionLabel]);

  function onListScroll() {
    const el = frameRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 360) {
      setVisible((v) => (v < filtered.length ? Math.min(filtered.length, v + PAGE) : v));
    }
  }
  // Bảo đảm khung luôn đủ cao để cuộn (màn hình cao / ít tuyến) + khi đổi cỡ màn hình.
  useEffect(() => {
    function fill() {
      const el = frameRef.current;
      if (el && el.scrollHeight <= el.clientHeight + 4) {
        setVisible((v) => (v < filtered.length ? Math.min(filtered.length, v + PAGE) : v));
      }
    }
    fill();
    window.addEventListener("resize", fill);
    return () => window.removeEventListener("resize", fill);
  }, [visible, filtered.length]);

  return (
    <>
      <KpiRow routes={byCat} regionLabel={regionLabel} category={category} />

      <CategoryTabs
        categories={data.categories}
        routes={data.routes}
        active={category}
        onChange={(c) => {
          setCategory(c);
          setSelected(null);
        }}
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
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSugOpen(true); }}
            onFocus={() => setSugOpen(true)}
            onBlur={() => setTimeout(() => setSugOpen(false), 150)}
            autoComplete="off"
          />
          {search && (
            <button type="button" className="search-clear" title="Xoá tìm kiếm" onClick={() => setSearch("")}
              style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 20, lineHeight: 1, color: "var(--muted)", padding: "0 6px" }}>×</button>
          )}
          <SuggestDrop value={search} names={sugNames} show={sugOpen} onPick={(n) => { setSearch(n); setSugOpen(false); }} />
        </div>
        <div className="res-count">
          Kết quả: <b>{filtered.length}</b> tuyến
        </div>
        <button
          className={"refresh-btn" + (refreshing ? " spin" : "")}
          onClick={onRefresh}
          disabled={refreshing}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
          </svg>
          {refreshing ? "Đang làm mới…" : "Làm mới"}
        </button>
      </div>

      {(canEdit || canExport) && (
        <RegionToolbar
          regionKey={regionKey}
          regionLabel={regionLabel}
          canEdit={!!canEdit}
          canExport={!!canExport}
          onChanged={onRefresh}
        />
      )}

      {q && filtered.length === 0 && crossHit && (
        <div className="pl-warn" style={{ background: "var(--blue-soft)", color: "var(--blue)", marginBottom: 10 }}>
          🤖 Không có ở <b>{regionLabel}</b>, nhưng có ở <b>{crossHit.label}</b> —{" "}
          {onSwitchRegion ? (
            <button className="lnk" style={{ padding: 0, fontWeight: 800 }} onClick={() => onSwitchRegion(crossHit.gid)}>
              Chuyển qua {crossHit.label} →
            </button>
          ) : (
            <>bấm tab <b>{crossHit.label}</b> phía trên để xem.</>
          )}
        </div>
      )}

      <StatusBar
        lastSync={data.lastSync}
        error={data.error}
        missingGeo={data.missingGeo}
        action={
          ready ? (
            <button
              className="xlsx-btn"
              onClick={() => exportLichTai(byCat, category ? `${regionLabel} - ${category}` : regionLabel)}
              title={`Tải Excel toàn bộ ${byCat.length} tuyến của ${category || regionLabel} (không phụ thuộc ô tìm kiếm)`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Tải Lịch (Excel)
            </button>
          ) : (
            <button className="xlsx-btn loading" disabled>
              <span className="xlsx-spin" /> Đang tải lịch…
            </button>
          )
        }
      />

      <div className="split">
        <div className="list-frame" ref={frameRef} onScroll={onListScroll}>
          <RouteList
            routes={shown}
            loading={data.loading}
            error={data.error}
            selectedId={selected}
            onSelect={(id) => setSelected(id === selected ? null : id)}
            onRetry={onRefresh}
            fleet={fleet}
            canEdit={canEdit}
            onSaved={onSaved}
          />
          {filtered.length > visible ? (
            <div className="list-frame-note">⌄ Lăn xuống để xem thêm {filtered.length - visible} tuyến…</div>
          ) : filtered.length > PAGE ? (
            <div className="list-frame-note done">Đã hiện hết {filtered.length} tuyến</div>
          ) : null}
        </div>
        <div className="map-panel">
          <MapPanel
            routes={mapRoutes}
            title={selectedRoute ? selectedRoute.route : "Bản đồ lộ trình"}
            mapMode={mapMode}
            setMapMode={setMapMode}
            placeIds={placeIds}
          />
        </div>
      </div>
    </>
  );
}
