/* ============================================================
   HIỆU SUẤT NCC — tỷ lệ đáp ứng xe theo từng nhà cung cấp + tách tải GHN vs NCC.
   Số THẬT từ lịch Tăng Cường (mỗi tuyến có cột NCC + biển số).
   "Đáp ứng" = tuyến đã có BIỂN SỐ xe trên lịch (NCC đã điều được xe).
   Tổng quan → chi tiết; mỗi số có ngữ cảnh (so tỷ lệ chung + xếp hạng).
   ============================================================ */
import { useMemo } from "react";
import type { TCRoute } from "../lib/tangcuong";
import { navTo } from "../lib/nav";

const normNcc = (s: string) => (s || "").trim().toUpperCase().replace(/\s+/g, " ");
const hasBks = (r: TCRoute) => !!(r.bks && r.bks.trim());
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
/** Màu theo tỷ lệ đáp ứng: ≥95% xanh · ≥80% cam · <80% đỏ. */
const rateColor = (r: number) => (r >= 95 ? "var(--green)" : r >= 80 ? "var(--orange)" : "var(--red)");
/** Giá trị KHÔNG phải NCC thật (trạng thái điền nhầm vào cột NCC). */
const isJunkNcc = (name: string) => !name || /^(CH[ƯU]A|KH[ÔO]NG|-+|N\/?A)$/i.test(name) || /^CH[ƯU]A\b/i.test(name);

interface Row { name: string; book: number; ok: number; lay: number; giao: number; isGhn: boolean; }

export function NccPerformance({ lay, giao, date }: { lay: TCRoute[]; giao: TCRoute[]; date: string }) {
  const stat = useMemo(() => {
    const m = new Map<string, Row>();
    let junk = 0;
    const add = (routes: TCRoute[], kind: "lay" | "giao") => {
      for (const r of routes) {
        const name = normNcc(r.ncc);
        if (!name) continue;
        if (name !== "GHN" && isJunkNcc(name)) { junk++; continue; } // "chưa chạy/chưa gán" -> không phải NCC
        const key = name === "GHN" ? "GHN" : name;
        let e = m.get(key);
        if (!e) { e = { name: key, book: 0, ok: 0, lay: 0, giao: 0, isGhn: key === "GHN" }; m.set(key, e); }
        e.book++; e[kind]++;
        if (hasBks(r)) e.ok++;
      }
    };
    add(lay, "lay"); add(giao, "giao");
    const rows = [...m.values()];
    const ghn = rows.find((r) => r.isGhn) || null;
    const ncc = rows.filter((r) => !r.isGhn).sort((a, b) => pct(a.ok, a.book) - pct(b.ok, b.book)); // kém → tốt (nổi bật NCC cần check)
    const nccBook = ncc.reduce((a, r) => a + r.book, 0);
    const nccOk = ncc.reduce((a, r) => a + r.ok, 0);
    const ghnBook = ghn?.book ?? 0;
    const totalBook = nccBook + ghnBook;
    return { rows, ghn, ncc, nccBook, nccOk, ghnBook, totalBook, junk };
  }, [lay, giao]);

  if (stat.nccBook + stat.ghnBook === 0) return null;
  const { ncc, ghn, nccBook, nccOk, ghnBook, totalBook, junk } = stat;
  // Tỷ lệ đáp ứng CHỈ tính NCC thuê ngoài (xe nhà GHN không điền BSX kiểu NCC -> không gán SLA).
  const rateNcc = pct(nccOk, nccBook);
  const ghnShare = pct(ghnBook, totalBook);
  const weak = ncc.filter((r) => r.book >= 2 && pct(r.ok, r.book) < 80).slice(0, 4);
  const perfect = ncc.filter((r) => r.book >= 2 && pct(r.ok, r.book) === 100).length;

  return (
    <div className="section-card" style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: 16, margin: "0 0 2px" }}>📊 Hiệu suất NCC {date ? `· ${date}` : ""}</h3>
      <p className="lead" style={{ margin: "0 0 10px", fontSize: 14 }}>
        Tỷ lệ đáp ứng = tuyến đã <b>có biển số xe</b> trên lịch / tổng tuyến đã book. Tách riêng tải <b>GHN (xe nhà)</b> và <b>NCC thuê ngoài</b>.{" "}
        Cần <b>hồ sơ năng lực đầy đủ</b> từng NCC? → <button onClick={() => navTo({ view: "ds-ncc" })} style={{ border: "none", background: "none", color: "var(--blue)", fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 14 }}>xem Performance NCC</button>
      </p>

      {/* TỔNG QUAN */}
      <div className="kpi-row">
        <div className="kpi">
          <div className="lbl">Tổng xe tăng cường</div>
          <div className="val orange">{totalBook}</div>
          <div className="note">{ncc.length} NCC + xe nhà GHN</div>
        </div>
        <div className="kpi green">
          <div className="lbl">Tỷ lệ đáp ứng NCC</div>
          <div className="val">{rateNcc}%</div>
          <div className="badge" style={{ background: rateColor(rateNcc) }}>{nccOk}/{nccBook} xe có BSX</div>
        </div>
        <div className="kpi blue">
          <div className="lbl">Tải NCC thuê ngoài</div>
          <div className="val">{nccBook}</div>
          <div className="note">{pct(nccBook, totalBook)}% tổng tải · {ncc.length} nhà</div>
        </div>
        <div className="kpi ink">
          <div className="lbl">Tải GHN (xe nhà)</div>
          <div className="val" style={{ color: "var(--ink)" }}>{ghnBook}</div>
          <div className="note">{ghnShare}% tổng tải · xe tự chủ</div>
        </div>
      </div>

      {/* CHI TIẾT THEO NCC */}
      <div className="tc-wrap" style={{ marginTop: 12 }}>
        <table className="tc-grid">
          <thead>
            <tr>
              <th>Nhà cung cấp</th>
              <th style={{ width: 74 }}>Xe book</th>
              <th style={{ width: 84 }}>Đã có xe</th>
              <th style={{ width: 104 }}>Tỷ lệ đáp ứng</th>
              <th style={{ width: 66 }}>Lấy</th>
              <th style={{ width: 66 }}>Giao</th>
            </tr>
          </thead>
          <tbody>
            {ghn && (
              <tr style={{ background: "rgba(0,161,154,0.06)" }}>
                <td style={{ fontWeight: 700 }}>🏠 GHN (xe nhà)</td>
                <td className="num">{ghn.book}</td>
                <td className="num" style={{ color: "var(--muted)" }}>—</td>
                <td className="num" style={{ fontWeight: 700, color: "var(--muted)" }} title="Xe tự chủ — theo dõi riêng, không tính SLA đáp ứng">tự chủ</td>
                <td className="num">{ghn.lay}</td>
                <td className="num">{ghn.giao}</td>
              </tr>
            )}
            {ncc.map((r) => {
              const rt = pct(r.ok, r.book);
              return (
                <tr key={r.name}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td className="num">{r.book}</td>
                  <td className="num" style={{ color: r.ok < r.book ? "var(--red)" : "var(--green)" }}>{r.ok}</td>
                  <td className="num" style={{ fontWeight: 700, color: rateColor(rt) }}>{rt}%</td>
                  <td className="num">{r.lay}</td>
                  <td className="num">{r.giao}</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 800 }}>
              <td>TỔNG NCC</td>
              <td className="num">{nccBook}</td>
              <td className="num">{nccOk}</td>
              <td className="num" style={{ color: rateColor(rateNcc) }}>{rateNcc}%</td>
              <td className="num">{ncc.reduce((a, r) => a + r.lay, 0)}</td>
              <td className="num">{ncc.reduce((a, r) => a + r.giao, 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* NHẬN ĐỊNH TỰ ĐỘNG (việc cần làm) */}
      <div style={{ fontSize: 14, lineHeight: 1.65, color: "var(--text-body)", background: "var(--bg)", borderLeft: "3px solid var(--orange)", borderRadius: 8, padding: "8px 12px", marginTop: 10 }}>
        <b>🤖 Nhận định:</b> NCC thuê ngoài đáp ứng <b>{rateNcc}%</b> ({nccOk}/{nccBook} xe có biển số).{" "}
        Xe nhà GHN gánh <b>{ghnShare}%</b> tổng tải, còn lại <b>{100 - ghnShare}%</b> thuê NCC ngoài.{" "}
        {weak.length > 0
          ? <>NCC cần <b style={{ color: "var(--red)" }}>check gấp</b> (đáp ứng &lt;80%): {weak.map((r) => `${r.name} ${pct(r.ok, r.book)}%`).join(", ")}.</>
          : <>Các NCC đáp ứng ổn.</>}
        {perfect > 0 && <> {perfect} NCC đáp ứng đủ 100%.</>}
        {junk > 0 && <> Còn <b>{junk}</b> tuyến chưa gán/chưa chạy NCC — cần bổ sung.</>}
      </div>
    </div>
  );
}
