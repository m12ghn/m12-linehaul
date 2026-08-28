import { useEffect, useMemo, useRef, useState } from "react";
import { adminHeaders } from "../lib/useUser";
import { useTlld } from "../lib/useTlld";
import { RichText } from "../components/RichText";
import { usePersistentState, usePersistentLocal } from "../lib/usePersistent";
import { getUser, addressOf } from "../lib/useUser";
import { loadFC, fcAccuracy, type FCRow } from "../lib/fc";
import { startPoll } from "../lib/poll";
import { FleetCharts } from "../components/FleetCharts";
import { TrucCompare } from "../components/TrucCompare";
import { loadFleetMix, type FleetMix, TON_LABEL, TON_ORDER, BASE_FLEET_TOTAL, tonBucket, type TonKey, RESERVE_PICKUP_TRIPS_TOTAL_MIN, RESERVE_PICKUP_TRIPS_TOTAL_MAX } from "../lib/fleetMix";
import { useReply } from "../lib/useReply";
import { isTeach, teachKnowledge } from "../lib/knowledge";
import { computePlan, planDigest, DEFAULT_PARAMS, activeNormalOf } from "../lib/planEngine";
import { computeHistoricalElasticity, buildPeakDaySet } from "../lib/vehicleElasticity";
import { PlanBoard } from "../components/PlanBoard";
import { PlanVerdict } from "../components/PlanVerdict";
import { SurgePlan } from "../components/SurgePlan";
import { DailyActionTable } from "../components/DailyActionTable";
import { CostEstimate } from "../components/CostEstimate";
import { PriceReference } from "../components/PriceReference";
import { SurgeCostTimeline, type SurgeCostPeriodResult } from "../components/SurgeCostTimeline";
import { estimateCost, surgeCostOf, DEFAULT_COST_RATES, type CostRates } from "../lib/costEstimate";
import { Glossary } from "../components/Glossary";
import { ColorLegend } from "../components/ColorLegend";
import { Reveal } from "../components/Reveal";
import { Collapsible } from "../components/Collapsible";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { TcEventEval } from "../components/TcEventEval";
import { TcTlldEval } from "../components/TcTlldEval";
import { TcEventHistoryReport } from "../components/TcEventHistoryReport";
import { loadTcEvent, tcEventStats, dailyBreakdown, type TcEvData } from "../lib/tcEvent";
import { loadXinTc, type XtcData } from "../lib/xinTangCuong";
import { loadTcTlld, tcTlldStats, type TcTlldData } from "../lib/tcTlld";
import { loadDataHang, type DataHangData } from "../lib/dataHang";

const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");
const dm = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
const fmtTime = (at: number) => (at ? new Date(at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "");

/** Chữ ký nội dung bỏ qua field "lastSync" (field này luôn đổi mỗi lần poll THÀNH CÔNG, dù dữ
 *  liệu thật không đổi gì) — dùng để (1) tránh setState/re-render khi dữ liệu THẬT không đổi và
 *  (2) phát hiện đúng lúc dữ liệu THẬT vừa được cập nhật, không nhầm với "vừa poll xong". */
const sigNoSync = (o: unknown) => (o ? JSON.stringify(o, (k, v) => (k === "lastSync" ? undefined : v)) : "");

interface EventPeriod { key: string; label: string; mm: number; start: Date; end: Date; status: "past" | "now" | "next"; }

function buildEvents(now: Date): EventPeriod[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const evs: EventPeriod[] = [];
  for (let off = -1; off <= 2; off++) {
    const base = new Date(now.getFullYear(), now.getMonth() + off, 1);
    const y = base.getFullYear(), m = base.getMonth(), mm = m + 1;
    const dim = new Date(y, m + 1, 0).getDate();
    const mk = (day: number, label: string) => {
      if (day > dim) return null;
      const start = new Date(y, m, day);
      const end = new Date(y, m, Math.min(day + 5, dim));
      const status: EventPeriod["status"] = today > end ? "past" : today >= start ? "now" : "next";
      return { key: `${y}-${mm}-${day}`, label, mm, start, end, status };
    };
    [mk(mm, `Ngày đôi ${mm}/${mm}`), mk(15, `Giữa tháng 15/${mm}`), mk(25, `Cuối tháng 25/${mm}`)]
      .forEach((e) => { if (e) evs.push(e); });
  }
  return evs.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Loại kỳ (bỏ số ngày/tháng) — "Ngày đôi 7/7" -> "Ngày đôi", để gộp đối chiếu độ chính xác theo loại. */
const eventType = (label: string) => label.replace(/\s*\d.*$/, "").trim();

/** Nhãn "EVENT" kiểu sheet "Lưu trữ TC Event" (vd "7/7", "15/6" — d/m KHÔNG số 0 đầu) để khớp cột EVENT. */
const eventLabelOf = (period: EventPeriod) => `${period.start.getDate()}/${period.start.getMonth() + 1}`;

/** NGÀY THẬT SỰ cần tăng cường trong 1 kỳ — RÀ LẠI 2026-07-21 (Sếp xác nhận, áp dụng CHUNG mọi kỳ
 *  "Ngày đôi"): kỳ "Ngày đôi" KHÔNG chạy liên tục cả cửa sổ [start,end] (cửa sổ này VẪN giữ rộng 6
 *  ngày cho baseline/ngữ cảnh Forecast) — chỉ THẬT SỰ cần tăng cường đúng 2 ngày: ngày gốc (D) và
 *  D+2 (vd "Ngày đôi 8/8" -> chỉ 8/8 và 10/8, BỎ QUA 9/8). "Giữa tháng"/"Cuối tháng" CHƯA có xác
 *  nhận tương tự -> giữ nguyên "mọi ngày trong [start,end] đều active" như trước, không suy đoán.
 *  Dùng để lọc NGÀY TÍNH — xe cần/chi phí/đánh giá sau event — KHÔNG áp cho dữ liệu ĐÃ LƯU TRỮ
 *  (tcEvent.ts) vì đó là ngày THẬT đã ghi nhận, tự nó đã đúng, không cần suy qua quy tắc này. */
function activeDaysOf(period: EventPeriod): number[] {
  if (eventType(period.label) === "Ngày đôi") {
    const d2 = new Date(period.start); d2.setDate(d2.getDate() + 2);
    const out = [period.start.getTime()];
    if (d2.getTime() <= period.end.getTime()) out.push(d2.getTime());
    return out;
  }
  const out: number[] = [];
  const d = new Date(period.start);
  while (d.getTime() <= period.end.getTime()) { out.push(d.getTime()); d.setDate(d.getDate() + 1); }
  return out;
}
function isActiveDay(period: EventPeriod, ms: number): boolean {
  return activeDaysOf(period).includes(ms);
}

/** CẢ CỬA SỔ kỳ event [start,end] (không lọc theo ngày THẬT active) — RÀ LẠI 2026-07-21 (v2, Sếp
 *  phản hồi ngay sau khi áp isActiveDay() ở mọi nơi): "Chi tiết Forecast" + biểu đồ/heatmap/bảng
 *  hành động theo ngày cần hiện ĐỦ các ngày trong tuần event (kể cả ngày "Ngày đôi" không thật sự
 *  tăng cường, vd 9/8) để có NGỮ CẢNH cả tuần — không phải chỉ 2 điểm dữ liệu rời rạc. `isActiveDay()`
 *  VẪN giữ nguyên, dùng RIÊNG cho phần THẬT SỰ cần tách theo ngày tăng cường thật (chi phí NCC đã
 *  book — `surgeCostTimeline`, và tương quan Khối lượng hàng ↔ Xin tăng cường — `weightXtcCorr`, 2 nơi
 *  đó số liệu gắn trực tiếp với NGÀY BOOK/NGÀY NỘP thật nên không thể "làm rộng" theo tuần được). Các
 *  nơi khác dùng Forecast/thực tế theo NGÀY (fc/fcForPeriod/actualForPeriod/review) đổi sang dùng hàm
 *  này — vì Forecast vốn đã phản ánh đúng nhu cầu THẬT từng ngày (ngày không có sale sẽ tự thấp), hiện
 *  đủ cả tuần không làm sai peakNeeded/peakExtra (vẫn là ngày cao nhất, thường trùng đúng ngày active).
 */
function inPeriodWindow(period: EventPeriod, ms: number): boolean {
  return ms >= period.start.getTime() && ms <= period.end.getTime();
}

/** Bản RÚT GỌN của cách "fc" (useMemo chính) dựng cửa sổ DỰ BÁO — nhận PERIOD BẤT KỲ (không chỉ kỳ
 *  đang chọn) để tính lại plan dự báo cho MỌI kỳ đã qua (đối chiếu độ chính xác theo loại kỳ). */
function fcForPeriod(period: EventPeriod, fcH: FCRow[], fcS: FCRow[]) {
  const s = period.start.getTime(), preS = s - 7 * 864e5;
  const dt = (d: string) => new Date(d + "T00:00:00").getTime();
  const avg = (arr: (number | null)[]) => { const v = arr.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const buildKho = (rows: FCRow[]) => {
    const win = rows.filter((r) => inPeriodWindow(period, dt(r.date)));
    const days = win.map((r) => ({ date: r.date, vol: r.fcVol ?? r.actVol ?? null, weight: r.fcW ?? r.actW ?? null }));
    const pre = rows.filter((r) => { const t = dt(r.date); return t >= preS && t < s; });
    // Baseline ưu tiên THỰC TẾ hơn dự báo — GIỐNG hệt fix ở "fc" useMemo chính (xem comment ở đó).
    return { days, baseW: avg(pre.map((r) => r.actW ?? r.fcW)) };
  };
  const hcm = buildKho(fcH), st = buildKho(fcS);
  if (!hcm.days.length && !st.days.length) return null;
  return { hcm, st };
}

/** Bản RÚT GỌN của phần "fcActual" trong review (useMemo chính) — nhận PERIOD BẤT KỲ, trả cửa sổ
 *  SỐ THỰC TẾ để tính lại "xe thực cần" cho kỳ đó (null nếu kỳ chưa có ngày nào có số thực tế). */
function actualForPeriod(period: EventPeriod, fcH: FCRow[], fcS: FCRow[]) {
  const s = period.start.getTime(), preS = s - 7 * 864e5;
  const dt = (d: string) => new Date(d + "T00:00:00").getTime();
  const mean = (arr: (number | null)[]) => { const v = arr.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const buildKho = (rows: FCRow[]) => {
    const win = rows.filter((r) => inPeriodWindow(period, dt(r.date)));
    const withAct = win.filter((r) => r.actVol != null || r.actW != null);
    const pre = rows.filter((r) => { const t = dt(r.date); return t >= preS && t < s; });
    return { withAct, baseActW: mean(pre.map((r) => r.actW ?? r.fcW)) };
  };
  const hcm = buildKho(fcH), st = buildKho(fcS);
  if (hcm.withAct.length + st.withAct.length === 0) return null;
  return {
    hcm: { days: hcm.withAct.map((d) => ({ date: d.date, vol: d.actVol, weight: d.actW })), baseW: hcm.baseActW },
    st: { days: st.withAct.map((d) => ({ date: d.date, vol: d.actVol, weight: d.actW })), baseW: st.baseActW },
  };
}
const STATUS_TXT: Record<EventPeriod["status"], string> = { past: "đã qua", now: "đang diễn ra", next: "sắp tới" };
const STATUS_IC: Record<EventPeriod["status"], string> = { past: "✓", now: "🔴", next: "⏳" };


interface Msg { role: "user" | "assistant"; content: string; quote?: string }

const fmtVN = (v: number) => Math.round(v).toLocaleString("vi-VN");
const shortNum = (v: number) => { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : a >= 1e3 ? Math.round(v / 1e3) + "K" : String(Math.round(v)); };
const avgOf = (arr: (number | null)[]) => { const v = arr.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
// Màu/nhãn cho sai số dự báo (MAPE): <8% rất sát (xanh), 8–15% chấp nhận (cam), >15% lệch nhiều (đỏ).
const mapeColor = (m: number | null) => (m == null ? "var(--muted)" : m < 0.08 ? "var(--green)" : m <= 0.15 ? "var(--orange)" : "var(--red)");
const mapeTxt = (m: number | null) => (m == null ? "—" : Math.round(m * 100) + "%");
const deltaTxt = (act: number, fc: number) => (fc > 0 ? (act / fc - 1 >= 0 ? "+" : "") + Math.round((act / fc - 1) * 100) + "%" : "—");

/** Biểu đồ cột NHÓM — so sánh 2 series theo ngày; hiện 2 ngày (T7/T6) + % chênh lệch mỗi cặp. */
function FcCompareChart({ days, series, unit }: {
  days: { label: string; sub?: string }[];
  series: { name: string; color: string; vals: (number | null)[] }[];
  unit: string;
}) {
  const W = 500, H = 196, padL = 14, padR = 14, padT = 26, padB = 44; // rộng hết bề ngang + chừa chỗ 2 ngày & %
  const cw = W - padL - padR, ch = H - padT - padB;
  const all = series.flatMap((s) => s.vals).filter((v): v is number => v != null);
  const yMax = Math.max(1, ...all) * 1.24;
  const n = days.length || 1, slot = cw / n;
  const groupW = Math.min(slot * 0.92, 120), bw = groupW / Math.max(1, series.length);
  const yOf = (v: number) => padT + ch - (v / yMax) * ch;
  return (
    <svg className="sl-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 210 }}>
      {[0, 0.5, 1].map((f, i) => <line key={i} x1={padL} y1={yOf(f * yMax)} x2={W - padR} y2={yOf(f * yMax)} stroke="#eef1f5" />)}
      {days.map((d, i) => {
        const gx = padL + i * slot + (slot - groupW) / 2;
        const a = series[0]?.vals[i], b = series[1]?.vals[i];
        const pc = a != null && b ? Math.round((a / b - 1) * 100) : null; // % series0 so series1
        return (
          <g key={i}>
            {series.map((sr, si) => {
              const v = sr.vals[i] || 0, x = gx + si * bw, y = yOf(v), h = padT + ch - y;
              return (
                <g key={si}>
                  <rect x={x + 1} y={y} width={Math.max(1, bw - 2)} height={Math.max(0, h)} rx={2} fill={sr.color} className="fx-rise" style={{ animationDelay: `${i * 0.05 + si * 0.03}s` }}>
                    <title>{`${sr.name} · ${si === 0 ? d.label : d.sub || ""}: ${fmtVN(v)} ${unit}`}</title>
                  </rect>
                  <text x={x + bw / 2} y={y - 3} textAnchor="middle" className="fc-gv">{shortNum(v)}</text>
                </g>
              );
            })}
            {pc != null && <text x={gx + groupW / 2} y={13} textAnchor="middle" className="fc-pct" style={{ fill: pc >= 0 ? "#1faa59" : "#e23b3b" }}>{pc >= 0 ? "+" : ""}{pc}%</text>}
            <text x={gx + groupW / 2} y={H - padB + 12} textAnchor="middle" className="fc-xlb-a" style={{ fontSize: 10.5, fontWeight: 700, fill: series[0]?.color || "#44515f" }}>{d.label}</text>
            {d.sub && <text x={gx + groupW / 2} y={H - padB + 23} textAnchor="middle" className="fc-xlb-b" style={{ fontSize: 9.5, fontWeight: 600, fill: series[1]?.color || "#8a97a4" }}>{d.sub}</text>}
          </g>
        );
      })}
      <line x1={padL} y1={padT + ch} x2={W - padR} y2={padT + ch} stroke="#cdd6e0" />
    </svg>
  );
}
function FcLegend({ series }: { series: { name: string; color: string }[] }) {
  return <div className="fc-legend2">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>;
}

/** Nhận xét AI (rule-based) cho 1 biểu đồ so sánh 2 series: tổng quát + chi tiết ngắn gọn.
 *  Mẫu ít ngày (<3) -> hạ giọng chắc chắn thay vì kết luận dứt khoát; ngày có baseline (b)
 *  QUÁ NHỎ so TB bị loại khỏi tìm "lệch mạnh nhất" (mẫu số nhỏ dễ tạo % biến dạng ảo). */
function compareComment(aName: string, a: (number | null)[], bName: string, b: (number | null)[], unit: string, labels: string[]): string {
  const pairedN = a.filter((v, i) => v != null && b[i] != null).length;
  const avgA = avgOf(a), avgB = avgOf(b);
  if (avgA == null) return "Chưa đủ dữ liệu để nhận xét.";
  const dp = avgB ? Math.round((avgA / avgB - 1) * 100) : null;
  // ngày lệch mạnh nhất (a so b) — bỏ ngày có baseline < 15% TB (mẫu số nhỏ, % dễ biến dạng).
  const minBase = avgB ? avgB * 0.15 : 0;
  let pkI = -1, pkV = 0;
  a.forEach((v, i) => { if (v != null && b[i] && (b[i] as number) >= minBase) { const r = v / (b[i] as number) - 1; if (Math.abs(r) > Math.abs(pkV)) { pkV = r; pkI = i; } } });
  const tq = dp == null ? `TB <b>${fmtVN(avgA)}</b> ${unit}/ngày.`
    : dp >= 8 ? `${aName} cao hơn ${bName} <b>+${dp}%</b> ⬆️ (TB ${fmtVN(avgA)} vs ${fmtVN(avgB as number)} ${unit}/ngày).`
    : dp <= -8 ? `${aName} thấp hơn ${bName} <b>${dp}%</b> ⬇️ (TB ${fmtVN(avgA)} vs ${fmtVN(avgB as number)} ${unit}/ngày).`
    : `${aName} ~ ${bName}, chênh nhẹ (${dp >= 0 ? "+" : ""}${dp}%).`;
  const ct = pkI >= 0 ? ` Lệch mạnh nhất ngày <b>${labels[pkI]}</b> (${pkV >= 0 ? "+" : ""}${Math.round(pkV * 100)}%).` : "";
  const note = pairedN > 0 && pairedN < 3 ? ` <i>(mới ${pairedN} ngày đối chiếu — số liệu sơ bộ, chưa đủ để chắc chắn.)</i>` : "";
  return `<b>🤖 Nhận xét:</b> ${tq}${ct}${note}`;
}

interface KhoFC { days: { date: string; thu: string; vol: number | null; weight: number | null }[]; baseVol: number | null; baseW: number | null }

/** Nhận xét tự động (rule-based) cho 1 kho. */
function fcComment(k: KhoFC): string {
  if (!k.days.length) return "Chưa có forecast cho kho này trong kỳ.";
  const evVol = avgOf(k.days.map((d) => d.vol)) || 0;
  const evW = avgOf(k.days.map((d) => d.weight)) || 0;
  const dv = k.baseVol ? Math.round((evVol / k.baseVol - 1) * 100) : null;
  const dw = k.baseW ? Math.round((evW / k.baseW - 1) * 100) : null;
  const peak = k.days.reduce((m: typeof k.days[0] | null, x) => ((x.vol || 0) > (m?.vol || -1) ? x : m), null);
  const pd = peak && k.baseVol ? Math.round(((peak.vol || 0) / k.baseVol - 1) * 100) : null;
  const trend = (d: number | null) => (d == null ? "" : d >= 15 ? `cao hơn ngày thường <b>+${d}%</b> ⚠️` : d >= 0 ? `nhỉnh hơn ngày thường +${d}%` : `thấp hơn ngày thường ${d}%`);
  return `Sản lượng kỳ event TB ~<b>${fmtVN(evVol)}</b> đơn/ngày, ${trend(dv)}. Đỉnh ngày <b>${peak ? peak.date.slice(8) + "/" + peak.date.slice(5, 7) : "—"}</b> ~${fmtVN(peak?.vol || 0)} đơn${pd != null ? ` (+${pd}%)` : ""}. Khối lượng ~${fmtVN(evW)} kg/ngày${dw != null ? ` (${dw >= 0 ? "+" : ""}${dw}%)` : ""}. ${dv != null && dv >= 15 ? "→ Cần bố trí tăng cường xe những ngày đỉnh." : "→ Tải tăng nhẹ, đội xe nền cơ bản đáp ứng."}`;
}

/** Tiến trình soạn kế hoạch đang chạy — giữ ở cấp module để KHÔNG bị huỷ
 *  khi chuyển sang menu khác rồi quay lại (component unmount/mount). */
const genInflight = new Map<string, Promise<{ text: string; at: number; by: string }>>();

export function PlanEvent({ view, onRequestKeHoach }: { view: "ke-hoach" | "chi-tiet"; onRequestKeHoach?: () => void }) {
  const { index } = useTlld();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ text: string; at: number; by: string } | null>(null);
  const [loadingRep, setLoadingRep] = useState(true);
  const [genErr, setGenErr] = useState<string | null>(null); // lỗi soạn AI — hiện TẠI CHỖ, không chặn màn hình
  // Đánh giá SAU event (post-mortem) — báo cáo riêng, lưu theo reviewKey.
  const [savedRev, setSavedRev] = useState<{ text: string; at: number; by: string } | null>(null);
  const [busyRev, setBusyRev] = useState(false);
  const [loadingRev, setLoadingRev] = useState(true);
  const [genRevErr, setGenRevErr] = useState<string | null>(null);

  const events = useMemo(() => buildEvents(new Date()), []);
  // Mặc định nhảy tới kỳ NGÀY ĐÔI sắp tới (event lớn cần lập kế hoạch) — vd 7/7.
  const defaultKey = useMemo(() => (
    events.find((e) => /Ngày đôi/.test(e.label) && e.status !== "past")
    || events.find((e) => e.status === "next")
    || events.find((e) => e.status === "now")
    || events[events.length - 1]
  )?.key, [events]);
  const [sel, setSel] = useState<string>("");
  const selected = events.find((e) => e.key === (sel || defaultKey)) || events[0];
  const reportKey = "eventplan-" + (selected?.key || "x");
  const reviewKey = "eventreview-" + (selected?.key || "x");

  // Theo dõi kỳ đang xem + trạng thái mount để cập nhật state đúng chỗ.
  const selectedRef = useRef(reportKey);
  selectedRef.current = reportKey;
  const reviewRef = useRef(reviewKey);
  reviewRef.current = reviewKey;
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const [msgs, setMsgs] = usePersistentState<Msg[]>("pe.chat", []);
  const [input, setInput] = usePersistentState<string>("pe.draft", ""); // giữ nội dung đang soạn khi chuyển tab
  const [chatBusy, setChatBusy] = useState(false);
  const { replyTo, setReplyTo, quote } = useReply();
  const msgsEnd = useRef<HTMLDivElement>(null);

  // Forecast volume thật theo ngày × kho (HCM20 + Sóng Thần).
  const [fcH, setFcH] = useState<FCRow[]>([]);
  const [fcS, setFcS] = useState<FCRow[]>([]);
  useEffect(() => {
    let alive = true;
    loadFC("FC HCM20").then((d) => { if (alive) setFcH(d.rows); });
    loadFC("FC ST").then((d) => { if (alive) setFcS(d.rows); });
    return () => { alive = false; };
  }, []);

  // Hiện trạng đội xe (lịch tải + tăng cường) — dùng cho biểu đồ & nạp cho trợ lý.
  const [fleet, setFleet] = useState<FleetMix | null>(null);
  useEffect(() => {
    let alive = true;
    // Bỏ qua setState nếu dữ liệu KHÔNG đổi -> tránh re-render toàn bộ biểu đồ mỗi 60s (đỡ lag).
    // BUG ĐÃ SỬA (2026-07-20): so cả "lastSync" (luôn đổi mỗi lần poll) khiến điều kiện này LUÔN
    // sai (không bao giờ giữ prev) -> optimization vô hiệu từ đầu. Nay so bỏ qua "lastSync".
    const run = () => loadFleetMix().then((d) => { if (alive) setFleet((prev) => sigNoSync(prev) === sigNoSync(d) ? prev : d); }).catch(() => {});
    run();
    const stop = startPoll(run, 60000);
    return () => { alive = false; stop(); };
  }, []);

  // SỐ XE TC THẬT: lịch cố định (lưu trữ TC EVENT) + phát sinh (BC Xin TC) — nạp cho báo cáo AI (không
  // bịa). RÀ LẠI 2026-07-21: dời khối này lên TRƯỚC "fc" useMemo (trước đây nằm dưới, xa hơn nhiều) vì
  // `historicalElasticity`/baseline sạch (bên dưới) cần `tcEv.allRoutes` để loại ngày nhiễm — JS yêu
  // cầu biến `const` phải khai báo TRƯỚC khi dùng trong cùng component.
  const [tcEv, setTcEv] = useState<TcEvData | null>(null);
  const [xinTc, setXinTc] = useState<XtcData | null>(null);
  const [tcTl, setTcTl] = useState<TcTlldData | null>(null);
  const [dataHang, setDataHang] = useState<DataHangData | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => {
      loadTcEvent().then((d) => { if (alive && d.ok) setTcEv(d); }).catch(() => {});
      loadXinTc().then((d) => { if (alive && d.ok) setXinTc(d); }).catch(() => {});
      loadTcTlld().then((d) => { if (alive && d.ok) setTcTl(d); }).catch(() => {});
      loadDataHang().then((d) => { if (alive && d.rows.length) setDataHang(d); }).catch(() => {});
    };
    run();
    const stop = startPoll(run, 60000);
    return () => { alive = false; stop(); };
  }, []);

  // ĐỘ CO GIÃN XE/HÀNG đo từ lịch sử (Phương án 3, xem lib/vehicleElasticity.ts) + ngày "nhiễm" (đang
  // tăng cường ở BẤT KỲ kỳ event nào đã lưu trữ) — dùng để (a) tính elasticity truyền vào computePlan(),
  // (b) loại khỏi cửa sổ baseline "7 ngày trước" bên dưới (tránh baseline dính dư âm kỳ liền trước).
  const peakDaySet = useMemo(() => buildPeakDaySet(tcEv?.allRoutes ?? []), [tcEv]);
  const kgOf = useMemo(() => {
    const hMap = new Map(fcH.map((r) => [r.date, r.actW ?? r.fcW]));
    const sMap = new Map(fcS.map((r) => [r.date, r.actW ?? r.fcW]));
    return (iso: string): number | null => {
      const h = hMap.get(iso), s = sMap.get(iso);
      if (h == null && s == null) return null;
      return (h || 0) + (s || 0);
    };
  }, [fcH, fcS]);
  const historicalElasticity = useMemo(
    () => computeHistoricalElasticity(tcEv?.allRoutes ?? [], activeNormalOf(fleet), kgOf).elasticity,
    [tcEv, fleet, kgOf]
  );

  // Hệ số an toàn (dự phòng) cho bộ máy tính kế hoạch.
  const [safety, setSafety] = usePersistentState<number>("pe.safety", DEFAULT_PARAMS.safety);
  // Tab con của "Đánh giá sau event" — gộp các khối vốn xếp chồng vào 1 chỗ xem tại 1 thời điểm.
  const [revTab, setRevTab] = usePersistentState<"tq" | "xe" | "tlld" | "ls">("pe.revtab", "tq");
  // Đơn vị hiển thị cho "Chi tiết Forecast theo ngày × kho" — Sếp yêu cầu 2026-07-21: thêm lại
  // Khối lượng (kg) dưới dạng CHỌN (không hiện song song cả 2 như bản rất cũ, tránh rối lại).
  const [fcUnit, setFcUnit] = useState<"don" | "kg">("don");

  // Deadline chốt xe — KHÔNG có quy tắc/nguồn dữ liệu nào trong Sheet quy định hạn chốt (chỉ có
  // ngày bắt đầu event), nên đây là Ô SẾP TỰ GÕ TAY, lưu riêng theo TỪNG KỲ (localStorage, sống
  // qua nhiều phiên chứ không chỉ 1 lần xem — theo đúng lựa chọn Sếp đã chọn khi được hỏi).
  const [deadline, setDeadline] = usePersistentLocal<string>(`pe.deadline.${selected?.key || "x"}`, "");
  // Đơn giá tăng cường — suy từ bảng giá NCC thật (Bang_Gia_Tong_Hop_NCC_M12.xlsx, 2026-07-21),
  // Sếp xác nhận riêng mức 8T 50-100km giữ 2.500.000đ. Lưu CHUNG (không theo kỳ, đơn giá NCC không
  // đổi theo từng kỳ event). Backfill field mới (t50/t80near/t80far) cho phiên đã lưu rates CŨ
  // (r19/r8n/r8f, trước 2026-07-21) -> tránh field "undefined" khi đổi tên/thêm field interface.
  const [costRatesRaw, setCostRates] = usePersistentLocal<CostRates>("pe.costRates", DEFAULT_COST_RATES);
  const costRates = useMemo<CostRates>(() => ({ ...DEFAULT_COST_RATES, ...costRatesRaw }), [costRatesRaw]);

  // Cắt FC theo cửa sổ kỳ event + baseline = TB 7 ngày TRƯỚC event (per kho).
  const fc = useMemo(() => {
    if (!selected) return null;
    const s = selected.start.getTime();
    const dt = (d: string) => new Date(d + "T00:00:00").getTime();
    const iso = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const avg = (arr: (number | null)[]) => { const v = arr.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    // Kỳ event THÁNG TRƯỚC cùng loại (vd Ngày đôi 7/7 -> 6/6) để so sánh theo ngày.
    const typePrefix = selected.label.replace(/\s*\d.*$/, "").trim();
    const prevMM = selected.mm === 1 ? 12 : selected.mm - 1;
    const prevStart = events.find((ev) => ev.mm === prevMM && ev.label.startsWith(typePrefix))?.start.getTime() ?? null;
    const buildKho = (rows: FCRow[]) => {
      const byDate = new Map(rows.map((r) => [r.date, r]));
      const past = (r?: FCRow) => (r ? { vol: r.actVol ?? r.fcVol ?? null, weight: r.actW ?? r.fcW ?? null } : { vol: null, weight: null });
      const win = rows.filter((r) => inPeriodWindow(selected, dt(r.date))).sort((a, b) => (a.date < b.date ? -1 : 1));
      const days = win.map((r) => {
        // Ngày T6 tương ứng theo ĐỘ LỆCH NGÀY thật (dt(r.date)-s), KHÔNG theo vị trí mảng (index) —
        // sửa 2026-07-21: "Ngày đôi" giờ có ngày active KHÔNG liên tục (D, D+2, bỏ D+1) nên index
        // trong mảng đã lọc không còn khớp thẳng với độ lệch ngày thật (vd D+2 là phần tử index=1
        // nhưng lệch 2 ngày chứ không phải 1 — index cũ sẽ tính nhầm ngày T6 tương ứng là D+1).
        const t6Date = prevStart != null ? iso(prevStart + (dt(r.date) - s)) : null;
        const normDate = iso(dt(r.date) - 7 * 864e5);                          // cùng thứ, tuần trước
        const t6 = past(t6Date ? byDate.get(t6Date) : undefined);
        const nm = past(byDate.get(normDate));
        return {
          date: r.date, thu: r.thu, vol: r.fcVol ?? r.actVol ?? null, weight: r.fcW ?? r.actW ?? null,
          t6Date, t6Vol: t6.vol, t6W: t6.weight, normDate, normVol: nm.vol, normW: nm.weight,
        };
      });
      // BASELINE (7 ngày TRƯỚC event) LUÔN là ngày ĐÃ QUA — ưu tiên số THỰC TẾ hơn dự báo (ngược
      // với cột "days" ở trên, nơi ngày trong kỳ event có thể CHƯA xảy ra nên phải ưu tiên dự báo).
      // Bug đã sửa (2026-07-19): trước đây ưu tiên fcVol/fcW cho baseline dù ngày đã có số thật —
      // khiến effectiveCap (năng lực/xe) tính sai theo dự báo lệch thay vì theo thực tế đã biết,
      // ví dụ kỳ 7/7: baseline dự báo cao hơn thực tế 13% -> thiếu 15 xe so nhu cầu đỉnh thực tế.
      // BUG THẬT THỨ 2 đã tìm ra (2026-07-21, backtest phương án tính xe cần): cửa sổ "7 ngày liền
      // trước" hay DÍNH DƯ ÂM của kỳ event LIỀN TRƯỚC (các kỳ cách nhau ~10 ngày nên gần như LUÔN
      // dính vài ngày đuôi còn tăng cường) -> baseline bị đẩy SAI (thường cao hơn thật) -> effectiveCap
      // tính sai -> dự báo lệch NGƯỢC (thiếu thay vì dư). Đã sửa: bỏ hẳn "7 ngày liền trước" cứng,
      // dò NGƯỢC tối đa 45 ngày, bỏ qua mọi ngày nằm trong `peakDaySet` (đang tăng cường ở BẤT KỲ kỳ
      // event nào đã lưu trữ, xem vehicleElasticity.ts), lấy ĐỦ 7 ngày SẠCH gần nhất.
      const byDateAll = new Map(rows.map((r) => [r.date, r]));
      const cleanPre: FCRow[] = [];
      { let cursor = iso(s - 864e5), scanned = 0;
        while (cleanPre.length < 7 && scanned < 45) {
          if (!peakDaySet.has(cursor)) { const r = byDateAll.get(cursor); if (r && (r.actW != null || r.fcW != null)) cleanPre.push(r); }
          cursor = iso(dt(cursor) - 864e5); scanned++;
        }
      }
      return { days, baseVol: avg(cleanPre.map((r) => r.actVol ?? r.fcVol)), baseW: avg(cleanPre.map((r) => r.actW ?? r.fcW)) };
    };
    const hcm = buildKho(fcH), st = buildKho(fcS);
    if (!hcm.days.length && !st.days.length) return null;
    const allDates = [...new Set([...hcm.days, ...st.days].map((d) => d.date))].sort();
    const totalVol = [...hcm.days, ...st.days].reduce((a, d) => a + (d.vol || 0), 0);
    const peak = allDates
      .map((dd) => ({ date: dd, total: (hcm.days.find((x) => x.date === dd)?.vol || 0) + (st.days.find((x) => x.date === dd)?.vol || 0) }))
      .reduce((m: { date: string; total: number } | null, x) => (x.total > (m?.total ?? -1) ? x : m), null);
    return { hcm, st, totalVol, peak, accH: fcAccuracy(fcH), accS: fcAccuracy(fcS) };
  }, [selected, fcH, fcS, events, peakDaySet]);

  // ĐỘ CHÍNH XÁC KẾ HOẠCH THEO LOẠI KỲ (Ngày đôi / Giữa tháng / Cuối tháng) — tính lại "plan dự báo"
  // vs "thực cần" cho MỌI kỳ ĐÃ QUA có đủ số thực tế, gộp theo loại kỳ. Dash TỰ phát hiện loại kỳ nào
  // đang bị lệch có hệ thống (không phải nhiễu 1 lần) để cảnh báo tăng hệ số an toàn — không qua AI.
  const typeAccuracy = useMemo(() => {
    const rows: { label: string; type: string; planPeak: number; actualPeak: number; diff: number }[] = [];
    for (const ev of events) {
      if (ev.status !== "past") continue;
      const fcP = fcForPeriod(ev, fcH, fcS);
      const planF = computePlan(fcP, fleet, { safety, elasticity: historicalElasticity });
      const fcA = actualForPeriod(ev, fcH, fcS);
      const planA = fcA ? computePlan(fcA, fleet, { safety, elasticity: historicalElasticity }) : null;
      if (planF && planA) rows.push({ label: ev.label, type: eventType(ev.label), planPeak: planF.peakNeeded, actualPeak: planA.peakNeeded, diff: planA.peakNeeded - planF.peakNeeded });
    }
    const byType = new Map<string, typeof rows>();
    for (const r of rows) { const g = byType.get(r.type) || []; g.push(r); byType.set(r.type, g); }
    return [...byType.entries()].map(([type, rs]) => {
      const avgDiff = rs.reduce((a, r) => a + r.diff, 0) / rs.length;
      const avgDiffPct = Math.round((rs.reduce((a, r) => a + (r.planPeak > 0 ? r.diff / r.planPeak : 0), 0) / rs.length) * 100);
      const allSameSign = rs.every((r) => r.diff > 0) || rs.every((r) => r.diff < 0);
      return { type, rows: rs, avgDiff, avgDiffPct, consistent: rs.length >= 2 && allSameSign };
    });
  }, [events, fcH, fcS, fleet, safety, historicalElasticity]);
  const curType = selected ? eventType(selected.label) : "";
  const curTypeAcc = typeAccuracy.find((t) => t.type === curType);

  const evMM = selected?.mm ?? 0;
  const prevMM = evMM === 1 ? 12 : evMM - 1;
  const dmStr = (iso: string) => iso.slice(8) + "/" + iso.slice(5, 7);

  const data = useMemo(() => {
    if (!index) return null;
    const rows = [...index.byCode.entries()]
      .map(([code, t]) => ({ code, ev: t.eventAvg, base: t.avg30, days: t.eventDays }))
      .filter((r) => r.ev != null && r.base != null && r.base > 0.1 && (r.days || 0) >= 2)
      .map((r) => ({ code: r.code, ev: r.ev as number, base: r.base as number, up: (r.ev as number) / (r.base as number) }));
    const avgUp = rows.length ? rows.reduce((a, r) => a + r.up, 0) / rows.length : null;
    const surge = [...rows].sort((a, b) => b.up - a.up).slice(0, 8);
    return { rows, avgUp, surge };
  }, [index]);

  // ĐÁNH GIÁ SAU EVENT: đối chiếu THỰC TẾ (actVol/actW) vs DỰ BÁO (fcVol/fcW) trong cửa sổ kỳ.
  // Chỉ có nghĩa cho kỳ đã/đang chạy (có số thực tế); kỳ "sắp tới" -> null (chưa đánh giá được).
  const review = useMemo(() => {
    if (!selected || selected.status === "next") return null;
    const s = selected.start.getTime(), preS = s - 7 * 864e5;
    const dt = (d: string) => new Date(d + "T00:00:00").getTime();
    const mean = (arr: (number | null)[]) => { const v = arr.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const sum = (arr: (number | null)[]) => arr.reduce((a: number, x) => a + (x || 0), 0);
    const mapeOf = (rows: { fc: number | null; act: number | null }[]) => {
      const b = rows.filter((r) => r.fc != null && r.act != null && r.fc > 0);
      return b.length ? { mape: b.reduce((a, r) => a + Math.abs((r.act as number) - (r.fc as number)) / (r.fc as number), 0) / b.length, n: b.length } : { mape: null, n: 0 };
    };
    const buildKho = (rows: FCRow[]) => {
      const win = rows.filter((r) => inPeriodWindow(selected, dt(r.date))).sort((a, b) => (a.date < b.date ? -1 : 1));
      const days = win.map((r) => ({ date: r.date, thu: r.thu, fcVol: r.fcVol, actVol: r.actVol, fcW: r.fcW, actW: r.actW }));
      const withAct = days.filter((d) => d.actVol != null || d.actW != null); // ngày đã có số thực tế
      const pre = rows.filter((r) => { const t = dt(r.date); return t >= preS && t < s; });
      return {
        days, withAct,
        baseActW: mean(pre.map((r) => r.actW ?? r.fcW)), // baseline kg ngày thường (ưu tiên thực tế)
        mapeVol: mapeOf(days.map((d) => ({ fc: d.fcVol, act: d.actVol }))),
        mapeW: mapeOf(days.map((d) => ({ fc: d.fcW, act: d.actW }))),
        sumFcVol: sum(days.map((d) => d.fcVol)), sumActVol: sum(withAct.map((d) => d.actVol)),
        sumFcW: sum(days.map((d) => d.fcW)), sumActW: sum(withAct.map((d) => d.actW)),
      };
    };
    const hcm = buildKho(fcH), st = buildKho(fcS);
    const nAct = hcm.withAct.length + st.withAct.length;
    if (nAct === 0) return null; // chưa có số thực tế -> chưa đánh giá
    // Cấu trúc fc dùng số THỰC TẾ để tính lại "xe thực cần" bằng cùng bộ máy computePlan.
    const fcActual = {
      hcm: { days: hcm.withAct.map((d) => ({ date: d.date, vol: d.actVol, weight: d.actW })), baseW: hcm.baseActW },
      st: { days: st.withAct.map((d) => ({ date: d.date, vol: d.actVol, weight: d.actW })), baseW: st.baseActW },
    };
    const allDates = [...new Set([...hcm.withAct, ...st.withAct].map((d) => d.date))].sort();
    const actPeak = allDates
      .map((dd) => ({ date: dd, total: (hcm.withAct.find((x) => x.date === dd)?.actVol || 0) + (st.withAct.find((x) => x.date === dd)?.actVol || 0) }))
      .reduce((m: { date: string; total: number } | null, x) => (x.total > (m?.total ?? -1) ? x : m), null);
    return {
      hcm, st, fcActual, actPeak,
      sumFcVol: hcm.sumFcVol + st.sumFcVol, sumActVol: hcm.sumActVol + st.sumActVol,
      sumFcW: hcm.sumFcW + st.sumFcW, sumActW: hcm.sumActW + st.sumActW,
      complete: nAct >= (hcm.days.length + st.days.length), nAct,
    };
  }, [selected, fcH, fcS]);

  // Mốc "Cập nhật lúc" — SỬA LẠI 2026-07-21 theo đúng ý Sếp: bản trước dò "dữ liệu Sheet vừa đổi
  // THẬT" (so chữ ký nội dung) VẪN tự nhảy liên tục vì Sheet tăng cường/lịch tải đổi suốt ngày khi
  // team vận hành thao tác — không còn ý nghĩa "vừa có ai đó CHỦ Ý cập nhật". Sếp muốn CHỈ 2 mốc:
  // (1) Sếp bấm "Cập nhật nhận định AI" (saved.at), (2) trợ lý (Claude) đưa bản code MỚI lên (deploy)
  // — KHÔNG tính biến động dữ liệu Sheet tự nhiên. __BUILD_ID__ (vite.config.ts) = Date.now() lúc
  // build dạng base36 -> giải mã ngược ra đúng thời điểm deploy, không cần thêm cơ chế nào mới.
  const buildAt = parseInt(__BUILD_ID__, 36) || 0;
  const dataUpdatedAt = Math.max(buildAt, saved?.at ?? 0);

  // FLEET DÙNG ĐỂ TÍNH PLAN: kỳ ĐÃ QUA -> ưu tiên số THẬT đã book CHO ĐÚNG kỳ đó (Lưu trữ TC Event,
  // khớp nhãn EVENT d/m) thay vì số LIVE (phản ánh kỳ KHÁC đang chạy hôm nay, không liên quan). Kỳ
  // đang diễn ra / sắp tới vẫn dùng LIVE — đúng, vì đó chính là số cập nhật của kỳ đang xét.
  // BUG ĐÃ SỬA (2026-07-20, rà lại theo yêu cầu Sếp): trước đây LUÔN dùng fleet LIVE cho MỌI kỳ kể cả
  // đã qua -> xem lại 7/7 (đã kết thúc) vẫn lấy "xe NCC đã book" của HÔM NAY (kỳ 15/7 đang chạy, không
  // liên quan) làm "dư địa" -> PlanVerdict báo "Plan C, chỉ đáp ứng 36%" trong khi Đánh giá sau event
  // (dùng đúng số Lưu trữ TC Event của 7/7) cho thấy thực tế đáp ứng 89% — HAI CON SỐ MÂU THUẪN NHAU
  // ngay trên cùng 1 trang, cùng 1 kỳ, vì lấy nhầm nguồn (live vs lưu trữ đúng kỳ). Không có lưu trữ
  // cho kỳ đang xem (sheet chưa/không còn dữ liệu) -> giữ nguyên fleet LIVE (không suy đoán số).
  const planFleet = useMemo(() => {
    if (!fleet || !selected || selected.status !== "past" || !tcEv?.allRoutes.length) return fleet;
    const label = eventLabelOf(selected);
    const routes = tcEv.allRoutes.filter((r) => r.event === label);
    if (!routes.length) return fleet;
    const ghnRoutes = routes.filter((r) => r.ncc.toUpperCase().trim() === "GHN");
    return { ...fleet, totalNcc: routes.length - ghnRoutes.length, ghnTC: ghnRoutes.length };
  }, [fleet, selected, tcEv]);

  // CHUỖI KỲ cùng loại lùi về trước (vd đang xem "Ngày đôi 8/8" -> chuỗi [6/6, 7/7, 8/8]) — RÀ LẠI
  // 2026-07-21 (v3, theo yêu cầu Sếp "lấy data T6,T7,T8"): tổng quát hoá "prevPeriod" (chỉ 1 kỳ
  // trước) thành 1 CHUỖI nhiều kỳ, đi lùi tới khi hết dữ liệu trong `events` (mảng events chỉ phủ
  // -1..+2 tháng quanh hôm nay nên chuỗi tự dừng đúng lúc, KHÔNG hardcode "3 kỳ"/"T6/T7/T8" cứng —
  // xem đúng bao nhiêu kỳ cùng loại tồn tại trong cửa sổ dữ liệu hiện có).
  const periodChain = useMemo(() => {
    if (!selected) return [];
    const chain: EventPeriod[] = [selected];
    let cur = selected;
    for (let i = 0; i < 6; i++) { // chặn vòng lặp vô hạn, thực tế events chỉ có ~4 tháng nên dừng sớm hơn nhiều
      const typePrefix = eventType(cur.label);
      const prevMM = cur.mm === 1 ? 12 : cur.mm - 1;
      const prev = events.find((ev) => ev.mm === prevMM && ev.label.startsWith(typePrefix));
      if (!prev) break;
      chain.push(prev);
      cur = prev;
    }
    return chain.reverse(); // cũ -> mới, kết thúc bằng `selected`
  }, [selected, events]);
  // Kỳ TRƯỚC cùng loại (vd "Ngày đôi 8/8" -> "Ngày đôi 7/7") — suy từ periodChain, giữ lại cho
  // trucCompare (chỉ cần đúng 1 kỳ trước liền kề, không cần cả chuỗi).
  const prevPeriod = periodChain.length >= 2 ? periodChain[periodChain.length - 2] : null;

  // SO SÁNH BOOK NCC THEO NCC × TẢI TRỌNG: Book kỳ này (LIVE, fleet.ncc) vs Book kỳ trước cùng loại
  // (Lưu trữ TC Event) — tách theo 4 tab Tổng/1.9T/5T/8T. BẢN TRƯỚC có thêm "Dự báo cần tăng"/"Thực
  // tế vs dự báo" suy từ %Δ hàng FC — Sếp phản hồi bỏ hẳn (dù đã ghi rõ giới hạn, vẫn thấy không có
  // cơ sở đủ tin) -> CHỈ giữ so sánh Book THẬT vs Book THẬT (deltaAbs/deltaPct), không suy diễn thêm.
  const trucCompare = useMemo(() => {
    if (!fleet?.ncc.length || !tcEv?.allRoutes.length || !prevPeriod || !selected) return null;
    const prevLabel = eventLabelOf(prevPeriod);
    const norm = (s: string) => (s || "(chưa gán)").trim().toUpperCase().replace(/\s+/g, " ");
    const allPrevRoutes = tcEv.allRoutes.filter((r) => r.event === prevLabel && norm(r.ncc) !== "GHN");
    if (!allPrevRoutes.length) return null; // sheet chưa lưu trữ kỳ trước -> không suy đoán

    const TIERS: { key: "total" | TonKey; label: string }[] = [
      { key: "total", label: "Tổng" },
      { key: "t19", label: TON_LABEL.t19 },
      { key: "t50", label: TON_LABEL.t50 },
      { key: "t80", label: TON_LABEL.t80 },
    ];
    const tabs = TIERS.map(({ key, label }) => {
      const prevRoutes = key === "total" ? allPrevRoutes : allPrevRoutes.filter((r) => tonBucket(r.tai) === key);
      const prevByNcc = new Map<string, number>();
      for (const r of prevRoutes) prevByNcc.set(norm(r.ncc), (prevByNcc.get(norm(r.ncc)) || 0) + 1);
      const curByNcc = new Map<string, number>();
      for (const x of fleet.ncc) {
        const cnt = key === "total" ? x.count : x.layTon[key] + x.giaoTon[key];
        if (cnt > 0) curByNcc.set(norm(x.name), cnt);
      }
      const names = [...new Set([...curByNcc.keys(), ...prevByNcc.keys()])];
      const rows = names.map((name) => {
        const book88 = curByNcc.get(name) || 0;
        const book77 = prevByNcc.get(name) || 0;
        const deltaAbs = book88 - book77; // "So sánh tăng giảm số lượng" đã book
        const deltaPct = book77 > 0 ? Math.round((book88 / book77 - 1) * 100) : null;
        return { name, book88, book77, deltaAbs, deltaPct };
      }).sort((a, b) => b.book88 - a.book88);
      return {
        key, label, rows,
        totalBook88: rows.reduce((a, r) => a + r.book88, 0),
        totalBook77: rows.reduce((a, r) => a + r.book77, 0),
      };
    }).filter((t) => t.totalBook88 > 0 || t.totalBook77 > 0);
    if (!tabs.length) return null;

    return { tabs, curLabel: eventLabelOf(selected), prevLabel };
  }, [fleet, tcEv, prevPeriod, selected]);

  // CHI PHÍ TĂNG CƯỜNG THEO NGÀY, NHIỀU KỲ (T6→T7→T8...) — RÀ LẠI 2026-07-21 (v3, theo yêu cầu
  // Sếp "lấy all data tăng cường T6,T7,T8, chia chi tiết theo từng ngày trong event"):
  // - Kỳ ĐÃ LƯU TRỮ ("Lưu trữ TC Event" có route gắn nhãn kỳ đó): chia theo TỪNG NGÀY THẬT bằng
  //   `dailyBreakdown()` (mỗi route dùng đúng from/to của CHÍNH NÓ, không phải khung ngày giả định
  //   chung — sửa đúng bug Sếp chỉ ra "T7 chỉ chạy 3 ngày 6/7-8/7" chứ không phải 6 ngày như code
  //   cũ từng giả định). Phát sinh (Xin tăng cường) khớp theo NGÀY NỘP thật = từng ngày trong
  //   `dailyBreakdown()`, KHÔNG dùng khung ngày giả định của EventPeriod.start/end nữa.
  // - Kỳ CHƯA LƯU TRỮ nhưng đang chạy/sắp tới (status !== "past"): RÀ LẠI 2026-07-21 (v4, Sếp chỉ ra
  //   bug thật qua dữ liệu sống — xem [[m12-plan-event]]): trước đây cộng dồn MÙ toàn bộ sheet Tăng
  //   Cường LIVE không lọc ngày — sheet này KHÔNG có nhãn kỳ (khác "Lưu trữ TC Event") nên có thể lẫn
  //   route của kỳ KHÁC chưa dọn (thực tế kiểm tra: 172 dòng "Lấy" đều đúng ngày kỳ đang xem, nhưng
  //   106 dòng "Giao" KHÔNG dòng nào chạm ngày kỳ này — có vẻ Giao chưa cập nhật/còn sót kỳ trước) ->
  //   cộng cả 2 sẽ SAI. Nay lọc `fleet.liveRoutes` (đã có from/to THẬT per-route) theo đúng khung
  //   ngày kỳ đang xem (`p.start`/`p.end`) trước, rồi CHIA THEO NGÀY THẬT bằng `dailyBreakdown()`
  //   giống hệt kỳ đã lưu trữ (không còn là 1 dòng tổng mù nữa).
  // - Kỳ ĐÃ QUA nhưng KHÔNG có lưu trữ (hiếm, lỗi thao tác lưu): không suy đoán, ghi "chưa có dữ liệu".
  // RÀ LẠI 2026-07-21 (v5, feedback ảnh chụp): 3 fix theo yêu cầu Sếp —
  // (1) adhocCount CHỈ tính lượt "xin tăng cường" ĐÃ ĐÁP ỨNG (coXe===true) — trước đây đếm TẤT CẢ
  //     kể cả "Không có xe"/hủy, thổi phồng chi phí phát sinh.
  // (2) Thêm `byTon` — breakdown xe CỐ ĐỊNH theo tải trọng CẢ KỲ (dùng route GỐC của kỳ, KHÔNG sum
  //     theo từng ngày — 1 route trải nhiều ngày sẽ bị đếm trùng nếu cộng dồn `d.routes` qua các ngày).
  // (3) Trừ GHN dự phòng (10 xe, ước ~20-30 lượt LẤY HÀNG/kỳ, xem RESERVE_PICKUP_*) khỏi số phát sinh
  //     TRƯỚC KHI tính chi phí thuê NCC — GHN tự đáp ứng phần này KHÔNG phát sinh chi phí thuê ngoài.
  //     Chỉ trừ ở phần TÍNH CHI PHÍ (adhocNetMin/Max), KHÔNG đổi số "đã đáp ứng" thật (adhocFulfilled).
  const surgeCostTimeline = useMemo<SurgeCostPeriodResult[] | null>(() => {
    if (!periodChain.length) return null;
    const norm = (s: string) => (s || "").trim().toUpperCase().replace(/\s+/g, " ");
    const parseDMYMs = (s: string): number | null => {
      const m = (s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (!m) return null;
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return new Date(y, Number(m[2]) - 1, Number(m[1])).getTime();
    };
    const buildFromRoutes = <T extends { tai: string; from: string; to: string }>(
      p: EventPeriod, label: string, routes: T[], kind: "archived" | "live"
    ): SurgeCostPeriodResult | null => {
      const days = dailyBreakdown(routes).filter((d) => isActiveDay(p, new Date(d.dateIso + "T00:00:00").getTime()));
      if (!days.length) return null;
      const periodAdhocRate = surgeCostOf(routes, 0, costRates).adhocRate;
      const activeDates = new Set(days.map((d) => d.dateIso));
      const adhocFulfilled = (xinTc?.recs ?? []).filter((r) => activeDates.has(r.date) && r.coXe === true).length;
      const adhocNetMin = Math.max(0, adhocFulfilled - RESERVE_PICKUP_TRIPS_TOTAL_MAX);
      const adhocNetMax = Math.max(0, adhocFulfilled - RESERVE_PICKUP_TRIPS_TOTAL_MIN);
      // byTon: CỘNG DỒN breakdown từng NGÀY ACTIVE (không phải route gốc cả kỳ) — khớp đúng cách
      // "Tổng kỳ" hiện có bên dưới đã tính (1 route chạy ≥2 ngày active bị tính CHI PHÍ mỗi ngày nó
      // thật sự chạy, giống hợp đồng thuê xe trả theo ngày vận hành — không phải lỗi đếm trùng).
      const dayFixedList = days.map((d) => surgeCostOf(d.routes, 0, costRates));
      const byTon = dayFixedList[0].byTon
        .map((row, i) => ({
          key: row.key, label: row.label, rate: row.rate,
          n: dayFixedList.reduce((a, df) => a + df.byTon[i].n, 0),
          cost: dayFixedList.reduce((a, df) => a + df.byTon[i].cost, 0),
        }))
        .filter((r) => r.n > 0);
      const dayResults = days.map((d, i) => {
        const dayFixed = dayFixedList[i];
        const adhocCount = (xinTc?.recs ?? []).filter((r) => r.date === d.dateIso && r.coXe === true).length;
        const adhocCost = adhocCount * periodAdhocRate;
        return {
          dateIso: d.dateIso, label: d.label,
          fixedCount: dayFixed.fixedTotal, fixedCost: dayFixed.fixedCost,
          adhocCount, adhocCost,
          totalVeh: dayFixed.fixedTotal + adhocCount, totalCost: dayFixed.fixedCost + adhocCost,
        };
      });
      return {
        key: p.key, label, periodLabel: p.label, status: p.status, kind,
        fromIso: days[0].dateIso, toIso: days[days.length - 1].dateIso, days: dayResults,
        totalVeh: dayResults.reduce((a, d) => a + d.totalVeh, 0),
        totalCost: dayResults.reduce((a, d) => a + d.totalCost, 0),
        fixedTotal: dayResults.reduce((a, d) => a + d.fixedCount, 0),
        adhocTotal: dayResults.reduce((a, d) => a + d.adhocCount, 0),
        byTon,
        adhocFulfilled, adhocRate: periodAdhocRate,
        adhocNetMin, adhocNetMax,
        adhocNetCostMin: adhocNetMin * periodAdhocRate, adhocNetCostMax: adhocNetMax * periodAdhocRate,
      };
    };
    const results: SurgeCostPeriodResult[] = periodChain.map((p): SurgeCostPeriodResult => {
      const label = eventLabelOf(p);
      const fixedRoutes = (tcEv?.allRoutes ?? []).filter((r) => r.event === label && norm(r.ncc) !== "GHN");
      if (fixedRoutes.length) {
        const r = buildFromRoutes(p, label, fixedRoutes, "archived");
        if (r) return r;
      }
      if (p.status !== "past" && fleet?.liveRoutes.length) {
        const inWindow = fleet.liveRoutes.filter((r) => {
          const f = parseDMYMs(r.from);
          if (f == null) return false;
          const t = parseDMYMs(r.to) ?? f;
          return f <= p.end.getTime() && t >= p.start.getTime();
        });
        const r = buildFromRoutes(p, label, inWindow, "live");
        if (r) return r;
      }
      return { key: p.key, label, periodLabel: p.label, status: p.status, kind: "none" as const, totalVeh: null, totalCost: null, fixedTotal: null, adhocTotal: null };
    });
    return results.every((r) => r.kind === "none") ? null : results;
  }, [periodChain, tcEv, xinTc, fleet, costRates]);

  // BỘ MÁY TÍNH KẾ HOẠCH: ra số xe cần/đỉnh/thiếu từ FC kg thật + đội xe ĐÚNG KỲ (không bịa).
  const plan = useMemo(() => computePlan(fc, planFleet, { safety, elasticity: historicalElasticity }), [fc, planFleet, safety, historicalElasticity]);
  // Xe THỰC CẦN (tính lại từ khối lượng thực tế) — để so với xe ĐÃ PLAN (từ forecast).
  const planActual = useMemo(() => (review ? computePlan(review.fcActual, planFleet, { safety, elasticity: historicalElasticity }) : null), [review, planFleet, safety, historicalElasticity]);
  // Chi phí ước tính bù xe thiếu ngày đỉnh (plan.gap) × đơn giá — dùng cho banner quyết định.
  const costRange = useMemo(() => (plan ? estimateCost(plan.gap, costRates, planFleet) : null), [plan, costRates, planFleet]);

  // ĐỐI CHIẾU KHỐI LƯỢNG HÀNG (Data hàng, 15 khu CK nội thành) vs NHU CẦU XIN TĂNG CƯỜNG (toàn cụm)
  // trong CÙNG khoảng ngày Data hàng có số liệu -> ĐỘ NHẠY (elasticity): hàng đổi X% thì xin TC đổi Y%.
  // CHỈ đối chiếu mức TỔNG CỤM — "Data hàng" là 15 khu CK, KHÔNG có bảng ánh xạ xuống từng bưu cục lẻ
  // trong "xin tăng cường" nên KHÔNG tách theo BC/khu vực (tránh suy diễn sai khi thiếu khoá nối đáng tin).
  const weightXtcCorr = useMemo(() => {
    if (!dataHang?.rows.length || !xinTc?.recs.length) return null;
    const dhDates = [...new Set(dataHang.rows.map((r) => r.date))].sort();
    // RÀ LẠI 2026-07-21: dùng isActiveDay() (ngày THẬT SỰ cần tăng cường) thay vì cả khung [start,end]
    // — "Ngày đôi" giờ chỉ có 2 ngày active (D, D+2), ngày giữa (D+1) phải tính là "ngày thường".
    const isEventDate = (iso: string) => {
      const t = new Date(iso + "T00:00:00").getTime();
      return events.some((ev) => isActiveDay(ev, t));
    };
    const eventDates = dhDates.filter(isEventDate);
    const baseDates = dhDates.filter((d) => !isEventDate(d));
    if (eventDates.length < 2 || baseDates.length < 2) return null; // quá ít ngày -> không đủ cơ sở so sánh

    const weightByDate = new Map<string, number>();
    for (const r of dataHang.rows) weightByDate.set(r.date, (weightByDate.get(r.date) || 0) + r.weightTon);
    const xtcByDate = new Map<string, number>();
    for (const r of xinTc.recs) xtcByDate.set(r.date, (xtcByDate.get(r.date) || 0) + 1);
    // SỬA 2026-07-21 (Sếp chỉ ra: so "ngày thường" vs "ngày event" trực tiếp kiểu này dễ bị SAI vì
    // lệch cơ cấu THỨ trong tuần giữa 2 nhóm — đúng nguyên tắc "so cùng thứ" đã áp dụng ở phần
    // Forecast phía trên (normDate = -7 ngày, CÙNG THỨ tuần trước), phần này TRƯỚC ĐÂY chỉ gộp
    // trung bình thẳng theo ngày, không cân bằng theo thứ). Fix: tính TB riêng cho từng THỨ (0-6)
    // trong mỗi nhóm rồi mới lấy TB của 7 thứ đó — tránh 1 nhóm lỡ có nhiều cuối tuần hơn nhóm kia
    // kéo lệch số liệu (hàng/xin TC thường có mùa vụ theo thứ, xem [[feedback-same-weekday-compare]]).
    const avgByWeekday = (dates: string[], m: Map<string, number>): number => {
      const byDow = new Map<number, number[]>();
      for (const d of dates) {
        const dow = new Date(d + "T00:00:00").getDay();
        const v = m.get(d) || 0;
        const a = byDow.get(dow);
        if (a) a.push(v); else byDow.set(dow, [v]);
      }
      const dowAvgs = [...byDow.values()].map((vals) => vals.reduce((a, b) => a + b, 0) / vals.length);
      return dowAvgs.length ? dowAvgs.reduce((a, b) => a + b, 0) / dowAvgs.length : 0;
    };

    const baseW = avgByWeekday(baseDates, weightByDate), evW = avgByWeekday(eventDates, weightByDate);
    const baseX = avgByWeekday(baseDates, xtcByDate), evX = avgByWeekday(eventDates, xtcByDate);
    const dW = baseW > 0 ? (evW - baseW) / baseW : null;
    const dX = baseX > 0 ? (evX - baseX) / baseX : null;
    const elasticity = dW && dX != null ? dX / dW : null;

    return {
      warehouses: new Set(dataHang.rows.map((r) => r.warehouse)).size,
      fromIso: dhDates[0], toIso: dhDates[dhDates.length - 1],
      baseDays: baseDates.length, eventDays: eventDates.length,
      baseW, evW, dW, baseX, evX, dX, elasticity,
    };
  }, [dataHang, xinTc, events]);

  // Áp NGƯỢC độ nhạy trên vào %Δ hàng mà FC đã dự báo cho kỳ ĐANG CHỌN (plan.volSurgePct, logic FC là CHÍNH)
  // -> ước tính %Δ nhu cầu xin tăng cường, CHỈ để ĐỐI CHIẾU với phương án đã chốt, KHÔNG thay thế planEngine.
  const projectedXtcSurge = useMemo(() => {
    if (!weightXtcCorr?.elasticity || !plan) return null;
    const dWFc = plan.volSurgePct / 100;
    return { dWFc, dXtcEst: dWFc * weightXtcCorr.elasticity };
  }, [weightXtcCorr, plan]);

  // Tải báo cáo đã lưu (ai cũng đọc) theo kỳ event đang chọn.
  useEffect(() => {
    let alive = true;
    setLoadingRep(true);
    fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: reportKey, action: "get" }) })
      .then((r) => r.json())
      .then((d) => { if (alive) { setSaved(d?.text ? { text: d.text, at: d.at, by: d.by } : null); setLoadingRep(false); } })
      .catch(() => { if (alive) setLoadingRep(false); });
    // Nếu đang có tiến trình soạn cho kỳ này (vd vừa chuyển menu rồi quay lại) -> bám theo.
    const p = genInflight.get(reportKey);
    if (p) {
      setBusy(true);
      p.then((res) => { if (alive) setSaved(res); }).catch(() => {}).finally(() => { if (alive) setBusy(false); });
    }
    return () => { alive = false; };
  }, [reportKey]);

  // Tải báo cáo ĐÁNH GIÁ SAU EVENT đã lưu theo kỳ.
  useEffect(() => {
    let alive = true;
    setLoadingRev(true);
    fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: reviewKey, action: "get" }) })
      .then((r) => r.json())
      .then((d) => { if (alive) { setSavedRev(d?.text ? { text: d.text, at: d.at, by: d.by } : null); setLoadingRev(false); } })
      .catch(() => { if (alive) setLoadingRev(false); });
    const p = genInflight.get(reviewKey);
    if (p) {
      setBusyRev(true);
      p.then((res) => { if (alive) setSavedRev(res); }).catch(() => {}).finally(() => { if (alive) setBusyRev(false); });
    }
    return () => { alive = false; };
  }, [reviewKey]);

  useEffect(() => { msgsEnd.current?.scrollIntoView({ block: "nearest" }); }, [msgs, chatBusy]);

  function buildDigest(withChat = false): string {
    const L: string[] = [];
    L.push(`KẾ HOẠCH TẢI EVENT — Cụm M12.`);
    if (selected) L.push(`Kỳ event: ${selected.label} (${dm(selected.start)}–${dm(selected.end)}, ${STATUS_TXT[selected.status]}).`);
    L.push(`Quy ước: mỗi tháng 3 kỳ cao điểm (ngày đôi, 15, 25), mỗi kỳ 6 ngày. Đo nhu cầu tăng cường dựa trên lượng hàng & số xe hiện tại + độ nhạy event + forecast (nếu có).`);
    // FORECAST THẬT theo ngày × kho + so TB 7 ngày trước event (ưu tiên dùng, KHÔNG bịa).
    if (fc) {
      const n = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("vi-VN"));
      const dl = (v: number | null, b: number | null) => (v != null && b ? ` (${v >= b ? "+" : ""}${Math.round((v / b - 1) * 100)}% vs thường)` : "");
      for (const [name, k] of [["HCM20", fc.hcm], ["Sóng Thần", fc.st]] as const) {
        if (!k.days.length) continue;
        L.push(`\nFORECAST ${name} — TB 7 ngày TRƯỚC event: ${n(k.baseVol)} đơn/ngày, ${n(k.baseW)} kg/ngày. Theo ngày kỳ event:`);
        for (const d of k.days) L.push(`  ${d.date.slice(8)}/${d.date.slice(5, 7)}: ${n(d.vol)} đơn${dl(d.vol, k.baseVol)} · ${n(d.weight)} kg${dl(d.weight, k.baseW)}`);
      }
      L.push(`\nTổng FC cả kỳ (2 kho): ${n(fc.totalVol)} đơn. Ngày ĐỈNH: ${fc.peak?.date.slice(8)}/${fc.peak?.date.slice(5, 7)} (${n(fc.peak?.total ?? null)} đơn).`);
      const accTxt = [fc.accH.mape != null ? `HCM20 ~${Math.round(fc.accH.mape * 100)}% (${fc.accH.n} ngày)` : "", fc.accS.mape != null ? `Sóng Thần ~${Math.round(fc.accS.mape * 100)}% (${fc.accS.n} ngày)` : ""].filter(Boolean).join(", ");
      if (accTxt) L.push(`Độ lệch FC quá khứ: ${accTxt}. DÙNG ĐÚNG số FC trên để tính số xe; "vs thường" = so TB 7 ngày trước event.`);
    } else L.push(`\n(Chưa có forecast cho kỳ này — số xe là ước lượng theo đội xe tham chiếu.)`);
    if (data && data.rows.length) {
      L.push(`\nĐỘ NHẠY EVENT — ${data.rows.length} tuyến, mức tăng lấp đầy TB ×${data.avgUp?.toFixed(2)}.`);
      L.push(`Top tuyến nhạy event (cần tăng xe): ` + data.surge.map((r) => `${r.code} ×${r.up.toFixed(2)} (event ${pct(r.ev)} vs thường ${pct(r.base)})`).join("; "));
    }
    // ĐỘI XE THẬT (realtime) — xe đang dùng theo tải + đội nền + book NCC. DÙNG ĐÚNG, KHÔNG bịa.
    if (fleet) {
      L.push(`\nĐỘI XE THẬT (realtime từ lịch tải + tăng cường):`);
      L.push(`- Xe đang dùng toàn cụm theo tải trọng (đếm tuyến): ` + TON_ORDER.map((k) => `${TON_LABEL[k]}: ${fleet.inUse[k]}`).join(", ") + ` (tổng ${fleet.totalInUse} chuyến${fleet.unknownLoad ? `, ${fleet.unknownLoad} tuyến chưa ghi tải` : ""}).`);
      L.push(`- Đội xe nền ~${BASE_FLEET_TOTAL} xe (số THAM CHIẾU thủ công theo tải trọng, không phải số live), hiện CHẠY HẾT theo tham chiếu đó (không còn xe nằm bãi). Riêng theo Lịch Tải THẬT (đếm tuyến/ngày, tách Loại tuyến): Lấy ${fleet.fixedByDir.lay} tuyến, Giao/khác ${fleet.fixedByDir.other} tuyến (tổng ${fleet.fixedByDir.lay + fleet.fixedByDir.other} — số LIVE). Xe nhà GHN kỳ này (~${fleet.ghnTC}, số THẬT đếm từ lịch tăng cường) GIỮ làm dự phòng phát sinh.`);
      if (fleet.ncc.length) L.push(`- Plan book NCC kỳ này (Lấy+Giao): tổng ${fleet.totalNcc} xe từ ${fleet.ncc.length} NCC + ${fleet.ghnTC} xe GHN nhà. Chi tiết (NCC · xe · vùng): ` + fleet.ncc.map((x) => `${x.name} ${x.count}xe [${x.lay}L/${x.giao}G]${x.quans.length ? " @" + x.quans.slice(0, 4).join("/") : ""}`).join("; ") + ".");
      const fx = fleet.fixed, ev = fleet.event;
      L.push(`- Xe RIÊNG BIỆT theo biển số (chỉ đối chiếu được phần tuyến CÓ ghi biển số, không phải toàn bộ):`);
      L.push(`  · CỐ ĐỊNH (lịch tải hàng ngày): ${fx.veh.distinctBks} xe khác nhau / ${fx.veh.routes} chuyến (${fx.veh.coveragePct}% có biển số) — GHN ${fx.ghnVeh.routes} chuyến (chưa ghi biển số riêng theo dòng), NCC ${fx.nccVeh.distinctBks} xe/${fx.nccVeh.routes} chuyến. ${fx.veh.multiRouteBks} xe chạy ≥2 chuyến khác nhau (1 xe nhiều vòng).`);
      L.push(`  · EVENT (tăng cường đặt thêm): ${ev.veh.distinctBks} xe khác nhau / ${ev.veh.routes} chuyến (${ev.veh.coveragePct}% có biển số) — GHN ${ev.ghnVeh.routes} chuyến (chưa ghi biển số riêng theo dòng), NCC ${ev.nccVeh.distinctBks} xe/${ev.nccVeh.routes} chuyến. ${ev.veh.multiRouteBks} xe chạy ≥2 chuyến khác nhau.`);
      L.push(`  · GHN (xe nhà) hầu như không ghi biển số theo dòng ở cả 2 sheet trên (mặc định xe cố định đã biết) nên KHÔNG tính được "xe riêng biệt" cho GHN — chỉ NCC (thuê ngoài) có đủ dữ liệu biển số để tách. KHÔNG suy diễn GHN có ít xe hơn NCC từ điều này.`);
      L.push(`  · KHÔNG cộng dồn 2 số CỐ ĐỊNH + EVENT thành "tổng xe cụm" — 1 xe có thể vừa chạy cố định vừa được đặt thêm event nên sẽ trùng, cộng vào sẽ sai cao hơn thực tế.`);
    }
    // ĐỐI CHIẾU Khối lượng hàng (Data hàng) vs Xin tăng cường — bổ sung, KHÔNG thay logic FC chính.
    if (weightXtcCorr) {
      L.push(`\nĐỐI CHIẾU KHỐI LƯỢNG HÀNG ("Data hàng", ${weightXtcCorr.warehouses} khu CK nội thành) vs XIN TĂNG CƯỜNG (toàn cụm, ${weightXtcCorr.fromIso.slice(8)}/${weightXtcCorr.fromIso.slice(5, 7)}–${weightXtcCorr.toIso.slice(8)}/${weightXtcCorr.toIso.slice(5, 7)}):`);
      L.push(`- Ngày thường (${weightXtcCorr.baseDays} ngày): ${weightXtcCorr.baseW.toFixed(1)} tấn/ngày, ${weightXtcCorr.baseX.toFixed(1)} lượt xin TC/ngày. Ngày event (${weightXtcCorr.eventDays} ngày): ${weightXtcCorr.evW.toFixed(1)} tấn/ngày (${weightXtcCorr.dW != null ? (weightXtcCorr.dW >= 0 ? "+" : "") + Math.round(weightXtcCorr.dW * 100) + "%" : "—"}), ${weightXtcCorr.evX.toFixed(1)} lượt/ngày (${weightXtcCorr.dX != null ? (weightXtcCorr.dX >= 0 ? "+" : "") + Math.round(weightXtcCorr.dX * 100) + "%" : "—"}).`);
      L.push(`- Độ nhạy: hàng +1% ↔ xin TC ${weightXtcCorr.elasticity != null ? (weightXtcCorr.elasticity >= 0 ? "+" : "") + weightXtcCorr.elasticity.toFixed(2) + "%" : "chưa tính được"}.${weightXtcCorr.baseDays < 5 ? " (nền so sánh còn MỎNG, chỉ tham khảo)" : ""}`);
      if (projectedXtcSurge) L.push(`- Áp vào FC kỳ ${selected?.label} (FC +${Math.round(projectedXtcSurge.dWFc * 100)}%) → ƯỚC TÍNH xin tăng cường có thể đổi ${projectedXtcSurge.dXtcEst >= 0 ? "+" : ""}${Math.round(projectedXtcSurge.dXtcEst * 100)}% — CHỈ để đối chiếu chéo với kế hoạch xe đã tính (dưới đây), KHÔNG dùng số này thay cho kế hoạch xe.`);
      L.push(`- LƯU Ý: "Data hàng" đo mức KHU VỰC (CK), không map được xuống từng bưu cục lẻ trong "xin tăng cường" nên đây là đối chiếu TỔNG CỤM, không phải theo từng BC.`);
    } else if (selected && !plan) {
      L.push(`\n(Chưa đối chiếu được Khối lượng hàng ↔ Xin tăng cường cho kỳ này — thiếu dữ liệu trùng khoảng ngày hoặc kỳ chưa có Forecast.)`);
    }
    // KẾ HOẠCH XE đã tính sẵn bằng code (nguồn số THẬT cho trợ lý).
    if (selected?.status === "past") {
      L.push(planFleet !== fleet
        ? `\n(Xe NCC/GHN "dư địa" dùng số THẬT đã book cho ĐÚNG kỳ ${selected.label} — Lưu trữ TC Event — không phải số live hôm nay.)`
        : `\n(Chưa có Lưu trữ TC Event cho kỳ ${selected.label} — xe NCC/GHN "dư địa" tạm dùng số LIVE hiện tại, có thể không đúng thời điểm đó.)`);
    }
    L.push(planDigest(plan));
    if (withChat && msgs.length) L.push(`\n[ĐIỀU CHỈNH TỪ TRAO ĐỔI VỚI SẾP — lồng vào kế hoạch]\n` + msgs.slice(-6).map((m) => `${m.role === "user" ? "Sếp" : "Trợ lý"}: ${m.content}`).join("\n"));
    return L.join("\n");
  }

  // Soạn / cập nhật (chỉ admin) -> sinh kế hoạch + LƯU cho mọi người đọc.
  // Tiến trình chạy ở cấp module nên KHÔNG bị huỷ khi chuyển menu; quay lại sẽ bám tiếp.
  async function gen() {
    const key = reportKey;
    if (genInflight.has(key)) return; // đang soạn -> tránh chạy 2 lần
    const digest = buildDigest(true); // chốt dữ liệu tại thời điểm bấm
    setBusy(true); setGenErr(null);
    const p = (async () => {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "eventplan", text: digest }) });
      const d = await r.json();
      const text = d?.reply || "";
      if (!text || /^⚠/.test(text)) throw new Error(text || "trợ lý chưa soạn được");
      const sv = await (await fetch("/api/report", { method: "POST", headers: { "content-type": "application/json", ...adminHeaders() }, body: JSON.stringify({ key, action: "save", text }) })).json();
      return { text, at: sv?.at || Date.now(), by: getUser()?.email || "" };
    })();
    genInflight.set(key, p);
    const onThis = () => mountedRef.current && selectedRef.current === key;
    // KHÔNG chặn màn hình (alert) — "Chốt phương án" ở trên đã tự tính đủ dùng dù nhận định AI này lỗi.
    p.then((res) => { if (onThis()) setSaved(res); })
      .catch((e) => { if (onThis()) setGenErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { genInflight.delete(key); if (onThis()) setBusy(false); });
  }

  // Gói số liệu ĐÁNH GIÁ SAU EVENT (thực tế vs dự báo, plan vs thực cần) cho trợ lý — số đã tính sẵn, KHÔNG bịa.
  function buildReviewDigest(): string {
    const L: string[] = [];
    const n = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("vi-VN"));
    const dl = (v: number | null) => (v == null ? "—" : (v >= 0 ? "+" : "") + Math.round(v * 100) + "%");
    L.push(`ĐÁNH GIÁ SAU EVENT — Cụm M12.`);
    if (selected) L.push(`Kỳ event: ${selected.label} (${dm(selected.start)}–${dm(selected.end)}, ${STATUS_TXT[selected.status]}).`);
    if (!review) return L.join("\n");
    L.push(review.complete ? `Kỳ đã kết thúc — đủ dữ liệu thực tế cả kỳ.` : `Kỳ ĐANG diễn ra — mới có ${review.nAct} ngày-kho có số thực tế; đánh giá SƠ BỘ phần đã chạy.`);
    const dVol = review.sumFcVol > 0 ? review.sumActVol / review.sumFcVol - 1 : null;
    const dW = review.sumFcW > 0 ? review.sumActW / review.sumFcW - 1 : null;
    L.push(`\nTỔNG KỲ (2 kho, chỉ ngày có thực tế): Sản lượng THỰC TẾ ${n(review.sumActVol)} đơn vs DỰ BÁO ${n(review.sumFcVol)} đơn (${dl(dVol)}). Khối lượng THỰC TẾ ${n(review.sumActW)} kg vs DỰ BÁO ${n(review.sumFcW)} kg (${dl(dW)}).`);
    L.push(`Ngày ĐỈNH THỰC TẾ: ${review.actPeak ? review.actPeak.date.slice(8) + "/" + review.actPeak.date.slice(5, 7) + ` (${n(review.actPeak.total)} đơn)` : "—"}. Ngày đỉnh DỰ BÁO: ${fc?.peak ? fc.peak.date.slice(8) + "/" + fc.peak.date.slice(5, 7) : "—"}.`);
    for (const [name, k] of [["HCM20", review.hcm], ["Sóng Thần", review.st]] as const) {
      if (!k.withAct.length) { L.push(`\n${name}: chưa có số thực tế trong kỳ.`); continue; }
      // Chỉ đẩy MAPE + ngày lệch mạnh nhất (BỎ liệt kê từng ngày -> tiết kiệm token; dashboard đã có biểu đồ).
      let pkD = "", pkV = 0;
      for (const d of k.withAct) { const dv = d.fcVol && d.actVol != null ? d.actVol / d.fcVol - 1 : 0; if (Math.abs(dv) > Math.abs(pkV)) { pkV = dv; pkD = d.date.slice(8) + "/" + d.date.slice(5, 7); } }
      L.push(`\n${name} — MAPE Volume ${k.mapeVol.mape != null ? Math.round(k.mapeVol.mape * 100) + "%" : "—"}, Weight ${k.mapeW.mape != null ? Math.round(k.mapeW.mape * 100) + "%" : "—"}${pkD ? ` · lệch mạnh nhất ${pkD} (${pkV >= 0 ? "+" : ""}${Math.round(pkV * 100)}%)` : ""}.`);
    }
    // SỐ XE TC THẬT (ưu tiên số này cho mục "Hiệu quả kế hoạch xe" — KHÔNG dùng ước lượng forecast).
    // KHỚP ĐÚNG kỳ đang xem (nhãn EVENT d/m) — tcEv.routes luôn là kỳ MỚI NHẤT trong sheet, có thể
    // KHÁC kỳ "selected" đang soạn báo cáo -> nếu dùng thẳng sẽ nạp nhầm số của kỳ khác cho AI.
    if (tcEv?.ok && selected) {
      const evRoutes = tcEv.allRoutes.filter((r) => r.event === eventLabelOf(selected));
      if (evRoutes.length) {
        const st = tcEventStats(evRoutes);
        const dmy = (s: string) => { const m = (s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return ""; const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; };
        const first = evRoutes.find((r) => r.from);
        const bucket = first ? `${first.from}→${first.to}` : selected.label;
        const [fRaw, tRaw] = bucket.split("→");
        const fIso = dmy(fRaw), tIso = dmy(tRaw || fRaw);
        const isMet = (s: string) => /kh[ôo]ng\s*đợi\s*t/i.test(s) || (/c[óo]\s*xe/i.test(s) && !/kh[ôo]ng\s*c[óo]\s*xe/i.test(s));
        const ps = (xinTc?.recs ?? []).filter((r) => r.date && (!fIso || r.date >= fIso) && (!tIso || r.date <= tIso));
        const psOk = ps.filter((r) => isMet(r.trangThai)).length;
        L.push(`\nXE TĂNG CƯỜNG THỰC TẾ (số THẬT từ "Lưu trữ TC EVENT" + "BC Xin TC", ĐÚNG kỳ ${selected.label} — DÙNG ĐÚNG SỐ NÀY khi viết mục kế hoạch xe, KHÔNG dùng ước lượng):`);
        L.push(`- Xe TC CỐ ĐỊNH đã lên lịch: ${st.totalXe} xe; đã điều được (có biển số/ghi "Đáp ứng"): ${st.okXe} xe (${Math.round(st.rate * 100)}% đáp ứng).`);
        L.push(`- Xe PHÁT SINH (BC xin thêm trong kỳ ${bucket}, ngày theo Timestamp): ${ps.length} lượt, đáp ứng ${psOk} (Có xe + Hủy-BC không đợi tải). => TỔNG NHU CẦU ~${st.totalXe + ps.length} xe.`);
        L.push(`- Đáp ứng theo NCC: ` + st.byNcc.map((x) => `${x.ncc} ${x.ok}/${x.xe} (${Math.round(x.rate * 100)}%)`).join("; ") + ".");
      } else {
        L.push(`\n(Chưa có "Lưu trữ TC EVENT" cho đúng kỳ ${selected.label} — không đối chiếu số xe TC thực tế được cho kỳ này.)`);
      }
    }
    if (tcTl?.ok && tcTl.routes.length) {
      const ts = tcTlldStats(tcTl.routes);
      L.push(`\nTLLD TUYẾN TĂNG CƯỜNG (Sheet 17, ${tcTl.dateLabels.join("/")}): ${ts.n} tuyến, TLLD TB ${ts.avg != null ? Math.round(ts.avg * 100) + "%" : "—"}. Quá tải >100%: ${ts.over} tuyến (${ts.overRoutes.slice(0, 4).map((r) => r.code + " " + Math.round(r.avg * 100) + "%").join(", ")}). Rỗng <60%: ${ts.low} tuyến (${ts.lowRoutes.slice(0, 4).map((r) => r.code + " " + Math.round(r.avg * 100) + "%").join(", ")}).`);
    }
    if (plan && planActual) {
      L.push(`\n(THAM CHIẾU lý thuyết từ forecast — chỉ để đối chiếu, KHÔNG thay số thật ở trên: bộ máy tính đội xe đỉnh plan ${plan.peakNeeded} vs thực cần ${planActual.peakNeeded} xe; năng lực ~${n(planActual.effectiveCap)} kg/xe/ngày.)`);
    }
    if (data && data.rows.length) {
      L.push(`\nLẤP ĐẦY THỰC TẾ (TLLD ${data.rows.length} tuyến): mức tăng lấp đầy kỳ event TB ×${data.avgUp?.toFixed(2)} so ngày thường. Top tuyến tải cao: ` + data.surge.slice(0, 5).map((r) => `${r.code} ${pct(r.ev)}`).join("; ") + ".");
    }
    L.push(`\nYÊU CẦU: viết BÁO CÁO ĐÁNH GIÁ SAU EVENT theo đúng bố cục, CHỈ dùng các số trên, KHÔNG bịa. RIÊNG mục "HIỆU QUẢ KẾ HOẠCH XE" PHẢI dùng SỐ XE TC THỰC TẾ (xe cố định + phát sinh + tỷ lệ đáp ứng theo NCC ở trên), KHÔNG dùng số ước lượng forecast; nêu rõ NCC nào đáp ứng thấp cần rút kinh nghiệm.`);
    return L.join("\n");
  }

  // Soạn ĐÁNH GIÁ SAU EVENT (chỉ admin) -> lưu cho mọi người đọc (reviewKey riêng).
  async function genReview() {
    const key = reviewKey;
    if (genInflight.has(key)) return;
    const digest = buildReviewDigest();
    setBusyRev(true); setGenRevErr(null);
    const p = (async () => {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "eventreview", id: "eventreview", text: digest }) });
      const d = await r.json();
      const text = d?.reply || "";
      if (!text || /^⚠/.test(text)) throw new Error(text || "trợ lý chưa đánh giá được");
      const sv = await (await fetch("/api/report", { method: "POST", headers: { "content-type": "application/json", ...adminHeaders() }, body: JSON.stringify({ key, action: "save", text }) })).json();
      return { text, at: sv?.at || Date.now(), by: getUser()?.email || "" };
    })();
    genInflight.set(key, p);
    const onThis = () => mountedRef.current && reviewRef.current === key;
    p.then((res) => { if (onThis()) setSavedRev(res); })
      .catch((e) => { if (onThis()) setGenRevErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { genInflight.delete(key); if (onThis()) setBusyRev(false); });
  }

  async function send() {
    const q = input.trim();
    if (!q || chatBusy) return;
    const rq = replyTo;
    const userMsg: Msg = { role: "user", content: q, ...(rq ? { quote: rq.text } : {}) };
    const next: Msg[] = [...msgs, userMsg];
    setMsgs(next); setInput(""); setReplyTo(null); setChatBusy(true);
    try {
      // Dạy kiến thức từ Plan Event -> kho CHUNG mọi chat.
      if (isTeach(q)) {
        const note = await teachKnowledge(q);
        setMsgs([...next, { role: "assistant", content: note }]);
        return;
      }
      // Dán link -> đọc & lưu vào kho dữ liệu CHUNG (id "planevent").
      let convo = next;
      const urls = q.match(/https?:\/\/[^\s]+/g) || [];
      for (const u of urls) {
        try {
          const dd = await (await fetch("/api/dashdata", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "planevent", action: "addUrl", url: u }) })).json();
          convo = [...convo, { role: "assistant", content: dd?.ok ? `📎 Đã đọc & lưu dữ liệu từ link (${(dd.chars || 0).toLocaleString("vi-VN")} ký tự) vào kho chung — mọi mục chat dùng được ạ.` : `⚠ Không đọc được link: ${dd?.error || "lỗi"}` }];
          setMsgs(convo);
        } catch { /* bỏ qua link lỗi */ }
      }
      const address = addressOf(getUser());
      const ctx = buildDigest() + (saved?.text ? `\n\n[BÁO CÁO HIỆN TẠI]\n${saved.text}` : "") + `\n\n[XƯNG HÔ: gọi người dùng là "${address}"]`;
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "askdata", id: "planevent", messages: convo.slice(-8).map((m) => ({ role: m.role, content: m.quote ? `[Người dùng đang hỏi về đoạn: "${m.quote}"]\n${m.content}` : m.content })), context: ctx }) });
      const d = await r.json();
      setMsgs([...convo, { role: "assistant", content: d?.reply || "(không có phản hồi)" }]);
    } catch (e) { setMsgs([...next, { role: "assistant", content: "Lỗi: " + (e instanceof Error ? e.message : String(e)) }]); }
    finally { setChatBusy(false); }
  }

  // Plan Event chỉ dành cho ADMIN (đăng nhập M12SC).

  return (
    <div>
      <div className="section-card pe-head">
        <div>
          <h2 className="pe-h">✈️ Plan Event · Kế hoạch tải cao điểm</h2>
          <p className="pe-sub">Mạch đọc: <b>dự báo hàng</b> → <b>cần bao nhiêu xe</b> → <b>book ở đâu</b> → <b>còn thiếu bao nhiêu</b> → <b>làm gì tiếp</b>. Dash <b>tự tính số & chốt phương án</b> (Plan A/B/C) — không cần chờ trợ lý AI. Trợ lý bên dưới chỉ để xin thêm nhận định diễn giải, không bắt buộc.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <button className="pl-calc" onClick={() => { onRequestKeHoach?.(); gen(); }} disabled={busy}>{busy ? "🤖 Đang soạn…" : saved ? "🤖 Cập nhật nhận định AI" : "🤖 Xin nhận định AI (tuỳ chọn)"}</button>
          {dataUpdatedAt > 0 && <div className="da-stamp" title="Mốc MỚI HƠN giữa: lúc trợ lý AI vừa soạn lại nhận định, hoặc lúc bản dashboard này được cập nhật (deploy) — KHÔNG tính biến động dữ liệu Sheet (đội xe/tăng cường đổi liên tục suốt ngày, không phải 'cập nhật' theo nghĩa này)">🕘 Cập nhật lúc {fmtTime(dataUpdatedAt)}</div>}
        </div>
      </div>

      <div className="section-card pe-pick">
        <label className="pe-pick-lb">Kỳ event:</label>
        <select className="pl-in" value={sel || defaultKey} onChange={(e) => setSel(e.target.value)}>
          {events.map((e) => <option key={e.key} value={e.key}>{STATUS_IC[e.status]} {e.label} ({dm(e.start)}–{dm(e.end)}) · {STATUS_TXT[e.status]}</option>)}
        </select>
        {selected && <span className={"pe-badge pe-" + selected.status}>{STATUS_IC[selected.status]} {STATUS_TXT[selected.status]}</span>}
      </div>

      <ColorLegend />
      <Glossary />

      {/* TAB "📋 Kế Hoạch" — quyết định hằng ngày (rà lại 2026-07-21, v2: tách trang thành 2 tab cấp
          trang thay vì tiếp tục xếp Collapsible — xem plan pure-riding-dahl.md). Mọi useMemo/useState
          tính toán GIỮ NGUYÊN ở đầu component, chỉ nhánh JSX hiển thị tách theo `view`. */}
      {view === "ke-hoach" && (
      <>
      {/* VÙNG QUYẾT ĐỊNH — gộp "Tóm tắt nhanh" + "Chốt phương án" (PlanVerdict) + "Kế hoạch đội xe"
          thành 1 vùng liền mạch NGAY ĐẦU TRANG (rà lại 2026-07-21 theo yêu cầu "đóng vai giám đốc
          kho"): đây là thứ cần đọc ĐẦU TIÊN — đáp ứng đủ chưa, làm gì tiếp, cần bao nhiêu xe — không
          phải cuộn qua Đánh giá sau event/Forecast chi tiết (giờ đẩy xuống dưới, xem mục audit) mới
          tới. 2 chip dưới đây là 2 số DUY NHẤT chưa có sẵn trong PlanVerdict — "Phương án"/"Đáp ứng xe
          tăng cường" đã BỎ vì trùng tier badge + dòng "KPI đáp ứng ≥95%" ngay trong PlanVerdict. */}
      {/* RÀ LẠI 2026-07-21 (v2 — Sếp phản hồi "mục tổng quát chưa đủ tổng quát"): đổi headline từ 1
          số ĐƠN gộp cả cụm sang FC KHỐI LƯỢNG (kg — số THẬT dùng để tính xe, xem feedback-plan-kg-
          not-don) TÁCH RIÊNG theo từng kho — đây mới là số phản ánh đúng "cần bao nhiêu xe" ngay từ
          đầu trang, thay vì phải đọc xuống 🧮 Kế hoạch đội xe mới thấy. Số đơn (đã có toggle Đơn/
          Khối lượng trong 📊 Chi tiết Forecast bên dưới) không còn lặp lại ở đây nữa. */}
      {plan && fc && (
        <ErrorBoundary compact label="Tóm tắt nhanh">
          <div className="pe-kpis" style={{ margin: "0 0 8px" }}>
            {([["🏢 HCM20", fc.hcm], ["🏬 Sóng Thần", fc.st]] as const).map(([name, k]) => {
              const peakW = k.days.reduce((m: (typeof k.days)[number] | null, d) => ((d.weight || 0) > (m?.weight || -1) ? d : m), null);
              const totalW = k.days.reduce((a, d) => a + (d.weight || 0), 0);
              return (
                <div className="pe-kpi" key={name}>
                  <span className="l" title="Đỉnh khối lượng dự báo (kg) — số THẬT dùng để tính xe cần, không phải số đơn">{name} · Đỉnh khối lượng</span>
                  <b style={{ color: "var(--orange)" }}>{peakW ? `${fmtVN(peakW.weight || 0)} kg` : "—"}</b>
                  <span className="u">{peakW ? `${dmStr(peakW.date)} · ${fmtVN(totalW)} kg cả kỳ` : "chưa có forecast"}</span>
                </div>
              );
            })}
          </div>
        </ErrorBoundary>
      )}

      {/* CHỐT PHƯƠNG ÁN — Dash tự nhận định Plan A/B/C, KHÔNG qua AI (chuyển lên đây từ dưới Forecast) */}
      {plan && (
        <ErrorBoundary compact label="Chốt phương án">
          <PlanVerdict plan={plan} fleet={fleet} deadline={deadline} onDeadlineChange={setDeadline} costRange={costRange} />
        </ErrorBoundary>
      )}
      {/* Chưa tính được kế hoạch — GIẢI THÍCH RÕ lý do (thường là chưa có Forecast cho kỳ này), tránh
          tưởng nhầm là lỗi. KHÔNG tự ước lượng khi thiếu forecast — đúng nguyên tắc "không bịa". */}
      {!plan && selected && (
        <div className="section-card" style={{ marginTop: 12, borderLeft: "4px solid var(--muted)" }}>
          <b>ℹ️ Chưa tính được kế hoạch xe cho kỳ {selected.label}</b>
          <p className="pe-sub" style={{ margin: "6px 0 0", fontSize: 14 }}>
            Sheet <b>Forecast Volume</b> (FC HCM20 / FC ST) chưa có số cho kỳ này — thường vì kỳ còn xa,
            chưa tới lúc điền dự báo. Dash không tự ước lượng khi thiếu forecast thật (tránh bịa số).
            {(() => {
              const lastDate = [...fcH, ...fcS].map((r) => r.date).filter(Boolean).sort().pop();
              return lastDate ? <> Forecast hiện có tới <b>{lastDate.slice(8)}/{lastDate.slice(5, 7)}/{lastDate.slice(0, 4)}</b> — chọn kỳ trong khoảng đó để xem kế hoạch đầy đủ.</> : null;
            })()}
          </p>
        </div>
      )}

      {/* BỘ MÁY TÍNH KẾ HOẠCH XE — số xe cần/đỉnh/thiếu tính từ FC kg thật (chuyển lên đây từ dưới
          Forecast) — đây là phần THỰC THI, cần thấy NGAY sau verdict, không phải cuộn qua audit trước. */}
      {plan && (
        <ErrorBoundary compact label="Bảng kế hoạch đội xe">
          <div className="pe-sech" style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span>🧮 Kế hoạch đội xe (tự tính từ forecast)</span>
            <label className="pb-safety">Hệ số an toàn:
              <select value={safety} onChange={(e) => setSafety(Number(e.target.value))}>
                <option value={1.0}>1.0 — sát</option>
                <option value={1.1}>1.1 — +10% dự phòng</option>
                <option value={1.2}>1.2 — +20% chắc tay</option>
                <option value={1.3}>1.3 — +30% cao điểm gắt</option>
              </select>
            </label>
          </div>
          {selected?.status === "past" && (
            <p className="pe-sub" style={{ margin: "0 0 8px", fontSize: 13 }}>
              {planFleet !== fleet
                ? <>🗄️ Xe NCC/GHN "dư địa" dùng số THẬT đã book cho ĐÚNG kỳ {selected.label} (Lưu trữ TC Event) — không phải số live hôm nay.</>
                : <>ℹ️ Chưa có lưu trữ TC Event cho kỳ {selected.label} — xe NCC/GHN "dư địa" tạm dùng số LIVE hiện tại (có thể không phản ánh đúng lúc đó).</>}
            </p>
          )}
          <PlanBoard plan={plan} fleet={fleet} />
        </ErrorBoundary>
      )}

      {/* BẢNG HÀNH ĐỘNG THEO NGÀY + CHI PHÍ ƯỚC TÍNH — theo brief "giám đốc kho": biểu đồ xe/ngày
          ở trên THIẾU cột "còn thiếu"/"hành động"/"owner"; và không có đồng chi phí nào. Đặt NGAY
          SAU biểu đồ (rà lại 2026-07-21) — trước đây SurgePlan chen giữa 2 phần liền mạch này. */}
      {plan && selected && (
        <>
          <ErrorBoundary compact label="Bảng hành động theo ngày">
            <DailyActionTable plan={plan} periodKey={selected.key} />
          </ErrorBoundary>
          {/* ZONE "💰 Chi phí tăng cường" (rà lại 2026-07-21, v2): 1 heading dùng chung style .pe-sech
              đứng trước cặp SurgeCostTimeline (chi phí theo ngày, nhiều kỳ)/CostEstimate (min-max bù thiếu) để 2 card
              đọc thành 1 cụm — không bọc thêm div/CSS mới, chỉ 1 dòng tiêu đề. Đơn giá/bảng giá NCC chi
              tiết đã tách sang PriceReference.tsx ở tab "Chi tiết & Đánh giá" (không còn ở đây). */}
          <div className="pe-sech" style={{ marginTop: 16 }}>💰 Chi phí tăng cường</div>
          <ErrorBoundary compact label="Chi phí tăng cường theo ngày, nhiều kỳ">
            <SurgeCostTimeline data={surgeCostTimeline} />
          </ErrorBoundary>
          {/* Cross-reference RÕ RÀNG tới TrucCompare (rà lại 2026-07-21 — Sếp báo "không thấy" báo cáo
              book NCC 2 kỳ gần nhất theo NCC): component ĐÃ CÓ SẴN (🚛 Book NCC theo NCC × tải trọng)
              nhưng nằm trong Collapsible đóng mặc định ở tab 2, dễ bị bỏ sót — thêm 1 dòng chỉ thẳng. */}
          <p className="pe-sub" style={{ margin: "4px 0 0", fontSize: 12.5 }}>
            Muốn xem book NCC 2 kỳ gần nhất TÁCH THEO TỪNG NHÀ CUNG CẤP (không chỉ theo tải trọng) → mở 🔍 Chi tiết &amp; Đánh giá → 📋 Chi tiết đội xe &amp; NCC → 🚛 Book NCC theo NCC × tải trọng.
          </p>
          <ErrorBoundary compact label="Chi phí ước tính">
            <CostEstimate gap={plan.gap} rates={costRates} fleet={planFleet} />
          </ErrorBoundary>
        </>
      )}

      {/* DỰ TRÙ TĂNG CƯỜNG PHÁT SINH — dời xuống sau Bảng hành động/Chi phí (rà lại 2026-07-21):
          trước đây chen giữa PlanBoard và Bảng hành động, cắt mạch "biểu đồ → bảng thực thi". */}
      {plan && (
        <ErrorBoundary compact label="Dự trù tăng cường phát sinh">
          <SurgePlan plan={plan} />
        </ErrorBoundary>
      )}

      {/* NHẬN ĐỊNH AI — dời vào TAB "Kế Hoạch" (rà lại 2026-07-21, v2): diễn giải cho verdict/kế hoạch
          đã chốt ngay trong tab này, không còn đứng cuối trang chung với Chat/tab "Chi tiết". Nút
          "Xin nhận định AI" ở Header tự chuyển về tab này khi bấm (xem onRequestKeHoach). */}
      <ErrorBoundary compact label="Nhận định thêm từ AI">
      <div className="section-card sl-ai" style={{ marginTop: 12 }}>
        <div className="sl-ai-title">🤖 Nhận định thêm từ AI (tuỳ chọn) · {selected?.label}</div>
        <p className="pe-sub" style={{ margin: "0 0 8px", fontSize: 13.5 }}>Diễn giải bằng lời cho phương án đã chốt ở trên — không phải nguồn số liệu, không bắt buộc phải có để dùng Plan Event.</p>
        {saved?.at ? <div className="da-stamp">🕘 Cập nhật {fmtTime(saved.at)}{saved.by ? ` · bởi ${saved.by}` : ""}</div> : null}
        {/* CẢNH BÁO STALE — bài viết dưới được soạn từ số liệu LIVE TẠI THỜI ĐIỂM ĐÓ (buildDigest()),
            nhưng nếu SAU ĐÓ dashboard được cập nhật lên bản mới (buildAt > saved.at) thì cách tính/
            hiển thị có thể đã đổi khác đi so lúc soạn — không phải AI đọc sai, chỉ là bài ĐÃ CŨ hơn
            bản hiện tại. KHÔNG cảnh báo vì biến động dữ liệu Sheet thường ngày (đã bỏ theo ý Sếp). */}
        {saved?.at && buildAt > saved.at && (
          <div className="sl-empty" style={{ color: "var(--orange)", background: "var(--orange-soft)", borderRadius: 8, padding: "8px 12px", textAlign: "left" }}>
            ⚠️ Dashboard đã cập nhật bản mới lúc <b>{fmtTime(buildAt)}</b> — SAU khi bài này được soạn (<b>{fmtTime(saved.at)}</b>). Số/cách tính trong bài dưới đây có thể đã CŨ so bản hiện tại — bấm "Cập nhật nhận định AI" ở đầu trang để soạn lại.
          </div>
        )}
        {genErr && <div className="sl-empty" style={{ color: "var(--red)" }}>⚠ Trợ lý AI chưa soạn được lúc này: {genErr} — không ảnh hưởng phương án đã chốt ở trên, thử lại sau cũng được.</div>}
        {busy && !saved?.text ? <div className="sl-empty">🤖 Đang soạn… (có thể rời mục này, soạn xong sẽ tự lưu)</div>
          : loadingRep ? <div className="sl-empty">Đang tải báo cáo…</div>
          : saved?.text ? <RichText className="sl-result-rich" text={saved.text} />
          : !genErr ? <div className="sl-empty">Chưa xin nhận định AI cho kỳ này — bấm “Xin nhận định AI” nếu muốn, hoặc dùng luôn phương án đã chốt ở trên.</div> : null}
      </div>
      </ErrorBoundary>
      </>
      )}

      {/* TAB "🔍 Chi tiết & Đánh giá" — kiểm chứng/tra cứu/lịch sử (rà lại 2026-07-21, v2). */}
      {view === "chi-tiet" && (
      <>
      {/* ĐỘ CHÍNH XÁC KẾ HOẠCH THEO LOẠI KỲ — dời lên ĐẦU tab này (trước đây đứng giữa SurgePlan và
          Đánh giá sau event trong 1 trang cuộn) — đúng vai trò audit độ tin cậy số liệu tab "Kế
          Hoạch", không phải nội dung hành động. Dash tự đối chiếu MỌI kỳ đã qua, không qua AI. Nội
          dung 3 nhánh (lệch hệ thống / không lệch / chưa đủ dữ liệu) GIỮ NGUYÊN 100% logic cũ. */}
      {plan && (
        <ErrorBoundary compact label="Độ chính xác kế hoạch theo loại kỳ">
          {curTypeAcc?.consistent ? (
            <div className="section-card" style={{ borderLeft: `4px solid ${curTypeAcc.avgDiff > 0 ? "var(--red)" : "var(--orange)"}`, marginTop: 0, marginBottom: 12 }}>
              <b>{curTypeAcc.avgDiff > 0 ? "📉" : "📈"} Loại kỳ "{curTypeAcc.type}" hay bị lệch kế hoạch xe</b>
              <p className="pe-sub" style={{ margin: "6px 0 8px", fontSize: 14 }}>
                Đối chiếu {curTypeAcc.rows.length} kỳ "{curTypeAcc.type}" đã qua: plan {curTypeAcc.avgDiff > 0 ? "THIẾU" : "DƯ"} trung bình{" "}
                <b>{Math.abs(Math.round(curTypeAcc.avgDiff))} xe ({curTypeAcc.avgDiffPct >= 0 ? "+" : ""}{curTypeAcc.avgDiffPct}%)</b> so thực cần —{" "}
                {curTypeAcc.rows.map((r) => `${r.label}: plan ${r.planPeak} vs thực ${r.actualPeak}`).join("; ")}.
                {curTypeAcc.avgDiff > 0 ? " Cân nhắc tăng hệ số an toàn (dropdown ở tab 📋 Kế Hoạch · 🧮 Kế hoạch đội xe) cho riêng loại kỳ này." : " Có thể hạ hệ số an toàn để đỡ tốn chi phí NCC dư."}
              </p>
            </div>
          ) : curTypeAcc && curTypeAcc.rows.length >= 2 ? (
            <div className="section-card" style={{ borderLeft: "4px solid var(--green)", marginTop: 0, marginBottom: 12 }}>
              <b>✅ Loại kỳ "{curTypeAcc.type}" chưa phát hiện lệch hệ thống</b>
              <p className="pe-sub" style={{ margin: "6px 0 0", fontSize: 14 }}>
                Đối chiếu {curTypeAcc.rows.length} kỳ đã qua: plan lúc thiếu lúc dư, không lệch 1 chiều rõ rệt — hệ số an toàn hiện tại ({safety}) hợp lý, chưa cần chỉnh riêng cho loại kỳ này.
              </p>
            </div>
          ) : (
            <div className="section-card" style={{ borderLeft: "4px solid var(--muted)", marginTop: 0, marginBottom: 12 }}>
              <b>ℹ️ Chưa đủ dữ liệu lịch sử cho loại kỳ "{curType}"</b>
              <p className="pe-sub" style={{ margin: "6px 0 0", fontSize: 14 }}>
                {curTypeAcc ? `Mới có ${curTypeAcc.rows.length} kỳ đã qua cùng loại — cần ≥2 kỳ mới đối chiếu được xu hướng lệch.` : "Chưa có kỳ nào cùng loại đã kết thúc để đối chiếu."} Số plan hiện tại dùng hệ số an toàn mặc định ({safety}), chưa có cơ sở lịch sử để tăng/giảm riêng.
              </p>
            </div>
          )}
        </ErrorBoundary>
      )}

      {/* ĐÁNH GIÁ SAU EVENT — thực tế vs dự báo & kế hoạch (chỉ hiện khi kỳ đã/đang chạy & có số thực tế) */}
      {review && (
        <ErrorBoundary compact label="Đánh giá sau event">
          <div className="section-card pe-review">
            <div className="pe-sech" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              <span>📊 Đánh giá sau event · {selected?.label}</span>
              <span className={"pe-badge pe-" + (review.complete ? "past" : "now")}>{review.complete ? "✓ đã kết thúc" : "🔴 đang chạy · sơ bộ"}</span>
            </div>
            <p className="pe-sub" style={{ margin: "0 0 10px" }}>Đối chiếu <b>thực tế</b> với <b>dự báo & kế hoạch xe</b> — số do dashboard tự tính từ Sheet, trợ lý chỉ diễn giải. <i>Đây là hiệu quả ĐÃ QUA của kỳ {selected?.label} — khác với bảng "đang book" ở mục 📋 Chi tiết đội xe & NCC phía dưới trang.</i></p>

            <div className="pe-kpis">
              <div className="pe-kpi"><span className="l">Sản lượng thực tế (2 kho)</span><b style={{ color: "var(--orange)" }}>{fmtVN(review.sumActVol)}</b><span className="u">vs FC {fmtVN(review.sumFcVol)} · {deltaTxt(review.sumActVol, review.sumFcVol)}</span></div>
              <div className="pe-kpi"><span className="l">Khối lượng thực tế</span><b style={{ color: "var(--blue)" }}>{fmtVN(review.sumActW)}</b><span className="u">kg · {deltaTxt(review.sumActW, review.sumFcW)} vs FC</span></div>
              <div className="pe-kpi"><span className="l">Sai số dự báo · HCM20 / ST</span><b style={{ color: mapeColor(review.hcm.mapeVol.mape) }}>{mapeTxt(review.hcm.mapeVol.mape)} / {mapeTxt(review.st.mapeVol.mape)}</b><span className="u">MAPE sản lượng · {review.hcm.mapeVol.n}/{review.st.mapeVol.n} ngày đối chiếu{(review.hcm.mapeVol.n < 3 || review.st.mapeVol.n < 3) ? " (còn ít, sơ bộ)" : ""}</span></div>
              {(() => {
                // KHỚP ĐÚNG kỳ đang xem (nhãn EVENT d/m) — KHÔNG dùng tcEv.routes (luôn là kỳ MỚI
                // NHẤT trong sheet, có thể là kỳ KHÁC với "selected" đang xem, gây hiển thị nhầm
                // số của kỳ khác dưới tiêu đề "Đánh giá sau event · {selected.label}").
                if (!tcEv?.ok || !selected) return null;
                const routes = tcEv.allRoutes.filter((r) => r.event === eventLabelOf(selected));
                if (!routes.length) return null;
                const st = tcEventStats(routes);
                const col = st.rate >= 0.95 ? "var(--green)" : st.rate >= 0.8 ? "var(--orange)" : "var(--red)";
                return <div className="pe-kpi"><span className="l">Xe TC · đáp ứng</span><b style={{ color: col }}>{st.totalXe} xe · {Math.round(st.rate * 100)}%</b><span className="u">điều được {st.okXe} xe (số thật, kỳ {selected.label})</span></div>;
              })()}
            </div>

            <div className="xtc-seg" style={{ marginTop: 12 }}>
              <button className={revTab === "tq" ? "on" : ""} onClick={() => setRevTab("tq")}>📋 Tổng quan</button>
              <button className={revTab === "xe" ? "on" : ""} onClick={() => setRevTab("xe")}>🚚 Xe TC</button>
              <button className={revTab === "tlld" ? "on" : ""} onClick={() => setRevTab("tlld")}>📈 TLLD tuyến</button>
              <button className={revTab === "ls" ? "on" : ""} onClick={() => setRevTab("ls")}>🗓️ Lịch sử nhiều kỳ</button>
            </div>

            {/* SỐ XE TĂNG CƯỜNG THẬT (lưu trữ TC EVENT + phát sinh BC Xin TC) — thay ước lượng */}
            {revTab === "xe" && <TcEventEval />}

            {/* TLLD tuyến TC (Sheet 17) — nhận định rỗng/quá tải theo ngày event */}
            {revTab === "tlld" && <TcTlldEval />}

            {/* Phân tích TC cố định QUA NHIỀU KỲ EVENT (theo tháng) — toàn bộ "Lưu trữ TC EVENT" */}
            {revTab === "ls" && <TcEventHistoryReport allRoutes={tcEv?.allRoutes ?? []} />}

            {revTab === "tq" && (
              <>
                <div className="pe-fc-grid" style={{ marginTop: 12 }}>
                  {([["🏬 Sóng Thần", review.st, "var(--blue)"], ["🏢 HCM20", review.hcm, "var(--orange)"]] as const).map(([name, k, col]) => (
                    <Reveal className="section-card pe-fc-card" key={name}>
                      <div className="pe-sech" style={{ color: col }}>{name} <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 14 }}>· Thực tế vs Dự báo</span></div>
                      {k.withAct.length === 0 ? <div className="sl-empty">Chưa có số thực tế cho kho này trong kỳ.</div> : (
                        <>
                          <div className="pe-fc-sub">📊 Sản lượng (đơn) · Thực tế vs Dự báo</div>
                          <FcCompareChart unit="đơn" days={k.withAct.map((d) => ({ label: dmStr(d.date) }))} series={[
                            { name: "Thực tế", color: "#1faa59", vals: k.withAct.map((d) => d.actVol) },
                            { name: "Dự báo", color: "#f15a24", vals: k.withAct.map((d) => d.fcVol) },
                          ]} />
                          <div className="pe-comment" dangerouslySetInnerHTML={{ __html: compareComment("Thực tế", k.withAct.map((d) => d.actVol), "dự báo", k.withAct.map((d) => d.fcVol), "đơn", k.withAct.map((d) => dmStr(d.date))) }} />
                          <div className="pe-fc-sub">⚖️ Khối lượng (kg) · Thực tế vs Dự báo</div>
                          <FcCompareChart unit="kg" days={k.withAct.map((d) => ({ label: dmStr(d.date) }))} series={[
                            { name: "Thực tế", color: "#1faa59", vals: k.withAct.map((d) => d.actW) },
                            { name: "Dự báo", color: "#f15a24", vals: k.withAct.map((d) => d.fcW) },
                          ]} />
                          <div className="pe-comment" dangerouslySetInnerHTML={{ __html: compareComment("Thực tế", k.withAct.map((d) => d.actW), "dự báo", k.withAct.map((d) => d.fcW), "kg", k.withAct.map((d) => dmStr(d.date))) }} />
                          <FcLegend series={[{ name: "Thực tế", color: "#1faa59" }, { name: "Dự báo", color: "#f15a24" }]} />
                        </>
                      )}
                    </Reveal>
                  ))}
                </div>

                {plan && planActual && (
                  <div className="pe-comment" style={{ borderLeftColor: "var(--blue)" }}>
                    <b>🚚 Kế hoạch xe (ngày đỉnh):</b> đã plan <b>{plan.peakNeeded}</b> xe · thực cần <b>{planActual.peakNeeded}</b> xe{" "}
                    {(() => { const d = planActual.peakNeeded - plan.peakNeeded; return d > 0 ? <>→ <b style={{ color: "var(--red)" }}>plan thiếu {d} xe</b> (rủi ro quá tải).</> : d < 0 ? <>→ <b style={{ color: "var(--orange)" }}>plan dư {-d} xe</b> (tốn chi phí NCC).</> : <>→ <b style={{ color: "var(--green)" }}>plan sát thực tế</b>.</>; })()}
                    {" "}Tăng cường: plan {plan.peakExtra} vs thực cần {planActual.peakExtra} xe.
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <div className="sl-ai-title">🤖 Đánh giá chuyên sâu từ Trợ lý</div>
                    <button className="pl-calc" onClick={genReview} disabled={busyRev}>{busyRev ? "🤖 Đang đánh giá…" : savedRev ? "🤖 Cập nhật đánh giá" : "🤖 Soạn đánh giá sau event"}</button>
                  </div>
                  {savedRev?.at ? <div className="da-stamp">🕘 Cập nhật {fmtTime(savedRev.at)}{savedRev.by ? ` · bởi ${savedRev.by}` : ""}</div> : null}
                  {genRevErr && <div className="sl-empty" style={{ color: "var(--red)" }}>⚠ Trợ lý AI chưa soạn được lúc này: {genRevErr} — các số ở trên vẫn đúng, không cần AI để dùng.</div>}
                  {busyRev && !savedRev?.text ? <div className="sl-empty">🤖 Đang phân tích thực tế vs kế hoạch… (có thể rời mục này, xong sẽ tự lưu)</div>
                    : loadingRev ? <div className="sl-empty">Đang tải đánh giá…</div>
                    : savedRev?.text ? <RichText className="sl-result-rich" text={savedRev.text} />
                    : !genRevErr ? <div className="sl-empty">Chưa có đánh giá cho kỳ này — bấm “Soạn đánh giá sau event” để trợ lý phân tích số thực tế.</div> : null}
                </div>
              </>
            )}
          </div>
        </ErrorBoundary>
      )}

      {/* FORECAST theo ngày × kho — CHI TIẾT/AUDIT, luôn thu gọn mặc định (rà lại 2026-07-21):
          "Tổng FC cả kỳ"/"Ngày đỉnh" đã có ở vùng Quyết định phía trên (chip "Sản lượng đỉnh dự
          báo") nên bỏ hẳn 2 KPI đó ở đây; "Độ lệch FC" (MAPE) rút gọn thành 1 dòng caption nhỏ
          (không còn 2 pe-kpi riêng) — vẫn giữ thông tin nhưng không chiếm chỗ ngang hàng verdict. */}
      {fc && (
        <ErrorBoundary compact label="Biểu đồ forecast">
          <Collapsible
            key={reportKey}
            title="📊 Chi tiết Forecast theo ngày × kho"
            sub={`Kỳ này vs tháng trước · ngày event vs ngày thường · độ lệch FC quá khứ: HCM20 ${fc.accH.mape != null ? "~" + Math.round(fc.accH.mape * 100) + "%" : "—"}, Sóng Thần ${fc.accS.mape != null ? "~" + Math.round(fc.accS.mape * 100) + "%" : "—"}`}
            defaultOpen={false}
          >
            {/* Chọn Đơn/Khối lượng (rà lại 2026-07-21, theo yêu cầu Sếp) — thêm lại kg dưới dạng
                CHỌN 1 trong 2 (không hiện song song như bản rất cũ, tránh rối lại đúng lý do đã bỏ
                trước đây). Áp dụng chung cho cả 2 kho + cả 2 cặp biểu đồ bên dưới. */}
            <div className="xtc-seg sm" style={{ marginBottom: 10 }}>
              <button className={fcUnit === "don" ? "on" : ""} onClick={() => setFcUnit("don")}>Đơn</button>
              <button className={fcUnit === "kg" ? "on" : ""} onClick={() => setFcUnit("kg")}>Khối lượng (kg)</button>
            </div>
            <div className="pe-fc-grid">
              {([["🏬 Sóng Thần", fc.st, "var(--blue)"], ["🏢 HCM20", fc.hcm, "var(--orange)"]] as const).map(([name, k, col]) => {
                const unitLb = fcUnit === "don" ? "đơn" : "kg";
                const valOf = (d: (typeof k.days)[number]) => (fcUnit === "don" ? d.vol : d.weight);
                const t6ValOf = (d: (typeof k.days)[number]) => (fcUnit === "don" ? d.t6Vol : d.t6W);
                const normValOf = (d: (typeof k.days)[number]) => (fcUnit === "don" ? d.normVol : d.normW);
                return (
                <Reveal className="section-card pe-fc-card" key={name}>
                  <div className="pe-sech" style={{ color: col }}>{name} <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 14 }}>· so sánh event T{evMM} với T{prevMM} & ngày thường</span></div>
                  {k.days.length === 0 ? <div className="sl-empty">Chưa có forecast cho kho này trong kỳ.</div> : (
                    <>
                      {/* (1) Kỳ này (T7) vs kỳ tháng trước (T6) — theo ngày tương ứng. */}
                      <div className="pe-fc-sub">📊 {fcUnit === "don" ? "Sản lượng (đơn)" : "Khối lượng (kg)"} · Kỳ này T{evMM} vs Tháng trước T{prevMM}</div>
                      <FcCompareChart unit={unitLb} days={k.days.map((d) => ({ label: dmStr(d.date), sub: d.t6Date ? dmStr(d.t6Date) : undefined }))} series={[
                        { name: `Kỳ này (T${evMM})`, color: "#f15a24", vals: k.days.map(valOf) },
                        { name: `Tháng trước (T${prevMM})`, color: "#1668c7", vals: k.days.map(t6ValOf) },
                      ]} />
                      <div className="pe-comment" dangerouslySetInnerHTML={{ __html: compareComment("Kỳ này", k.days.map(valOf), `tháng trước`, k.days.map(t6ValOf), unitLb, k.days.map((d) => dmStr(d.date))) }} />
                      <FcLegend series={[{ name: `Kỳ này (T${evMM})`, color: "#f15a24" }, { name: `Tháng trước (T${prevMM})`, color: "#1668c7" }]} />

                      {/* (2) Ngày event vs NGÀY THƯỜNG cùng thứ tuần trước (-7 ngày) */}
                      <div className="pe-fc-sub" style={{ marginTop: 10 }}>📅 Ngày event vs Ngày thường (cùng thứ, tuần trước) · {fcUnit === "don" ? "Sản lượng" : "Khối lượng"}</div>
                      <FcCompareChart unit={unitLb} days={k.days.map((d) => ({ label: dmStr(d.date), sub: d.normDate ? dmStr(d.normDate) : undefined }))} series={[
                        { name: "Ngày event", color: "#f15a24", vals: k.days.map(valOf) },
                        { name: "Ngày thường", color: "#8a97a4", vals: k.days.map(normValOf) },
                      ]} />
                      <div className="pe-comment" dangerouslySetInnerHTML={{ __html: compareComment("Ngày event", k.days.map(valOf), "ngày thường", k.days.map(normValOf), unitLb, k.days.map((d) => dmStr(d.date))) }} />
                      <FcLegend series={[{ name: "Ngày event", color: "#f15a24" }, { name: "Ngày thường (cùng thứ, tuần trước)", color: "#8a97a4" }]} />

                      <div className="pe-comment" style={{ borderLeftColor: "var(--blue)" }}><b>📋 Tổng quát kho:</b> <span dangerouslySetInnerHTML={{ __html: fcComment(k) }} /></div>
                    </>
                  )}
                </Reveal>
                );
              })}
            </div>
          </Collapsible>
        </ErrorBoundary>
      )}

      {/* ĐỐI CHIẾU Khối lượng hàng (Data hàng) vs Nhu cầu xin tăng cường — cross-check bổ sung,
          logic xe CHÍNH vẫn là FC (PlanBoard/PlanVerdict ở trên) — đây chỉ để kiểm tra chéo, nên
          bọc Collapsible đóng mặc định (rà lại 2026-07-21, giảm rối cho vùng đọc chính phía trên). */}
      {(weightXtcCorr || (selected && !plan)) && (
        <ErrorBoundary compact label="Đối chiếu Khối lượng hàng ↔ Xin tăng cường">
          <Collapsible
            title="🔗 Đối chiếu Khối lượng hàng ↔ Nhu cầu xin tăng cường"
            sub="Độ nhạy KHÁC với độ co giãn xe/hàng ở tab 📋 Kế Hoạch · Dự trù tăng cường phát sinh — kiểm tra chéo, không thay logic FC chính"
            defaultOpen={false}
            style={{ marginTop: 12 }}
          >
            {weightXtcCorr ? (
              <>
                <p className="pe-sub" style={{ margin: "0 0 8px", fontSize: 13 }}>
                  ⚠️ Đây là <b>độ nhạy hàng ↔ xin tăng cường</b> (nguồn "Data hàng"/"BC xin TC") — KHÁC với <b>độ co giãn xe/hàng</b> đã dùng ở mục "Dự trù tăng cường phát sinh" (tab 📋 Kế Hoạch, nguồn FC/planEngine, là số CHÍNH). 2 chỉ số cùng dùng từ "độ nhạy/co giãn" nhưng đo 2 việc khác nhau — mục này chỉ để kiểm tra chéo. Số "ngày thường"/"ngày event" bên dưới đã tính CÙNG THỨ trong tuần (trung bình riêng từng thứ rồi mới gộp) để không bị lệch do 2 nhóm khác cơ cấu thứ.
                </p>
                <div className="pe-kpis" style={{ marginBottom: 8 }}>
                  <div className="pe-kpi"><span className="l">Khối lượng · ngày thường vs event</span>
                    <b style={{ color: "var(--blue)" }}>{weightXtcCorr.baseW.toFixed(1)} → {weightXtcCorr.evW.toFixed(1)} tấn/ngày</b>
                    <span className="u">{weightXtcCorr.dW != null ? `${weightXtcCorr.dW >= 0 ? "+" : ""}${Math.round(weightXtcCorr.dW * 100)}%` : "—"} · {weightXtcCorr.warehouses} khu CK</span>
                  </div>
                  <div className="pe-kpi"><span className="l">Xin tăng cường · ngày thường vs event</span>
                    <b style={{ color: "var(--orange)" }}>{weightXtcCorr.baseX.toFixed(1)} → {weightXtcCorr.evX.toFixed(1)} lượt/ngày</b>
                    <span className="u">{weightXtcCorr.dX != null ? `${weightXtcCorr.dX >= 0 ? "+" : ""}${Math.round(weightXtcCorr.dX * 100)}%` : "—"} · toàn cụm</span>
                  </div>
                  <div className="pe-kpi"><span className="l">Độ nhạy (elasticity)</span>
                    <b style={{ color: "var(--red)" }}>{weightXtcCorr.elasticity != null ? `×${weightXtcCorr.elasticity.toFixed(2)}` : "—"}</b>
                    <span className="u">hàng +1% ↔ xin TC {weightXtcCorr.elasticity != null ? `${weightXtcCorr.elasticity >= 0 ? "+" : ""}${weightXtcCorr.elasticity.toFixed(2)}%` : "—"}</span>
                  </div>
                </div>
                <div className="pe-comment">
                  🤖 Đối chiếu <b>{weightXtcCorr.baseDays} ngày thường</b> vs <b>{weightXtcCorr.eventDays} ngày event</b> trong
                  khoảng Data hàng có số ({dm(new Date(weightXtcCorr.fromIso))}–{dm(new Date(weightXtcCorr.toIso))}
                  {weightXtcCorr.baseDays < 5 ? " — nền so sánh còn MỎNG, chỉ mang tính tham khảo, chưa đủ chắc để làm cơ sở CHÍNH" : ""}).
                  {/* projectedXtcSurge = số DẪN XUẤT 2 lớp (ước tính từ độ nhạy, áp vào %Δ hàng FC) —
                      hạ cấp từ ô KPI in đậm xuống câu chữ thường trong nhận xét (rà lại 2026-07-21),
                      tránh có trọng lượng thị giác ngang các KPI đo TRỰC TIẾP ở trên. */}
                  {projectedXtcSurge ? ` Ước tính (suy từ độ nhạy trên, áp vào %Δ hàng FC dự báo cho kỳ ${selected?.label}, logic FC vẫn là CHÍNH): xin tăng cường có thể đổi ${projectedXtcSurge.dXtcEst >= 0 ? "+" : ""}${Math.round(projectedXtcSurge.dXtcEst * 100)}% so ngày thường — SO SÁNH với phương án đã chốt ở tab 📋 Kế Hoạch (PlanVerdict/PlanBoard), KHÔNG thay thế.` : ""}
                  {" "}⚠️ "Data hàng" đo ở mức <b>khu vực CK</b> (15 khu gom hàng nội thành), KHÔNG có bảng ánh xạ xuống từng bưu cục lẻ trong "xin tăng cường" nên chỉ đối chiếu được ở mức <b>TỔNG CỤM</b>, không tách theo từng BC/khu vực.
                </div>
              </>
            ) : (
              <div className="sl-empty">Chưa đủ dữ liệu "Data hàng" trùng khoảng ngày event để đối chiếu (cần ≥2 ngày thường + ≥2 ngày event cùng có số).</div>
            )}
            {selected && !plan && (
              <div className="pe-comment" style={{ borderLeftColor: "var(--muted)", marginTop: 8 }}>
                ℹ️ Kỳ <b>{selected.label}</b> chưa có Forecast → chưa áp ngược được cho kỳ này. Số ở trên (nếu có) là đối chiếu trên các kỳ ĐÃ QUA để minh hoạ cơ chế — kỳ này sẽ tự tính ngay khi Sheet Forecast được điền.
              </div>
            )}
          </Collapsible>
        </ErrorBoundary>
      )}

      {/* CHI TIẾT ĐỘI XE & NCC — gộp FleetCharts (tải trọng/xe riêng biệt/book NCC) + TrucCompare
          (so Book kỳ này/kỳ trước theo NCC) thành 1 khối rõ ràng, ở tab "Chi tiết & Đánh giá". RÀ LẠI
          2026-07-21 (v2): đổi defaultOpen true→false — trước đây phải MỞ SẴN vì đứng lẫn trong 1 trang
          cuộn dài (không có cách nào khác để "dễ thấy"); nay đã nằm sau 1 cú bấm chuyển tab có chủ đích
          ("đang chủ động đào sâu"), không cần ép tải sẵn 2 biểu đồ nặng ngay khi vào tab — giữ tab này
          gọn như 1 menu tra cứu, Sếp tự mở phần cần. */}
      <ErrorBoundary compact label="Chi tiết đội xe & NCC">
        <Collapsible
          title="📋 Chi tiết đội xe & NCC"
          sub="Tải trọng · xe riêng biệt · book NCC · so kỳ trước"
          defaultOpen={false}
          style={{ marginTop: 12 }}
        >
          <p className="pe-sub" style={{ margin: "0 0 8px", fontSize: 13 }}>
            Xe/NCC ĐANG BOOK cho kỳ này. Muốn xem tỷ lệ ĐÁP ỨNG thực tế (đã điều được xe chưa) hoặc xu hướng NHIỀU KỲ trước → xem tab "Xe TC"/"Lịch sử nhiều kỳ" trong 📊 Đánh giá sau event ở trên.
          </p>
          <FleetCharts fm={fleet} />
          <TrucCompare data={trucCompare} />
        </Collapsible>
      </ErrorBoundary>

      {/* CẤU HÌNH ĐƠN GIÁ & BẢNG GIÁ NCC — tách khỏi CostEstimate.tsx (2026-07-21, v2), đứng độc lập
          ở tab này vì đây là công cụ cấu hình/tra cứu, không phải con số quyết định "tốn bao nhiêu"
          (số đó vẫn ở CostEstimate.tsx, tab 📋 Kế Hoạch). Dùng CHUNG costRates/setCostRates với tab
          Kế Hoạch — sửa giá ở đây, quay lại tab kia sẽ thấy SurgeCostTimeline/CostEstimate cập nhật theo. */}
      <ErrorBoundary compact label="Cấu hình đơn giá & bảng giá NCC">
        <PriceReference rates={costRates} onRatesChange={setCostRates} />
      </ErrorBoundary>
      </>
      )}

      {/* CHAT — dùng CHUNG cho cả 2 tab (hỏi-đáp cắt ngang quyết định lẫn chi tiết), đặt NGOÀI 2 nhánh
          `view` (rà lại 2026-07-21, v2), không nhân bản theo tab. "Nhận định thêm từ AI" đã dời sang
          trong nhánh tab "📋 Kế Hoạch" (ngay sau SurgePlan) — không còn đứng chung với Chat ở đây. */}
      <ErrorBoundary compact label="Trao đổi & điều chỉnh">
      <div className="section-card sl-ai" style={{ marginTop: 12 }}>
          <div className="sl-ai-title">💬 Trao đổi & điều chỉnh</div>
          <div className="sl-ai-sub">Trao đổi về kế hoạch, rồi bấm <b>“🤖 Cập nhật nhận định AI”</b> ở đầu trang để lưu bản mới. Dán link để em đọc · gõ “dạy: …” để dạy kiến thức (dùng chung mọi mục).</div>
          {msgs.length > 0 && (
            <div className="da-msgs" style={{ marginTop: 10 }}>
              {msgs.map((m, i) => (
                <div key={i} className={"da-msg " + m.role} data-msg>
                  {m.quote && <div className="da-quote">↪ {m.quote}</div>}
                  {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
                  <button className="da-reply-btn" title="Trả lời / hỏi về tin này (bôi đen 1 đoạn để trích đúng đoạn đó)" onClick={(e) => quote(m.content, m.role, e)}>↩ Trả lời</button>
                </div>
              ))}
              {chatBusy && <div className="da-msg assistant da-typing">Trợ lý đang trả lời…</div>}
              <div ref={msgsEnd} />
            </div>
          )}
          {replyTo && (
            <div className="da-replybar">
              <span className="da-replybar-tag">↪ Đang trả lời {replyTo.role === "assistant" ? "trợ lý" : "bạn"}:</span>
              <span className="da-replybar-text">{replyTo.text}</span>
              <button className="da-replybar-x" onClick={() => setReplyTo(null)} title="Bỏ trích">✕</button>
            </div>
          )}
          <div className="da-row" style={{ marginTop: 10 }}>
            <input className="pl-in" placeholder={replyTo ? "Hỏi về đoạn đang trích…" : "VD: kỳ này tăng mấy xe? ưu tiên tuyến nào? rủi ro gì?…"} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
            <button className="pl-calc" onClick={send} disabled={chatBusy || !input.trim()}>Gửi</button>
            {msgs.length > 0 && <button className="da-clear" onClick={() => setMsgs([])} title="Xoá hội thoại">✕</button>}
          </div>
      </div>
      </ErrorBoundary>

      <div className="section-card pe-note">✅ Đã nối <b>Forecast volume</b> (FC HCM20 + FC ST) — trợ lý soạn kế hoạch theo <b>số dự báo thật theo ngày × kho</b>, không còn ước lượng. Forecast cập nhật trên Sheet là dashboard tự cập nhật.</div>
    </div>
  );
}
