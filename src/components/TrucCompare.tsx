/* So sánh Book NCC theo NCC × tải trọng: Book kỳ này (LIVE) vs Book kỳ trước cùng loại (Lưu trữ
   TC Event), tách 4 tab Tổng/1.9T/5T/8T (Sếp chọn xem) — bảng bên trái + biểu đồ thanh ngang cặp
   đôi bên phải cho dễ hình dung. ẨN HẲN (return null) khi sheet chưa lưu trữ kỳ trước, không suy
   đoán số liệu. (Bản trước có thêm cột "Dự báo cần tăng"/"Thực tế vs dự báo" suy từ %Δ hàng FC —
   Sếp phản hồi bỏ hẳn vì thấy không đủ cơ sở, dù đã ghi rõ giới hạn.) */
import { useState } from "react";
import { Reveal } from "./Reveal";

export interface TrucCompareRow {
  name: string; book88: number; book77: number; deltaAbs: number; deltaPct: number | null;
}
export interface TrucCompareTab {
  key: string; label: string; rows: TrucCompareRow[]; totalBook88: number; totalBook77: number;
}
export interface TrucCompareData {
  tabs: TrucCompareTab[]; curLabel: string; prevLabel: string;
}

const fmtVN = (v: number) => Math.round(v).toLocaleString("vi-VN");

/** Biểu đồ thanh ngang cặp đôi (Book kỳ này/kỳ trước) theo NCC — dễ so lệch bằng mắt hơn bảng số. */
function PairedHBars({ rows, curLabel, prevLabel }: { rows: TrucCompareRow[]; curLabel: string; prevLabel: string }) {
  const maxVal = Math.max(1, ...rows.flatMap((r) => [r.book88, r.book77]));
  return (
    <div>
      <div className="fc-legend2" style={{ marginBottom: 8 }}>
        <span><i style={{ background: "var(--chart-1)" }} />Book {curLabel}</span>
        <span><i style={{ background: "var(--chart-2)" }} />Book {prevLabel}</span>
      </div>
      <div className="tcc-chart">
        {rows.map((r) => (
          <div className="tcc-row" key={r.name}>
            <div className="tcc-name" title={r.name}>{r.name}</div>
            <div className="tcc-bars">
              <div className="tcc-bar">
                <div className="tcc-track"><span className="tcc-fill" style={{ width: `${(r.book88 / maxVal) * 100}%`, background: "var(--chart-1)" }} /></div>
                <span className="tcc-val">{fmtVN(r.book88)}</span>
              </div>
              <div className="tcc-bar">
                <div className="tcc-track"><span className="tcc-fill" style={{ width: `${(r.book77 / maxVal) * 100}%`, background: "var(--chart-2)" }} /></div>
                <span className="tcc-val">{fmtVN(r.book77)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrucCompare({ data }: { data: TrucCompareData | null }) {
  const [tabKey, setTabKey] = useState<string | null>(null);
  if (!data) return null;
  const { tabs, curLabel, prevLabel } = data;
  const active = tabs.find((t) => t.key === tabKey) ?? tabs[0];

  const { rows, totalBook88, totalBook77 } = active;
  const totalDeltaPct = totalBook77 > 0 ? Math.round((totalBook88 / totalBook77 - 1) * 100) : null;

  const up = rows.filter((r) => r.deltaAbs > 0).sort((a, b) => b.deltaAbs - a.deltaAbs);
  const down = rows.filter((r) => r.deltaAbs < 0).sort((a, b) => a.deltaAbs - b.deltaAbs);
  const note = `Tổng Book <b>${curLabel}</b> (tải ${active.label}): <b>${totalBook88}</b> xe, so Book <b>${prevLabel}</b> (${totalBook77} xe): `
    + `${totalDeltaPct != null ? `${totalDeltaPct >= 0 ? "+" : ""}${totalDeltaPct}%` : "—"}. `
    + (up.length ? `Tăng: ${up.slice(0, 3).map((r) => `${r.name} (+${r.deltaAbs})`).join(", ")}${up.length > 3 ? "…" : ""}. ` : "")
    + (down.length ? `Giảm: ${down.slice(0, 3).map((r) => `${r.name} (${r.deltaAbs})`).join(", ")}${down.length > 3 ? "…" : ""}.` : "");

  return (
    <Reveal className="section-card pe-fc-card" style={{ marginTop: 12 }}>
      <div className="pe-fc-sub">🚛 Book NCC theo NCC × tải trọng <span className="fc-src">· Book {curLabel} vs Book {prevLabel}</span></div>
      {tabs.length > 1 && (
        <div className="xtc-seg sm" style={{ marginBottom: 10 }}>
          {tabs.map((t) => (
            <button key={t.key} className={active.key === t.key ? "on" : ""} onClick={() => setTabKey(t.key)}>{t.label}</button>
          ))}
        </div>
      )}
      <div className="pe-kpis" style={{ marginBottom: 4 }}>
        <div className="pe-kpi"><span className="l">Book {curLabel}</span><b style={{ color: "var(--orange)" }}>{totalBook88}</b><span className="u">xe · tải {active.label}</span></div>
        <div className="pe-kpi"><span className="l">Book {prevLabel}</span><b style={{ color: "var(--blue)" }}>{totalBook77}</b><span className="u">xe · tải {active.label}</span></div>
        <div className="pe-kpi">
          <span className="l">So sánh tăng/giảm</span>
          <b style={{ color: totalDeltaPct == null ? "var(--muted)" : totalDeltaPct < 0 ? "var(--red)" : "var(--green)" }}>{totalDeltaPct != null ? `${totalDeltaPct >= 0 ? "+" : ""}${totalDeltaPct}%` : "—"}</b>
          <span className="u">{totalBook88 - totalBook77 >= 0 ? "+" : ""}{totalBook88 - totalBook77} xe</span>
        </div>
      </div>
      <div className="tc-split">
        <div className="tc-wrap">
          <table className="tc-grid ncc-grid">
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th>Nhà cung cấp (NCC)</th>
                <th style={{ textAlign: "center" }}>Book {curLabel}</th>
                <th style={{ textAlign: "center" }}>Book {prevLabel}</th>
                <th style={{ textAlign: "center" }} title="Số xe đã book kỳ này trừ kỳ trước">So sánh tăng/giảm</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.name}>
                  <td className="num" style={{ color: "var(--muted)" }}>{i + 1}</td>
                  <td style={{ fontWeight: 700 }}>{r.name}</td>
                  <td className="num" style={{ textAlign: "center", fontWeight: 800, color: "var(--orange)" }}>{r.book88}</td>
                  <td className="num" style={{ textAlign: "center", color: "var(--blue)" }}>{r.book77}</td>
                  <td className="num" style={{ textAlign: "center", color: r.deltaAbs < 0 ? "var(--red)" : r.deltaAbs > 0 ? "var(--green)" : "var(--muted)" }}>
                    {r.deltaAbs >= 0 ? "+" : ""}{r.deltaAbs}{r.deltaPct != null ? ` (${r.deltaPct >= 0 ? "+" : ""}${r.deltaPct}%)` : ""}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 800 }}>
                <td /><td>TỔNG</td>
                <td className="num" style={{ textAlign: "center" }}>{totalBook88}</td>
                <td className="num" style={{ textAlign: "center" }}>{totalBook77}</td>
                <td className="num" style={{ textAlign: "center" }}>{totalBook88 - totalBook77 >= 0 ? "+" : ""}{totalBook88 - totalBook77}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <PairedHBars rows={rows} curLabel={curLabel} prevLabel={prevLabel} />
      </div>
      <div className="pe-comment" style={{ marginTop: 10 }}>🤖 <span dangerouslySetInnerHTML={{ __html: note }} /></div>
    </Reveal>
  );
}
