import { useMemo, useState } from "react";
import { buildTlldDigest, type TlldIndex, type TlldRoute } from "../lib/tlld";
import { DailyAnalysis } from "./DailyAnalysis";
import { exportTlld } from "../lib/exportExcel";
import { useInView } from "../lib/useInView";
import { isWeekendISO } from "../lib/normalize";
import { buildPeriods, GRAN_LABEL, type Granularity } from "../lib/tlldPeriods";

const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");

/** "2026-07-06" -> "06/07" (ngày/tháng gọn). */
const ddmm = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };

/** ISO date (YYYY-MM-DD) cộng n ngày (dùng để dựng trục NGÀY liên tục theo lịch cho biểu đồ dài hạn). */
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

type RangeMode = "7d" | "3w" | "month";
interface Bar { key: string; val: number | null; label: string; weekend: boolean; tip: string }

/** Màu nền theo ngưỡng lấp đầy. */
const baseColor = (v: number | null) =>
  v == null ? "#9aa7b4" : v >= 0.85 ? "#1faa59" : v >= 0.6 ? "#f0a020" : "#e23b3b";

/** Pha sáng (amt>0) / tối (amt<0) một màu hex -> rgb() để tạo mặt 3D. */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 0 : 255, t = Math.abs(amt);
  r = Math.round(r + (f - r) * t); g = Math.round(g + (f - g) * t); b = Math.round(b + (f - b) * t);
  return `rgb(${r},${g},${b})`;
}

interface Item { code: string; tlld: TlldRoute }

const LONG_GRANS: Granularity[] = ["tuan", "d14", "d30", "d60"];
/** Các mốc "N ngày" = hiển thị TỪNG NGÀY trong cửa sổ N ngày gần nhất (KHÔNG gộp tổng). */
const DAY_WINDOW: Partial<Record<Granularity, number>> = { d14: 14, d30: 30, d60: 60 };
const WEEK_CAP = 14; // "Tuần" gộp theo tuần, hiện tối đa 14 tuần gần nhất.
const VN_DOW = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const dowVN = (iso: string) => VN_DOW[new Date(iso + "T00:00:00").getDay()];

/** 1 cột biểu đồ (1 ngày ở chế độ N-ngày, hoặc 1 tuần ở chế độ Tuần). */
interface LB { key: string; val: number | null; label: string; sub: string; weekend: boolean; n: number; running: boolean }

/** Biểu đồ cột theo NGÀY/TUẦN — tự nới rộng + cuộn ngang khi nhiều cột (vd 60 ngày), tô nền
 *  cuối tuần (T7/CN) khi ở chế độ ngày. LUÔN hiện SỐ % trên mỗi cột (Sếp yêu cầu) — cỡ chữ + bề
 *  rộng cột tự co theo mật độ để số không chồng; cột rất dày (60 ngày) bỏ dấu "%" cho gọn. */
function LongBars({ bars }: { bars: LB[] }) {
  const n = bars.length || 1;
  // Nới rộng đủ để SỐ trên đỉnh cột không đè nhau: mỗi cột cần ~26-34px khi có nhãn số.
  const perBar = n <= 12 ? 54 : n <= 24 ? 36 : n <= 40 ? 30 : 24;
  const W = Math.max(720, n * perBar);
  const H = 248, padL = 38, padR = 14, padT = 26, padB = 42;
  const cw = W - padL - padR, ch = H - padT - padB;
  const yMax = Math.max(1, ...bars.map((b) => b.val ?? 0)) * 1.16;
  const slot = cw / n, bw = Math.min(46, slot * 0.64);
  const yOf = (v: number) => padT + ch - (v / yMax) * ch;
  // Đường trung bình — TB lấp đầy của các cột đang hiển thị (cùng cách tính với TrendChart ở
  // "Tổng TLLD Cụm"), để so trực quan cột nào đang cao/thấp hơn mặt bằng chung của đoạn đang xem.
  const withVal2 = bars.filter((b) => b.val != null);
  const meanVal = withVal2.length ? withVal2.reduce((a, b) => a + b.val!, 0) / withVal2.length : null;
  // Nhãn số trên đỉnh cột: cột càng dày, chữ càng nhỏ; >40 cột (60 ngày) bỏ "%" chỉ để số.
  const valFont = n <= 24 ? 10.5 : n <= 40 ? 9 : 8;
  const valText = (v: number) => (n > 40 ? String(Math.round(v * 100)) : pct(v));
  const dayFont = n > 40 ? 8.5 : n > 24 ? 9.5 : 10.5;
  const labelEvery = n <= 16 ? 1 : n <= 32 ? 2 : 3; // nhãn NGÀY (trục dưới) thưa khi dày cho đỡ chồng
  return (
    <div className="sl-chart-scroll">
      <svg className="sl-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={n > 14 ? { minWidth: W } : undefined}>
        {[0.6, 0.85, 1].filter((t) => t <= yMax).map((t, i) => (
          <line key={i} x1={padL} y1={yOf(t)} x2={W - padR} y2={yOf(t)} stroke={t === 0.85 ? "#cfe9da" : t === 0.6 ? "#fbe7c6" : "#eef1f5"} strokeDasharray="4 4" />
        ))}
        {bars.map((b, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          const v = b.val ?? 0, y = yOf(v), h = Math.max(0, padT + ch - y);
          return (
            <g key={b.key}>
              {b.weekend && <rect x={padL + i * slot} y={padT} width={slot} height={ch} fill="rgba(22,104,199,0.12)" />}
              {b.val != null && (
                <rect x={x} y={y} width={bw} height={h} rx={2.5} fill={baseColor(b.val)}>
                  <title>{`${b.label}${b.sub ? " (" + b.sub + ")" : ""}: ${pct(b.val)} · ${b.n} tuyến${b.running ? " · đang chạy" : ""}`}</title>
                </rect>
              )}
              {b.val != null && (
                <text x={x + bw / 2} y={y - 5} textAnchor="middle" className="sl-barval" style={{ fontSize: valFont }}>{valText(b.val)}</text>
              )}
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={H - padB + 15} textAnchor="middle" className="sl-xlb" style={{ fontSize: dayFont, ...(b.weekend ? { fill: "#1356a8", fontWeight: 800 } : {}) }}>{b.label}</text>
              )}
            </g>
          );
        })}
        {meanVal != null && (
          <g>
            <line x1={padL} y1={yOf(meanVal)} x2={W - padR} y2={yOf(meanVal)} stroke="#6b3df0" strokeWidth={1.6} strokeDasharray="6 3" opacity={0.85}>
              <title>{`TB các cột đang xem: ${pct(meanVal)}`}</title>
            </line>
            {/* Nhãn TB đặt CỐ ĐỊNH ở góc trên-trái, không bám đúng độ cao đường TB — đặt sát lề phải
                sẽ đè lên số của cột cuối (cột hay được chú ý nhất), rõ nhất khi nhiều cột (vd 60 ngày)
                dồn nhãn sát mép phải. Có nền trắng mờ phía sau để luôn đọc được. */}
            <rect x={padL} y={padT - 2} width={56} height={16} rx={4} fill="#fff" opacity={0.85} />
            <text x={padL + 4} y={padT + 9} textAnchor="start" fontSize={10.5} fontWeight={800} fill="#6b3df0">TB {pct(meanVal)}</text>
          </g>
        )}
        <line x1={padL} y1={padT + ch} x2={W - padR} y2={padT + ch} stroke="#cdd6e0" />
      </svg>
    </div>
  );
}

/** Xu hướng lấp đầy DÀI HẠN của ĐÚNG nhóm tuyến đang xem (vùng/loại tuyến/tuyến lẻ đang chọn) —
 *  khác với "Tổng TLLD của Cụm" (luôn toàn cụm M12, không đổi theo lựa chọn).
 *  - "Tuần": mỗi cột = 1 tuần (gộp), tối đa 14 tuần gần nhất.
 *  - "14/30/60 Ngày": mỗi cột = 1 NGÀY trong cửa sổ N ngày gần nhất (hiện hết từng ngày, KHÔNG gộp).
 *  Dùng ở CẢ 2 tab: "Tổng Quan" (detailed=true — thêm KPI + bảng số liệu từng ngày/tuần) và "Báo Cáo"
 *  (detailed=false — chỉ biểu đồ + nhận xét gọn). Xem TlldTuyen.tsx / TlldReport bên dưới. */
export function LongTrend({ items, index, detailed = false, scopeLabel }: { items: Item[]; index: TlldIndex; detailed?: boolean; scopeLabel?: string }) {
  const [gran, setGran] = useState<Granularity>("tuan");
  const dayWindow = DAY_WINDOW[gran];

  const bars: LB[] = useMemo(() => {
    if (dayWindow) {
      // THEO NGÀY: gộp TB lấp đầy của cả nhóm cho từng ngày.
      const byDay = new Map<string, { sum: number; cnt: number; routes: Set<string> }>();
      for (const x of items) for (const s of x.tlld.seriesAll) if (s.val != null) {
        let e = byDay.get(s.date);
        if (!e) { e = { sum: 0, cnt: 0, routes: new Set() }; byDay.set(s.date, e); }
        e.sum += s.val; e.cnt++; e.routes.add(x.code);
      }
      const sorted = [...byDay.keys()].sort();
      if (!sorted.length) return [];
      // Trục NGÀY LIÊN TỤC theo lịch (mỗi ngày = 1 cột), ngày không chạy để TRỐNG — để tuyến chạy
      // thưa (vd chỉ 2 ngày trong 60) không bị trải toác thành 2 cột cách xa, mà giữ đúng KHOẢNG
      // CÁCH ngày thật. Cửa sổ = N ngày gần nhất tính lùi từ ngày CÓ DỮ LIỆU mới nhất; trục bắt đầu
      // từ ngày có dữ liệu ĐẦU TIÊN trong cửa sổ (không đệm ngày rỗng ở đầu cho gọn).
      const latest = sorted[sorted.length - 1];
      const windowStart = addDaysISO(latest, -(dayWindow - 1));
      const firstInWindow = sorted.find((d) => d >= windowStart);
      if (!firstInWindow) return [];
      const out: LB[] = [];
      for (let d = firstInWindow; d <= latest; d = addDaysISO(d, 1)) {
        const e = byDay.get(d);
        out.push({ key: d, val: e ? e.sum / e.cnt : null, label: ddmm(d), sub: dowVN(d), weekend: isWeekendISO(d), n: e ? e.routes.size : 0, running: false });
      }
      return out;
    }
    // THEO TUẦN: gộp theo tuần (CN→T7), tối đa 14 tuần gần nhất.
    const periods = buildPeriods(index.allDates, "tuan").slice(-WEEK_CAP);
    return periods.map((p) => {
      const dset = new Set(p.dates); let sum = 0, cnt = 0; const routes = new Set<string>();
      for (const x of items) for (const s of x.tlld.seriesAll) if (s.val != null && dset.has(s.date)) { sum += s.val; cnt++; routes.add(x.code); }
      return { key: p.key, val: cnt ? sum / cnt : null, label: p.shortLabel, sub: "", weekend: false, n: routes.size, running: p.running };
    });
  }, [items, index, gran, dayWindow]);

  const withVal = bars.filter((b) => b.val != null);
  const windowAvg = withVal.length ? withVal.reduce((a, b) => a + b.val!, 0) / withVal.length : null;
  const hi = withVal.reduce<LB | null>((a, b) => (a == null || b.val! > a.val! ? b : a), null);
  const lo = withVal.reduce<LB | null>((a, b) => (a == null || b.val! < a.val! ? b : a), null);
  // Xu hướng: TB nửa CUỐI dải so nửa ĐẦU (ổn hơn so ngày-với-ngày, vốn nhiễu theo thứ trong tuần).
  const trendPts = (() => {
    if (withVal.length < 4) return null;
    const half = Math.floor(withVal.length / 2);
    const firstA = withVal.slice(0, half).reduce((a, b) => a + b.val!, 0) / half;
    const secondArr = withVal.slice(-half); const secondA = secondArr.reduce((a, b) => a + b.val!, 0) / secondArr.length;
    return Math.round((secondA - firstA) * 100);
  })();

  if (!withVal.length) return null;
  const unit = dayWindow ? "ngày" : "tuần";

  return (
    <div className="section-card tlld-report" style={{ marginTop: 14 }}>
      <div className="sl-chart-h" style={{ marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span>
          📈 Xu hướng lấp đầy dài hạn{" "}
          <span style={{ color: "var(--muted)", fontWeight: 600 }}>
            ({scopeLabel || "nhóm tuyến đang xem"} · {items.length} tuyến · {dayWindow ? `TB lấp đầy mỗi ngày, ${dayWindow} ngày gần nhất` : "gộp theo tuần, 14 tuần gần nhất"})
          </span>{" "}
          <span
            className="info-dot"
            title={
              "Cách đọc biểu đồ này:\n" +
              `• Phạm vi: đúng nhóm ${items.length} tuyến đang xem ở trên (lọc theo vùng + loại tuyến, hoặc theo kết quả tìm kiếm) — KHÔNG phải toàn Cụm M12, KHÔNG phải 1 tuyến lẻ.\n` +
              (dayWindow
                ? `• Mỗi cột = 1 NGÀY; giá trị = trung bình tỷ lệ lấp đầy (TLLD) của tất cả tuyến trong nhóm CÓ CHẠY hôm đó. Ngày không tuyến nào chạy để trống.\n`
                : `• Mỗi cột = 1 TUẦN (CN→T7); giá trị = trung bình TLLD của mọi lượt chạy trong tuần của nhóm.\n`) +
              "• Cửa sổ tính lùi từ ngày CÓ DỮ LIỆU mới nhất.\n" +
              "• Màu cột theo mức lấp đầy (xanh cao / cam khá / đỏ thấp); đường tím nét đứt = TB cả dải đang xem.\n" +
              "→ Muốn xem TLLD toàn Cụm M12 (không đổi theo lựa chọn), dùng bảng “Tổng TLLD Cụm”."
            }
          >ⓘ</span>
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {LONG_GRANS.map((g) => (
            <button key={g} className={"cat-chip" + (gran === g ? " active" : "")} onClick={() => setGran(g)}>{GRAN_LABEL[g]}</button>
          ))}
        </div>
      </div>
      <LongBars bars={bars} />
      <div className="pe-comment">
        🤖 TB lấp đầy nhóm này qua {withVal.length} {unit}: <b style={{ color: baseColor(windowAvg) }}>{pct(windowAvg)}</b>
        {hi && lo && <> · cao nhất <b>{pct(hi.val)}</b> ({hi.label}) · thấp nhất <b>{pct(lo.val)}</b> ({lo.label})</>}.
        {trendPts != null && (
          <> Xu hướng nửa cuối so nửa đầu: <b style={{ color: trendPts >= 0 ? "var(--green)" : "var(--red)" }}>{trendPts >= 0 ? "+" : ""}{trendPts} điểm %</b>.</>
        )}
      </div>

      {detailed && (
        <>
          <div className="tr-kpis" style={{ marginTop: 10 }}>
            <div className="tr-kpi"><span className="l">TB {withVal.length} {unit}</span><b style={{ color: baseColor(windowAvg) }}>{pct(windowAvg)}</b></div>
            <div className="tr-kpi"><span className="l">Xu hướng (nửa cuối/đầu)</span><b style={{ color: trendPts == null ? "var(--muted)" : trendPts >= 0 ? "var(--green)" : "var(--red)" }}>{trendPts == null ? "—" : (trendPts >= 0 ? "+" : "") + trendPts + "đ"}</b></div>
            {hi && <div className="tr-kpi"><span className="l">Cao nhất · {hi.label}</span><b style={{ color: baseColor(hi.val) }}>{pct(hi.val)}</b></div>}
            {lo && <div className="tr-kpi"><span className="l">Thấp nhất · {lo.label}</span><b style={{ color: baseColor(lo.val) }}>{pct(lo.val)}</b></div>}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Báo cáo TLLD cho nhóm tuyến đang chọn: biểu đồ TB lấp đầy 7 ngày (cột 3D),
 * phân bố theo mức lấp đầy, và nhận định của trợ lý AI.
 */
export function TlldReport({
  items,
  index,
  regionLabel,
  catLabel,
}: {
  items: Item[];
  index: TlldIndex | null;
  regionLabel: string;
  catLabel: string;
}) {
  const digest = useMemo(
    () => (index && items.length
      ? buildTlldDigest(items, { regionLabel, catLabel, refDate: index.refDate, last7: index.last7, eventLabel: index.event?.label })
      : ""),
    [items, index, regionLabel, catLabel]
  );

  // Công cụ (function calling) cho trợ lý tra số TLLD chính xác của nhóm tuyến đang xem.
  const tools = useMemo(() => {
    const pc = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100));
    const base = items.map((x) => ({ code: x.code, n1: pc(x.tlld.n1), avg7: pc(x.tlld.avg7), avg30: pc(x.tlld.avg30) }));
    const v = (r: { n1: number | null; avg7: number | null }) => (r.n1 ?? r.avg7 ?? 0);
    const decls = [
      { name: "thong_ke_nhom", description: "Thống kê tổng quan nhóm tuyến đang xem: số tuyến, TB lấp đầy N-1 & 7 ngày, số tuyến tốt(≥85%)/khá(60-85%)/thấp(<60%)/vượt tải(>100%).", parameters: { type: "OBJECT", properties: {} } },
      { name: "tra_tuyen", description: "Tra TLLD của tuyến theo mã (khớp gần đúng, không dấu cũng được). Trả về N-1, TB 7 ngày, TB tháng (đơn vị %).", parameters: { type: "OBJECT", properties: { ma_tuyen: { type: "STRING", description: "mã tuyến hoặc một phần mã, vd 'SG_CK2_101'" } }, required: ["ma_tuyen"] } },
      { name: "top_tuyen", description: "Lấy danh sách tuyến theo tiêu chí.", parameters: { type: "OBJECT", properties: { loai: { type: "STRING", description: "thap (lấp đầy thấp nhất) | cao (cao nhất) | vuot_tai (>100%)" }, n: { type: "INTEGER", description: "số lượng, mặc định 5" } }, required: ["loai"] } },
    ];
    const run = (name: string, args: any) => {
      if (name === "thong_ke_nhom") {
        const withV = base.filter((r) => r.n1 != null || r.avg7 != null);
        const mean = (k: "n1" | "avg7") => { const a = withV.map((r) => r[k]).filter((x): x is number => x != null); return a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null; };
        return {
          so_tuyen: items.length, tb_n1_phantram: mean("n1"), tb_7ngay_phantram: mean("avg7"),
          tot_85: withV.filter((r) => v(r) >= 85).length, kha_60_85: withV.filter((r) => v(r) >= 60 && v(r) < 85).length,
          thap_duoi_60: withV.filter((r) => v(r) < 60).length, vuot_tai_tren_100: withV.filter((r) => v(r) > 100).length,
        };
      }
      if (name === "tra_tuyen") {
        const q = String(args?.ma_tuyen || "").toUpperCase().replace(/\s+/g, "");
        const hits = base.filter((r) => r.code.toUpperCase().replace(/\s+/g, "").includes(q)).slice(0, 12);
        return hits.length ? { ket_qua: hits } : { thong_bao: "Không tìm thấy tuyến khớp mã này trong nhóm đang xem." };
      }
      if (name === "top_tuyen") {
        const n = Math.min(20, Math.max(1, Number(args?.n) || 5));
        const loai = String(args?.loai || "thap");
        let list = [...base];
        if (loai === "cao") list.sort((a, b) => v(b) - v(a));
        else if (loai === "vuot_tai") list = list.filter((r) => v(r) > 100).sort((a, b) => v(b) - v(a));
        else list.sort((a, b) => v(a) - v(b));
        return { loai, ket_qua: list.slice(0, n) };
      }
      return { error: "Công cụ không hợp lệ" };
    };
    return { decls, run };
  }, [items]);

  const [chartRef, chartIn] = useInView<HTMLDivElement>(); // PHẢI gọi trước mọi return (quy tắc Hooks)
  const [mode, setMode] = useState<RangeMode>("7d"); // khung thời gian biểu đồ: 7 ngày / 3 tuần / tháng

  if (!index || items.length === 0) return null;

  const valOf = (t: TlldRoute) => t.n1 ?? t.avg7;
  const avg = (sel: (t: TlldRoute) => number | null) => {
    const vs = items.map((x) => sel(x.tlld)).filter((v): v is number => v != null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  const avgN1 = avg((t) => t.n1);
  const avg7 = avg((t) => t.avg7);

  const high = items.filter((x) => (valOf(x.tlld) ?? 0) >= 0.85).length;
  const mid = items.filter((x) => { const v = valOf(x.tlld) ?? -1; return v >= 0.6 && v < 0.85; }).length;
  const low = items.filter((x) => (valOf(x.tlld) ?? 1) < 0.6).length;
  const distSum = high + mid + low || 1;

  // TB lấp đầy 1 ngày trên cả nhóm tuyến đang xem (bỏ tuyến thiếu dữ liệu ngày đó).
  const dayAvg = (d: string, sel: (t: TlldRoute) => { date: string; val: number | null }[]) => {
    const vs = items.map((x) => sel(x.tlld).find((s) => s.date === d)?.val ?? null).filter((v): v is number => v != null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };

  // ----- dữ liệu biểu đồ: cột THEO NGÀY, cửa sổ 7 / 21 / 30 ngày gần nhất -----
  const days = mode === "7d" ? index.last7 : mode === "3w" ? index.last30.slice(-21) : index.last30.slice(-30);
  const bars: Bar[] = days.map((d) => {
    const avg = dayAvg(d, (t) => (mode === "7d" ? t.series : t.series30));
    return { key: d, val: avg, label: ddmm(d), weekend: isWeekendISO(d), tip: `${ddmm(d)}: ${pct(avg)}` };
  });

  // ----- biểu đồ cột 3D -----
  const n = bars.length || 1;
  // nhiều cột -> nới rộng SVG (px) để cột đủ dày & cuộn ngang trong khung, thay vì nén dí sát nhau.
  const W = mode === "7d" ? 760 : Math.max(760, n * 40);
  const H = 260, padL = 46, padR = 14, padT = 22, padB = 40;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const yMax = Math.max(1, ...bars.map((p) => p.val ?? 0)) * 1.08;
  const slot = chartW / n;
  const barW = Math.min(70, slot * 0.5);
  const yOf = (v: number) => padT + chartH - (v / yMax) * chartH;
  const ticks = [0, 0.5, 0.85, 1].filter((t) => t <= yMax);
  const chartKey = `${regionLabel}|${catLabel}|${mode}`;

  return (
    <>
      <div className="section-card tlld-report" style={{ marginTop: 14 }}>
        <div className="sl-chart-h" style={{ marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>📊 Báo cáo TLLD · {catLabel} <span style={{ color: "var(--muted)", fontWeight: 600 }}>({items.length} tuyến · {regionLabel})</span></span>
          <button className="xlsx-btn" onClick={() => exportTlld(items.map((x) => ({ code: x.code, n1: x.tlld.n1, avg7: x.tlld.avg7, avg30: x.tlld.avg30 })), `${regionLabel}_${catLabel}`)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
            Excel
          </button>
        </div>

        <div className="tr-kpis">
          <div className="tr-kpi"><span className="l">TB lấp đầy N-1</span><b style={{ color: baseColor(avgN1) }}>{pct(avgN1)}</b></div>
          <div className="tr-kpi"><span className="l">TB 7 ngày</span><b style={{ color: baseColor(avg7) }}>{pct(avg7)}</b></div>
          <div className="tr-kpi"><span className="l">🟢 ≥85%</span><b style={{ color: "var(--green)" }}>{high}</b></div>
          <div className="tr-kpi"><span className="l">🟠 60–85%</span><b style={{ color: "var(--orange)" }}>{mid}</b></div>
          <div className="tr-kpi"><span className="l">🔴 &lt;60%</span><b style={{ color: "var(--red)" }}>{low}</b></div>
        </div>

        <div className="tr-sub" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>TB lấp đầy theo ngày · {mode === "7d" ? "7" : mode === "3w" ? "21" : "30"} ngày gần nhất</span>
          <div style={{ display: "flex", gap: 6 }}>
            {([["7d", "7 ngày"], ["3w", "21 ngày"], ["month", "30 ngày"]] as [RangeMode, string][]).map(([k, lb]) => (
              <button key={k} className={"cat-chip" + (mode === k ? " active" : "")} onClick={() => setMode(k)}>{lb}</button>
            ))}
          </div>
        </div>
        <div className={"sl-chart-scroll tlld-rpt-chart" + (chartIn ? " in-view" : "")} ref={chartRef}>
          <svg key={chartKey} className="sl-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={mode !== "7d" ? { minWidth: W } : undefined}>
            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={padL} y1={yOf(t)} x2={W - padR} y2={yOf(t)} stroke={t === 0.85 ? "#cfe9da" : t === 0.6 ? "#fbe7c6" : "#eef1f5"} strokeDasharray={t === 0.85 || t === 0.5 ? "4 4" : undefined} />
                <text x={padL - 7} y={yOf(t) + 4} textAnchor="end" className="sl-axis">{Math.round(t * 100)}%</text>
              </g>
            ))}
            {bars.map((p, i) => {
              const v = p.val ?? 0;
              const x = padL + i * slot + (slot - barW) / 2;
              const y = yOf(v);
              const h = Math.max(0, padT + chartH - y);
              const base = baseColor(p.val);
              const d = Math.max(5, Math.min(11, barW * 0.2));
              const x2 = x + barW;
              return (
                <g key={p.key}>
                  {p.weekend && <rect x={padL + i * slot} y={padT} width={slot} height={chartH} rx={4} fill="rgba(22,104,199,0.15)" />}
                  <g className="sl-bar3d fx-pop" style={{ animationDelay: i * 0.08 + "s" }}>
                    <polygon points={`${x2},${y} ${x2 + d},${y - d} ${x2 + d},${y - d + h} ${x2},${y + h}`} fill={shade(base, -0.28)} />
                    <polygon points={`${x},${y} ${x + d},${y - d} ${x2 + d},${y - d} ${x2},${y}`} fill={shade(base, 0.3)} />
                    <rect x={x} y={y} width={barW} height={h} fill={base} />
                    <title>{p.tip}</title>
                  </g>
                  {h > 0 && <text className="sl-barval" style={{ animationDelay: i * 0.08 + 0.4 + "s" }} x={x + barW / 2 + d / 2} y={y - d - 6} textAnchor="middle">{pct(p.val)}</text>}
                  <text x={x + barW / 2} y={H - padB + 16} textAnchor="middle" className="sl-xlb" style={mode !== "7d" ? { fontSize: 11.5, ...(p.weekend ? { fill: "#1356a8", fontWeight: 800 } : {}) } : (p.weekend ? { fill: "#1356a8", fontWeight: 800 } : undefined)}>{p.label}</text>
                </g>
              );
            })}
            <line x1={padL} y1={padT + chartH} x2={W - padR} y2={padT + chartH} stroke="#cdd6e0" />
          </svg>
        </div>

        <div className="tr-sub" style={{ marginTop: 10 }}>Phân bố tuyến theo mức lấp đầy (N-1)</div>
        <div className="sl-loaibar">
          {high > 0 && <div className="sl-loaibar-seg" style={{ width: (high / distSum) * 100 + "%", background: "var(--green)" }} title={`≥85%: ${high} tuyến`} />}
          {mid > 0 && <div className="sl-loaibar-seg" style={{ width: (mid / distSum) * 100 + "%", background: "var(--orange)" }} title={`60–85%: ${mid} tuyến`} />}
          {low > 0 && <div className="sl-loaibar-seg" style={{ width: (low / distSum) * 100 + "%", background: "var(--red)" }} title={`<60%: ${low} tuyến`} />}
        </div>
        <div className="sl-loaileg">
          <span><i style={{ background: "var(--green)" }} />Tốt ≥85%: <b>{high}</b></span>
          <span><i style={{ background: "var(--orange)" }} />Khá 60–85%: <b>{mid}</b></span>
          <span><i style={{ background: "var(--red)" }} />Thấp &lt;60%: <b>{low}</b></span>
        </div>
      </div>

      <LongTrend items={items} index={index} scopeLabel={`${regionLabel} · ${catLabel}`} />

      <DailyAnalysis
        id={"tlld-" + (regionLabel + "-" + catLabel).replace(/\s+/g, "-").replace(/[^\w-]/g, "")}
        digest={digest}
        title="🤖 Nhận định TLLD từ Trợ lý"
        sub={`Trợ lý tự đọc toàn bộ TLLD nhóm ${catLabel} (${items.length} tuyến) lúc 09:00 mỗi ngày → nhận định, chỉ ra tuyến lãng phí nên ghép tải / tuyến vượt tải, đề xuất hành động.`}
        tools={tools}
      />
    </>
  );
}
