/* ============================================================
   Donut chart đơn giản (vòng tròn tỷ trọng) — tái dùng cho NCC,
   cơ cấu tải… Có % trên cung + chú thích bên cạnh.
   ============================================================ */

export interface DonutItem { label: string; value: number; color: string }

const R = 42, RIN = 26, CX = 50, CY = 50;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
/** Path 1 lát donut từ góc a0->a1 (độ). */
function slice(a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [ox0, oy0] = polar(CX, CY, R, a0);
  const [ox1, oy1] = polar(CX, CY, R, a1);
  const [ix1, iy1] = polar(CX, CY, RIN, a1);
  const [ix0, iy0] = polar(CX, CY, RIN, a0);
  return `M${ox0.toFixed(2)},${oy0.toFixed(2)} A${R},${R} 0 ${large} 1 ${ox1.toFixed(2)},${oy1.toFixed(2)} L${ix1.toFixed(2)},${iy1.toFixed(2)} A${RIN},${RIN} 0 ${large} 0 ${ix0.toFixed(2)},${iy0.toFixed(2)} Z`;
}

export function Donut({ items, center, centerSub }: { items: DonutItem[]; center?: string; centerSub?: string }) {
  const total = items.reduce((a, x) => a + x.value, 0) || 1;
  // Khe hở giữa các lát: 1.5° khi nhiều lát (để phân biệt mắt thường); CHỈ 1 lát (100%) thì khe hở
  // phải RẤT NHỎ (0.05°) — không phải 0, vì SVG "A" (arc) không vẽ được khi điểm đầu = điểm cuối
  // (vòng tròn tròn đủ 360°) -> lát 100% sẽ BIẾN MẤT hoàn toàn nếu không có khe hở này.
  const gapDeg = items.length > 1 ? 1.5 : 0.05;
  let acc = 0;
  const arcs = items.map((it) => {
    const a0 = (acc / total) * 360;
    acc += it.value;
    const a1 = (acc / total) * 360;
    const mid = (a0 + a1) / 2;
    const pctNum = (it.value / total) * 100;
    return { ...it, a0, a1, mid, pctNum };
  });
  return (
    <div className="donut">
      <svg viewBox="0 0 100 100" className="donut-svg">
        {arcs.map((a) => (
          <path key={a.label} d={slice(a.a0, a.a1 - gapDeg)} fill={a.color}>
            <title>{`${a.label}: ${a.value} (${a.pctNum.toFixed(1)}%)`}</title>
          </path>
        ))}
        {center != null && <text x={CX} y={CY - 1} textAnchor="middle" className="donut-c">{center}</text>}
        {centerSub && <text x={CX} y={CY + 9} textAnchor="middle" className="donut-cs">{centerSub}</text>}
      </svg>
      <div className="donut-legend">
        {arcs.map((a) => (
          <div className="donut-lg" key={a.label}>
            <i style={{ background: a.color }} />
            <span className="donut-lg-name" title={a.label}>{a.label}</span>
            <span className="donut-lg-val">{a.value}</span>
            <b>{a.pctNum.toFixed(0)}%</b>
          </div>
        ))}
      </div>
    </div>
  );
}
