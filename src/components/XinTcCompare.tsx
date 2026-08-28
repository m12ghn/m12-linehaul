import { useMemo } from "react";
import { comparePeriods, type Gran, type XtcRec } from "../lib/xinTangCuong";

const CUR = "#e11d48";  // kỳ này (ĐỎ)
const PREV = "#1668c7"; // kỳ trước (XANH)
const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");
const f1 = (n: number) => n.toFixed(n < 10 ? 1 : 0);

/** 1 ô chỉ báo so sánh kỳ này vs kỳ trước. */
export function Kpi({ label, cur, prev, delta, color }: { label: string; cur: string; prev: string; delta?: string; color?: string }) {
  return (
    <div style={{ flex: "1 1 120px", minWidth: 110, background: "var(--bg)", borderRadius: 10, padding: "8px 11px" }}>
      <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || "var(--ink)", lineHeight: 1.2 }}>{cur}
        {delta && <span style={{ fontSize: 13.5, marginLeft: 5, color }}>{delta}</span>}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>kỳ trước: {prev}</div>
    </div>
  );
}

/**
 * SO SÁNH CÙNG KỲ: lượt xin tăng cường kỳ này vs kỳ liền trước (căn theo ngày).
 * Kỳ đang diễn ra chỉ so phần đã trôi qua (vd T7 ngày 1–7 vs T6 ngày 1–7).
 * Gồm dải chỉ báo (tổng · TB/ngày · đỉnh · đáp ứng · số ngày tăng/giảm) + biểu đồ cột kép.
 */
export function XinTcCompare({ recs, gran, sel }: { recs: XtcRec[]; gran: Gran; sel: string }) {
  const cmp = useMemo(() => comparePeriods(recs, gran, sel), [recs, gran, sel]);
  if (!cmp || (cmp.curTotal === 0 && cmp.prevTotal === 0)) return null;

  const { bars } = cmp;
  const max = Math.max(1, ...bars.flatMap((b) => [b.cur, b.prev]));
  const n = bars.length || 1;
  // To hơn hẳn bản cũ (190px) + rộng theo số cột để có chỗ ghi SỐ trên mỗi cột (không chỉ đỉnh).
  const W = Math.max(760, n * 30), H = 300, padL = 14, padR = 14, padT = 34, padB = 34;
  const cw = W - padL - padR, ch = H - padT - padB;
  const slot = cw / n;
  const groupW = Math.min(slot * 0.8, 52), bw = groupW / 2;
  const yOf = (v: number) => padT + ch - (v / (max * 1.15)) * ch;
  const showLabel = (i: number) => n <= 16 || i % 2 === 0;

  const chg = cmp.changePct;
  const chgTxt = chg == null ? "—" : `${chg >= 0 ? "+" : ""}${Math.round(chg * 100)}%`;
  const chgColor = chg == null ? "var(--muted)" : chg > 0.02 ? "var(--red)" : chg < -0.02 ? "var(--green)" : "var(--ink)";
  const rDelta = cmp.curRate != null && cmp.prevRate != null ? Math.round((cmp.curRate - cmp.prevRate) * 100) : null;

  // Mẫu ít ngày đã trôi qua (vd đầu tuần/đầu tháng) -> hạ giọng chắc chắn, không kết luận dứt khoát.
  const elapsedN = cmp.bars.filter((b) => !b.beyond).length;
  const lowSample = elapsedN > 0 && elapsedN < 3;

  // Nhận xét tự động.
  const insight = (() => {
    const parts: string[] = [];
    if (chg != null) parts.push(`Nhu cầu ${chg > 0.02 ? `<b style="color:${chgColor}">tăng ${Math.round(chg * 100)}%</b>` : chg < -0.02 ? `<b style="color:${chgColor}">giảm ${Math.abs(Math.round(chg * 100))}%</b>` : "≈ đi ngang"} so kỳ trước (${cmp.curTotal} vs ${cmp.prevTotal} lượt${cmp.partial ? `, tính đến ${cmp.asOf}` : ""}).`);
    else if (cmp.prevTotal === 0 && cmp.curTotal > 0) parts.push(`Phát sinh <b>MỚI</b> xuất hiện kỳ này (${cmp.curTotal} lượt) — kỳ trước không có để so sánh.`);
    if (cmp.curPeak.val > 0) parts.push(`Đỉnh ngày <b>${cmp.curPeak.label}</b> (${cmp.curPeak.val} lượt).`);
    parts.push(`${cmp.daysUp} ngày cao hơn · ${cmp.daysDown} ngày thấp hơn cùng ngày kỳ trước.`);
    if (rDelta != null) parts.push(`Đáp ứng ${rDelta >= 0 ? "+" : ""}${rDelta}đ.`);
    if (lowSample) parts.push(`<i>(mới ${elapsedN} ngày dữ liệu — số liệu sơ bộ, chưa đủ để chắc chắn.)</i>`);
    return parts.join(" ");
  })();

  return (
    <div>
      <h3 style={{ fontSize: 15.5, margin: "0 0 8px" }}>
        📊 So sánh cùng kỳ — {cmp.curLabel} <span style={{ color: "var(--muted)", fontWeight: 400 }}>vs {cmp.prevLabel}</span>
        {cmp.partial && <span style={{ fontSize: 13, color: "var(--orange)", marginLeft: 6 }}>· tính đến {cmp.asOf}</span>}
      </h3>

      {/* Dải chỉ báo */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <Kpi label="Tổng lượt xin" cur={String(cmp.curTotal)} prev={String(cmp.prevTotal)} delta={chgTxt} color={chgColor} />
        <Kpi label="TB lượt/ngày" cur={f1(cmp.curAvg)} prev={f1(cmp.prevAvg)} />
        <Kpi label="Ngày đỉnh" cur={`${cmp.curPeak.val}`} prev={`${cmp.prevPeak.val}`} color={CUR} />
        <Kpi label="Đáp ứng" cur={pct(cmp.curRate)} prev={pct(cmp.prevRate)} delta={rDelta == null ? undefined : `${rDelta >= 0 ? "+" : ""}${rDelta}đ`} color={rDelta != null && rDelta < 0 ? "var(--red)" : "var(--green)"} />
        <Kpi label="Ngày tăng/giảm" cur={`↑${cmp.daysUp}`} prev={`↓${cmp.daysDown}`} color={cmp.daysUp >= cmp.daysDown ? "var(--red)" : "var(--green)"} />
      </div>

      {/* Biểu đồ cột kép TO, có SỐ trên mỗi cột (không chỉ đỉnh), tô cuối tuần, ngày chưa tới làm mờ */}
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: 300, minWidth: n > 10 ? n * 26 : 420 }}>
          {[0, 0.5, 1].map((g, i) => <line key={i} x1={padL} y1={yOf(g * max * 1.15)} x2={W - padR} y2={yOf(g * max * 1.15)} stroke="#eef1f5" />)}
          {bars.map((b, i) => {
            const gx = padL + i * slot + (slot - groupW) / 2;
            const pc = b.prev ? Math.round((b.cur / b.prev - 1) * 100) : null;
            const isPeak = b.cur === cmp.curPeak.val && b.cur > 0;
            return (
              <g key={i} opacity={b.beyond ? 0.4 : 1}>
                {b.weekend && <rect x={gx - slot * 0.1} y={padT} width={groupW + slot * 0.2} height={ch} fill="rgba(245,166,35,0.14)" rx={3} />}
                <rect x={gx} y={yOf(b.prev)} width={Math.max(1, bw - 1)} height={Math.max(0, padT + ch - yOf(b.prev))} rx={2} fill={PREV} opacity={0.55}>
                  <title>{`${cmp.prevLabel} · ${b.date} (${b.label}): ${b.prev} lượt`}</title>
                </rect>
                <rect x={gx + bw} y={yOf(b.cur)} width={Math.max(1, bw - 1)} height={Math.max(0, padT + ch - yOf(b.cur))} rx={2} fill={CUR} stroke={isPeak ? "#b5401a" : undefined} strokeWidth={isPeak ? 1.5 : 0}>
                  <title>{`${cmp.curLabel} · ${b.date} (${b.label}): ${b.cur} lượt${pc != null ? ` (${pc >= 0 ? "+" : ""}${pc}% vs kỳ trước)` : ""}`}</title>
                </rect>
                {/* SỐ trên mỗi cột: kỳ trước (xanh) hiện khi đủ chỗ (≤16 cột); kỳ này (đỏ) LUÔN hiện — đỉnh viền cam */}
                {b.prev > 0 && n <= 16 && <text x={gx + bw / 2} y={yOf(b.prev) - 3} textAnchor="middle" style={{ fontSize: 9.5, fontWeight: 700, fill: PREV, opacity: 0.85 }}>{b.prev}</text>}
                {b.cur > 0 && (
                  <text x={gx + bw + bw / 2} y={yOf(b.cur) - 3} textAnchor="middle" style={{ fontSize: isPeak ? 11 : 9, fontWeight: 800, fill: CUR }}>{b.cur}</text>
                )}
                {showLabel(i) && <text x={gx + groupW / 2} y={H - padB + 14} textAnchor="middle" style={{ fontSize: 10.5, fill: b.weekend ? "#c47f0a" : "var(--muted)", fontWeight: b.weekend ? 700 : 400 }}>{gran === "tuan" ? `${b.label} ${b.date}` : b.date}</text>}
              </g>
            );
          })}
          <line x1={padL} y1={padT + ch} x2={W - padR} y2={padT + ch} stroke="#cdd6e0" />
        </svg>
      </div>

      <div style={{ display: "flex", gap: 16, fontSize: 13.5, margin: "6px 0" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><i style={{ width: 11, height: 11, borderRadius: 3, background: CUR, display: "inline-block" }} /> {cmp.curLabel}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><i style={{ width: 11, height: 11, borderRadius: 3, background: PREV, opacity: 0.55, display: "inline-block" }} /> {cmp.prevLabel}</span>
        <span style={{ color: "var(--muted)" }}>▨ nền vàng = cuối tuần · mờ = ngày chưa tới</span>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: "#3a4753", background: "var(--bg)", borderLeft: "3px solid var(--orange)", borderRadius: 8, padding: "8px 12px" }}
        dangerouslySetInnerHTML={{ __html: "<b>🤖 Nhận xét:</b> " + insight }} />
    </div>
  );
}
