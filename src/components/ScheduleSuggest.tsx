import { useMemo, useState } from "react";
import { buildScheduleSuggestions, scheduleWindowRange, type XtcRec, type BcScheduleSuggest, type DowPattern } from "../lib/xinTangCuong";
import { Collapsible } from "./Collapsible";

const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** 1 ô THỨ trong lưới lịch đề xuất: xanh=cố định · cam=linh động · xám=OFF. */
function DowChip({ p }: { p: DowPattern }) {
  const bg = p.status === "fixed" ? "var(--green)" : p.status === "off" ? "var(--line-2)" : "var(--orange)";
  const fg = p.status === "off" ? "var(--muted)" : "var(--text-onaccent)";
  const txt = p.status === "off" ? "OFF" : p.label;
  const tip = `${p.label}: xin ${Math.round(p.freq * 100)}% số tuần hoạt động`
    + (p.reqCount ? ` · ${p.reqCount} lượt · TB ${p.avgXe.toFixed(1)} xe/lần` : "")
    + (p.rate != null ? ` · đáp ứng ${pct(p.rate)}` : "");
  return (
    <span title={tip} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 28, height: 21,
      borderRadius: 6, background: bg, color: fg, fontSize: 11.5, fontWeight: 800, opacity: p.status === "off" ? 0.5 : 1,
    }}>
      {txt}
    </span>
  );
}

const confColor = (c: BcScheduleSuggest["confidence"]) => (c === "cao" ? "var(--green)" : c === "vừa" ? "var(--orange)" : "var(--muted)");

/**
 * ĐỀ XUẤT LỊCH TẢI CỐ ĐỊNH: phân tích mẫu hình xin xe THEO THỨ trong ~13 tuần gần nhất
 * để đề xuất bưu cục nào nên có xe cố định (và đúng thứ nào), thay vì luôn xin phát sinh.
 * CHỈ dựa vào số liệu thật đã có — BC chưa đủ tuần/lượt xin bị loại khỏi đề xuất chính.
 */
export function ScheduleSuggest({ recs }: { recs: XtcRec[] }) {
  const all = useMemo(() => buildScheduleSuggestions(recs), [recs]);
  const win = useMemo(() => scheduleWindowRange(), []);
  const [showAll, setShowAll] = useState(false);

  if (!all.length) return null;

  const withFixed = all.filter((b) => b.fixedDows.length > 0);
  const rows = showAll ? all : withFixed;
  const totalFixedSlots = withFixed.reduce((a, b) => a + b.fixedDows.length, 0);
  const highConf = withFixed.filter((b) => b.confidence === "cao").length;

  return (
    <Collapsible title="🗓️ Đề xuất lịch tải cố định" sub={`${withFixed.length}/${all.length} bưu cục nên có lịch cố định — dựa vào mẫu hình xin xe thực tế`}>
      <p className="lead" style={{ margin: "0 0 10px", fontSize: 14 }}>
        Phân tích tần suất xin xe <b>theo THỨ trong tuần</b>, dựa trên <b>{ddmm(win.fromIso)} – {ddmm(win.toIso)}</b> (~13 tuần gần nhất — cần nhiều tuần lặp lại mới thấy được mẫu hình theo thứ, nên mục này <b>không đổi</b> theo bộ lọc Ngày/Tuần/Tháng ở phía trên). Bưu cục xin đều 1 vài thứ (vd luôn T7+CN) → đề xuất <b style={{ color: "var(--green)" }}>CỐ ĐỊNH</b> đúng những thứ đó, các thứ còn lại để <span style={{ color: "var(--muted)" }}>OFF</span>. Chỉ đề xuất khi đủ dữ liệu (≥3 tuần &amp; ≥3 lượt xin).
      </p>

      <div className="kpi-row">
        <div className="kpi">
          <div className="lbl">BC đủ dữ liệu phân tích</div>
          <div className="val orange">{all.length}</div>
          <div className="note">≥3 tuần · ≥3 lượt xin gần đây</div>
        </div>
        <div className="kpi green">
          <div className="lbl">BC nên có lịch cố định</div>
          <div className="val">{withFixed.length}</div>
          <div className="note">{Math.round((withFixed.length / all.length) * 100)}% BC đủ dữ liệu · {highConf} độ tin cậy cao</div>
        </div>
        <div className="kpi blue">
          <div className="lbl">Tổng lượt cố định đề xuất</div>
          <div className="val">{totalFixedSlots}</div>
          <div className="note">xe·thứ/tuần nên xếp sẵn lịch</div>
        </div>
      </div>

      <div className="tc-wrap scroll-frame" style={{ marginTop: 12 }}>
        <table className="tc-grid">
          <thead>
            <tr>
              <th>Bưu cục</th>
              <th style={{ width: 232 }}>Lịch đề xuất (T2 → CN)</th>
              <th style={{ width: 64 }}>Số tuần</th>
              <th style={{ width: 68 }}>Tổng lượt</th>
              <th style={{ width: 78 }}>Tin cậy</th>
              <th>Nhận định</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.bc}>
                <td style={{ fontWeight: 600 }}>{b.bc}</td>
                <td><div style={{ display: "flex", gap: 3 }}>{b.byDow.map((p) => <DowChip key={p.dow} p={p} />)}</div></td>
                <td className="num">{b.totalWeeks}</td>
                <td className="num">{b.totalReq}</td>
                <td className="num" style={{ fontWeight: 700, color: confColor(b.confidence) }}>{b.confidence}</td>
                <td style={{ fontSize: 13.5 }}>{b.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!showAll && all.length > withFixed.length && (
        <button
          onClick={() => setShowAll(true)}
          style={{ marginTop: 8, fontSize: 14, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          Xem thêm {all.length - withFixed.length} bưu cục chưa có mẫu hình rõ (giữ linh động) ⌄
        </button>
      )}
    </Collapsible>
  );
}
