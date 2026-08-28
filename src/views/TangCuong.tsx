import { useEffect, useMemo, useState } from "react";
import { MapPanel } from "../components/MapPanel";
import { NccPanel } from "../components/NccPanel";
import { XinTcPanel } from "../components/XinTcPanel";
import { TtAmPanel } from "../components/TtAmPanel";
import { useTangCuong } from "../lib/useTangCuong";
import { takePendingTcSub } from "../lib/nav";
import { usePersistentState } from "../lib/usePersistent";
import { normSearch } from "../lib/normalize";
import { usePlaceIds } from "../lib/allRoutes";
import { SHEET_ID, TANG_CUONG_LAY_GID, TANG_CUONG_GIAO_SHEET_ID, TANG_CUONG_GIAO_GID } from "../config";
import type { Route } from "../types";

/**
 * Báo cáo TẢI TĂNG CƯỜNG — 2 mục: Lấy & Giao. Bảng gọn bên trái (ưu tiên),
 * bản đồ lộ trình bên phải. Bấm 1 tuyến để xem đường đi. Realtime 60s.
 */
export function TangCuong({
  mapMode,
  setMapMode,
}: {
  mapMode: "auto" | "mymap";
  setMapMode: (m: "auto" | "mymap") => void;
}) {
  // Mặc định mở "TC - Phát Sinh" (key đổi -> reset để mọi người thấy mục này trước).
  const [view, setView] = usePersistentState<"list" | "ncc" | "xintc" | "ttam">("tc.view2", "xintc");
  const [kind, setKind] = usePersistentState<"lay" | "giao">("tc.kind", "lay");
  const sheetId = kind === "lay" ? SHEET_ID : TANG_CUONG_GIAO_SHEET_ID;
  const gid = kind === "lay" ? TANG_CUONG_LAY_GID : TANG_CUONG_GIAO_GID;
  const kindLabel = kind === "lay" ? "Lấy" : "Giao";
  const { data, refreshing } = useTangCuong(sheetId, gid, kindLabel);
  const placeIds = usePlaceIds(); // cho ô "Tìm vị trí" trên bản đồ gõ được mã ID bưu cục/kho
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  // Nơi khác (vd nút "xem Vùng HCM · Lịch TC theo NCC" ở Performance NCC) muốn mở đúng
  // sub-tab thay vì rơi vào sub-tab đã lưu từ lần xem trước — đọc 1 lần lúc mount.
  useEffect(() => {
    const v = takePendingTcSub();
    if (v) setView(v);
  }, []);

  const routes = data?.routes ?? [];
  const q = normSearch(search);
  const filtered = useMemo(() => {
    if (!q) return routes;
    return routes.filter((r) => {
      const blob = [r.code, r.ncc, r.bks, r.tx, r.sdt, ...r.stops.map((s) => s.name + " " + s.quan + " " + s.id)].join(" ");
      return normSearch(blob).includes(q);
    });
  }, [routes, q]);

  // Chọn tuyến đầu nếu chưa chọn / lựa chọn cũ không còn trong danh sách lọc
  useEffect(() => {
    if (filtered.length === 0) { setSelected(null); return; }
    if (!selected || !filtered.some((r) => r.code === selected)) setSelected(filtered[0].code);
  }, [filtered, selected]);

  const withVehicle = routes.filter((r) => r.bks || r.sdt).length;
  // Không có gid, hoặc đã thử tải mà thất bại (vd sheet chưa chia sẻ công khai).
  const noSource = !gid || (!!data && data.ok === false);

  // Tuyến đang chọn -> Route để vẽ bản đồ
  const sel = filtered.find((r) => r.code === selected);
  const mapRoutes: Route[] = sel
    ? [{
        route: sel.code,
        load: sel.trongTai,
        category: kindLabel,
        stops: sel.stops.map((s) => ({ kho: s.name, loaiHinh: kindLabel, toi: s.den, roi: s.di, coord: s.coord || undefined })),
        mappedCount: sel.stops.filter((s) => s.coord).length,
      }]
    : [];

  return (
    <div>
      <div className="sub-tabs">
        <button className={view === "list" && kind === "lay" ? "active" : ""} onClick={() => { setView("list"); setKind("lay"); }}>📥 TC - Lấy</button>
        <button className={view === "list" && kind === "giao" ? "active" : ""} onClick={() => { setView("list"); setKind("giao"); }}>📤 TC - Giao</button>
        <button className={view === "xintc" ? "active" : ""} onClick={() => setView("xintc")}>🙋 TC - Phát Sinh</button>
        <button className={view === "ttam" ? "active" : ""} onClick={() => setView("ttam")}>🧑‍💼 TT - AM</button>
        <button className={view === "ncc" ? "active" : ""} onClick={() => setView("ncc")}>🚚 Lịch TC theo NCC</button>
      </div>

      {view === "ttam" ? (
        <TtAmPanel />
      ) : view === "xintc" ? (
        <XinTcPanel />
      ) : view === "ncc" ? (
        <NccPanel />
      ) : noSource ? (
        <div className="section-card" style={{ marginTop: 12, textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 6 }}>🔒</div>
          <p className="lead" style={{ maxWidth: 560, margin: "0 auto" }}>
            {!gid ? (
              <>Chưa cấu hình nguồn <b>Tăng Cường {kindLabel}</b>.</>
            ) : (
              <>
                Chưa đọc được sheet <b>Tăng Cường {kindLabel}</b> — sheet đang để <b>riêng tư</b>.<br />
                Vào Google Sheet → <b>Chia sẻ</b> → “Bất kỳ ai có đường liên kết” → <b>Người xem</b>, rồi đợi ~1 phút.
                Dash đã cắm sẵn nguồn, sẽ tự hiện realtime ngay khi sheet công khai.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="split tc-split">
          <div>
            <div className="section-card tc-head">
              <h2 style={{ marginBottom: 2, fontSize: 17 }}>🚚 Tải Tăng Cường — {kindLabel}{data?.date ? ` ${data.date}` : ""}</h2>
              <p className="lead" style={{ margin: 0, fontSize: 14 }}>
                {routes.length} tuyến · {withVehicle} đã có xe
                {data?.lastSync ? ` · cập nhật ${new Date(data.lastSync).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : ""}
                {refreshing ? " · đồng bộ…" : ""}
              </p>
              <input
                className="pl-in"
                style={{ marginTop: 9 }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`🔎 Tìm mã tuyến, điểm ${kindLabel.toLowerCase()}, ID bưu cục, quận, biển số, tài xế, SĐT…`}
              />
            </div>

            {!data ? (
              <div className="section-card" style={{ marginTop: 12, textAlign: "center", color: "var(--muted)" }}>Đang tải dữ liệu tăng cường…</div>
            ) : filtered.length === 0 ? (
              <div className="section-card" style={{ marginTop: 12, textAlign: "center", color: "var(--muted)" }}>
                {routes.length === 0 ? "Chưa có tải tăng cường cho ngày này." : "Không có tuyến nào khớp tìm kiếm."}
              </div>
            ) : (
              <div className="section-card tc-wrap scroll-frame" style={{ marginTop: 12 }}>
                <table className="tc-grid">
                  <colgroup>
                    <col className="c-route" />
                    <col className="c-name" />
                    <col className="c-quan" />
                    <col className="c-gio" />
                    <col className="c-veh" />
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
                    {filtered.map((r) =>
                      r.stops.map((s, i) => (
                        <tr
                          key={r.code + i}
                          className={(i === 0 ? "tc-row-first " : "") + (s.isKho ? "tc-kho " : "") + (r.code === selected ? "tc-sel" : "")}
                          onClick={() => setSelected(r.code)}
                        >
                          {i === 0 && (
                            <td rowSpan={r.stops.length} className="tc-c-route">
                              <div className="tc-code">{r.code}</div>
                              {r.trongTai && <div className="tc-sub">{r.trongTai} kg</div>}
                              {r.ncc && <div className="tc-sub">{r.ncc}</div>}
                            </td>
                          )}
                          <td className="tc-name"><span className="tc-stt">{i + 1}.</span> {s.isKho ? "🏠 " : ""}{s.name}</td>
                          <td className="tc-quan">{s.quan || "—"}</td>
                          <td className="tc-gio">{s.den || s.di ? `${s.den || "—"} - ${s.di || "—"}` : "—"}</td>
                          {i === 0 && (
                            <td rowSpan={r.stops.length} className="tc-c-veh">
                              <div className="tc-bks">{r.bks || <span className="tc-empty">—</span>}</div>
                              <div className="tc-tx">{r.tx || <span className="tc-empty">—</span>}</div>
                              <div>{r.sdt ? <a href={`tel:${r.sdt}`} onClick={(e) => e.stopPropagation()}>{r.sdt}</a> : <span className="tc-empty">—</span>}</div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="map-panel">
            <MapPanel routes={mapRoutes} title={sel ? sel.code : "Lộ trình tăng cường"} mapMode={mapMode} setMapMode={setMapMode} placeIds={placeIds} />
          </div>
        </div>
      )}
    </div>
  );
}
