import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTlld } from "../lib/useTlld";
import { useExcludedSet, isExcluded } from "../lib/tlldExclude";
import { usePersistentState } from "../lib/usePersistent";
import { SanLuongDash } from "../components/SanLuongDash";
import { SL_SHEETS } from "../config";

// Lazy-load dashboard biến động — chỉ tải khi Sếp mở đúng tab bc-lay.
const BcLayBienDong = lazy(() => import("../components/BcLayBienDong").then((m) => ({ default: m.BcLayBienDong })));

const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");

interface Row { diem: string; lay: string; giao: string }

/** Các nhóm sản lượng (sub-menu) — ưu tiên BC LẤY / BC GIAO lên trước. */
const SL_TABS: { key: string; label: string }[] = [
  { key: "bc-lay", label: "BC LẤY" },
  { key: "bc-giao", label: "BC GIAO" },
  { key: "ktc-hcm20", label: "KTC HCM20" },
  { key: "ktc-st", label: "KTC SÓNG THẦN" },
  { key: "mbh-q7", label: "MBH Q7" },
  { key: "mbh-tt", label: "MBH TÂN TẠO" },
];
const EMPTY: Row = { diem: "", lay: "", giao: "" };

/**
 * Sản Lượng Lấy /Giao: nhập sản lượng (kg) theo bưu cục/kho mỗi ngày, kết hợp
 * TLLD hiện tại -> trợ lý AI phân tích, dự đoán lịch tải & cảnh báo bưu cục/kho.
 */
export function SanLuong() {
  const { index } = useTlld();
  const exclSet = useExcludedSet(); // Nội Vùng HCM + hub HCM01 + loại tuyến 01_FW_20 — KHÔNG thuộc Cụm M12
  const [ngay, setNgay] = usePersistentState("sl.ngay", "");
  const [tab, setTab] = usePersistentState("sl.tab.v2", "ktc-hcm20");
  const [data, setData] = usePersistentState<Record<string, Row[]>>("sl.data", {});
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  const tabLabel = SL_TABS.find((t) => t.key === tab)?.label || "";
  const rows = data[tab]?.length ? data[tab] : [EMPTY];
  const totalLay = rows.reduce((a, r) => a + (parseFloat(r.lay) || 0), 0);
  const totalGiao = rows.reduce((a, r) => a + (parseFloat(r.giao) || 0), 0);

  // Đổi nhóm thì xoá kết quả phân tích cũ.
  useEffect(() => { setResult(""); }, [tab]);

  function updTab(fn: (rows: Row[]) => Row[]) {
    setData((d) => ({ ...d, [tab]: fn(d[tab]?.length ? d[tab] : [EMPTY]) }));
  }

  // Tóm tắt TLLD TOÀN CỤM (dữ liệu TLLD không tách theo kho/tab Sản Lượng) để đưa vào phân tích.
  // LƯU Ý: ghi rõ "toàn cụm" trong câu đầu để KHÔNG bị hiểu nhầm là TLLD riêng của kho đang xem
  // (vd đang xem Sóng Thần nhưng danh sách "thấp nhất" có thể toàn tuyến HCM20/vùng khác).
  const tlldSummary = useMemo(() => {
    if (!index) return "Chưa có dữ liệu TLLD.";
    const ents = [...index.byCode.entries()]
      .filter(([code]) => !isExcluded(code, exclSet))
      .map(([code, t]) => ({ code, v: t.n1 ?? t.avg7 }));
    const valid = ents.filter((e) => e.v != null) as { code: string; v: number }[];
    if (!valid.length) return "Chưa có dữ liệu TLLD.";
    const avg = valid.reduce((a, e) => a + e.v, 0) / valid.length;
    const low = valid.filter((e) => e.v < 0.6).sort((a, b) => a.v - b.v);
    const high = valid.filter((e) => e.v > 1).sort((a, b) => b.v - a.v);
    return [
      `TLLD trung bình TOÀN CỤM (mọi kho gộp chung, KHÔNG riêng kho đang xem): ${pct(avg)} (trên ${valid.length} tuyến có dữ liệu).`,
      `Tuyến lấp đầy THẤP (<60%, có thể thuộc kho/vùng KHÁC): ${low.length} tuyến. Thấp nhất: ${low.slice(0, 10).map((e) => `${e.code} ${pct(e.v)}`).join(", ") || "không"}.`,
      `Tuyến VƯỢT tải (>100%, có thể thuộc kho/vùng KHÁC): ${high.length} tuyến. Cao nhất: ${high.slice(0, 8).map((e) => `${e.code} ${pct(e.v)}`).join(", ") || "không"}.`,
    ].join("\n");
  }, [index, exclSet]);

  function setRow(i: number, k: keyof Row, val: string) {
    updTab((a) => a.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  }

  async function analyze() {
    const filled = rows.filter((r) => r.diem.trim() && (r.lay.trim() || r.giao.trim()));
    if (!filled.length) { setResult("Sếp nhập sản lượng ít nhất 1 điểm rồi bấm phân tích nhé."); return; }
    setBusy(true);
    setResult("");
    const text =
      `NHÓM: ${tabLabel}\nNGÀY: ${ngay || "(không ghi)"}\n\nSẢN LƯỢNG LẤY/GIAO (kg) theo điểm:\n` +
      filled.map((r) => `- ${r.diem.trim()}: lấy ${parseFloat(r.lay) || 0}kg, giao ${parseFloat(r.giao) || 0}kg`).join("\n") +
      `\nTỔNG: lấy ${Math.round(totalLay)}kg, giao ${Math.round(totalGiao)}kg.\n\nTLLD HIỆN TẠI:\n${tlldSummary}`;
    try {
      const r = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "analyze", text }),
      });
      const d = await r.json();
      setResult(d?.reply || "(Không có phản hồi)");
    } catch (e) {
      setResult("Lỗi gọi trợ lý: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  // Mục Sản Lượng chỉ dành cho ADMIN.

  const dashSheet = SL_SHEETS[tab];
  const tabName = SL_TABS.find((t) => t.key === tab)?.label || "";

  return (
    <div>
      <div className="section-card" style={{ marginBottom: 12 }}>
        <div className="sub-tabs sl-subtabs">
          {SL_TABS.map((t) => (
            <button
              key={t.key}
              className={"sub-tab" + (t.key === tab ? " active" : "")}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "bc-lay" && (
        <Suspense fallback={<div className="section-card"><div className="sl-empty">Đang tải dashboard biến động…</div></div>}>
          <BcLayBienDong />
        </Suspense>
      )}

      {dashSheet ? (
        <SanLuongDash sheetName={dashSheet} title={tabName} tlld={tlldSummary} />
      ) : (
      <>
      <div className="section-card">
        <label className="pl-full" style={{ maxWidth: 220 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--muted)" }}>Ngày</span>
          <input className="pl-in" type="date" value={ngay} onChange={(e) => setNgay(e.target.value)} />
        </label>

        <div className="sl-wrap">
          <table className="sl-table">
            <thead>
              <tr><th>#</th><th>Bưu cục / Kho / Khu vực</th><th>Lấy (kg)</th><th>Giao (kg)</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="num">{i + 1}</td>
                  <td><input className="pl-in" value={r.diem} placeholder="Tên điểm…" onChange={(e) => setRow(i, "diem", e.target.value)} /></td>
                  <td><input className="pl-in num" type="number" value={r.lay} placeholder="0" onChange={(e) => setRow(i, "lay", e.target.value)} /></td>
                  <td><input className="pl-in num" type="number" value={r.giao} placeholder="0" onChange={(e) => setRow(i, "giao", e.target.value)} /></td>
                  <td><button className="sl-del" onClick={() => updTab((a) => (a.length > 1 ? a.filter((_, j) => j !== i) : a))} title="Xoá dòng">✕</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td></td><td>TỔNG</td><td className="num">{Math.round(totalLay).toLocaleString("vi-VN")}</td><td className="num">{Math.round(totalGiao).toLocaleString("vi-VN")}</td><td></td></tr>
            </tfoot>
          </table>
        </div>

        <div className="sl-actions">
          <button className="pl-add" onClick={() => updTab((a) => [...a, { diem: "", lay: "", giao: "" }])}>+ Thêm dòng</button>
          <button className="pl-calc" onClick={analyze} disabled={busy}>{busy ? "🤖 Đang phân tích…" : "🤖 Phân tích & cảnh báo"}</button>
        </div>
        <div className="sl-tlld-note">TLLD đưa vào phân tích: {tlldSummary.split("\n")[0]}</div>
      </div>

      {result && (
        <div className="section-card sl-result" style={{ marginTop: 12 }}>
          <div className="sl-result-h">🤖 Phân tích của trợ lý</div>
          <div className="sl-result-body">{result}</div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
