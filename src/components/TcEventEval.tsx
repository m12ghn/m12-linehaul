import { useEffect, useState } from "react";
import { loadTcEvent, tcEventStats, type TcEvData } from "../lib/tcEvent";
import { loadXinTc, type XtcData } from "../lib/xinTangCuong";
import { startPoll } from "../lib/poll";
import { REFRESH_MS } from "../config";

const pct = (v: number) => Math.round(v * 100) + "%";
/** "06/07/26" | "06/07/2026" -> ISO. */
function dmyIso(s: string): string {
  const m = (s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return "";
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
function rateColor(r: number): string { return r >= 0.95 ? "var(--green)" : r >= 0.8 ? "var(--orange)" : "var(--red)"; }

/**
 * ĐÁNH GIÁ SỐ XE TĂNG CƯỜNG kỳ event (số THẬT, không bịa):
 * - Xe CỐ ĐỊNH: từ "Lưu trữ TC EVENT" (mỗi SG_TCEV = 1 xe) + tỷ lệ điều được theo NCC.
 * - Xe PHÁT SINH: đếm ticket "BC xin TC" rơi trong kỳ (từ ngày→đến ngày của batch cố định).
 * - Tổng nhu cầu = cố định + phát sinh.
 */
export function TcEventEval() {
  const [tc, setTc] = useState<TcEvData | null>(null);
  const [xin, setXin] = useState<XtcData | null>(null);

  useEffect(() => {
    let alive = true;
    const run = () => {
      loadTcEvent().then((d) => { if (alive && d.ok) setTc(d); }).catch(() => {});
      loadXinTc().then((d) => { if (alive && d.ok) setXin(d); }).catch(() => {});
    };
    run();
    const stop = startPoll(run, REFRESH_MS);
    return () => { alive = false; stop(); };
  }, []);

  if (!tc) return <div className="section-card" style={{ marginTop: 12, color: "var(--muted)", textAlign: "center" }}>Đang tải lịch TC cố định…</div>;

  const st = tcEventStats(tc.routes);
  // Cửa sổ kỳ event = from→to của batch cố định.
  const [fromRaw, toRaw] = tc.mainBucket.split("→");
  const fromIso = dmyIso(fromRaw), toIso = dmyIso(toRaw || fromRaw);
  // Phát sinh: ticket "BC Xin TC" trong kỳ (ngày theo Timestamp; đã loại "Hủy - Nhập sai" ở loader).
  // Đáp ứng = "Có xe" HOẶC "Hủy - BC không đợi tải"; KHÔNG đáp ứng = "Không có xe".
  const isMet = (s: string) => /kh[ôo]ng\s*đợi\s*t/i.test(s) || (/c[óo]\s*xe/i.test(s) && !/kh[ôo]ng\s*c[óo]\s*xe/i.test(s));
  const psRecs = (xin?.recs ?? []).filter((r) => r.date && (!fromIso || r.date >= fromIso) && (!toIso || r.date <= toIso));
  const psTotal = psRecs.length;
  const psOk = psRecs.filter((r) => isMet(r.trangThai)).length;
  const tongNhuCau = st.totalXe + psTotal;

  return (
    <div className="section-card" style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: 16, margin: "0 0 2px" }}>🚚 Số xe tăng cường kỳ event {tc.mainBucket ? `· ${tc.mainBucket}` : ""}</h3>
      <p className="lead" style={{ margin: "0 0 10px", fontSize: 14 }}>
        Số THẬT từ "Lưu trữ TC EVENT" (mỗi mã SG_TCEV = 1 xe) + phát sinh từ "BC Xin TC". Đã điều được xe = có biển số / ghi "Đáp ứng".
      </p>

      <div className="kpi-row">
        <div className="kpi">
          <div className="lbl">Xe TC cố định</div>
          <div className="val orange">{st.totalXe}</div>
          <div className="note">đã lên lịch</div>
        </div>
        <div className="kpi green">
          <div className="lbl">Đã điều được xe</div>
          <div className="val">{st.okXe}</div>
          <div className="badge" style={{ background: rateColor(st.rate) }}>{pct(st.rate)} đáp ứng</div>
        </div>
        <div className="kpi blue">
          <div className="lbl">Phát sinh (xin thêm)</div>
          <div className="val">{psTotal}</div>
          <div className="note">{xin ? `${psOk} đáp ứng được` : "đang tải…"}</div>
        </div>
        <div className="kpi ink">
          <div className="lbl">Tổng nhu cầu xe</div>
          <div className="val" style={{ color: "var(--ink)" }}>{tongNhuCau}</div>
          <div className="note">cố định + phát sinh</div>
        </div>
      </div>

      <div className="tc-wrap" style={{ marginTop: 12 }}>
        <table className="tc-grid">
          <thead>
            <tr><th>Nhà cung cấp (NCC)</th><th style={{ width: 70 }}>Số xe</th><th style={{ width: 90 }}>Điều được</th><th style={{ width: 100 }}>Tỷ lệ đáp ứng</th></tr>
          </thead>
          <tbody>
            {st.byNcc.map((n) => (
              <tr key={n.ncc}>
                <td style={{ fontWeight: 600 }}>{n.ncc}</td>
                <td className="num">{n.xe}</td>
                <td className="num" style={{ color: n.ok < n.xe ? "var(--red)" : "var(--green)" }}>{n.ok}</td>
                <td className="num" style={{ fontWeight: 700, color: rateColor(n.rate) }}>{pct(n.rate)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 800 }}>
              <td>TỔNG</td>
              <td className="num">{st.totalXe}</td>
              <td className="num">{st.okXe}</td>
              <td className="num" style={{ color: rateColor(st.rate) }}>{pct(st.rate)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {(() => {
        // GHN = xe nhà tự vận hành (không phải NCC thuê ngoài) -> loại khỏi "NCC cần rút kinh nghiệm".
        const weak = st.byNcc.filter((n) => n.rate < 1 && n.ncc.toUpperCase() !== "GHN").sort((a, b) => a.rate - b.rate).slice(0, 3);
        const good = st.byNcc.filter((n) => n.rate >= 1 && n.xe >= 2).length;
        const rv = st.rate >= 0.95 ? "TỐT 🟢" : st.rate >= 0.85 ? "KHÁ 🟠" : "THẤP 🔴";
        const psPct = st.totalXe ? Math.round((psTotal / st.totalXe) * 100) : 0;
        return (
          <div style={{ fontSize: 14, lineHeight: 1.65, color: "var(--text-body)", background: "var(--bg)", borderLeft: "3px solid var(--orange)", borderRadius: 8, padding: "8px 12px", marginTop: 10 }}>
            <b>🤖 Nhận xét (tự động):</b> Đáp ứng chung <b>{pct(st.rate)}</b> — {rv} ({st.okXe}/{st.totalXe} xe).{" "}
            {weak.length > 0 && <>NCC cần rút kinh nghiệm: {weak.map((n) => `${n.ncc} ${pct(n.rate)}`).join(", ")}. </>}
            {good > 0 && <>{good} NCC đáp ứng đủ 100%. </>}
            {psTotal > 0 && <>Phát sinh xin thêm <b>{psTotal}</b> xe (+{psPct}% so lịch cố định){psOk < psTotal ? `, mới có xe ${psOk}` : ""} → tổng nhu cầu <b>{tongNhuCau}</b> xe.</>}
          </div>
        );
      })()}
    </div>
  );
}
