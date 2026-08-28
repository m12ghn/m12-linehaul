import { useMemo, useState } from "react";
import { useTangCuong } from "../lib/useTangCuong";
import { groupByNcc, type NccGroup } from "../lib/ncc";
import { NccPerformance } from "./NccPerformance";
import { Collapsible } from "./Collapsible";
import { navTo } from "../lib/nav";
import { exportTcNcc } from "../lib/exportExcel";
import { SHEET_ID, TANG_CUONG_LAY_GID, TANG_CUONG_GIAO_SHEET_ID, TANG_CUONG_GIAO_GID } from "../config";
import type { TCRoute } from "../lib/tangcuong";

/** Bảng lịch tăng cường đầy đủ (1 dòng = 1 điểm dừng), giống mục Tăng Cường. */
function TcTable({ routes, kind }: { routes: TCRoute[]; kind: "lay" | "giao" }) {
  return (
    <div className="tc-wrap" style={{ marginTop: 6 }}>
      <table className="tc-grid">
        <colgroup>
          <col className="c-route" /><col className="c-name" /><col className="c-quan" /><col className="c-gio" /><col className="c-veh" />
        </colgroup>
        <thead>
          <tr>
            <th>Tuyến</th>
            <th>{kind === "lay" ? "Điểm lấy → Kho" : "Kho → Điểm giao"}</th>
            <th>Quận</th>
            <th>Giờ (Đến / Rời)</th>
            <th>Xe · Tài xế · SĐT</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) =>
            r.stops.map((s, i) => (
              <tr key={r.code + i} className={(i === 0 ? "tc-row-first " : "") + (s.isKho ? "tc-kho" : "")}>
                {i === 0 && (
                  <td rowSpan={r.stops.length} className="tc-c-route">
                    <div className="tc-code">{r.code}</div>
                    {r.trongTai && <div className="tc-sub">{r.trongTai} kg</div>}
                  </td>
                )}
                <td className="tc-name"><span className="tc-stt">{i + 1}.</span> {s.isKho ? "🏠 " : ""}{s.name}</td>
                <td className="tc-quan">{s.quan || "—"}</td>
                <td className="tc-gio">{s.den || s.di ? `${s.den || "—"} - ${s.di || "—"}` : "—"}</td>
                {i === 0 && (
                  <td rowSpan={r.stops.length} className="tc-c-veh">
                    <div className="tc-bks">{r.bks || <span className="tc-empty">—</span>}</div>
                    <div className="tc-tx">{r.tx || <span className="tc-empty">—</span>}</div>
                    <div>{r.sdt ? <a href={`tel:${r.sdt}`}>{r.sdt}</a> : <span className="tc-empty">—</span>}</div>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function NccCard({ g, date }: { g: NccGroup; date: string }) {
  return (
    <div className="section-card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>🏢 {g.name}</h3>
        <span className="lead" style={{ margin: 0, fontSize: 14 }}>{g.lay.length} tuyến lấy · {g.giao.length} tuyến giao</span>
        {g.url && (
          <a className="pl-calc" style={{ padding: "4px 10px", fontSize: 14, textDecoration: "none" }}
            href={g.url} target="_blank" rel="noreferrer" title="Mở room Telegram báo lịch cho NCC này">✈️ Room Telegram</a>
        )}
        {g.lay.length > 0 && (
          <button className="pl-calc" style={{ padding: "4px 10px", fontSize: 14 }} onClick={() => exportTcNcc(g.lay, g.name, "Lấy", date)}>⬇️ Excel Lấy</button>
        )}
        {g.giao.length > 0 && (
          <button className="pl-calc" style={{ padding: "4px 10px", fontSize: 14 }} onClick={() => exportTcNcc(g.giao, g.name, "Giao", date)}>⬇️ Excel Giao</button>
        )}
      </div>

      <Collapsible title="📋 Xem chi tiết tuyến" sub={`${g.lay.length} lấy · ${g.giao.length} giao`}>
        {g.lay.length > 0 && (
          <>
            <div className="pe-fc-sub" style={{ marginTop: 6 }}>📥 Lịch LẤY ({g.lay.length} tuyến)</div>
            <TcTable routes={g.lay} kind="lay" />
          </>
        )}
        {g.giao.length > 0 && (
          <>
            <div className="pe-fc-sub" style={{ marginTop: 10 }}>📤 Lịch GIAO ({g.giao.length} tuyến)</div>
            <TcTable routes={g.giao} kind="giao" />
          </>
        )}
      </Collapsible>
    </div>
  );
}

/**
 * Mục NCC (CHỈ ADMIN): hiện LỊCH tăng cường đầy đủ gom theo từng nhà cung cấp,
 * NCC chưa gán để cuối. Có nút tải Excel (gửi NCC, tách Lấy/Giao) + link room Telegram.
 */
export function NccPanel() {
  const lay = useTangCuong(SHEET_ID, TANG_CUONG_LAY_GID, "Lấy");
  const giao = useTangCuong(TANG_CUONG_GIAO_SHEET_ID, TANG_CUONG_GIAO_GID, "Giao");
  const [q, setQ] = useState("");

  const layRoutes = lay.data?.routes ?? [];
  const giaoRoutes = giao.data?.routes ?? [];
  const date = lay.data?.date || giao.data?.date || "";

  const groups = useMemo(() => {
    const all = groupByNcc(layRoutes, giaoRoutes);
    const k = q.trim().toLowerCase();
    return k ? all.filter((g) => g.name.toLowerCase().includes(k)) : all;
  }, [layRoutes, giaoRoutes, q]);


  const totalNcc = groups.filter((g) => !g.name.startsWith("(")).length;
  const loading = !lay.data && !giao.data;

  return (
    <div>
      <div className="section-card tc-head">
        <h2 style={{ marginBottom: 2, fontSize: 17 }}>🚚 Lịch TC theo NCC{date ? ` · ${date}` : ""}</h2>
        <p className="lead" style={{ margin: 0, fontSize: 14 }}>
          {totalNcc} NCC · {layRoutes.length} tuyến lấy · {giaoRoutes.length} tuyến giao. Lịch gom theo từng nhà; tải Excel tách Lấy/Giao để gửi NCC.
        </p>
        <p className="lead" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
          Cần <b>hồ sơ năng lực, SĐT/email liên hệ văn phòng, giám đốc NCC</b>? → <button onClick={() => navTo({ view: "ds-ncc" })} style={{ border: "none", background: "none", color: "var(--blue)", fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 13.5 }}>xem Performance NCC</button>
        </p>
        <input className="pl-in" style={{ marginTop: 9 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔎 Tìm tên NCC…" />
      </div>

      {!loading && (layRoutes.length > 0 || giaoRoutes.length > 0) && (
        <NccPerformance lay={layRoutes} giao={giaoRoutes} date={date} />
      )}

      {loading ? (
        <div className="section-card" style={{ marginTop: 12, textAlign: "center", color: "var(--muted)" }}>Đang tải dữ liệu tăng cường…</div>
      ) : groups.length === 0 ? (
        <div className="section-card" style={{ marginTop: 12, textAlign: "center", color: "var(--muted)" }}>Không có NCC nào khớp / chưa có tải tăng cường.</div>
      ) : (
        groups.map((g) => <NccCard key={g.name} g={g} date={date} />)
      )}
    </div>
  );
}
