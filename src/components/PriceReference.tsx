/* Cấu hình đơn giá + bảng giá NCC tham khảo — TÁCH khỏi CostEstimate.tsx (2026-07-21, rà lại v2)
   sang tab "Chi tiết & Đánh giá": đây là công cụ cấu hình/tra cứu (chỉnh giá khi NCC báo giá mới,
   xem bảng giá gốc từ Excel), không phải con số quyết định "tốn bao nhiêu hôm nay" (số đó ở
   CostEstimate.tsx, vẫn nằm ở tab "Kế Hoạch"). Nội dung/logic giữ nguyên 100% so với bản trước khi
   tách — chỉ đổi vị trí đứng độc lập (top-level Collapsible) thay vì lồng trong Reveal của CostEstimate. */
import type { CostRates } from "../lib/costEstimate";
import { PRICE_TABLE, PRICE_SOURCE_NOTE, PRICE_OPEN_ISSUES } from "../lib/costEstimate";
import { Collapsible } from "./Collapsible";

export function PriceReference({ rates, onRatesChange }: { rates: CostRates; onRatesChange: (r: CostRates) => void }) {
  return (
    <Collapsible title="⚙️ Cấu hình đơn giá & bảng giá NCC tham khảo" sub="Chỉnh nếu giá đổi · xem đầy đủ 5 loại xe × vùng/cự ly" defaultOpen={false} style={{ marginTop: 12 }}>
      <div className="pe-sub" style={{ margin: "0 0 6px", fontSize: 13 }}>Đơn giá dùng để tính (VNĐ, chưa VAT):</div>
      <div className="cost-rate-row">
        <label>1.9T (gói ≤15km)<input className="pl-in" type="number" value={rates.t19} onChange={(e) => onRatesChange({ ...rates, t19: Number(e.target.value) || 0 })} /></label>
        <label>5T (&lt;15km)<input className="pl-in" type="number" value={rates.t50} onChange={(e) => onRatesChange({ ...rates, t50: Number(e.target.value) || 0 })} /></label>
        <label>8T (&lt;50km)<input className="pl-in" type="number" value={rates.t80near} onChange={(e) => onRatesChange({ ...rates, t80near: Number(e.target.value) || 0 })} /></label>
        <label>8T (50–100km)<input className="pl-in" type="number" value={rates.t80far} onChange={(e) => onRatesChange({ ...rates, t80far: Number(e.target.value) || 0 })} /></label>
      </div>

      <div className="pe-sub" style={{ margin: "14px 0 6px", fontSize: 13 }}>📋 Bảng giá NCC tham khảo (toàn bộ, chưa VAT):</div>
      <div style={{ overflowX: "auto" }}>
        <table className="tc-grid">
          <thead><tr><th>Loại xe</th><th>Vùng chạy</th><th>Cách tính</th><th>Cự ly</th><th>Đơn giá</th><th>Ghi chú</th></tr></thead>
          <tbody>
            {PRICE_TABLE.map((r, i) => (
              <tr key={i} style={r.reliability === "thấp" ? { background: "rgba(241, 196, 15, 0.12)" } : undefined}>
                <td>{r.vehicle}</td><td>{r.zone}</td><td>{r.method}</td><td>{r.distance}</td>
                <td>{r.rateLabel}</td>
                <td style={{ fontSize: 12.5, color: "var(--muted)" }}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pe-sub" style={{ margin: "8px 0 0", fontSize: 12.5 }}>{PRICE_SOURCE_NOTE}</p>
      <p className="pe-sub" style={{ margin: "4px 0 0", fontSize: 12.5 }}>Dòng nền vàng = ít mẫu/có mâu thuẫn, độ tin cậy thấp. {PRICE_OPEN_ISSUES.join(" ")}</p>
    </Collapsible>
  );
}
