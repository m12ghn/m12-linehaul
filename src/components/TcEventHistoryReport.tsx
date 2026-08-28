/* ============================================================
   PHÂN TÍCH TC CỐ ĐỊNH THEO CÁC KỲ EVENT (theo tháng) — dùng TOÀN BỘ dữ liệu
   đã lưu trong "Lưu trữ TC EVENT" (không chỉ kỳ hiện tại). So sánh "kỳ thứ N
   trong tháng" giữa 2 tháng gần nhất (vd kỳ 1 = 7/7 vs 6/6, kỳ 2 = 15/7 vs 15/6)
   + phát hiện NCC yếu LẶP LẠI qua nhiều kỳ (khác với yếu 1 lần).
   ============================================================ */
import { useMemo } from "react";
import { buildEventPeriods, pairLatestTwoMonths, type TcEvRoute } from "../lib/tcEvent";

const pct = (v: number) => Math.round(v * 100) + "%";
const rateColor = (r: number) => (r >= 0.9 ? "var(--green)" : r >= 0.75 ? "var(--orange)" : "var(--red)");
const ddmm = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
// GHN = xe nhà tự vận hành, không phải NCC thuê ngoài -> loại khỏi đánh giá "NCC yếu"
// (xe nhà thường không điền biển số theo kiểu NCC nên dễ bị tính nhầm đáp ứng thấp).
const isRealNcc = (ncc: string) => ncc.toUpperCase() !== "GHN";

export function TcEventHistoryReport({ allRoutes }: { allRoutes: TcEvRoute[] }) {
  const periods = useMemo(() => buildEventPeriods(allRoutes), [allRoutes]);
  const pairs = useMemo(() => pairLatestTwoMonths(periods), [periods]);

  if (periods.length < 2) return null; // chưa đủ ≥2 kỳ để có gì phân tích/so sánh

  const totalXeAll = periods.reduce((a, p) => a + p.stats.totalXe, 0);
  const avgRate = periods.reduce((a, p) => a + p.stats.rate, 0) / periods.length;
  const first = periods[0], last = periods[periods.length - 1];
  const trendPts = Math.round((last.stats.rate - first.stats.rate) * 100);

  // NCC yếu LẶP LẠI (đáp ứng TB <85% qua ≥2 kỳ có ≥2 xe) — tín hiệu khác "yếu 1 lần".
  const chronic = useMemo(() => {
    const acc = new Map<string, { sum: number; n: number }>();
    for (const p of periods) for (const n of p.stats.byNcc) if (n.xe >= 2 && isRealNcc(n.ncc)) {
      const e = acc.get(n.ncc) || { sum: 0, n: 0 }; e.sum += n.rate; e.n++; acc.set(n.ncc, e);
    }
    return [...acc.entries()]
      .filter(([, v]) => v.n >= 2 && v.sum / v.n < 0.85)
      .map(([ncc, v]) => ({ ncc, avgRate: v.sum / v.n, kyCount: v.n }))
      .sort((a, b) => a.avgRate - b.avgRate);
  }, [periods]);

  const insight = (() => {
    const parts = pairs.map((pr) => {
      const dXe = pr.b.stats.totalXe - pr.a.stats.totalXe;
      const dRate = Math.round((pr.b.stats.rate - pr.a.stats.rate) * 100);
      return `Kỳ ${pr.ordinal} (<b>${pr.b.event}</b> vs ${pr.a.event}): ${dXe >= 0 ? "+" : ""}${dXe} xe, đáp ứng ${dRate >= 0 ? "+" : ""}${dRate}đ`;
    });
    const chronicTxt = chronic.length
      ? ` <b style="color:var(--red)">NCC cần theo dõi sát</b> (đáp ứng TB &lt;85% qua nhiều kỳ): ${chronic.slice(0, 3).map((c) => `${c.ncc} (TB ${pct(c.avgRate)}, ${c.kyCount} kỳ)`).join(", ")}.`
      : " Không có NCC nào yếu lặp lại qua nhiều kỳ.";
    return (parts.length ? parts.join(". ") + "." : "") + chronicTxt;
  })();

  return (
    <div className="section-card" style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: 16, margin: "0 0 2px" }}>📈 Phân tích TC cố định theo các kỳ Event (theo tháng)</h3>
      <p className="lead" style={{ margin: "0 0 10px", fontSize: 14 }}>
        Tổng hợp <b>toàn bộ {periods.length} kỳ event</b> đã lưu ({ddmm(first.fromIso)} → {ddmm(last.fromIso)}) từ "Lưu trữ TC EVENT" — theo dõi xu hướng quy mô, đáp ứng &amp; hiệu suất NCC qua thời gian (không chỉ kỳ đang chọn ở trên).
      </p>

      <div className="kpi-row">
        <div className="kpi">
          <div className="lbl">Số kỳ event đã ghi nhận</div>
          <div className="val orange">{periods.length}</div>
          <div className="note">{ddmm(first.fromIso)} – {ddmm(last.fromIso)}</div>
        </div>
        <div className="kpi blue">
          <div className="lbl">Tổng xe qua các kỳ</div>
          <div className="val">{totalXeAll}</div>
          <div className="note">TB {(totalXeAll / periods.length).toFixed(0)} xe/kỳ</div>
        </div>
        <div className="kpi green">
          <div className="lbl">Đáp ứng trung bình</div>
          <div className="val">{pct(avgRate)}</div>
          <div className="note">{trendPts >= 0 ? "▲" : "▼"} {Math.abs(trendPts)}đ so kỳ đầu tiên ({first.event})</div>
        </div>
        <div className="kpi ink">
          <div className="lbl">NCC yếu lặp lại</div>
          <div className="val" style={{ color: chronic.length ? "var(--red)" : "var(--ink)" }}>{chronic.length}</div>
          <div className="note">đáp ứng TB &lt;85% qua ≥2 kỳ</div>
        </div>
      </div>

      {/* Bảng từng kỳ theo thời gian */}
      <div className="tc-wrap" style={{ marginTop: 12 }}>
        <table className="tc-grid">
          <thead>
            <tr><th>Kỳ Event</th><th>Ngày</th><th style={{ width: 70 }}>Tổng xe</th><th style={{ width: 90 }}>Đáp ứng</th><th>NCC yếu nhất kỳ này</th></tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const worst = [...p.stats.byNcc].filter((n) => n.xe >= 2 && isRealNcc(n.ncc)).sort((a, b) => a.rate - b.rate)[0];
              return (
                <tr key={p.event}>
                  <td style={{ fontWeight: 700 }}>{p.event}</td>
                  <td className="num">{p.label}</td>
                  <td className="num">{p.stats.totalXe}</td>
                  <td className="num" style={{ fontWeight: 700, color: rateColor(p.stats.rate) }}>{pct(p.stats.rate)}</td>
                  <td style={{ fontSize: 13.5 }}>{worst ? `${worst.ncc} (${pct(worst.rate)})` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* So sánh "kỳ thứ N trong tháng" giữa 2 tháng gần nhất */}
      {pairs.length > 0 && (
        <>
          <div style={{ fontSize: 14.5, fontWeight: 800, margin: "14px 0 8px" }}>🆚 So sánh cùng kỳ theo tháng (Tháng {Number(pairs[0].b.monthKey.slice(5))} vs Tháng {Number(pairs[0].a.monthKey.slice(5))})</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${pairs.length}, 1fr)`, gap: 10 }}>
            {pairs.map((pr) => {
              const dXe = pr.b.stats.totalXe - pr.a.stats.totalXe;
              const dRate = Math.round((pr.b.stats.rate - pr.a.stats.rate) * 100);
              return (
                <div key={pr.ordinal} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>Kỳ {pr.ordinal}: {pr.b.event} <span style={{ color: "var(--muted)", fontWeight: 400 }}>vs {pr.a.event}</span></div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>{pr.b.label} <span style={{ opacity: .7 }}>vs {pr.a.label}</span></div>
                  <div style={{ fontSize: 21, fontWeight: 800, color: dXe > 0 ? "var(--red)" : dXe < 0 ? "var(--green)" : "var(--ink)" }}>
                    {pr.b.stats.totalXe} xe <span style={{ fontSize: 13.5, fontWeight: 700 }}>({dXe >= 0 ? "+" : ""}{dXe})</span>
                  </div>
                  <div style={{ fontSize: 14, marginTop: 4 }}>
                    Đáp ứng <b style={{ color: rateColor(pr.b.stats.rate) }}>{pct(pr.b.stats.rate)}</b>{" "}
                    <span style={{ color: dRate >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>({dRate >= 0 ? "+" : ""}{dRate}đ)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ fontSize: 14, lineHeight: 1.65, color: "#3a4753", background: "var(--bg)", borderLeft: "3px solid var(--orange)", borderRadius: 8, padding: "8px 12px", marginTop: 12 }}
        dangerouslySetInnerHTML={{ __html: "<b>🤖 Nhận định:</b> " + insight }} />
    </div>
  );
}
