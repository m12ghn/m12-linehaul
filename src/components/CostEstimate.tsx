/* Chi phí ước tính bù xe thiếu ngày đỉnh — bản tóm tắt (khoảng giá) đã hiện ở banner quyết định
   (PlanVerdict), đây là phần MỞ RỘNG breakdown theo tải trọng.
   RÀ LẠI 2026-07-21 (v2 — tách trang thành 2 tab): phần "Đơn giá & bảng giá NCC tham khảo" (rate
   editor + bảng 20 dòng) đã TÁCH sang PriceReference.tsx, đứng ở tab "Chi tiết & Đánh giá" — component
   này chỉ còn đúng con số quyết định (tốn bao nhiêu), không còn phần cấu hình/tra cứu.
   RÀ LẠI 2026-07-21 (v3 — Sếp phản hồi khoảng "rẻ nhất/đắt nhất" quá rộng, ~6 lần chênh lệch, "cần
   nằm trong phạm vi tăng giảm 10%"): estimateCost() giờ ưu tiên PHÂN BỔ xe thiếu theo ĐÚNG tỷ lệ tải
   trọng thật (NCC đang book/đội xe cố định) ra 1 số TRUNG TÂM (mid) + biên ±10%, kèm breakdown "bao
   nhiêu xe loại nào" — thay 2 KPI "Rẻ nhất/Đắt nhất" bằng 1 KPI trung tâm + bảng breakdown tải trọng. */
import type { CostRates } from "../lib/costEstimate";
import { estimateCost } from "../lib/costEstimate";
import type { FleetMix } from "../lib/fleetMix";
import { Reveal } from "./Reveal";

const fmtVND = (n: number) => Math.round(n).toLocaleString("vi-VN") + "đ";

export function CostEstimate({ gap, rates, fleet }: { gap: number; rates: CostRates; fleet?: FleetMix | null }) {
  const est = estimateCost(gap, rates, fleet);
  return (
    <Reveal className="section-card pe-fc-card" style={{ marginTop: 12 }}>
      <div className="pe-fc-sub">💰 Chi phí ước tính bù xe thiếu <span className="fc-src">· đơn giá tham khảo, chỉnh ở tab "Chi tiết & Đánh giá"</span></div>
      {gap <= 0 ? (
        <div className="sl-empty">Không thiếu xe ngày đỉnh (Plan A) — không phát sinh chi phí bù thêm.</div>
      ) : est && (
        <>
          {est.byTon && est.mid != null ? (
            <>
              <div className="pe-kpis" style={{ marginBottom: 4 }}>
                <div className="pe-kpi"><span className="l">Ước tính ({gap} xe thiếu)</span><b style={{ color: "var(--orange)" }}>{fmtVND(est.mid)}</b><span className="u">dao động {fmtVND(est.min)} – {fmtVND(est.max)} (±10%)</span></div>
              </div>
              <div className="tc-wrap" style={{ marginBottom: 8 }}>
                <table className="tc-grid ncc-grid">
                  <thead><tr><th>Tải trọng</th><th style={{ textAlign: "center" }}>Số xe</th><th style={{ textAlign: "center" }}>Đơn giá tham khảo</th><th style={{ textAlign: "right" }}>Thành tiền</th></tr></thead>
                  <tbody>
                    {est.byTon.map((r) => (
                      <tr key={r.key}>
                        <td style={{ fontWeight: 700 }}>{r.label}</td>
                        <td className="num" style={{ textAlign: "center" }}>{r.n}</td>
                        <td className="num" style={{ textAlign: "center" }}>{fmtVND(r.rate)}</td>
                        <td className="num" style={{ textAlign: "right", fontWeight: 700 }}>{fmtVND(r.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="pe-kpis" style={{ marginBottom: 4 }}>
              <div className="pe-kpi"><span className="l">Rẻ nhất</span><b style={{ color: "var(--green)" }}>{fmtVND(est.min)}</b><span className="u">{est.minLabel}</span></div>
              <div className="pe-kpi"><span className="l">Đắt nhất</span><b style={{ color: "var(--red)" }}>{fmtVND(est.max)}</b><span className="u">{est.maxLabel}</span></div>
            </div>
          )}
          <div className="pe-comment">🤖 {est.note}</div>
        </>
      )}
    </Reveal>
  );
}
