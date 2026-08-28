import { useEffect, useMemo, useState } from "react";
import {
  loadXinTc, periodKey, periodLabel, statsOf, recentPeriods, seriesByDay, lastNDays, comparePeriods,
  type XtcData, type Gran, type DayBar, type CmpResult,
} from "../lib/xinTangCuong";
import { normSearch, isWeekendISO } from "../lib/normalize";
import { usePlaceIds } from "../lib/allRoutes";
import { usePersistentState } from "../lib/usePersistent";
import { startPoll } from "../lib/poll";
import { REFRESH_MS } from "../config";
import { Gauge } from "./Gauge";
import { TrendChart } from "./TrendChart";
import { Donut } from "./Donut";
import { XinTcCompareTabs } from "./XinTcCompareTabs";
import { ScheduleSuggest } from "./ScheduleSuggest";
import { Collapsible } from "./Collapsible";

let cache: XtcData | null = null;
function useXinTc() {
  const [data, setData] = useState<XtcData | null>(cache);
  useEffect(() => {
    let alive = true;
    const run = () => loadXinTc().then((d) => {
      if (!alive || !d.ok) return;
      // Chống "mất data" do 1 lần fetch CỤT/lỗi tạm: nếu bản mới ít hơn HẲN bản cũ (<50%)
      // trong khi bản cũ đang có nhiều dòng -> bỏ qua, giữ bản tốt; lần poll sau khớp lại.
      if (cache && cache.recs.length > 30 && d.recs.length < cache.recs.length * 0.5) return;
      cache = d; setData(d);
    }).catch(() => {});
    if (!cache) run(); else { setData(cache); run(); }
    const stop = startPoll(run, REFRESH_MS);
    return () => { alive = false; stop(); };
  }, []);
  return data;
}

const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const GRANS: { key: Gran; label: string }[] = [
  { key: "ngay", label: "Theo Ngày" },
  { key: "tuan", label: "Theo Tuần" },
  { key: "thang", label: "Theo Tháng" },
];

// Số kỳ liệt kê trong dropdown (tính từ hôm nay đổ xuống).
const PERIOD_COUNT: Record<Gran, number> = { ngay: 60, tuan: 16, thang: 12 };

/** Thanh tỷ lệ ngang: có xe (xanh) / không xe (đỏ) / khác-hủy (xám). */
function RatioBar({ coXe, khongXe, other }: { coXe: number; khongXe: number; other: number }) {
  const total = coXe + khongXe + other || 1;
  const w = (n: number) => (n / total) * 100 + "%";
  return (
    <div style={{ display: "flex", height: 16, borderRadius: 8, overflow: "hidden", background: "rgba(0,0,0,.06)" }}>
      {coXe > 0 && <div style={{ width: w(coXe), background: "var(--green)" }} title={`Có xe: ${coXe}`} />}
      {khongXe > 0 && <div style={{ width: w(khongXe), background: "var(--red)" }} title={`Không xe: ${khongXe}`} />}
      {other > 0 && <div style={{ width: w(other), background: "var(--muted)", opacity: 0.35 }} title={`Khác/hủy: ${other}`} />}
    </div>
  );
}

/** Biểu đồ cột theo ngày: xếp chồng (xanh có xe / đỏ không xe / xám khác), kèm đường
 *  trung bình, làm nổi NGÀY ĐỈNH (viền cam + số) và HÔM NAY (nhãn cam). */
function DayChart({ series }: { series: DayBar[] }) {
  const max = Math.max(1, ...series.map((b) => b.total));
  const active = series.filter((b) => b.total > 0);
  const avg = active.length ? active.reduce((a, b) => a + b.total, 0) / active.length : 0;
  const peakKey = series.reduce((m, b) => (b.total > m.total ? b : m), series[0]).key;
  const today = todayIso();
  const H = 140;
  const h = (n: number) => (n > 0 ? Math.max(3, Math.round((n / max) * H)) : 0);
  const minW = series.length * 16;
  return (
    <div style={{ overflowX: "auto", paddingTop: 18 }}>
      <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 3, height: H, minWidth: minW }}>
        {avg > 0 && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(avg / max) * 100}%`, borderTop: "1px dashed var(--orange)", opacity: 0.75, zIndex: 1 }}>
            <span style={{ position: "absolute", right: 2, top: -15, fontSize: 11.5, fontWeight: 700, color: "var(--orange)" }}>TB {avg.toFixed(1)}/ngày</span>
          </div>
        )}
        {series.map((b) => {
          const other = Math.max(0, b.total - b.coXe - b.khongXe);
          const isPeak = b.key === peakKey && b.total > 0;
          const we = isWeekendISO(b.key); // T7/CN -> dải nền xanh nước biển
          return (
            <div key={b.key} title={`Ngày ${b.label}: ${b.total} lượt · ${b.coXe} có xe · ${b.khongXe} không xe${we ? " · CUỐI TUẦN" : ""}`}
              style={{ flex: "1 0 auto", minWidth: 12, maxWidth: 26, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", position: "relative", background: we ? "rgba(22,104,199,0.16)" : undefined, borderRadius: we ? 5 : undefined }}>
              {isPeak && <div style={{ position: "absolute", top: -16, left: 0, right: 0, textAlign: "center", fontSize: 11.5, fontWeight: 800, color: "var(--orange)" }}>{b.total}</div>}
              <div style={{ borderRadius: "4px 4px 0 0", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: isPeak ? "0 0 0 2px var(--orange)" : undefined }}>
                {other > 0 && <div style={{ height: h(other), background: "var(--muted)", opacity: 0.3 }} />}
                {b.khongXe > 0 && <div style={{ height: h(b.khongXe), background: "var(--red)" }} />}
                {b.coXe > 0 && <div style={{ height: h(b.coXe), background: "var(--green)" }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 3, marginTop: 5, minWidth: minW }}>
        {series.map((b) => {
          const isToday = b.key === today;
          const we = isWeekendISO(b.key); // T7/CN -> đỏ đậm
          return (
            <div key={b.key} title={we ? "Cuối tuần (T7/CN)" : undefined}
              style={{ flex: "1 0 auto", minWidth: 12, maxWidth: 26, textAlign: "center", fontSize: 10, padding: "1px 0", borderRadius: 4, fontWeight: isToday || we ? 800 : 400, color: isToday || we ? "#fff" : "var(--muted)", background: isToday ? "var(--orange)" : we ? "#1668c7" : "transparent" }}>
              {b.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Ô so sánh nhanh số XE tăng cường: kỳ này vs kỳ trước (đặt cạnh gauge). */
function CmpMini({ title, cmp }: { title: string; cmp: CmpResult | null }) {
  const chg = cmp?.changePct ?? null;
  const up = chg != null && chg > 0.02, down = chg != null && chg < -0.02;
  const col = up ? "var(--red)" : down ? "var(--green)" : "var(--ink)";
  const chgTxt = chg == null ? "" : `${chg >= 0 ? "▲" : "▼"}${Math.abs(Math.round(chg * 100))}%`;
  return (
    <div className="xtc-cmpmini">
      <div className="xtc-cmpmini-t">{title}</div>
      <div className="xtc-cmpmini-v" style={{ color: col }}>
        {cmp ? cmp.curTotal : "—"}<span className="u">xe</span>
        {chgTxt && <span className="d" style={{ color: col }}>{chgTxt}</span>}
      </div>
      <div className="xtc-cmpmini-s">
        kỳ trước: <b>{cmp ? cmp.prevTotal : "—"}</b>{cmp?.partial ? ` · đến ${cmp.asOf}` : ""}
      </div>
    </div>
  );
}

/**
 * Xin Xe TC: thống kê tỷ lệ bưu cục xin xe tăng cường + tỷ lệ đáp ứng (có xe/không xe)
 * theo Ngày/Tuần/Tháng + biểu đồ theo ngày + Top 50 + tìm kiếm theo tên BC.
 * Mặc định xem CẢ THÁNG HIỆN TẠI. Dropdown kỳ tính từ hôm nay đổ xuống.
 */
export function XinTcPanel() {
  const data = useXinTc();
  // Sếp báo 2026-08-25: chọn Ngày/Tuần/Tháng + kỳ + tìm kiếm xong, chuyển qua tab khác rồi quay lại
  // là MẤT hết lựa chọn (useState thường -> reset khi component unmount lúc đổi tab). Đổi sang
  // usePersistentState (sessionStorage) — giữ nguyên khi chuyển menu, chỉ mất khi đóng hẳn tab.
  const [gran, setGran] = usePersistentState<Gran>("xtc.gran", "thang"); // mặc định: theo tháng
  const [sel, setSel] = usePersistentState<string>("xtc.sel", "");
  const [q, setQ] = usePersistentState<string>("xtc.q", "");
  const [trendN, setTrendN] = usePersistentState<7 | 30>("xtc.trendN", 30); // cửa sổ biểu đồ xu hướng
  // true = chưa chọn tay -> tự bám kỳ MỚI NHẤT CÓ dữ liệu (phải lưu cùng "sel" ở trên, không thì
  // quay lại tab là effect tự bám-kỳ-mới-nhất ở dưới lại ghi đè mất kỳ Sếp đã tự chọn tay).
  const [autoSel, setAutoSel] = usePersistentState<boolean>("xtc.autoSel", true);

  const recs = data?.recs ?? [];

  // Tìm theo tên HOẶC mã ID bưu cục (XtcRec không tự có cột ID, tra chéo qua usePlaceIds()):
  // khi có tìm kiếm, TOÀN BỘ chỉ số bên dưới (gauge, xu hướng, biểu đồ theo ngày, so sánh kỳ,
  // đề xuất lịch) đều thu hẹp về (các) bưu cục khớp — không chỉ riêng bảng Top 50 như trước.
  // Không tìm -> scoped = recs (không đổi hành vi cũ).
  const placeIds = usePlaceIds();
  const nq = normSearch(q);
  const scoped = useMemo(
    () => (nq ? recs.filter((r) => normSearch(r.bc).includes(nq) || (placeIds.get(r.bc) || "").includes(nq)) : recs),
    [recs, nq, placeIds]
  );

  // Danh sách kỳ: TỪ HÔM NAY đổ về (không phụ thuộc dữ liệu -> tránh ngày rác).
  const periods = useMemo(() => recentPeriods(gran, PERIOD_COUNT[gran]), [gran]);
  // Kỳ MỚI NHẤT có dữ liệu (để mặc định hiển thị, tránh tháng hiện tại trống).
  // CHỈ xét các kỳ NẰM TRONG dropdown -> bỏ qua ngày rác tương lai (vd 30/12/2099).
  const latestDataPeriod = useMemo(() => {
    const win = new Set(periods);
    let best = "";
    for (const r of scoped) { const k = periodKey(r.date, gran); if (k && win.has(k) && k > best) best = k; }
    return best;
  }, [scoped, gran, periods]);

  // Mặc định: nếu chưa chọn tay -> ưu tiên kỳ mới nhất có data (trong dropdown), không thì kỳ hiện tại.
  useEffect(() => {
    if (autoSel) {
      const want = latestDataPeriod || periods[0];
      if (want && want !== sel) setSel(want);
    } else if (periods.length && !periods.includes(sel)) {
      setSel(periods[0]);
    }
  }, [periods, latestDataPeriod, sel, autoSel]);

  const inPeriod = useMemo(() => scoped.filter((r) => periodKey(r.date, gran) === sel), [scoped, gran, sel]);
  const st = useMemo(() => statsOf(inPeriod), [inPeriod]);
  // So sánh KỲ ĐANG CHỌN vs kỳ liền trước (khớp đúng số đang xem, không lấy "tuần/tháng hiện tại" trống).
  const cmpSel = useMemo(() => comparePeriods(scoped, gran, sel), [scoped, gran, sel]);
  const series = useMemo(() => seriesByDay(inPeriod, gran, sel), [inPeriod, gran, sel]);
  const other = Math.max(0, st.total - st.coXe - st.khongXe);
  const denom = st.coXe + st.khongXe; // mẫu số tỷ lệ đáp ứng (bỏ khác/hủy/chờ)
  const rateColor = st.rate == null ? "var(--muted)" : st.rate >= 0.95 ? "var(--green)" : st.rate >= 0.8 ? "var(--orange)" : "var(--red)";

  // Nhận xét nhanh cho biểu đồ theo ngày: ngày đỉnh + so sánh cuối tuần / ngày thường.
  const dayInsight = useMemo(() => {
    const act = series.filter((b) => b.total > 0);
    if (!act.length) return "Chưa có dữ liệu theo ngày để nhận xét.";
    const peak = act.reduce((m, b) => (b.total > m.total ? b : m), act[0]);
    const we = act.filter((b) => isWeekendISO(b.key));
    const wd = act.filter((b) => !isWeekendISO(b.key));
    const avg = (a: DayBar[]) => (a.length ? a.reduce((s, b) => s + b.total, 0) / a.length : 0);
    const weAvg = avg(we), wdAvg = avg(wd);
    const cmp = we.length && wd.length && wdAvg
      ? ` Cuối tuần TB <b>${weAvg.toFixed(0)}</b> vs ngày thường <b>${wdAvg.toFixed(0)}</b> lượt/ngày (${weAvg >= wdAvg ? "+" : ""}${Math.round((weAvg / wdAvg - 1) * 100)}%).`
      : "";
    const low = st.rate != null && st.rate < 0.85 ? ` Đáp ứng <b style="color:var(--red)">${pct(st.rate)}</b> dưới mục tiêu 95% → cần thêm xe những ngày đỉnh.` : ` Đáp ứng <b style="color:var(--green)">${pct(st.rate)}</b>.`;
    return `Đỉnh ngày <b>${peak.label}</b> (${peak.total} lượt).${cmp}${low}`;
  }, [series, st.rate]);

  // Xu hướng N ngày gần nhất (độc lập kỳ đang chọn) cho biểu đồ đường.
  const trend = useMemo(() => lastNDays(scoped, trendN), [scoped, trendN]);
  const trendStats = useMemo(() => {
    let coXe = 0, khongXe = 0, total = 0;
    for (const b of trend) { total += b.total; coXe += b.coXe; khongXe += b.khongXe; }
    const denom = coXe + khongXe;
    return { total, coXe, khongXe, rate: denom ? coXe / denom : null };
  }, [trend]);

  // Sếp yêu cầu 2026-08-25: tìm NGAY trong bảng "Top 50 bưu cục" (không phải ô tìm kiếm chung ở đầu
  // trang — ô đó thu hẹp CẢ TRANG về 1 BC, dùng để phân tích sâu; ô này chỉ lọc riêng bảng, tra cứu
  // nhanh 1 dòng trong danh sách dài). Lọc trên TOÀN BỘ st.topBc (trước khi cắt top 50) để tìm được
  // cả bưu cục NGOÀI top 50 hiển thị mặc định — không chỉ lọc trong 50 dòng đang thấy.
  const [tableQ, setTableQ] = usePersistentState<string>("xtc.tableQ", "");
  const ntq = normSearch(tableQ);
  const tableRows = useMemo(
    () => (ntq ? st.topBc.filter((b) => normSearch(b.bc).includes(ntq) || (placeIds.get(b.bc) || "").includes(ntq)) : st.topBc),
    [st.topBc, ntq, placeIds]
  );
  const rows = tableRows.slice(0, 50);

  // Bước qua kỳ bằng nút ‹ › (periods: [0]=mới nhất … cuối=cũ nhất).
  const selIdx = periods.indexOf(sel);
  const stepPeriod = (dir: number) => {
    const i = selIdx + dir;
    if (i >= 0 && i < periods.length) { setSel(periods[i]); setAutoSel(false); }
  };

  if (!data) return <div className="section-card" style={{ marginTop: 12, textAlign: "center", color: "var(--muted)" }}>Đang tải dữ liệu xin xe tăng cường…</div>;

  return (
    <div>
      <div className="section-card tc-head">
        <h2 style={{ marginBottom: 2, fontSize: 17 }}>🙋 TC - Phát Sinh (Bưu cục xin xe tăng cường)</h2>
        <p className="lead" style={{ margin: 0, fontSize: 14 }}>
          Đây là <b>số XE tăng cường PHÁT SINH mà bưu cục xin</b> (ngoài lịch cố định) — đo nhu cầu thực tế theo ngày/tuần/tháng & khả năng đáp ứng. Đã loại ticket “Hủy - Nhập sai”.
        </p>
        <div className="xtc-glossary">
          <span><b>Lượt xin = SỐ XE</b>: mỗi dòng form = <b>1 xe</b>; 1 bưu cục có thể xin <b>nhiều xe/ngày</b> (2–7 xe) → tính đủ TỪNG xe, không gộp về 1.</span>
          <span><b className="g">Có xe (đáp ứng)</b> = đã điều được xe.</span>
          <span><b className="r">Không có xe</b> = không bố trí được (cần chú ý).</span>
          <span><b className="b">Tỷ lệ đáp ứng</b> = Có xe ÷ (Có + Không), mục tiêu ≥ 95%.</span>
        </div>
        {st.total > 0 && (
          <div className="xtc-multi">
            🚚 <b>{st.total}</b> xe xin · từ <b>{st.bcCount}</b> bưu cục · TB <b>{st.avgXePerBc.toFixed(1)}</b> xe/BC
            {st.maxXeDay >= 2 && <> · cao nhất <b>{st.maxXeDay}</b> xe/ngày ({st.maxXeDayBc.replace(/^\d+\s*-\s*/, "").slice(0, 28)})</>}
            {st.multiXeDays > 0 && <> · <b>{st.multiXeDays}</b> lượt BC xin ≥2 xe/ngày</>}
          </div>
        )}
        <div className="xtc-toolbar">
          <div className="xtc-seg">
            {GRANS.map((g) => (
              <button key={g.key} className={gran === g.key ? "on" : ""} onClick={() => { setGran(g.key); setAutoSel(true); }}>{g.label}</button>
            ))}
          </div>
          <div className="period-nav">
            <button
              className="pn-arrow"
              disabled={selIdx >= periods.length - 1}
              onClick={() => stepPeriod(1)}
              title="Kỳ trước"
            >‹</button>
            <div className="pn-current">
              <span className="pn-ic">📅</span>
              <span className="pn-text">{periodLabel(sel, gran)}</span>
              <span className="pn-caret">▾</span>
              <select value={sel} onChange={(e) => { setSel(e.target.value); setAutoSel(false); }}>
                {periods.map((k) => <option key={k} value={k}>{periodLabel(k, gran)}</option>)}
              </select>
            </div>
            <button
              className="pn-arrow"
              disabled={selIdx <= 0}
              onClick={() => stepPeriod(-1)}
              title="Kỳ sau"
            >›</button>
          </div>
          <div className="xtc-search">
            <input
              className="pl-in"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="🔎 Tìm theo tên hoặc mã ID bưu cục…"
            />
            {q && <button className="xtc-clear" onClick={() => setQ("")} title="Xoá tìm kiếm">×</button>}
          </div>
        </div>
      </div>

      {/* TỔNG QUAN kỳ đang chọn: Tổng xe → Đáp ứng% → Không có xe → So kỳ trước. */}
      <div className="section-card gauge-row" style={{ marginTop: 12 }}>
        <Gauge
          pct={1}
          color="var(--orange)"
          center={String(st.total)}
          sub="xe xin"
          label={`Tổng xe TC · ${periodLabel(sel, gran)}`}
        />
        <Gauge
          pct={st.rate ?? 0}
          color={rateColor}
          center={pct(st.rate)}
          sub={`${st.coXe}/${denom} có xe`}
          label="Tỷ lệ đáp ứng"
        />
        <Gauge
          pct={denom ? st.khongXe / denom : 0}
          color="var(--red)"
          center={String(st.khongXe)}
          sub={st.khongXe ? "cần bổ sung xe" : "không thiếu"}
          label="Không có xe"
        />
        <CmpMini title="So kỳ trước" cmp={cmpSel} />
      </div>

      <div className="section-card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
          <h3 style={{ fontSize: 15.5, margin: 0 }}>📈 Xu hướng lượt xin & tỷ lệ đáp ứng — {trendN} ngày gần nhất</h3>
          <div className="xtc-seg sm">
            <button className={trendN === 7 ? "on" : ""} onClick={() => setTrendN(7)}>7 ngày</button>
            <button className={trendN === 30 ? "on" : ""} onClick={() => setTrendN(30)}>30 ngày</button>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 4 }}>
          <span><b style={{ color: "#2f8f4e" }}>▮</b> Số lượt xin/ngày (cột)</span>
          <span><b style={{ color: "#f15a24" }}>―●</b> EMA — xu hướng lượt xin (đường mượt)</span>
          <span>Tổng kỳ: <b>{trendStats.total}</b> lượt · đáp ứng <b style={{ color: "#2f8f4e" }}>{pct(trendStats.rate)}</b></span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 2, fontStyle: "italic" }}>
          ℹ️ Đường cam = EMA (trung bình động luỹ thừa) của số lượt xin — như đường MA chứng khoán: cột trên đường = ngày cao hơn xu hướng, cột dưới = thấp hơn.
        </div>
        {trendStats.total === 0 ? (
          <div className="lead" style={{ fontSize: 14, padding: "8px 0" }}>Chưa có lượt xin tăng cường trong {trendN} ngày gần nhất.</div>
        ) : (
          <TrendChart series={trend} showRateLabels={trendN === 7} />
        )}
      </div>

      <div className="section-card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ fontSize: 15.5, margin: "0 0 8px" }}>📊 Tỷ lệ đáp ứng & lượt xin theo ngày — {periodLabel(sel, gran)}</h3>
          <div style={{ fontSize: 13, color: "var(--muted)", display: "flex", gap: 12 }}>
            <span><b style={{ color: "var(--green)" }}>■</b> Có xe</span>
            <span><b style={{ color: "var(--red)" }}>■</b> Không xe</span>
            {other > 0 && <span><b style={{ color: "var(--muted)" }}>■</b> Khác/hủy</span>}
          </div>
        </div>

        {st.total === 0 ? (
          <div className="lead" style={{ fontSize: 14, padding: "8px 0" }}>Chưa có lượt xin tăng cường nào trong kỳ này.</div>
        ) : (
          <div className="dc-split">
            <div className="dc-main">
              <RatioBar coXe={st.coXe} khongXe={st.khongXe} other={other} />
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 5 }}>
                {st.coXe} có xe · {st.khongXe} không xe{other ? ` · ${other} khác/hủy` : ""} — đáp ứng <b style={{ color: "var(--green)" }}>{pct(st.rate)}</b>
              </div>
              {series.length > 0 && <DayChart series={series} />}
            </div>
            <div className="dc-side">
              <div className="dc-side-h">🍩 Cơ cấu đáp ứng</div>
              <Donut
                items={[
                  { label: "Có xe", value: st.coXe, color: "var(--green)" },
                  { label: "Không xe", value: st.khongXe, color: "var(--red)" },
                  ...(other > 0 ? [{ label: "Khác/hủy", value: other, color: "#c2cbd6" }] : []),
                ]}
                center={pct(st.rate)}
                centerSub="đáp ứng"
              />
              <div className="dc-insight" dangerouslySetInnerHTML={{ __html: dayInsight }} />
            </div>
          </div>
        )}
      </div>

      <Collapsible title="🆚 So sánh cùng kỳ" sub="theo Tháng · Tuần · Event — kỳ này vs kỳ trước">
        <XinTcCompareTabs recs={scoped} />
      </Collapsible>

      <Collapsible
        title={
          ntq
            ? `🏆 Bưu cục khớp "${tableQ}" (${tableRows.length})`
            : nq
            ? `🏆 Bưu cục khớp "${q}" (${st.topBc.length})`
            : "🏆 Top 50 bưu cục xin tăng cường"
        }
        sub={periodLabel(sel, gran)}
      >
        <div className="xtc-search" style={{ marginBottom: 10 }}>
          <input
            className="pl-in"
            value={tableQ}
            onChange={(e) => setTableQ(e.target.value)}
            placeholder="🔎 Tìm tên hoặc mã ID bưu cục trong bảng…"
          />
          {tableQ && <button className="xtc-clear" onClick={() => setTableQ("")} title="Xoá tìm kiếm">×</button>}
        </div>
        {rows.length === 0 ? (
          <div className="lead" style={{ fontSize: 14 }}>
            {ntq
              ? `Không tìm thấy bưu cục nào khớp "${tableQ}" trong kỳ này.`
              : nq
              ? "Không có bưu cục nào khớp tìm kiếm trong kỳ này."
              : "Chưa có dữ liệu trong kỳ này."}
          </div>
        ) : (
          <div className="tc-wrap scroll-frame">
            <table className="tc-grid">
              <thead>
                <tr><th style={{ width: 36 }}>#</th><th>Bưu cục</th><th style={{ width: 64 }}>Tổng xe</th><th style={{ width: 78 }} title="Số xe nhiều nhất trong 1 ngày">Max/ngày</th><th style={{ width: 60 }}>Có xe</th><th style={{ width: 74 }}>Không xe</th><th style={{ width: 84 }}>Đáp ứng</th></tr>
              </thead>
              <tbody>
                {rows.map((b, i) => (
                  <tr key={b.bc}>
                    <td className="num" style={{ fontWeight: 700, color: i < 3 && !nq && !ntq ? "var(--orange)" : undefined }}>{i + 1}</td>
                    <td>{b.bc}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{b.n}</td>
                    <td className="num" style={{ fontWeight: 700, color: b.maxDay >= 3 ? "var(--red)" : b.maxDay >= 2 ? "var(--orange)" : "var(--muted)" }} title="Xe nhiều nhất trong 1 ngày">{b.maxDay || "—"}</td>
                    <td className="num" style={{ color: "var(--green)" }}>{b.coXe}</td>
                    <td className="num" style={{ color: b.khongXe ? "var(--red)" : undefined }}>{b.khongXe}</td>
                    <td className="num" style={{ fontWeight: 700, color: b.rate == null ? "var(--muted)" : b.rate >= 0.85 ? "var(--green)" : b.rate >= 0.6 ? "var(--orange)" : "var(--red)" }}>{pct(b.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Collapsible>

      <ScheduleSuggest recs={scoped} />
    </div>
  );
}
