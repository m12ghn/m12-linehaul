/* ============================================================
   Biểu đồ xu hướng (N ngày gần nhất):
   - CỘT xanh lá = SỐ LƯỢT XIN tăng cường mỗi ngày (trục trái, đơn vị: lượt).
   - ĐƯỜNG cam  = EMA (trung bình động luỹ thừa) của số lượt xin — làm mượt để
     thấy XU HƯỚNG như đường MA trong biểu đồ chứng khoán. CÙNG trục với cột
     (đều là "số lượt") nên so trực tiếp được: đường dưới cột = ngày cao hơn xu hướng.
   Chu kỳ EMA: 3 (khi ≤10 ngày) hoặc 7 (dài hơn).
   ============================================================ */
import type { DayBar } from "../lib/xinTangCuong";
import { isWeekendISO } from "../lib/normalize";

const GREEN = "#2f8f4e";
const EMA_C = "#f15a24";

export function TrendChart({ series, showRateLabels }: { series: DayBar[]; showRateLabels: boolean }) {
  const n = series.length;
  if (n === 0) return null;
  const maxTotal = Math.max(1, ...series.map((b) => b.total));

  // EMA số lượt xin (giống MA chứng khoán) — chu kỳ nhỏ khi ít ngày.
  const P = n <= 10 ? 3 : 7;
  const k = 2 / (P + 1);
  const ema: number[] = [];
  series.forEach((b, i) => { ema[i] = i === 0 ? b.total : b.total * k + ema[i - 1] * (1 - k); });

  const padL = 30, padR = 40, padTop = 24, padBot = 30, PH = 130;
  const stepX = n <= 8 ? 70 : 36;
  const innerW = (n - 1) * stepX;
  const W = padL + innerW + padR;
  const H = padTop + PH + padBot;
  const x = (i: number) => padL + i * stepX;
  const bw = Math.min(26, stepX * 0.6);
  const y = (v: number) => padTop + PH - (v / maxTotal) * PH;
  const emaLine = ema.map((v, i) => `${x(i)},${y(v)}`).join(" ");

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W, width: "100%", height: H, maxWidth: n <= 8 ? W : undefined }}>
        {/* dải nền cuối tuần */}
        {series.map((b, i) =>
          isWeekendISO(b.key) ? (
            <rect key={"we" + i} x={x(i) - stepX / 2} y={padTop - 4} width={stepX} height={PH + 8} fill="rgba(22,104,199,0.07)" />
          ) : null
        )}
        {/* lưới + trục TRÁI (lượt) */}
        {[0, 0.5, 1].map((g) => {
          const yy = padTop + PH - g * PH;
          return (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="var(--line)" strokeWidth={1} />
              <text x={padL - 4} y={yy + 3} textAnchor="end" fontSize={8.5} fill={GREEN}>{Math.round(g * maxTotal)}</text>
            </g>
          );
        })}

        {/* CỘT số lượt xin + số trên đỉnh */}
        {series.map((b, i) => {
          const yb = y(b.total), h = padTop + PH - yb;
          return (
            <g key={"b" + i}>
              <rect x={x(i) - bw / 2} y={yb} width={bw} height={Math.max(0, h)} rx={3} fill={GREEN} opacity={0.85}>
                <title>{`${b.label}: ${b.total} lượt xin${b.coXe + b.khongXe ? ` · ${Math.round((b.coXe / (b.coXe + b.khongXe)) * 100)}% đáp ứng` : ""}`}</title>
              </rect>
              <text x={x(i)} y={yb - 4} textAnchor="middle" fontSize={10} fill={GREEN} fontWeight={800}>{b.total}</text>
            </g>
          );
        })}

        {/* ĐƯỜNG EMA số lượt xin (xu hướng) */}
        {n > 1 && <polyline points={emaLine} fill="none" stroke={EMA_C} strokeWidth={2.5} strokeLinejoin="round" />}
        {series.map((_, i) => (
          <circle key={"e" + i} cx={x(i)} cy={y(ema[i])} r={2.4} fill="#fff" stroke={EMA_C} strokeWidth={1.6} />
        ))}
        {/* nhãn EMA ở điểm cuối (giá trị xu hướng hiện tại) */}
        <text x={x(n - 1) + 4} y={y(ema[n - 1]) + 3} fontSize={9} fontWeight={800} fill={EMA_C}>EMA{P}</text>
        {showRateLabels && series.map((_, i) => (
          <text key={"el" + i} x={x(i)} y={y(ema[i]) - 7} textAnchor="middle" fontSize={8.5} fill={EMA_C} fontWeight={700}>{ema[i].toFixed(0)}</text>
        ))}

        {/* nhãn ngày */}
        {series.map((b, i) => {
          const we = isWeekendISO(b.key);
          return (
            <text key={"x" + i} x={x(i)} y={H - 10} textAnchor="middle" fontSize={9} fontWeight={we ? 800 : 400} fill={we ? "#1668c7" : "var(--muted)"}>
              {b.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
