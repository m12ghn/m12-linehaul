/* ============================================================
   TỔNG TLLD CỦA CỤM — báo cáo tổng quan cho cấp quản lý/giám đốc:
   - Đổi góc nhìn Ngày / Tuần (CN→T7) / Tháng, tự gộp từ TOÀN BỘ lịch sử có (không chỉ 30 ngày).
   - Xu hướng lấp đầy toàn cụm theo kỳ + tương quan với lượng hàng THẬT (FC actW).
   - Tuyến GIẢM trung bình kỳ này so kỳ trước (mọi mức Ngày/Tuần/Tháng đều dùng chung cơ chế).
   - Phân bố theo HUB nguồn (HCM01/HCM20/Sóng Thần/Tân Tạo) + Top vấn đề TOÀN CỤM.
   - Nhận định AI (DailyAnalysis, tự phân tích 09:00 mỗi ngày theo đúng góc nhìn đang chọn).
   Mọi số đều tính từ dữ liệu TLLD/FC thật — không suy diễn khi thiếu dữ liệu.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useTlld } from "../lib/useTlld";
import type { TlldRoute } from "../lib/tlld";
import { loadFC, type FCRow } from "../lib/fc";
import { buildPeriods, GRAN_LABEL, GRAN_UNIT, type Granularity, type Period } from "../lib/tlldPeriods";
import { useExcludedSet, isExcluded } from "../lib/tlldExclude";
import { ChartGradients, gradOf } from "./ChartGradients";
import { Reveal } from "./Reveal";
import { Collapsible } from "./Collapsible";
import { DailyAnalysis } from "./DailyAnalysis";

const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");
const fmtVN = (v: number) => Math.round(v).toLocaleString("vi-VN");
const shortNum = (v: number) => { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : a >= 1e3 ? Math.round(v / 1e3) + "K" : String(Math.round(v)); };
const fillColor = (v: number | null) => (v == null ? "var(--muted)" : v >= 0.85 ? "var(--green)" : v >= 0.6 ? "var(--orange)" : "var(--red)");
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const VN_WEEKDAY = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const weekdayOf = (iso: string) => VN_WEEKDAY[new Date(iso + "T00:00:00").getDay()];

/** TB lấp đầy của 1 tuyến trong tập ngày cho trước (dùng chung cho mọi kỳ Ngày/Tuần/Tháng). */
function avgOfDates(route: TlldRoute, dateSet: Set<string>): number | null {
  let sum = 0, cnt = 0;
  for (const s of route.seriesAll) if (s.val != null && dateSet.has(s.date)) { sum += s.val; cnt++; }
  return cnt ? sum / cnt : null;
}

/** Số ngày (a - b), dùng để xác định "ngày thứ mấy trong kỳ" khi so kỳ đang chạy dở với kỳ trước. */
function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00").getTime(), db = new Date(b + "T00:00:00").getTime();
  return Math.round((da - db) / 86400000);
}

export interface PeriodStat { period: Period; avg: number | null; nRoutes: number; actVol: number; actW: number; fcN: number }

/** Biểu đồ xu hướng lấp đầy theo kỳ — cột màu theo ngưỡng, viền kỳ đang chạy.
 *  Dùng chung cho cả "Tổng TLLD Cụm" (toàn cụm) và "Xu hướng dài hạn" trong TlldReport
 *  (theo đúng vùng/tuyến đang chọn) — chỉ khác nguồn `stats` truyền vào. */
export function TrendChart({ stats }: { stats: PeriodStat[] }) {
  const W = 720, H = 220, padL = 34, padR = 12, padT = 20, padB = 34;
  const cw = W - padL - padR, ch = H - padT - padB;
  const yMax = Math.max(1, ...stats.map((s) => s.avg ?? 0)) * 1.18;
  const n = stats.length || 1, slot = cw / n, bw = Math.min(46, slot * 0.58);
  const yOf = (v: number) => padT + ch - (v / yMax) * ch;
  // Đường trung bình — TB lấp đầy của TẤT CẢ các kỳ đang hiển thị trên biểu đồ (không phải toàn bộ
  // lịch sử), để so trực quan kỳ nào đang cao/thấp hơn mặt bằng chung của đoạn đang xem.
  const withAvg = stats.filter((s) => s.avg != null);
  const meanAvg = withAvg.length ? withAvg.reduce((a, s) => a + s.avg!, 0) / withAvg.length : null;
  return (
    <svg className="sl-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 240 }}>
      <ChartGradients />
      {[0.6, 0.85, 1].filter((t) => t <= yMax).map((t, i) => (
        <line key={i} x1={padL} y1={yOf(t)} x2={W - padR} y2={yOf(t)} stroke={t === 0.85 ? "var(--success-soft)" : t === 0.6 ? "var(--warning-soft)" : "var(--surface-sunken)"} strokeDasharray="4 4" />
      ))}
      {stats.map((s, i) => {
        const x = padL + i * slot + (slot - bw) / 2, v = s.avg ?? 0, y = yOf(v), h = padT + ch - y;
        const col = fillColor(s.avg);
        return (
          <g key={s.period.key}>
            <rect x={x} y={y} width={bw} height={Math.max(0, h)} rx={3}
              fill={gradOf(col)} stroke={s.period.running ? "var(--text-faint)" : "none"} strokeDasharray={s.period.running ? "3 2" : undefined}
              className="fx-drop" style={{ animationDelay: `${i * 0.05}s` }}>
              <title>{`${s.period.label}: ${pct(s.avg)} · ${s.nRoutes} tuyến${s.period.running ? " (đang chạy)" : ""}`}</title>
            </rect>
            {s.avg != null && <text x={x + bw / 2} y={y - 5} textAnchor="middle" className="sl-barval">{pct(s.avg)}</text>}
            <text x={x + bw / 2} y={H - padB + 15} textAnchor="middle" className="sl-xlb" style={{ fontSize: stats.length > 14 ? 9.5 : 11 }}>{s.period.shortLabel}</text>
          </g>
        );
      })}
      {meanAvg != null && (
        <g>
          <line x1={padL} y1={yOf(meanAvg)} x2={W - padR} y2={yOf(meanAvg)} stroke="var(--chart-3)" strokeWidth={1.6} strokeDasharray="6 3" opacity={0.85}>
            <title>{`TB các kỳ đang xem: ${pct(meanAvg)}`}</title>
          </line>
          {/* Nhãn TB đặt CỐ ĐỊNH ở góc trên-trái (không bám đúng độ cao đường TB) — đặt ngay trên
              đường/sát lề phải sẽ đè lên số % của cột cuối (cột hay được chú ý nhất), rõ nhất khi
              biểu đồ nhiều cột (vd 21 ngày) làm nhãn các cột dồn sát mép phải. Có nền trắng mờ phía
              sau để luôn đọc được dù phía dưới là gì. */}
          <rect x={padL} y={padT - 2} width={56} height={16} rx={4} fill="var(--surface-card)" opacity={0.85} />
          <text x={padL + 4} y={padT + 9} textAnchor="start" fontSize={10.5} fontWeight={800} fill="var(--chart-3)">TB {pct(meanAvg)}</text>
        </g>
      )}
      <line x1={padL} y1={padT + ch} x2={W - padR} y2={padT + ch} stroke="var(--chart-axis)" />
    </svg>
  );
}

/** Biểu đồ CHỈ SỐ (index=100 tại kỳ đầu hiển thị) — TLLD vs Lượng hàng thực tế, để soi TƯƠNG QUAN.
 *  Có nhãn GIÁ TRỊ THẬT (không chỉ số) ngay trên/dưới mỗi điểm khi không quá dày (≤14 điểm) — kèm
 *  bảng số liệu thật đầy đủ bên dưới (xem <IndexTable/>) để không phải suy ra ngược từ chỉ số. */
function IndexChart({ stats }: { stats: PeriodStat[] }) {
  const withBase = stats.filter((s) => s.avg != null);
  const baseTlld = withBase[0]?.avg ?? null;
  const withVol = stats.filter((s) => s.actW > 0);
  const baseVol = withVol[0]?.actW ?? null;
  if (baseTlld == null && baseVol == null) return null;
  const showLabels = stats.length <= 14;
  const W = 720, H = showLabels ? 240 : 210, padL = 40, padR = 14, padT = showLabels ? 34 : 18, padB = showLabels ? 44 : 30;
  const cw = W - padL - padR, ch = H - padT - padB;
  const idxTlld = stats.map((s) => (baseTlld && s.avg != null ? (s.avg / baseTlld) * 100 : null));
  const idxVol = stats.map((s) => (baseVol && s.actW > 0 ? (s.actW / baseVol) * 100 : null));
  const all = [...idxTlld, ...idxVol].filter((v): v is number => v != null);
  const yMax = Math.max(140, ...all) * 1.05, yMin = Math.min(60, ...all) * 0.95;
  const n = stats.length || 1, slot = cw / Math.max(1, n - 1);
  const yOf = (v: number) => padT + ch - ((v - yMin) / (yMax - yMin)) * ch;
  const path = (vals: (number | null)[]) => {
    let d = "", started = false;
    vals.forEach((v, i) => {
      if (v == null) { started = false; return; }
      const x = padL + i * slot, y = yOf(v);
      d += (started ? " L" : " M") + x + " " + y;
      started = true;
    });
    return d.trim();
  };
  return (
    <svg className="sl-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ maxHeight: showLabels ? 260 : 220 }}>
      <line x1={padL} y1={yOf(100)} x2={W - padR} y2={yOf(100)} stroke="var(--chart-axis)" strokeDasharray="4 4" />
      <text x={padL - 6} y={yOf(100) + 4} textAnchor="end" className="sl-axis">100</text>
      <path d={path(idxVol)} fill="none" stroke="var(--chart-2)" strokeWidth={2.5} />
      <path d={path(idxTlld)} fill="none" stroke="var(--chart-1)" strokeWidth={2.5} />
      {stats.map((s, i) => {
        const x = padL + i * slot;
        return (
          <g key={s.period.key}>
            {idxVol[i] != null && (
              <g>
                <circle cx={x} cy={yOf(idxVol[i]!)} r={3.4} fill="var(--chart-2)"><title>{`Lượng hàng · ${s.period.label}: ${fmtVN(s.actW)} kg (chỉ số ${Math.round(idxVol[i]!)}, kỳ đầu=100)`}</title></circle>
                {showLabels && <text x={x} y={yOf(idxVol[i]!) - 8} textAnchor="middle" className="sl-barval" style={{ fill: "var(--chart-2)" }}>{shortNum(s.actW)}kg</text>}
              </g>
            )}
            {idxTlld[i] != null && (
              <g>
                <circle cx={x} cy={yOf(idxTlld[i]!)} r={3.4} fill="var(--chart-1)"><title>{`TLLD · ${s.period.label}: ${pct(s.avg)} (chỉ số ${Math.round(idxTlld[i]!)}, kỳ đầu=100)`}</title></circle>
                {showLabels && <text x={x} y={yOf(idxTlld[i]!) + 15} textAnchor="middle" className="sl-barval" style={{ fill: "var(--chart-1)" }}>{pct(s.avg)}</text>}
              </g>
            )}
            <text x={x} y={H - padB + 15} textAnchor="middle" className="sl-xlb" style={{ fontSize: stats.length > 14 ? 9.5 : 11 }}>{s.period.shortLabel}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Bảng số liệu THẬT (không chỉ số) đứng sau biểu đồ — để đọc chính xác từng kỳ, không phải suy ngược từ %. */
function IndexTable({ stats }: { stats: PeriodStat[] }) {
  const rows = stats.filter((s) => s.avg != null || s.actW > 0);
  if (!rows.length) return null;
  return (
    <div className="tc-wrap" style={{ marginTop: 8 }}>
      <table className="tc-grid">
        <thead><tr><th>Kỳ</th><th style={{ width: 90 }}>TLLD thật</th><th style={{ width: 110 }}>Lượng hàng thật</th></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.period.key}>
              <td style={{ fontWeight: 700 }}>{s.period.label}{s.period.running ? " (đang chạy)" : ""}</td>
              <td className="num" style={{ color: fillColor(s.avg) }}>{pct(s.avg)}</td>
              <td className="num">{s.actW > 0 ? fmtVN(s.actW) + " kg" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TlldClusterReport() {
  const { index, loading, error } = useTlld();
  const exclSet = useExcludedSet(); // Nội Vùng HCM + hub HCM01 + loại tuyến 01_FW_20 — KHÔNG thuộc Cụm M12
  const [gran, setGran] = useState<Granularity>("tuan");
  const [fcH, setFcH] = useState<FCRow[]>([]);
  const [fcS, setFcS] = useState<FCRow[]>([]);
  useEffect(() => {
    let alive = true;
    loadFC("FC HCM20").then((d) => { if (alive) setFcH(d.rows); });
    loadFC("FC ST").then((d) => { if (alive) setFcS(d.rows); });
    return () => { alive = false; };
  }, []);

  // Phạm vi ĐÚNG Cụm M12 — bỏ hub HCM01 + Nội Vùng HCM + CK1/CK2/NB + loại tuyến "01_FW_20"
  // (xem src/lib/tlldExclude.ts) TRƯỚC khi tính bất kỳ tổng hợp nào bên dưới.
  const scoped = useMemo(() => {
    const m = new Map<string, TlldRoute>();
    if (!index) return m;
    for (const [code, route] of index.byCode) if (!isExcluded(code, exclSet)) m.set(code, route);
    return m;
  }, [index, exclSet]);
  // Gộp 1 LẦN: ngày -> {tổng, số điểm, tập tuyến góp} — dùng chung cho MỌI kỳ (nhẹ, không lặp lại).
  const dayAgg = useMemo(() => {
    const m = new Map<string, { sum: number; cnt: number; routes: Set<string> }>();
    for (const [code, route] of scoped) {
      for (const s of route.seriesAll) {
        if (s.val == null) continue;
        let e = m.get(s.date);
        if (!e) { e = { sum: 0, cnt: 0, routes: new Set() }; m.set(s.date, e); }
        e.sum += s.val; e.cnt++; e.routes.add(code);
      }
    }
    return m;
  }, [scoped]);

  const periods = useMemo(() => (index ? buildPeriods(index.allDates, gran) : []), [index, gran]);

  const periodStats: PeriodStat[] = useMemo(() => periods.map((p) => {
    let sum = 0, cnt = 0; const routes = new Set<string>();
    for (const d of p.dates) { const e = dayAgg.get(d); if (e) { sum += e.sum; cnt += e.cnt; for (const c of e.routes) routes.add(c); } }
    const dset = new Set(p.dates);
    let actVol = 0, actW = 0, fcN = 0;
    for (const r of [...fcH, ...fcS]) if (dset.has(r.date)) { if (r.actVol != null) { actVol += r.actVol; fcN++; } if (r.actW != null) actW += r.actW; }
    return { period: p, avg: cnt ? sum / cnt : null, nRoutes: routes.size, actVol, actW, fcN };
  }), [periods, dayAgg, fcH, fcS]);

  // Kỳ ĐANG XEM: mặc định lùi về kỳ ĐÃ CHỐT liền trước (N-1) nếu kỳ mới nhất đang chạy dở — vd hôm
  // nay Tuần 32 mới qua 2/7 ngày thì mặc định hiện Tuần 31 (đã đủ ngày), không phải Tuần 32 dở dang.
  // Sếp có thể chủ động CHỌN bất kỳ kỳ nào khác (kể cả kỳ đang chạy) qua bộ điều hướng "‹ 📅 ▾ ›"
  // bên dưới — selKey lưu đúng "key" của kỳ đã chọn tay; null = chưa chọn tay, dùng mặc định N-1.
  const [selKey, setSelKey] = useState<string | null>(null);
  const lastIdx = periodStats.length - 1;
  const autoSkipLive = periodStats.length > 1 && !!periodStats[lastIdx]?.period.running;
  const selIdx = selKey != null ? periodStats.findIndex((s) => s.period.key === selKey) : -1;
  const curIdx = selIdx >= 0 ? selIdx : autoSkipLive ? lastIdx - 1 : lastIdx;
  const cur = periodStats[curIdx] ?? null;
  const prev = periodStats[curIdx - 1] ?? null;

  /** Đổi Ngày/Tuần/Tháng: tự nhảy tới kỳ mới CHỨA đúng ngày đang xem (vd đang xem Tuần chứa 5/8,
   *  đổi qua Tháng -> nhảy thẳng Tháng 8), không về lại mặc định — giữ đúng mạch đang xem cho Sếp.
   *  Neo theo ngày THẬT có dữ liệu gần cuối kỳ nhất (period.dates[cuối]), KHÔNG neo theo period.end
   *  (ngày cuối lịch, vd 31/8) — vì khi đổi sang "Ngày" thì period.end thường chưa có dữ liệu thật
   *  (tháng chưa hết), tìm mốc đó ra "không khớp kỳ nào" rồi lại rơi về mặc định, mất mạch đang xem. */
  function changeGran(g: Granularity) {
    if (g === gran) return;
    const dates = cur?.period.dates;
    const anchor = dates && dates.length ? dates[dates.length - 1] : null;
    setGran(g);
    if (anchor && index) {
      const match = buildPeriods(index.allDates, g).find((p) => p.start <= anchor && anchor <= p.end);
      setSelKey(match ? match.key : null);
    } else {
      setSelKey(null);
    }
  }
  /** Lùi (-1, kỳ trước/cũ hơn) hoặc tới (+1, kỳ sau/mới hơn) 1 kỳ — periodStats tăng dần theo thời gian. */
  function stepPeriod(dir: number) {
    const i = curIdx + dir;
    if (i >= 0 && i < periodStats.length) setSelKey(periodStats[i].period.key);
  }

  // Kỳ hiện tại ĐANG CHẠY DỞ (vd mới có 1/7 ngày của tuần) -> so với CẢ kỳ trước đủ ngày sẽ SAI
  // lệch (vd so 1 ngày Chủ Nhật với TB nguyên tuần). Cắt kỳ trước về ĐÚNG cùng số ngày đã qua
  // (cùng vị trí trong kỳ) để so sánh công bằng — nguyên tắc "không bịa/không so lệch" của dự án.
  const prevComparable = useMemo(() => {
    if (!cur || !prev) return null;
    const offsets = new Set(cur.period.dates.map((d) => daysBetween(d, cur.period.start)));
    const dates = prev.period.dates.filter((d) => offsets.has(daysBetween(d, prev.period.start)));
    const truncated = dates.length < prev.period.dates.length;
    let sum = 0, cnt = 0;
    for (const d of dates) { const e = dayAgg.get(d); if (e) { sum += e.sum; cnt += e.cnt; } }
    let actW = 0;
    const dset = new Set(dates);
    for (const r of [...fcH, ...fcS]) if (dset.has(r.date)) actW += r.actW || 0;
    return { dates, avg: cnt ? sum / cnt : null, actW, truncated };
  }, [cur, prev, dayAgg, fcH, fcS]);

  const deltaPts = cur && prevComparable && cur.avg != null && prevComparable.avg != null ? Math.round((cur.avg - prevComparable.avg) * 100) : null;
  const volDeltaPct = cur && prevComparable && prevComparable.actW > 0 ? Math.round((cur.actW / prevComparable.actW - 1) * 100) : null;
  // Kỳ hiện tại còn THIẾU bao nhiêu ngày so với 1 kỳ đủ (7 ngày/tuần, cả tháng…) — hiện cảnh báo
  // rõ ràng thay vì để director tưởng nhầm số giảm mạnh là vấn đề vận hành thật.
  const curExpectedLen = cur ? daysBetween(cur.period.end, cur.period.start) + 1 : 0;
  const curCoverage = cur ? cur.period.dates.length : 0;
  const isPartial = !!cur?.period.running && curCoverage < curExpectedLen;

  // BIẾN ĐỘNG TUYẾN kỳ này so kỳ trước — cơ chế DÙNG CHUNG cho Ngày/Tuần/Tháng, so ĐÚNG cùng số
  // ngày (prevComparable) khi kỳ hiện tại đang chạy dở. Tách 3 nhóm: có ở CẢ 2 kỳ (so tăng/giảm),
  // MỚI xuất hiện (có kỳ này, không có kỳ trước), NGƯNG chạy (có kỳ trước, không có kỳ này).
  const routeChanges = useMemo(() => {
    const empty = { changeRows: [] as { code: string; hub: string; cur: number; prev: number; deltaPts: number; deltaPct: number | null }[], newRoutes: [] as { code: string; hub: string; avg: number }[], droppedRoutes: [] as { code: string; hub: string; avg: number }[] };
    if (!cur || !prevComparable || !prevComparable.dates.length) return empty;
    const curSet = new Set(cur.period.dates), prevSet = new Set(prevComparable.dates);
    for (const [code, route] of scoped) {
      const a = avgOfDates(route, curSet), b = avgOfDates(route, prevSet);
      if (a != null && b != null) {
        if (Math.abs(a - b) > 0.001) empty.changeRows.push({ code, hub: route.hub, cur: a, prev: b, deltaPts: Math.round((a - b) * 100), deltaPct: b > 0 ? Math.round((a / b - 1) * 100) : null });
      } else if (a != null && b == null) empty.newRoutes.push({ code, hub: route.hub, avg: a });
      else if (a == null && b != null) empty.droppedRoutes.push({ code, hub: route.hub, avg: b });
    }
    empty.changeRows.sort((x, y) => x.deltaPts - y.deltaPts);
    empty.newRoutes.sort((x, y) => y.avg - x.avg);
    empty.droppedRoutes.sort((x, y) => y.avg - x.avg);
    return empty;
  }, [scoped, cur, prevComparable]);
  const declineRows = useMemo(() => routeChanges.changeRows.filter((r) => r.deltaPts < 0), [routeChanges]);
  const increaseRows = useMemo(() => [...routeChanges.changeRows].filter((r) => r.deltaPts > 0).sort((x, y) => y.deltaPts - x.deltaPts), [routeChanges]);

  // TB lấp đầy từng tuyến kỳ HIỆN TẠI (dùng cho phân bố hub + top vấn đề toàn cụm).
  const curRouteAvgs = useMemo(() => {
    if (!cur) return [];
    const set = new Set(cur.period.dates);
    const out: { code: string; hub: string; avg: number }[] = [];
    for (const [code, route] of scoped) { const v = avgOfDates(route, set); if (v != null) out.push({ code, hub: route.hub, avg: v }); }
    return out;
  }, [scoped, cur]);

  // Phân bố theo Hub — kèm TB kỳ trước (cùng cửa sổ prevComparable) để thấy hub nào đang lên/xuống.
  const hubStats = useMemo(() => {
    if (!cur) return [];
    const curSet = new Set(cur.period.dates);
    const prevSet = prevComparable?.dates.length ? new Set(prevComparable.dates) : null;
    const acc = new Map<string, { curSum: number; curN: number; prevSum: number; prevN: number }>();
    for (const [, route] of scoped) {
      const a = avgOfDates(route, curSet);
      const b = prevSet ? avgOfDates(route, prevSet) : null;
      if (a == null && b == null) continue;
      const e = acc.get(route.hub) || { curSum: 0, curN: 0, prevSum: 0, prevN: 0 };
      if (a != null) { e.curSum += a; e.curN++; }
      if (b != null) { e.prevSum += b; e.prevN++; }
      acc.set(route.hub, e);
    }
    return [...acc.entries()].map(([hub, e]) => {
      const avg = e.curN ? e.curSum / e.curN : null, prevAvg = e.prevN ? e.prevSum / e.prevN : null;
      return { hub, avg, n: e.curN, prevAvg, deltaPts: avg != null && prevAvg != null ? Math.round((avg - prevAvg) * 100) : null };
    }).filter((h) => h.avg != null).sort((a, b) => b.n - a.n);
  }, [scoped, cur, prevComparable]);

  const topLow = useMemo(() => [...curRouteAvgs].filter((x) => x.avg < 0.6).sort((a, b) => a.avg - b.avg).slice(0, 10), [curRouteAvgs]);
  const topOver = useMemo(() => [...curRouteAvgs].filter((x) => x.avg > 1).sort((a, b) => b.avg - a.avg).slice(0, 10), [curRouteAvgs]);

  // Tương quan TLLD ↔ lượng hàng thật: đếm số cặp kỳ LIÊN TIẾP cùng chiều tăng/giảm (không suy diễn, chỉ đếm thật).
  const corrNote = useMemo(() => {
    const pts = periodStats.filter((p) => p.avg != null && p.actW > 0);
    if (pts.length < 3) return null;
    let same = 0, total = 0;
    for (let i = 1; i < pts.length; i++) {
      const dV = pts[i].avg! - pts[i - 1].avg!, dW = pts[i].actW - pts[i - 1].actW;
      if (dV === 0 || dW === 0) continue;
      total++; if ((dV > 0) === (dW > 0)) same++;
    }
    return total >= 2 ? { same, total, pc: Math.round((same / total) * 100) } : null;
  }, [periodStats]);

  const shownStats = useMemo(() => periodStats.slice(-(gran === "ngay" ? 21 : gran === "tuan" ? 12 : 6)), [periodStats, gran]);

  // Tuyến giảm CÓ TẬP TRUNG vào 1 hub cụ thể không, hay rải đều — dấu hiệu phân biệt "vấn đề cục
  // bộ 1 hub" vs "xu hướng chung toàn cụm" (giúp trợ lý khoanh vùng nguyên nhân thay vì đoán chung chung).
  const declineHubConcentration = useMemo(() => {
    if (!declineRows.length) return null;
    const byHub = new Map<string, number>();
    for (const r of declineRows) byHub.set(r.hub, (byHub.get(r.hub) || 0) + 1);
    const top = [...byHub.entries()].sort((a, b) => b[1] - a[1])[0];
    return { hub: top[0], n: top[1], pc: Math.round((top[1] / declineRows.length) * 100) };
  }, [declineRows]);

  // Tuyến VỪA giảm VỪA đang <60% — mức độ nghiêm trọng CHỒNG (không chỉ mới giảm mà còn đang yếu
  // sẵn) -> đây mới là nhóm CẦN ƯU TIÊN xử lý trước, khác với "giảm nhưng vẫn đang khá".
  const criticalDeclines = useMemo(() => {
    const lowCodes = new Set(topLow.map((x) => x.code));
    return declineRows.filter((r) => lowCodes.has(r.code));
  }, [declineRows, topLow]);

  const digest = useMemo(() => {
    if (!cur) return "";
    const L: string[] = [];
    const gl = GRAN_LABEL[gran];
    L.push(`TỔNG TLLD CỦA CỤM M12 (tỷ lệ lấp đầy theo khối lượng; đã loại hub HCM01 + loại tuyến 01_FW_20 + Nội Vùng HCM/CK1/CK2/NB — KHÔNG thuộc M12) — góc nhìn theo ${gl}.`);
    L.push(`Kỳ ${gl.toLowerCase()} hiện tại: ${cur.period.label} (${ddmmyyyy(cur.period.start)}–${ddmmyyyy(cur.period.end)})${cur.period.running ? " — ĐANG CHẠY, chưa hết kỳ, số liệu sơ bộ" : ""}. TB lấp đầy ${pct(cur.avg)}, ${cur.nRoutes} tuyến có dữ liệu.`);
    if (isPartial) L.push(`⚠️ Kỳ này mới có ${curCoverage}/${curExpectedLen} ngày dữ liệu — MỌI so sánh dưới đây đã tự cắt kỳ trước về ĐÚNG ${curCoverage} ngày đầu tương ứng (không so 1 ngày với cả kỳ đủ), nhưng vẫn nên coi là SƠ BỘ, chưa chốt.`);
    if (curCoverage > 0 && curCoverage <= 7) L.push(`Ngày có dữ liệu trong kỳ này: ${cur.period.dates.map((d) => `${weekdayOf(d)} ${ddmmyyyy(d)}`).join(", ")} (lưu ý thứ trong tuần khi suy luận nguyên nhân — vd Chủ Nhật/Thứ Bảy thường thấp hơn ngày thường).`);
    if (prevComparable) L.push(`So ${gl.toLowerCase()} trước (${prev!.period.label}${prevComparable.truncated ? `, chỉ ${prevComparable.dates.length} ngày đầu để so công bằng` : ""}): ${pct(prevComparable.avg)} → ${deltaPts != null ? (deltaPts >= 0 ? "+" : "") + deltaPts + " điểm %" : "chưa đủ dữ liệu so sánh"}.`);
    if (cur.actW > 0) L.push(`Lượng hàng thực tế kỳ này (FC HCM20+Sóng Thần, KHÔNG phải toàn cụm — 2/4 hub): ${fmtVN(cur.actW)} kg${volDeltaPct != null ? ` (${volDeltaPct >= 0 ? "+" : ""}${volDeltaPct}% so kỳ trước)` : ""}.`);
    if (corrNote) L.push(`Tương quan TLLD ↔ lượng hàng: ${corrNote.same}/${corrNote.total} lần đổi kỳ CÙNG CHIỀU (${corrNote.pc}%) trong lịch sử đang xem.`);
    L.push(`Biến động tuyến so ${gl.toLowerCase()} trước: ${increaseRows.length} tuyến TĂNG, ${declineRows.length} tuyến GIẢM, ${routeChanges.newRoutes.length} tuyến MỚI xuất hiện, ${routeChanges.droppedRoutes.length} tuyến NGƯNG chạy.`);
    if (declineHubConcentration) L.push(`Tuyến giảm TẬP TRUNG nhiều nhất ở hub ${declineHubConcentration.hub} (${declineHubConcentration.n}/${declineRows.length} tuyến giảm, ${declineHubConcentration.pc}%)${declineHubConcentration.pc >= 60 ? " — đây có vẻ là VẤN ĐỀ CỤC BỘ của hub này, không phải xu hướng chung toàn cụm" : " — giảm rải khá đều, có thể là xu hướng chung toàn cụm chứ không riêng 1 hub"}.`);
    if (criticalDeclines.length) L.push(`⚠️ QUAN TRỌNG — ${criticalDeclines.length} tuyến VỪA GIẢM VỪA đang <60% (nghiêm trọng nhất, cần ưu tiên xử lý trước các tuyến chỉ giảm đơn thuần): ${criticalDeclines.slice(0, 10).map((r) => `${r.code} (${pct(r.prev)}→${pct(r.cur)})`).join(", ")}.`);
    if (increaseRows.length) L.push(`Top TĂNG mạnh nhất: ${increaseRows.slice(0, 15).map((r) => `${r.code} ${pct(r.prev)}→${pct(r.cur)} (+${r.deltaPts}đ${r.deltaPct != null ? `, +${r.deltaPct}% tương đối` : ""})`).join(", ")}.`);
    if (declineRows.length) L.push(`Top GIẢM mạnh nhất: ${declineRows.slice(0, 15).map((r) => `${r.code} ${pct(r.prev)}→${pct(r.cur)} (${r.deltaPts}đ${r.deltaPct != null ? `, ${r.deltaPct}% tương đối` : ""})`).join(", ")}.`);
    if (routeChanges.newRoutes.length) L.push(`Tuyến MỚI xuất hiện kỳ này: ${routeChanges.newRoutes.slice(0, 10).map((x) => `${x.code} ${pct(x.avg)}`).join(", ")}.`);
    if (routeChanges.droppedRoutes.length) L.push(`Tuyến NGƯNG chạy so kỳ trước: ${routeChanges.droppedRoutes.slice(0, 10).map((x) => `${x.code} (từng ${pct(x.avg)})`).join(", ")}.`);
    if (hubStats.length) L.push(`Phân bố theo hub (kỳ này): ${hubStats.map((h) => `${h.hub} ${pct(h.avg)} (${h.n} tuyến)${h.deltaPts != null ? `, so kỳ trước ${h.deltaPts >= 0 ? "+" : ""}${h.deltaPts}đ` : ""}`).join("; ")}.`);
    if (topLow.length) L.push(`Thấp nhất toàn cụm (<60%, cần ghép tải): ${topLow.map((x) => `${x.code} ${pct(x.avg)}`).join(", ")}.`);
    if (topOver.length) L.push(`Quá tải toàn cụm (>100%): ${topOver.map((x) => `${x.code} ${pct(x.avg)}`).join(", ")}.`);
    L.push(`YÊU CẦU PHÂN TÍCH (bám sát, không lặp lại số liệu suông): (1) Xác định biến động lấp đầy kỳ này CÓ TẬP TRUNG theo hub/nhóm tuyến hay rải đều toàn cụm — dùng đúng số "tuyến giảm tập trung" ở trên. (2) Đối chiếu với tương quan lượng hàng: nếu lượng hàng KHÔNG đổi tương ứng với TLLD, phải nêu rõ nguyên nhân KHÁC lượng hàng có khả năng nhất (điều xe, ghép tải, dồn hàng cuối tuần/lễ, đổi lịch tuyến...). (3) Nhóm "VỪA GIẢM VỪA <60%" (nếu có) là vấn đề CỐT LÕI cần ưu tiên đề xuất xử lý trước, tách biệt với tuyến chỉ giảm nhẹ. (4) Mỗi đề xuất phải GẮN với 1 nguyên nhân cụ thể đã nêu (không đề xuất chung chung kiểu "cần theo dõi thêm").`);
    return L.join("\n");
  }, [cur, prev, prevComparable, gran, deltaPts, volDeltaPct, corrNote, declineRows, increaseRows, routeChanges, hubStats, topLow, topOver, isPartial, curCoverage, curExpectedLen, declineHubConcentration, criticalDeclines]);

  if (error) return <div className="section-card sl-empty" style={{ color: "var(--red)" }}>⚠ Lỗi tải TLLD: {error}</div>;
  if (loading && !index) return <div className="section-card sl-empty">Đang tải dữ liệu TLLD toàn cụm…</div>;
  if (!index || !cur) return <div className="section-card sl-empty">Chưa đủ dữ liệu để dựng báo cáo tổng TLLD cụm.</div>;

  // Nhận định tổng quan (rule-based, không qua AI) — đọc lướt là nắm được bức tranh chung,
  // không cần đọc hết các bảng/biểu đồ bên dưới.
  const worstHub = [...hubStats].sort((a, b) => a.avg! - b.avg!)[0];
  const overviewNote = (
    <>
      TB lấp đầy <b>{cur.period.label}</b> đạt <b style={{ color: fillColor(cur.avg) }}>{pct(cur.avg)}</b>
      {deltaPts != null ? (
        <> ({deltaPts >= 0 ? "tăng" : "giảm"} <b style={{ color: deltaPts >= 0 ? "var(--green)" : "var(--red)" }}>{Math.abs(deltaPts)} điểm %</b> so kỳ trước)</>
      ) : " (chưa đủ dữ liệu kỳ trước để so sánh)"}.
      {" "}<b style={{ color: "var(--green)" }}>{increaseRows.length} tuyến tăng</b>, <b style={{ color: "var(--red)" }}>{declineRows.length} tuyến giảm</b>
      {declineRows[0] ? <> (mạnh nhất <b>{declineRows[0].code}</b> {declineRows[0].deltaPts}đ)</> : null}.
      {" "}{topLow.length > 0 || topOver.length > 0 ? (
        <>Toàn cụm còn <b style={{ color: "var(--red)" }}>{topLow.length} tuyến &lt;60%</b> cần ghép tải và <b style={{ color: "var(--orange)" }}>{topOver.length} tuyến vượt tải &gt;100%</b> cần thêm xe.</>
      ) : "Không có tuyến nào quá thấp hoặc vượt tải nghiêm trọng."}
      {worstHub && worstHub.deltaPts != null && worstHub.deltaPts < -3 ? <> Hub <b>{worstHub.hub}</b> giảm nhiều nhất ({worstHub.deltaPts}đ), nên rà trước.</> : null}
    </>
  );

  return (
    <div className="section-card tlld-cum">
      <div className="tlld-cum-head">
        <div>
          <div className="pe-sech" style={{ marginBottom: 2 }}>🌐 Tổng TLLD của Cụm</div>
          <p className="pe-sub" style={{ margin: 0 }}>
            Phạm vi <b>Cụm M12</b> (HCM20 · Sóng Thần · Tân Tạo) · dữ liệu từ <b>{ddmmyyyy(index.allDates[0])}</b> đến <b>{ddmmyyyy(index.allDates[index.allDates.length - 1])}</b>.
          </p>
        </div>
        <div className="xtc-seg">
          {(["thang", "tuan", "ngay"] as Granularity[]).map((g) => (
            <button key={g} className={gran === g ? "on" : ""} onClick={() => changeGran(g)}>{GRAN_LABEL[g]}</button>
          ))}
        </div>
      </div>

      {periodStats.length > 0 && (
        <div className="period-nav" style={{ marginTop: 8 }}>
          <button className="pn-arrow" disabled={curIdx <= 0} onClick={() => stepPeriod(-1)} title="Kỳ trước">‹</button>
          <div className="pn-current">
            <span className="pn-ic">📅</span>
            <span className="pn-text">{cur?.period.label}{cur?.period.running ? " (đang chạy)" : ""}</span>
            <span className="pn-caret">▾</span>
            <select value={cur?.period.key ?? ""} onChange={(e) => setSelKey(e.target.value)}>
              {[...periodStats].reverse().map((s) => (
                <option key={s.period.key} value={s.period.key}>{s.period.label}{s.period.running ? " (đang chạy)" : ""}</option>
              ))}
            </select>
          </div>
          <button className="pn-arrow" disabled={curIdx >= lastIdx} onClick={() => stepPeriod(1)} title="Kỳ sau">›</button>
        </div>
      )}

      <p className="pe-sub" style={{ margin: "6px 0 0", fontSize: 13 }}>
        <b>TLLD</b> = tỷ lệ lấp đầy xe theo khối lượng hàng thật so với tải trọng xe (100% = xe chở vừa
        đủ tải). <b>Ghép tải</b> = gộp 2+ tuyến ít hàng thành 1 chuyến để đỡ chạy xe rỗng.
      </p>


      {/* BANNER TỔNG QUAN — 4 câu trả lời ngay, đọc là hiểu, không cần đọc hết bảng/chart bên dưới. */}
      <div className="pv-banner" style={{ borderColor: fillColor(cur.avg), marginTop: 12 }}>
        <div className="pv-b-cell">
          <span className="pv-b-lb">📊 {cur.period.label} thế nào?</span>
          <span className="pv-b-val">
            TB lấp đầy <b style={{ color: fillColor(cur.avg) }}>{pct(cur.avg)}</b> trên <b>{cur.nRoutes}</b> tuyến.
          </span>
        </div>
        <div className="pv-b-cell">
          <span className="pv-b-lb">📈 So kỳ trước?</span>
          <span className="pv-b-val">
            {deltaPts != null ? (
              <>{deltaPts >= 0 ? "Tăng" : "Giảm"} <b style={{ color: deltaPts >= 0 ? "var(--green)" : "var(--red)" }}>{Math.abs(deltaPts)} điểm %</b></>
            ) : "Chưa đủ dữ liệu để so"}
          </span>
        </div>
        <div className="pv-b-cell">
          <span className="pv-b-lb">⚠️ Cần chú ý gì?</span>
          <span className="pv-b-val">
            {topLow.length > 0 || topOver.length > 0 ? (
              <><b style={{ color: "var(--red)" }}>{topLow.length} tuyến &lt;60%</b>, <b style={{ color: "var(--orange)" }}>{topOver.length} tuyến &gt;100%</b></>
            ) : "Không có tuyến bất thường"}
            {worstHub && worstHub.deltaPts != null && worstHub.deltaPts < -3 ? <> · hub <b>{worstHub.hub}</b> giảm nhiều nhất</> : null}
          </span>
        </div>
        <div className="pv-b-cell">
          <span className="pv-b-lb">🔧 Nên làm gì?</span>
          <span className="pv-b-val">
            {topLow.length > 0 ? "Ghép tải tuyến <60%" : topOver.length > 0 ? "Bổ sung xe tuyến >100%" : "Giữ nguyên, theo dõi tiếp"}
          </span>
        </div>
      </div>

      <div className="pe-comment" style={{ marginTop: 12 }}>🤖 <b>Nhận định tổng quan:</b> {overviewNote}</div>

      {isPartial && (
        <div className="pe-comment" style={{ borderLeftColor: "var(--orange)", marginTop: 12 }}>
          ⚠️ Kỳ <b>{cur.period.label}</b> mới có <b>{curCoverage}/{curExpectedLen} ngày</b> dữ liệu (đang chạy dở) — mọi so sánh bên dưới đã tự động cắt kỳ trước về ĐÚNG {curCoverage} ngày đầu tương ứng để công bằng, nhưng số vẫn chỉ mang tính SƠ BỘ, chưa nên kết luận chắc chắn.
        </div>
      )}

      <div className="kpi-row" style={{ marginTop: 12 }}>
        <div className="kpi">
          <div className="lbl">TB lấp đầy {GRAN_LABEL[gran].toLowerCase()} này</div>
          <div className="val" style={{ color: fillColor(cur.avg) }}>{pct(cur.avg)}</div>
          <div className="note">{cur.period.label}{cur.period.running && <span className="pe-badge pe-now" style={{ marginLeft: 6, padding: "1px 8px", fontSize: 11.5 }}>đang chạy</span>}</div>
        </div>
        <div className="kpi blue">
          <div className="lbl">So {GRAN_UNIT[gran]}</div>
          <div className="val" style={{ color: deltaPts == null ? "var(--muted)" : deltaPts >= 0 ? "var(--green)" : "var(--red)" }}>
            {deltaPts == null ? "—" : (deltaPts >= 0 ? "+" : "") + deltaPts + "đ"}
          </div>
          <div className="note">{!prevComparable ? "chưa có kỳ trước" : prevComparable.avg == null ? "kỳ trước chưa có ngày cùng vị trí để so" : `${pct(prevComparable.avg)} → ${pct(cur.avg)}${prevComparable.truncated ? ` (${prevComparable.dates.length}n đầu)` : ""}`}</div>
        </div>
        <div className="kpi green">
          <div className="lbl">Tuyến có dữ liệu</div>
          <div className="val">{cur.nRoutes}</div>
          <div className="note">kỳ {cur.period.label}</div>
        </div>
        <div className="kpi ink">
          <div className="lbl">Biến động tuyến so kỳ trước</div>
          <div className="val" style={{ fontSize: 21 }}>
            <span style={{ color: "var(--green)" }}>▲{increaseRows.length}</span>
            {"  "}
            <span style={{ color: "var(--red)" }}>▼{declineRows.length}</span>
          </div>
          <div className="note">
            {declineRows[0] ? `giảm nhiều nhất ${declineRows[0].code} (${declineRows[0].deltaPts}đ)` : "không có tuyến giảm"}
            {routeChanges.newRoutes.length || routeChanges.droppedRoutes.length ? ` · ${routeChanges.newRoutes.length} mới, ${routeChanges.droppedRoutes.length} ngưng chạy` : ""}
          </div>
        </div>
      </div>

      <Reveal className="section-card pe-fc-card" style={{ marginTop: 12 }}>
        <div className="pe-fc-sub">📊 Xu hướng lấp đầy toàn cụm theo {GRAN_LABEL[gran].toLowerCase()}</div>
        <TrendChart stats={shownStats} />
        <div className="pe-comment">
          🤖 {cur.period.running ? <>Kỳ <b>{cur.period.label}</b> đang chạy dở, số liệu sơ bộ. </> : null}
          {deltaPts == null ? "Chưa đủ kỳ liền trước để so sánh." : deltaPts >= 0
            ? <>TB lấp đầy toàn cụm <b style={{ color: "var(--green)" }}>tăng +{deltaPts} điểm %</b> so {GRAN_UNIT[gran]}.</>
            : <>TB lấp đầy toàn cụm <b style={{ color: "var(--red)" }}>giảm {deltaPts} điểm %</b> so {GRAN_UNIT[gran]} — cần rà nguyên nhân (xem tuyến giảm bên dưới).</>}
        </div>
      </Reveal>

      <Reveal className="section-card pe-fc-card" style={{ marginTop: 12 }}>
        <div className="pe-fc-sub">🔗 Tương quan với lượng hàng thực tế <span className="fc-src">· chỉ số (kỳ đầu hiển thị = 100)</span></div>
        <IndexChart stats={shownStats} />
        <div className="fc-legend2">
          <span><i style={{ background: "var(--chart-1)" }} />TLLD lấp đầy (nhãn % thật)</span>
          <span><i style={{ background: "var(--chart-2)" }} />Lượng hàng thực tế (nhãn kg thật)</span>
        </div>
        <p className="pe-sub" style={{ margin: "4px 0 0", fontSize: 13 }}>
          2 đường được quy về CHỈ SỐ (kỳ đầu tiên hiển thị = 100) để so sánh HÌNH DẠNG xu hướng dù đơn vị khác nhau (% vs kg) — nhãn số cạnh mỗi điểm là GIÁ TRỊ THẬT, không phải chỉ số. Đường đi CÙNG CHIỀU (cùng lên/xuống) = lượng hàng ảnh hưởng nhiều tới TLLD; đi NGƯỢC CHIỀU = TLLD đang bị chi phối bởi yếu tố khác (điều xe, ghép tải…).
        </p>
        <Collapsible title="📋 Xem số liệu thật từng kỳ" sub={`${shownStats.length} kỳ`}>
          <IndexTable stats={shownStats} />
        </Collapsible>
        <div className="pe-comment">
          🤖 {corrNote
            ? <>TLLD đổi <b>cùng chiều</b> với lượng hàng thực tế <b>{corrNote.same}/{corrNote.total}</b> lần đổi kỳ ({corrNote.pc}%) trong lịch sử đang xem — {corrNote.pc >= 65 ? "khá nhất quán, lượng hàng là yếu tố chính chi phối TLLD." : corrNote.pc <= 35 ? "phần lớn NGƯỢC chiều — TLLD có thể đang chịu ảnh hưởng bởi yếu tố khác (điều xe, ghép tải) hơn là lượng hàng." : "không rõ xu hướng, cần thêm dữ liệu để kết luận."}</>
            : "Chưa đủ dữ liệu 2 chiều (TLLD + lượng hàng thật) để tính tương quan."}
          {" "}⚠️ Lượng hàng ở đây CHỈ tính 2/4 hub có Forecast (HCM20 + Sóng Thần) — chưa đại diện toàn cụm 4 hub như phần TLLD.
        </div>
      </Reveal>

      {hubStats.length > 0 && (
        <Reveal className="section-card pe-fc-card" style={{ marginTop: 12 }}>
          <div className="pe-fc-sub">🏭 Phân bố theo Hub nguồn <span className="fc-src">· kỳ {cur.period.label} ({curCoverage}/{curExpectedLen} ngày đã có dữ liệu)</span></div>
          <p className="pe-sub" style={{ margin: "0 0 8px", fontSize: 13 }}>
            "TB lấp đầy" = trung bình TLLD của các tuyến thuộc hub đó CHỈ trong {curCoverage} ngày đã có dữ liệu ở trên (không phải cả kỳ đủ nếu kỳ đang chạy dở) · "Số tuyến" = số tuyến hub đó có dữ liệu trong đúng {curCoverage} ngày này.
          </p>
          <div className="tc-wrap">
            <table className="tc-grid">
              <thead><tr><th>Hub</th><th style={{ width: 90 }}>TB lấp đầy</th><th style={{ width: 100 }}>So kỳ trước</th><th style={{ width: 90 }}>Số tuyến</th></tr></thead>
              <tbody>
                {hubStats.map((h) => (
                  <tr key={h.hub}>
                    <td style={{ fontWeight: 700 }}>{h.hub}</td>
                    <td className="num" style={{ fontWeight: 800, color: fillColor(h.avg) }}>{pct(h.avg)}</td>
                    <td className="num" style={{ fontWeight: 700, color: h.deltaPts == null ? "var(--muted)" : h.deltaPts >= 0 ? "var(--green)" : "var(--red)" }}>
                      {h.deltaPts == null ? "—" : (h.deltaPts >= 0 ? "+" : "") + h.deltaPts + "đ"}
                    </td>
                    <td className="num">{h.n}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 800 }}>
                  <td>TỔNG (= số kỳ này ở KPI trên)</td>
                  <td className="num" style={{ color: fillColor(cur.avg) }}>{pct(cur.avg)}</td>
                  <td className="num" style={{ color: deltaPts == null ? "var(--muted)" : deltaPts >= 0 ? "var(--green)" : "var(--red)" }}>
                    {deltaPts == null ? "—" : (deltaPts >= 0 ? "+" : "") + deltaPts + "đ"}
                  </td>
                  <td className="num">{cur.nRoutes}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Reveal>
      )}

      <Reveal className="section-card pe-fc-card" style={{ marginTop: 12 }}>
        <div className="pe-fc-sub">📊 Biến động tuyến · {cur.period.label} so {prev?.period.label || "kỳ trước"}{prevComparable?.truncated && prevComparable.dates.length > 0 ? ` (chỉ ${prevComparable.dates.length} ngày đầu để so công bằng)` : ""}</div>
        {!prev ? (
          <div className="sl-empty">Chưa có kỳ trước trong lịch sử để so sánh biến động.</div>
        ) : prevComparable && prevComparable.dates.length === 0 ? (
          <div className="pe-comment" style={{ borderLeftColor: "var(--muted)" }}>
            ℹ️ Chưa so sánh được: kỳ này mới có dữ liệu ở {cur.period.dates.map((d) => `${weekdayOf(d)} ${ddmmyyyy(d)}`).join(", ")}, nhưng kỳ trước (<b>{prev.period.label}</b>) KHÔNG có dữ liệu ở đúng {curCoverage === 1 ? "ngày" : "các ngày"} tương ứng ({curCoverage === 1 ? "có thể ngày đó chưa chốt số liệu trên Sheet" : "chưa chốt số liệu"}) — không phải lỗi hiển thị, chỉ là chưa đủ dữ liệu để so cùng vị trí. Xem góc nhìn <b>Tháng</b> hoặc quay lại khi kỳ này có thêm ngày.
          </div>
        ) : (
          <>
            {criticalDeclines.length > 0 && (
              <div className="pe-comment" style={{ borderLeftColor: "var(--red)", marginBottom: 10 }}>
                🔥 <b>{criticalDeclines.length} tuyến VỪA GIẢM VỪA đang &lt;60%</b> (nghiêm trọng nhất, ưu tiên xử lý trước): {criticalDeclines.slice(0, 8).map((r) => `${r.code} (${pct(r.prev)}→${pct(r.cur)})`).join(", ")}{criticalDeclines.length > 8 ? "…" : ""}.
              </div>
            )}
            <div className="pe-fc-grid" style={{ marginTop: 8 }}>
              <div>
                <div className="tlld-cum-subh" style={{ color: "var(--green)" }}>📈 Top TĂNG mạnh nhất <span className="fc-src">· {increaseRows.length} tuyến</span></div>
                {increaseRows.length === 0 ? <div className="sl-empty">Không có tuyến nào tăng.</div> : (
                  <Collapsible title="📋 Danh sách tuyến tăng" sub={`${increaseRows.length} tuyến`} defaultOpen={increaseRows.length <= 8}>
                    <div className="tc-wrap scroll-frame">
                      <table className="tc-grid">
                        <thead><tr><th style={{ width: 26 }}>#</th><th>Mã tuyến</th><th style={{ width: 70 }}>Hub</th><th style={{ width: 70 }}>Trước</th><th style={{ width: 70 }}>Này</th><th style={{ width: 60 }}>Δđ</th></tr></thead>
                        <tbody>
                          {increaseRows.map((r, i) => (
                            <tr key={r.code}>
                              <td className="num" style={{ color: "var(--muted)" }}>{i + 1}</td>
                              <td style={{ fontWeight: 700 }}>{r.code}</td>
                              <td>{r.hub}</td>
                              <td className="num">{pct(r.prev)}</td>
                              <td className="num" style={{ fontWeight: 700, color: fillColor(r.cur) }}>{pct(r.cur)}</td>
                              <td className="num" style={{ fontWeight: 800, color: "var(--green)" }}>+{r.deltaPts}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Collapsible>
                )}
              </div>
              <div>
                <div className="tlld-cum-subh" style={{ color: "var(--red)" }}>📉 Top GIẢM mạnh nhất <span className="fc-src">· {declineRows.length} tuyến</span></div>
                {declineRows.length === 0 ? (
                  <div className="sl-empty">Không có tuyến nào giảm.</div>
                ) : (
                  <Collapsible title="📋 Danh sách tuyến giảm" sub={`${declineRows.length} tuyến`} defaultOpen={declineRows.length <= 8}>
                    <div className="tc-wrap scroll-frame">
                      <table className="tc-grid">
                        <thead><tr><th style={{ width: 26 }}>#</th><th>Mã tuyến</th><th style={{ width: 70 }}>Hub</th><th style={{ width: 70 }}>Trước</th><th style={{ width: 70 }}>Này</th><th style={{ width: 60 }}>Δđ</th></tr></thead>
                        <tbody>
                          {declineRows.map((r, i) => (
                            <tr key={r.code}>
                              <td className="num" style={{ color: "var(--muted)" }}>{i + 1}</td>
                              <td style={{ fontWeight: 700 }}>{r.code}</td>
                              <td>{r.hub}</td>
                              <td className="num">{pct(r.prev)}</td>
                              <td className="num" style={{ fontWeight: 700, color: fillColor(r.cur) }}>{pct(r.cur)}</td>
                              <td className="num" style={{ fontWeight: 800, color: "var(--red)" }}>{r.deltaPts}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Collapsible>
                )}
              </div>
            </div>
            {(routeChanges.newRoutes.length > 0 || routeChanges.droppedRoutes.length > 0) && (
              <div className="pe-comment" style={{ borderLeftColor: "var(--blue)", marginTop: 10 }}>
                🚚 <b>{routeChanges.newRoutes.length} tuyến MỚI</b> xuất hiện so {GRAN_UNIT[gran]} (chưa từng chạy kỳ trước): {routeChanges.newRoutes.slice(0, 8).map((x) => `${x.code} (${pct(x.avg)})`).join(", ") || "—"}{routeChanges.newRoutes.length > 8 ? "…" : ""}.{" "}
                <b>{routeChanges.droppedRoutes.length} tuyến NGƯNG chạy</b>: {routeChanges.droppedRoutes.slice(0, 8).map((x) => `${x.code} (từng ${pct(x.avg)})`).join(", ") || "—"}{routeChanges.droppedRoutes.length > 8 ? "…" : ""}.
              </div>
            )}
          </>
        )}
      </Reveal>

      <div className="pe-fc-grid" style={{ marginTop: 12 }}>
        <Reveal className="section-card pe-fc-card">
          <div className="pe-fc-sub">🔴 Thấp nhất toàn cụm <span className="fc-src">· &lt;60%, nên ghép tải</span></div>
          {topLow.length === 0 ? <div className="sl-empty">Không có tuyến nào &lt;60%.</div> : (
            <div className="tlld-cum-chips">{topLow.map((x) => <span key={x.code} className="low-chip" title={x.hub}>{x.code} <b>{pct(x.avg)}</b></span>)}</div>
          )}
        </Reveal>
        <Reveal className="section-card pe-fc-card">
          <div className="pe-fc-sub">🟠 Quá tải toàn cụm <span className="fc-src">· &gt;100%, cần thêm xe</span></div>
          {topOver.length === 0 ? <div className="sl-empty">Không có tuyến nào vượt tải.</div> : (
            <div className="tlld-cum-chips">{topOver.map((x) => <span key={x.code} className="low-chip" style={{ borderColor: "var(--orange)", color: "var(--orange)" }} title={x.hub}>{x.code} <b>{pct(x.avg)}</b></span>)}</div>
          )}
        </Reveal>
      </div>

      <p className="pe-sub" style={{ margin: "12px 0 0", fontSize: 13 }}>
        Xem thêm hoạt động điều chỉnh/mở mới/huỷ tuyến kỳ này ở mục <b>🔧 Báo cáo Điều chỉnh</b> bên
        dưới — 1 nguyên nhân khả dĩ khi TLLD tăng/giảm mà lượng hàng không đổi tương ứng.
      </p>

      <DailyAnalysis
        id={`tlld-cum-${gran}`}
        digest={digest}
        title="🤖 Nhận định Tổng TLLD Cụm từ Trợ lý"
        sub={`Trợ lý tự đọc số liệu tổng cụm theo góc nhìn ${GRAN_LABEL[gran]} lúc 09:00 mỗi ngày → chỉ ra nguyên nhân giảm, tuyến/hub cần chú ý, đề xuất hành động.`}
      />
    </div>
  );
}
