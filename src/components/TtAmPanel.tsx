import { useEffect, useMemo, useRef, useState } from "react";
import { loadAm, type AmData } from "../lib/am";
import { normSearch } from "../lib/normalize";
import { startPoll } from "../lib/poll";
import { REFRESH_MS } from "../config";

/**
 * TT - AM — lịch tải gọn theo tuyến, kèm thông tin AM (phụ trách) sau mỗi bưu cục.
 * Tìm kiếm theo: tên tuyến · tên bưu cục · tên AM. Realtime 60s.
 */
let amCache: AmData | null = null;

export function TtAmPanel() {
  const [data, setData] = useState<AmData | null>(amCache);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setRefreshing(true);
      try {
        const res = await loadAm();
        if (!alive) return;
        amCache = res;
        setData(res);
      } catch { /* giữ data cũ */ } finally { if (alive) setRefreshing(false); }
    };
    run();
    const stop = startPoll(run, REFRESH_MS);
    return () => { alive = false; stop(); };
  }, []);

  const routes = data?.routes ?? [];
  const nq = normSearch(q);
  const filtered = useMemo(() => {
    if (!nq) return routes;
    return routes.filter((r) => {
      const blob = [r.code, r.load, ...r.stops.flatMap((s) => [s.kho, s.id, s.tenAm, s.idAm])].join(" ");
      return normSearch(blob).includes(nq);
    });
  }, [routes, nq]);

  const totalStops = routes.reduce((n, r) => n + r.stops.length, 0);
  const withAm = routes.reduce((n, r) => n + r.stops.filter((s) => s.tenAm).length, 0);

  return (
    <div>
      <div className="section-card tc-head">
        <h2 style={{ marginBottom: 2, fontSize: 17 }}>🧑‍💼 TT - AM</h2>
        <p className="lead" style={{ margin: 0, fontSize: 14 }}>
          {routes.length} tuyến · {totalStops} điểm · {withAm} điểm có AM
          {data?.lastSync ? ` · cập nhật ${new Date(data.lastSync).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : ""}
          {refreshing ? " · đồng bộ…" : ""}
        </p>
        <div style={{ position: "relative", marginTop: 9 }}>
          <input
            ref={inputRef}
            className="pl-in"
            style={{ width: "100%", paddingRight: 28 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔎 Tìm theo tên tuyến, tên/ID bưu cục, tên AM…"
          />
          {q && (
            <button
              onClick={() => { setQ(""); inputRef.current?.focus(); }}
              title="Xoá tìm kiếm"
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "var(--muted)" }}
            >✕</button>
          )}
        </div>
      </div>

      {!data ? (
        <div className="section-card" style={{ marginTop: 12, textAlign: "center", color: "var(--muted)" }}>Đang tải lịch AM…</div>
      ) : filtered.length === 0 ? (
        <div className="section-card" style={{ marginTop: 12, textAlign: "center", color: "var(--muted)" }}>
          {routes.length === 0 ? "Chưa đọc được dữ liệu AM." : "Không có tuyến nào khớp tìm kiếm."}
        </div>
      ) : (
        <div className="section-card tc-wrap" style={{ marginTop: 12 }}>
          <table className="tc-grid am-grid">
            <colgroup>
              <col className="c-route" />
              <col className="c-name" />
              <col className="c-gio" />
              <col className="c-am" />
            </colgroup>
            <thead>
              <tr>
                <th>Tuyến</th>
                <th>Lộ trình (bưu cục)</th>
                <th>Giờ (Tới / Rời)</th>
                <th>AM (ID · Tên · SĐT)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) =>
                r.stops.map((s, i) => (
                  <tr key={r.code + i} className={(i === 0 ? "tc-row-first " : "") + (/kho/i.test(s.kho) ? "tc-kho" : "")}>
                    {i === 0 && (
                      <td rowSpan={r.stops.length} className="tc-c-route">
                        <div className="tc-code">{r.code}</div>
                        {r.load && <div className="tc-sub">{r.load} kg</div>}
                      </td>
                    )}
                    <td className="tc-name"><span className="tc-stt">{i + 1}.</span> {/kho/i.test(s.kho) ? "🏠 " : ""}{s.kho}</td>
                    <td className="tc-gio">{s.toi || s.roi ? `${s.toi || "—"} - ${s.roi || "—"}` : "—"}</td>
                    <td className="am-info">
                      {s.tenAm || s.idAm || s.sdtAm ? (
                        <>
                          <div className="am-name">{s.tenAm || <span className="tc-empty">—</span>}{s.idAm ? <span className="am-id"> · {s.idAm}</span> : ""}</div>
                          {s.sdtAm && <div><a href={`tel:${s.sdtAm}`}>{s.sdtAm}</a></div>}
                        </>
                      ) : <span className="tc-empty">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
