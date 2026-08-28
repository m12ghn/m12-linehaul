import { useEffect, useState } from "react";
import { loadTcTlld, tcTlldStats, type TcTlldData } from "../lib/tcTlld";
import { startPoll } from "../lib/poll";
import { REFRESH_MS } from "../config";

const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");
// TLLD: <60% rỗng (đỏ) · 60–100% tốt (xanh) · >100% quá tải (cam)
const tlldColor = (v: number | null) => (v == null ? "var(--muted)" : v < 0.6 ? "var(--red)" : v > 1 ? "var(--orange)" : "var(--green)");

/**
 * NHẬN ĐỊNH TLLD TUYẾN TĂNG CƯỜNG (Sheet 17) — theo ngày event.
 * TLLD mỗi ngày = số LỚN HƠN trong 2 cột; <60% rỗng, >100% quá tải. Chỉ số có sẵn (3 ngày event), không bịa.
 */
export function TcTlldEval() {
  const [d, setD] = useState<TcTlldData | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => loadTcTlld().then((x) => { if (alive && x.ok) setD(x); }).catch(() => {});
    run();
    const stop = startPoll(run, REFRESH_MS);
    return () => { alive = false; stop(); };
  }, []);

  if (!d) return <div className="section-card" style={{ marginTop: 12, color: "var(--muted)", textAlign: "center" }}>Đang tải TLLD tuyến TC…</div>;
  if (!d.routes.length) return null;

  const st = tcTlldStats(d.routes);
  const sorted = [...d.routes].filter((r) => r.avg != null).sort((a, b) => (a.avg as number) - (b.avg as number));

  return (
    <div className="section-card" style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: 16, margin: "0 0 2px" }}>📈 TLLD tuyến tăng cường {d.dateLabels.length ? `· ${d.dateLabels.join(" · ")}` : ""}</h3>
      <p className="lead" style={{ margin: "0 0 10px", fontSize: 14 }}>Tỷ lệ lấp đầy từng tuyến TC theo ngày event (Sheet 17). 🔴 &lt;60% rỗng · 🟢 60–100% · 🟠 &gt;100% quá tải.</p>

      <div className="kpi-row">
        <div className="kpi"><div className="lbl">Tuyến TC có TLLD</div><div className="val orange">{st.n}</div><div className="note">tuyến</div></div>
        <div className="kpi blue"><div className="lbl">TLLD trung bình</div><div className="val">{pct(st.avg)}</div><div className="note">toàn bộ tuyến TC</div></div>
        <div className="kpi" style={{ borderColor: "var(--red)" }}><div className="lbl">Rỗng (&lt;60%)</div><div className="val" style={{ color: "var(--red)" }}>{st.low}</div><div className="note">cần gom/bỏ bớt xe</div></div>
        <div className="kpi" style={{ borderColor: "var(--orange)" }}><div className="lbl">Quá tải (&gt;100%)</div><div className="val" style={{ color: "var(--orange)" }}>{st.over}</div><div className="note">cần thêm xe</div></div>
      </div>

      <div className="tc-wrap" style={{ marginTop: 12 }}>
        <table className="tc-grid">
          <thead>
            <tr><th>Tuyến TC</th>{d.dateLabels.map((l) => <th key={l} style={{ width: 66 }}>{l}</th>)}<th style={{ width: 70 }}>TB</th></tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.code}>
                <td style={{ fontWeight: 600 }}>{r.code}</td>
                {r.days.map((v, i) => <td key={i} className="num" style={{ color: tlldColor(v) }}>{pct(v)}</td>)}
                <td className="num" style={{ fontWeight: 700, color: tlldColor(r.avg) }}>{pct(r.avg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 14, lineHeight: 1.65, color: "#3a4753", background: "var(--bg)", borderLeft: "3px solid var(--orange)", borderRadius: 8, padding: "8px 12px", marginTop: 10 }}>
        <b>🤖 Nhận định (tự động):</b> {st.n} tuyến TC, TLLD trung bình <b>{pct(st.avg)}</b>.{" "}
        {st.over > 0 && <><b style={{ color: "var(--orange)" }}>{st.over} tuyến quá tải &gt;100%</b> (cần thêm xe): {st.overRoutes.slice(0, 5).map((r) => `${r.code} ${pct(r.avg)}`).join(", ")}. </>}
        {st.low > 0 && <><b style={{ color: "var(--red)" }}>{st.low} tuyến rỗng &lt;60%</b> (nên gom/giảm xe): {st.lowRoutes.slice(0, 5).map((r) => `${r.code} ${pct(r.avg)}`).join(", ")}. </>}
        {st.over === 0 && st.low === 0 && "Tải các tuyến TC ở mức hợp lý."}
      </div>
    </div>
  );
}
