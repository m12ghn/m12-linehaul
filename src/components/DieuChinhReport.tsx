/* ============================================================
   BÁO CÁO ĐIỀU CHỈNH — tổng hợp tab "Điều chỉnh - Báo NCC": mỗi tuần NCC/vận hành đã điều chỉnh,
   mở mới, huỷ, thêm điểm, đổi lộ trình bao nhiêu tuyến. Dùng CHUNG cơ chế tuần CN->T7 + số tuần ISO
   với "Tổng TLLD Cụm" (tlldPeriods.ts) — mặc định cũng lùi về tuần ĐÃ CHỐT (N-1), không phải tuần
   đang chạy dở, để 2 báo cáo luôn nói cùng 1 "tuần" khi đối chiếu.
   ============================================================ */
import { useMemo, useState } from "react";
import { useDieuChinhNcc } from "../lib/useDieuChinhNcc";
import type { DangDieuChinh, DieuChinhEntry } from "../lib/dieuChinhNcc";
import { buildPeriods, sundayOf } from "../lib/tlldPeriods";
import { Collapsible } from "./Collapsible";
import { Reveal } from "./Reveal";

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const DANG_ORDER: DangDieuChinh[] = ["Điều chỉnh", "Mở mới", "Huỷ", "Thêm điểm", "Đổi lộ trình", "OFF"];
const DANG_ICON: Record<DangDieuChinh, string> = {
  "Điều chỉnh": "🔧", "Mở mới": "🆕", "Huỷ": "⛔", "Thêm điểm": "➕", "Đổi lộ trình": "🔀", "OFF": "⏸️",
};

function countByDang(entries: DieuChinhEntry[]): Map<DangDieuChinh, number> {
  const m = new Map<DangDieuChinh, number>();
  for (const e of entries) m.set(e.dang, (m.get(e.dang) || 0) + 1);
  return m;
}

export function DieuChinhReport() {
  const { data } = useDieuChinhNcc();
  const [selKey, setSelKey] = useState<string | null>(null);
  const entries = data?.entries ?? [];

  const dates = useMemo(() => [...new Set(entries.map((e) => e.ngayChay))].sort(), [entries]);
  const periods = useMemo(() => buildPeriods(dates, "tuan"), [dates]);

  const byWeek = useMemo(() => {
    const m = new Map<string, DieuChinhEntry[]>();
    for (const e of entries) {
      const k = sundayOf(e.ngayChay);
      const arr = m.get(k);
      if (arr) arr.push(e); else m.set(k, [e]);
    }
    return m;
  }, [entries]);

  const lastIdx = periods.length - 1;
  // Mặc định lùi về tuần ĐÃ CHỐT (N-1) nếu tuần mới nhất đang chạy dở — giống Tổng TLLD Cụm. Sếp có
  // thể chủ động chọn bất kỳ tuần nào khác qua bộ điều hướng "‹ 📅 ▾ ›" (xem Tổng TLLD Cụm phía trên).
  const autoSkipLive = periods.length > 1 && !!periods[lastIdx]?.running;
  const selIdx = selKey != null ? periods.findIndex((p) => p.key === selKey) : -1;
  const curIdx = selIdx >= 0 ? selIdx : autoSkipLive ? lastIdx - 1 : lastIdx;
  const cur = periods[curIdx] ?? null;
  const curEntries = cur ? byWeek.get(cur.key) ?? [] : [];
  const counts = useMemo(() => countByDang(curEntries), [curEntries]);
  function stepPeriod(dir: number) {
    const i = curIdx + dir;
    if (i >= 0 && i < periods.length) setSelKey(periods[i].key);
  }

  const nDieuChinh = counts.get("Điều chỉnh") || 0;
  const nMoMoi = counts.get("Mở mới") || 0;
  const nHuy = counts.get("Huỷ") || 0;
  const nKhac = (counts.get("Thêm điểm") || 0) + (counts.get("Đổi lộ trình") || 0) + (counts.get("OFF") || 0);

  const shownWeeks = periods.slice(-8);

  if (!data) return <div className="section-card sl-empty">Đang tải Báo cáo Điều chỉnh…</div>;
  if (!periods.length) return <div className="section-card sl-empty">Chưa có lượt điều chỉnh nào (đã xong) trong Sheet.</div>;

  return (
    <Reveal className="section-card pe-fc-card" style={{ marginTop: 12 }}>
      <div className="tlld-cum-head">
        <div>
          <div className="pe-fc-sub">🔧 Báo cáo Điều chỉnh <span className="fc-src">· NCC/vận hành điều chỉnh, mở mới, huỷ tuyến</span></div>
          <p className="pe-sub" style={{ margin: "2px 0 0" }}>
            Kỳ <b>{cur!.label}</b> ({ddmmyyyy(cur!.start)}–{ddmmyyyy(cur!.end)}){cur!.running ? " — ĐANG CHẠY, số liệu sơ bộ" : ""}.
          </p>
        </div>
        <div className="period-nav" style={{ alignSelf: "flex-start" }}>
          <button className="pn-arrow" disabled={curIdx <= 0} onClick={() => stepPeriod(-1)} title="Kỳ trước">‹</button>
          <div className="pn-current">
            <span className="pn-ic">📅</span>
            <span className="pn-text">{cur!.label}{cur!.running ? " (đang chạy)" : ""}</span>
            <span className="pn-caret">▾</span>
            <select value={cur!.key} onChange={(e) => setSelKey(e.target.value)}>
              {[...periods].reverse().map((p) => (
                <option key={p.key} value={p.key}>{p.label}{p.running ? " (đang chạy)" : ""}</option>
              ))}
            </select>
          </div>
          <button className="pn-arrow" disabled={curIdx >= lastIdx} onClick={() => stepPeriod(1)} title="Kỳ sau">›</button>
        </div>
      </div>

      <div className="kpi-row" style={{ marginTop: 12 }}>
        <div className="kpi blue">
          <div className="lbl">🔧 Điều chỉnh</div>
          <div className="val">{nDieuChinh}</div>
          <div className="note">tuyến đổi giờ/lộ trình</div>
        </div>
        <div className="kpi green">
          <div className="lbl">🆕 Mở mới</div>
          <div className="val">{nMoMoi}</div>
          <div className="note">tuyến mới thêm vào lịch</div>
        </div>
        <div className="kpi" style={{ borderLeftColor: "var(--red)" }}>
          <div className="lbl">⛔ Huỷ</div>
          <div className="val" style={{ color: "var(--red)" }}>{nHuy}</div>
          <div className="note">tuyến dừng chạy</div>
        </div>
        <div className="kpi ink">
          <div className="lbl">Khác</div>
          <div className="val">{nKhac}</div>
          <div className="note">thêm điểm, đổi lộ trình, OFF</div>
        </div>
      </div>

      {curEntries.length === 0 ? (
        <div className="sl-empty" style={{ marginTop: 10 }}>Không có lượt điều chỉnh nào trong kỳ này.</div>
      ) : (
        <Collapsible title="📋 Danh sách chi tiết" sub={`${curEntries.length} lượt`} defaultOpen={curEntries.length <= 8} style={{ marginTop: 10 }}>
          <div className="tc-wrap">
            <table className="tc-grid">
              <thead><tr><th>Mã tuyến</th><th style={{ width: 130 }}>Dạng</th><th>NCC</th><th style={{ width: 90 }}>Ngày</th></tr></thead>
              <tbody>
                {[...curEntries].sort((a, b) => a.ngayChay < b.ngayChay ? -1 : a.ngayChay > b.ngayChay ? 1 : 0).map((e, i) => (
                  <tr key={e.route + i}>
                    <td style={{ fontWeight: 700 }}>{e.route}</td>
                    <td>{DANG_ICON[e.dang]} {e.dang}</td>
                    <td>{e.ncc || "—"}</td>
                    <td className="num">{ddmmyyyy(e.ngayChay).slice(0, 5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Collapsible>
      )}

      {shownWeeks.length > 1 && (
        <Collapsible title="📈 So các tuần gần đây" sub={`${shownWeeks.length} tuần`} style={{ marginTop: 10 }}>
          <div className="tc-wrap">
            <table className="tc-grid">
              <thead>
                <tr>
                  <th>Tuần</th>
                  {DANG_ORDER.map((d) => <th key={d} style={{ width: 60 }}>{DANG_ICON[d]}</th>)}
                  <th style={{ width: 60 }}>Tổng</th>
                </tr>
              </thead>
              <tbody>
                {shownWeeks.map((p) => {
                  const es = byWeek.get(p.key) ?? [];
                  const c = countByDang(es);
                  return (
                    <tr key={p.key} style={p.key === cur!.key ? { background: "var(--bg)", fontWeight: 700 } : undefined}>
                      <td>{p.label}{p.running ? " (đang chạy)" : ""}</td>
                      {DANG_ORDER.map((d) => <td key={d} className="num">{c.get(d) || 0}</td>)}
                      <td className="num" style={{ fontWeight: 800 }}>{es.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Collapsible>
      )}

      <p className="pe-sub" style={{ margin: "10px 0 0", fontSize: 13 }}>
        Đối chiếu ảnh hưởng lên tỷ lệ lấp đầy ở mục <b>🌐 Tổng TLLD của Cụm</b> phía trên — tuyến vừa
        "Mở mới"/"Điều chỉnh" thường chưa có đủ lịch sử để so sánh công bằng ở đó.
      </p>
    </Reveal>
  );
}
