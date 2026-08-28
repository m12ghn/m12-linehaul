import { useMemo, useState } from "react";
import { isWeekendISO } from "../lib/normalize";
import type { TlldRoute } from "../lib/tlld";
import type { Route } from "../types";

function cls(v: number | null | undefined): "low" | "mid" | "high" | "na" {
  if (v == null) return "na";
  if (v < 0.6) return "low";
  if (v < 0.85) return "mid";
  return "high";
}
const pct = (v: number | null | undefined) => (v == null ? "—" : Math.round(v * 100) + "%");
const ddmm = (iso: string | null | undefined) => (iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : "—");

/** 1 dòng TLLD của tuyến: N-1, TB 7 ngày, sparkline. Bấm để mở chi tiết + lộ trình. */
export function TlldCard({ route, tlld }: { route: Route; tlld?: TlldRoute }) {
  const has = !!tlld && (tlld.n1 != null || tlld.avg7 != null);
  const cardCls = has ? cls(tlld!.n1 ?? tlld!.avg7) : "na";
  const [open, setOpen] = useState(false);

  // Lộ trình các điểm + giờ: ưu tiên stops từ lịch (có Tới/Rời), không có thì tách từ mô tả TLLD.
  const stopsDetail = useMemo(() => {
    if (route.stops.length) {
      return route.stops.map((s) => ({ name: s.kho, loaiHinh: s.loaiHinh || "", toi: s.toi || "", roi: s.roi || "" }));
    }
    return (tlld?.routeText || "")
      .split(/->|→/)
      .map((s) => s.replace(/^\s*\d+\.\s*/, "").trim())
      .filter(Boolean)
      .map((n) => ({ name: n, loaiHinh: "", toi: "", roi: "" }));
  }, [route, tlld]);
  const hasTimes = stopsDetail.some((s) => s.toi || s.roi);

  return (
    <div className={"tlld-card " + cardCls + (open ? " open" : "")}>
      <div className="tlld-card-main" onClick={() => has && setOpen((o) => !o)} style={{ cursor: has ? "pointer" : "default" }}>
        <div className="tc-left">
          <div className="tc-code">{has && <span className="tc-caret">{open ? "▾" : "▸"}</span>} {route.route}</div>
          <div className="tc-meta">
            {route.load && <span className="chip load">⚖ {route.load} kg</span>}
          </div>
        </div>

        {has ? (
          <div className="tc-metrics">
            <div className="tc-metric">
              <div className="tc-lbl">N-1</div>
              <div className={"tc-val " + cls(tlld!.n1)}>{pct(tlld!.n1)}</div>
            </div>
            <div className="tc-metric">
              <div className="tc-lbl">TB 7 ngày</div>
              <div className={"tc-val " + cls(tlld!.avg7)}>{pct(tlld!.avg7)}</div>
            </div>
            <div className="tc-metric">
              <div className="tc-lbl">TB tháng</div>
              <div className={"tc-val " + cls(tlld!.avg30)} title={`TB 30 ngày (${tlld!.days30}n)`}>{pct(tlld!.avg30)}</div>
            </div>
            <div className="tc-spark" title="7 ngày gần nhất (trái → phải)">
              {tlld!.series.map((s, i) => {
                const we = isWeekendISO(s.date); // T7/CN -> dải nền + nhãn xanh nước biển
                return (
                <div className="tc-col" key={i} style={we ? { background: "rgba(22,104,199,0.16)", borderRadius: 5 } : undefined}>
                  <div className={"tc-pct " + (s.val == null ? "" : cls(s.val))}>
                    {s.val == null ? "" : Math.round(s.val * 100)}
                  </div>
                  <div className="tc-barbox">
                    <div
                      className={"tc-bar " + (s.val == null ? "empty" : cls(s.val))}
                      style={{ height: s.val == null ? 2 : Math.max(2, Math.min(1.1, s.val) * 34), animationDelay: `${i * 0.06}s` }}
                      title={s.date + (s.val == null ? ": —" : ": " + Math.round(s.val * 100) + "%")}
                    />
                  </div>
                  <div className="tc-day" title={we ? "Cuối tuần (T7/CN)" : undefined}
                    style={we ? { color: "#fff", fontWeight: 800, background: "#1668c7", borderRadius: 4 } : undefined}>{s.date.slice(8, 10)}</div>
                </div>
                );
              })}
            </div>
          </div>
        ) : tlld?.lastVal != null ? (
          <div className="tlld-nodata" title={`TLLD gần nhất ngày ${ddmm(tlld.lastDate)} — tuyến chưa chạy trong 7 ngày qua`}>
            <span className={"tc-val " + cls(tlld.lastVal)} style={{ fontSize: 16 }}>{pct(tlld.lastVal)}</span>
            <span style={{ color: "var(--muted)", fontWeight: 600, marginLeft: 6 }}>· gần nhất {ddmm(tlld.lastDate)} (chạy thưa)</span>
          </div>
        ) : (
          <div className="tlld-nodata">Chưa có dữ liệu TLLD</div>
        )}
      </div>

      {open && has && (
        <div className="tlld-detail">
          {/* TRÁI: lộ trình các điểm + giờ */}
          <div className="tlld-route">
            <div className="tlld-route-title">🛣️ Lộ trình {!hasTimes && <span className="tld-empty" style={{ fontWeight: 400 }}>· (chưa có giờ trong lịch)</span>}</div>
            {stopsDetail.length > 0 ? (
              <table className="tlld-route-tbl">
                <thead>
                  <tr><th>#</th><th>Điểm / Kho</th><th>Loại hình</th><th>Tới</th><th>Rời</th></tr>
                </thead>
                <tbody>
                  {stopsDetail.map((s, i) => (
                    <tr key={i}>
                      <td className="num">{i + 1}</td>
                      <td>{/kho/i.test(s.name) ? "🏠 " : ""}{s.name}</td>
                      <td className="lh">{s.loaiHinh || "—"}</td>
                      <td className="num">{s.toi || "—"}</td>
                      <td className="num">{s.roi || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="tld-empty">Không có dữ liệu lộ trình.</div>
            )}
          </div>

          {/* PHẢI: TLLD chi tiết (thấy rõ hơn thanh tóm tắt phía trên) */}
          <div className="tlld-detbox">
            <div className="tlld-route-title">📊 TLLD chi tiết</div>
            <div className="tld-mb-row"><span>Hôm qua (N-1)</span><b className={cls(tlld!.n1)}>{pct(tlld!.n1)}</b></div>
            <div className="tld-mb-row"><span>TB 7 ngày</span><b className={cls(tlld!.avg7)}>{pct(tlld!.avg7)}</b></div>
            <div className="tld-mb-row"><span>TB tháng ({tlld!.days30}n)</span><b className={cls(tlld!.avg30)}>{pct(tlld!.avg30)}</b></div>
            <div className="tld-mb-sub">7 ngày gần nhất</div>
            <div className="tld-mb-days">
              {tlld!.series.map((s, i) => {
                const we = isWeekendISO(s.date);
                return (
                  <div className={"tld-mb-day" + (we ? " we" : "")} key={i}>
                    <span className="d">{ddmm(s.date)}</span>
                    <b className={s.val == null ? "na" : cls(s.val)}>{s.val == null ? "—" : Math.round(s.val * 100) + "%"}</b>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
