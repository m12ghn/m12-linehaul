/* ============================================================
   Gauge nửa vòng tròn (như "thị phần") — dùng cho thẻ KPI tổng quan.
   pct: 0..1 (tỷ lệ lấp đầy cung). center: nội dung GIỮA cung (số/%).
   ============================================================ */

const R = 44, CX = 50, CY = 50, SW = 9;

/** Toạ độ điểm trên cung tại fraction f (0=trái 180°, 1=phải 0°). */
function pt(f: number): [number, number] {
  const a = (180 * (1 - f) * Math.PI) / 180;
  return [CX + R * Math.cos(a), CY - R * Math.sin(a)];
}

/** Path SVG của cung từ 0 -> f. */
function arc(f: number): string {
  const [x0, y0] = pt(0);
  const [x1, y1] = pt(Math.max(0, Math.min(1, f)));
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

export function Gauge({
  pct, color, center, sub, label,
}: {
  pct: number;            // 0..1
  color: string;          // màu cung giá trị
  center: string;         // số/% ở giữa
  sub?: string;           // dòng nhỏ dưới số giữa
  label: string;          // nhãn dưới gauge
}) {
  const f = Math.max(0, Math.min(1, pct));
  return (
    <div className="gauge">
      <div className="gauge-arc">
        <svg viewBox="0 0 100 56" preserveAspectRatio="xMidYMid meet">
          <path d={arc(1)} fill="none" stroke="var(--gauge-track)" strokeWidth={SW} strokeLinecap="round" />
          {f > 0.001 && <path d={arc(f)} fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" />}
        </svg>
        <div className="gauge-center">
          <span className="gauge-num" style={{ color }}>{center}</span>
          {sub && <span className="gauge-sub">{sub}</span>}
        </div>
      </div>
      <div className="gauge-label">{label}</div>
    </div>
  );
}
