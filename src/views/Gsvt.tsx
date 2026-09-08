import { useEffect, useMemo, useRef, useState } from "react";
import { useGsvt, currentShift, gsvtDigest, caStats, type ShiftKey, type GsvtVehicle, type VehKind } from "../lib/gsvt";
import { RouteList } from "../components/RouteList";
import { MapPanel } from "../components/MapPanel";
import { AssistantChat } from "../components/AssistantChat";
import { useFleet } from "../lib/useFleet";
import { usePlaceIds } from "../lib/allRoutes";
import { exportGsvt } from "../lib/exportExcel";
import { normSearch } from "../lib/normalize";
import { Collapsible } from "../components/Collapsible";

/**
 * GSVT — Giám Sát Vận Tải. Lịch trực 3 ca + phân TOÀN BỘ xe cho GSVT của ca
 * đang trực theo GIỜ ĐẾN KHO ĐẦU (mốc 07:00/15:00/23:00). Có tìm kiếm nhanh +
 * lọc tải trọng. Phần lịch hiển thị bằng thẻ tuyến GIỐNG mục Lịch Tải (kèm bản đồ).
 * Chỉ admin (M12SC) mới xem — vì chứa SĐT & thông tin điều phối.
 */
const tel = (s: string) => (s || "").replace(/[^\d]/g, "");
type Tab = "all" | ShiftKey;

// 3 ca trực là PHÂN LOẠI, không phải trạng thái -> lấy màu từ dải chart,
// không mượn màu cảnh báo/lỗi (brand cấm dùng status color để trang trí).
const SHIFT_TONE: Record<ShiftKey, string> = { Ca1: "var(--chart-1)", Ca2: "var(--chart-6)", Ca3: "var(--chart-3)" };
const PAGE = 8;

export function Gsvt() {
  const { data, refreshing } = useGsvt();
  const fleet = useFleet();
  const placeIds = usePlaceIds(); // cho ô "Tìm vị trí" trên bản đồ gõ được mã ID bưu cục/kho
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [tons, setTons] = useState<Set<string>>(new Set()); // lọc tải trọng (rỗng = tất cả) — CHỌN NHIỀU mức
  const [selected, setSelected] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const [mapMode, setMapMode] = useState<"auto" | "mymap">("auto");
  const inputRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const nowShift = currentShift();

  const ctx = useMemo(() => (data ? gsvtDigest(data) : "Chưa tải được lịch trực GSVT."), [data]);

  // Các mức tải trọng có thật trong dữ liệu (giảm dần).
  const loads = useMemo(() => {
    const set = new Set<string>();
    for (const v of data?.vehicles ?? []) if (v.load) set.add(v.load);
    return [...set].sort((a, b) => (parseFloat(b) || 0) - (parseFloat(a) || 0));
  }, [data]);

  // Lọc theo ca (tab) + tải trọng + tìm kiếm nhanh -> danh sách tuyến (Route).
  const nq = normSearch(q);
  const vehicles = useMemo<GsvtVehicle[]>(() => {
    if (!data) return [];
    let list = tab === "all" ? data.vehicles : data.byShift[tab];
    if (tons.size) list = list.filter((v) => tons.has(v.load));
    if (nq) list = list.filter((v) => normSearch([v.code, v.kho, v.region, v.ncc, v.gioDen, v.load, ...v.route.stops.map((s) => s.kho), ...v.route.stops.map((s) => s.id || "")].join(" ")).includes(nq));
    return list;
  }, [data, tab, tons, nq]);
  const routes = useMemo(() => vehicles.map((v) => v.route), [vehicles]);

  useEffect(() => { setVisible(PAGE); if (frameRef.current) frameRef.current.scrollTop = 0; }, [tab, tons, q]);
  function onListScroll() {
    const el = frameRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 360) {
      setVisible((v) => (v < routes.length ? Math.min(routes.length, v + PAGE) : v));
    }
  }
  const shown = routes.slice(0, visible);
  const selectedRoute = routes.find((r) => r.route === selected) || null;
  const mapRoutes = selectedRoute ? [selectedRoute] : [];

  async function askGsvt(_text: string, history: { role: string; content: string }[]): Promise<string> {
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "askdata", id: "gsvt", messages: history, context: ctx }) });
      return (await r.json())?.reply || "(không có phản hồi)";
    } catch (e) { return "Lỗi kết nối trợ lý: " + (e instanceof Error ? e.message : String(e)); }
  }


  const counts = data ? {
    Ca1: data.byShift.Ca1.length, Ca2: data.byShift.Ca2.length,
    Ca3: data.byShift.Ca3.length, unknown: data.byShift.unknown.length,
  } : { Ca1: 0, Ca2: 0, Ca3: 0, unknown: 0 };
  const total = counts.Ca1 + counts.Ca2 + counts.Ca3;
  const shiftLabel = (k: ShiftKey) => data?.roster.find((s) => s.key === k)?.label || k;

  return (
    <div>
      {/* ĐẦU MỤC */}
      <div className="section-card tc-head">
        <h2 style={{ marginBottom: 2, fontSize: 17 }}>👷 GSVT — Giám sát vận tải</h2>
        <p className="lead" style={{ margin: 0, fontSize: 14 }}>
          Lịch trực 3 ca &amp; phân xe cho GSVT theo <b>giờ đến kho đầu</b> — tổng <b>{total}</b> xe toàn cụm
          {counts.unknown ? <> · <span style={{ color: "var(--muted)" }}>{counts.unknown} xe chưa rõ giờ</span></> : null}.
          {data?.lastSync ? ` · cập nhật ${new Date(data.lastSync).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : ""}{refreshing ? " · đồng bộ…" : ""}
        </p>
      </div>

      {/* LỊCH TRỰC — 3 ca, làm nổi ca đang trực */}
      <div className="gsvt-roster">
        {(data?.roster ?? []).map((s) => {
          const on = s.key === nowShift;
          const n = counts[s.key];
          return (
            <div key={s.key} className={"gsvt-shift" + (on ? " on" : "")} style={{ ["--tone" as string]: SHIFT_TONE[s.key] }}>
              <div className="gsvt-shift-top">
                <span className="gsvt-shift-name">{s.label}</span>
                {on && <span className="gsvt-now">🟢 Đang trực</span>}
              </div>
              <div className="gsvt-shift-hours">🕒 {s.hours}</div>
              <div className="gsvt-people">
                {(s.people ?? []).length ? (s.people ?? []).map((p, i) => (
                  <div key={i} className="gsvt-person">
                    <span className="gsvt-pname">{p.name}</span>
                    {p.phone && <a className="gsvt-tel" href={`tel:${tel(p.phone)}`}>📞 {p.phone}</a>}
                  </div>
                )) : <div className="tc-empty">— chưa có —</div>}
              </div>
              <div className="gsvt-shift-count">Quản lý <b>{n}</b> xe</div>
            </div>
          );
        })}
      </div>

      {/* SUB-TABS: Tổng quan + 3 ca */}
      <div className="sub-tabs" style={{ marginTop: 12 }}>
        <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>📊 Tổng quan</button>
        <button className={tab === "Ca1" ? "active" : ""} onClick={() => setTab("Ca1")}>① {shiftLabel("Ca1")} · {counts.Ca1}</button>
        <button className={tab === "Ca2" ? "active" : ""} onClick={() => setTab("Ca2")}>② {shiftLabel("Ca2")} · {counts.Ca2}</button>
        <button className={tab === "Ca3" ? "active" : ""} onClick={() => setTab("Ca3")}>③ {shiftLabel("Ca3")} · {counts.Ca3}</button>
      </div>

      {/* TỔNG QUAN: 1 khung so sánh 3 ca — tổng xe + theo loại (giao/lấy) + theo tải trọng */}
      {tab === "all" && data && (() => {
        const KINDS: VehKind[] = ["lay", "giao", "both"];
        const stats: Record<ShiftKey, ReturnType<typeof caStats>> = {
          Ca1: caStats(data.byShift.Ca1), Ca2: caStats(data.byShift.Ca2), Ca3: caStats(data.byShift.Ca3),
        };
        const cas: ShiftKey[] = ["Ca1", "Ca2", "Ca3"];
        const sumKind = (k: VehKind) => cas.reduce((a, c) => a + stats[c].kind[k], 0);
        const sumTon = (t: string) => cas.reduce((a, c) => a + (stats[c].ton[t] || 0), 0);
        const hasOther = cas.some((c) => stats[c].kind.other > 0);
        // Cột tải trọng: các mức có thật + cột "Chưa rõ" nếu có tuyến thiếu tải trọng (để cộng đủ tổng).
        const tonCols = [...loads, ...(cas.some((c) => stats[c].ton["—"] > 0) ? ["—"] : [])];
        return (
          <Collapsible title="📊 Xem thống kê 3 ca" sub={`phân theo loại & tải trọng · ${total} xe`} className="gsvt-ov" style={{ marginTop: 12 }}>
            <div className="gsvt-tb-wrap">
              <table className="gsvt-ovtb">
                <thead>
                  <tr>
                    <th className="l">Ca trực</th>
                    <th className="grp">Tổng</th>
                    <th>Lấy</th><th>Giao</th><th>Cả hai</th>{hasOther && <th>Khác</th>}
                    {tonCols.map((l) => <th key={l} className="grp">{l === "—" ? "Chưa rõ" : `${l}kg`}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {cas.map((c) => {
                    const st = stats[c];
                    return (
                      <tr key={c}>
                        <td className="l"><span className="gsvt-ca-dot" style={{ background: SHIFT_TONE[c] }} />{shiftLabel(c)}<span className="gsvt-ca-hr"> · {data.roster.find((s) => s.key === c)?.hours}</span></td>
                        <td className="grp b">{st.total}</td>
                        {KINDS.map((k) => <td key={k}>{st.kind[k] || <span className="tc-empty">·</span>}</td>)}
                        {hasOther && <td>{st.kind.other || <span className="tc-empty">·</span>}</td>}
                        {tonCols.map((l) => <td key={l} className="grp">{st.ton[l] || <span className="tc-empty">·</span>}</td>)}
                      </tr>
                    );
                  })}
                  <tr className="gsvt-ovtb-sum">
                    <td className="l">Tổng cộng</td>
                    <td className="grp b">{total}</td>
                    {KINDS.map((k) => <td key={k} className="b">{sumKind(k) || 0}</td>)}
                    {hasOther && <td className="b">{sumKind("other") || 0}</td>}
                    {tonCols.map((l) => <td key={l} className="grp b">{sumTon(l) || 0}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="lead" style={{ margin: "8px 2px 0", fontSize: 13 }}>
              Xe xếp cho ca theo <b>giờ đến kho đầu</b> (mốc 07:00/15:00/23:00). <b>Loại</b>: Lấy / Giao / Cả hai (theo loại hình các điểm). <b>Tải trọng</b>: số tuyến mỗi mức kg.
              {counts.unknown ? ` · ${counts.unknown} xe chưa rõ giờ (chưa tính vào ca).` : ""}
            </p>
          </Collapsible>
        );
      })()}

      {/* THANH LỌC: tìm kiếm + tải trọng */}
      <div className="section-card" style={{ marginTop: 12, padding: "12px 14px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div className="gsvt-tb-title">
            {tab === "all" ? "Tất cả xe" : `${shiftLabel(tab)} · GSVT: ${(data?.roster.find((s) => s.key === tab)?.people.map((p) => p.name).join(", ")) || "—"}`}
            <span className="gsvt-tb-n"> · {routes.length} tuyến</span>
          </div>
          <div className="gsvt-ton-chips" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--muted)" }}>⚖ Tải trọng:</span>
            <button className={"cat-chip" + (tons.size === 0 ? " active" : "")} onClick={() => setTons(new Set())} title="Bỏ lọc tải trọng">Tất cả</button>
            {loads.map((l) => (
              <button
                key={l}
                className={"cat-chip" + (tons.has(l) ? " active" : "")}
                title="Bấm chọn nhiều mức cùng lúc"
                onClick={() => setTons((prev) => { const n = new Set(prev); n.has(l) ? n.delete(l) : n.add(l); return n; })}
              >{l} kg</button>
            ))}
          </div>
          <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
            <input ref={inputRef} className="pl-in" style={{ width: "100%", paddingRight: 28 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔎 Tìm nhanh: mã tuyến, kho, vùng, NCC, giờ…" />
            {q && <button onClick={() => { setQ(""); inputRef.current?.focus(); }} title="Xoá" style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "var(--muted)" }}>✕</button>}
          </div>
          <button
            className="xlsx-btn"
            disabled={!vehicles.length}
            title={`Tải ${vehicles.length} tuyến đang xem ra Excel (kèm ca trực, GSVT, lộ trình)`}
            onClick={() => { if (vehicles.length) exportGsvt(vehicles, `${tab === "all" ? "ToanBo" : shiftLabel(tab)}${tons.size ? `_${[...tons].join("-")}kg` : ""}`); }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Tải lịch (Excel)
          </button>
        </div>
      </div>

      {/* LỊCH — thẻ tuyến GIỐNG Lịch Tải + bản đồ */}
      {!data ? (
        <div className="section-card" style={{ marginTop: 12 }}><div className="sl-empty" style={{ padding: 16 }}>Đang tải dữ liệu xe toàn cụm…</div></div>
      ) : (
        <div className="split" style={{ marginTop: 12 }}>
          <div className="list-frame" ref={frameRef} onScroll={onListScroll}>
            <RouteList
              routes={shown}
              loading={false}
              error={null}
              selectedId={selected}
              onSelect={(id) => setSelected(id === selected ? null : id)}
              onRetry={() => {}}
              fleet={fleet}
            />
            {routes.length > visible ? (
              <div className="list-frame-note">⌄ Lăn xuống để xem thêm {routes.length - visible} tuyến…</div>
            ) : routes.length > PAGE ? (
              <div className="list-frame-note done">Đã hiện hết {routes.length} tuyến</div>
            ) : null}
          </div>
          <div className="map-panel">
            <MapPanel routes={mapRoutes} title={selectedRoute ? selectedRoute.route : "Bản đồ lộ trình"} mapMode={mapMode} setMapMode={setMapMode} placeIds={placeIds} />
          </div>
        </div>
      )}

      {/* TRỢ LÝ — đặt cuối trang, ngay trên "Hỏi đáp & Góp ý" */}
      <div className="section-card" style={{ marginTop: 12 }}>
        <AssistantChat chatId="gsvt" context={ctx} interpret={askGsvt} onTemplate={() => {}} onUpload={() => {}} />
      </div>
    </div>
  );
}
