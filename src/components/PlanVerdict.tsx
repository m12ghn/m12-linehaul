/* ============================================================
   CHỐT PHƯƠNG ÁN — Dash TỰ nhận định số & ra quyết định (KHÔNG qua AI):
   xếp Plan A/B/C theo ngưỡng đáp ứng đã tính ở planEngine, chấm KPI
   chuẩn ngành, và nêu rủi ro từ dữ liệu đội xe/NCC thật.
   LUÔN hiện ngay khi có `plan` — không phụ thuộc trợ lý AI (AI ở khối
   "Kế hoạch tải" bên dưới chỉ là nhận định THÊM, không phải bắt buộc).

   RÀ LẠI 2026-07-21 (brief "giám đốc kho"): thêm banner 4 câu (Làm gì/
   Trước khi nào/Tốn bao nhiêu/Rủi ro) lên ĐẦU khối — trả lời ngay câu
   người đọc cần mà không phải đọc hết phần dưới mới ghép lại được.
   ============================================================ */
import type { PlanResult } from "../lib/planEngine";
import type { FleetMix } from "../lib/fleetMix";
import { Reveal } from "./Reveal";

export type PlanTier = "A" | "B" | "C";
export interface Verdict { tier: PlanTier; title: string; desc: string; color: string; actions: string[] }

/** Xếp Plan A/B/C theo đúng ngưỡng đáp ứng (coveragePct) đã tính sẵn — không suy đoán thêm.
 *  Export để dùng LẠI ở khối "Tóm tắt nhanh" đầu trang — tránh viết 2 lần cùng 1 ngưỡng phân loại. */
export function classify(r: PlanResult): Verdict {
  if (r.gap === 0) {
    return {
      tier: "A", color: "var(--green)",
      title: "Plan A — Đủ năng lực theo kế hoạch",
      desc: `Đội nền (${r.activeNormal} xe) + NCC đã book (${r.nccBooked} xe) đáp ứng đủ nhu cầu đỉnh ${r.peakNeeded} xe.`,
      actions: ["Giữ nguyên lịch NCC/GHN đã book, không cần thuê thêm.", "Vẫn theo dõi sát ngày đỉnh — phát sinh bất ngờ thì kích xe nhà GHN dự phòng."],
    };
  }
  if (r.coveragePct >= 70) {
    return {
      tier: "B", color: "var(--orange)",
      title: "Plan B — Thiếu xe, cần thuê ngoài/dồn chuyến",
      desc: `Còn thiếu ${r.gap} xe so nhu cầu đỉnh ${r.peakNeeded} (mới đáp ứng ${r.coveragePct}%).`,
      actions: [`Book thêm ${r.gap} xe NCC ngoài kế hoạch, ưu tiên NCC đang đáp ứng tốt.`, "Dồn chuyến các tuyến lấp đầy thấp để giải phóng xe cho ngày đỉnh.", "Giãn mốc giờ những điểm không gấp, ưu tiên đơn cận cut-off."],
    };
  }
  return {
    tier: "C", color: "var(--red)",
    title: "Plan C — Vượt mạnh, cần biện pháp mạnh",
    desc: `Chỉ đáp ứng ${r.coveragePct}% nhu cầu đỉnh (thiếu ${r.gap}/${r.peakNeeded} xe) — vượt xa năng lực hiện có.`,
    actions: ["Tăng ca đội xe nền + xe nhà GHN dự phòng.", "Cân nhắc mở thêm điểm trung chuyển tạm cho ngày đỉnh.", "Deal khẩn với NCC mức giá cao điểm để gom thêm xe nóng.", "Báo sớm các BC lớn để tiết chế/giãn đơn giờ cao điểm nếu cần."],
  };
}

export interface CostRange {
  minLabel: string; min: number; maxLabel: string; max: number; note: string;
  byTon?: { key: string; label: string; n: number }[]; // phân bổ xe thiếu theo tải trọng (nếu ước tính được)
}

/** Text ngắn "N xe Van, M xe 1.9T..." từ breakdown tải trọng — dùng chung cho banner Rủi ro + list. */
function tonBreakdownTxt(byTon?: CostRange["byTon"]): string {
  return byTon && byTon.length ? byTon.map((r) => `${r.n} xe ${r.label}`).join(", ") : "";
}

export function PlanVerdict({
  plan, fleet, deadline, onDeadlineChange, costRange,
}: {
  plan: PlanResult; fleet: FleetMix | null;
  deadline?: string; onDeadlineChange?: (v: string) => void; costRange?: CostRange | null;
}) {
  const v = classify(plan);
  const kpiOk = plan.coveragePct >= 95;
  const ratio = plan.volSurgePct > 0 ? plan.vehSurgePct / plan.volSurgePct : null;
  const elasticOk = ratio == null ? null : ratio <= 1.0;
  const nccFew = !!fleet && fleet.ncc.length > 0 && fleet.ncc.length < 3;

  const lamGi = v.tier === "A" ? "Giữ nguyên NCC/GHN đã book, không cần thuê thêm." : v.actions[0];
  const tonTxt = tonBreakdownTxt(costRange?.byTon);
  const ruiRo = v.tier !== "A"
    ? `Thiếu ${plan.gap} xe ngày đỉnh${tonTxt ? ` (${tonTxt})` : ""} nếu không kịp bổ sung → rủi ro rớt cut-off, khách chờ hàng.`
    : "Không có rủi ro lớn — vẫn cần theo dõi phát sinh ngoài kế hoạch.";
  const fmtVND = (n: number) => Math.round(n).toLocaleString("vi-VN") + "đ";

  return (
    <Reveal className="section-card pv" style={{ borderLeft: `4px solid ${v.color}` }}>
      {/* BANNER QUYẾT ĐỊNH — 4 câu trả lời ngay, không phải đọc hết mới ghép lại được */}
      <div className="pv-banner" style={{ borderColor: v.color }}>
        <div className="pv-b-cell">
          <span className="pv-b-lb">🎯 Làm gì</span>
          <span className="pv-b-val">{lamGi}</span>
        </div>
        <div className="pv-b-cell">
          <span className="pv-b-lb">📅 Trước khi nào</span>
          {onDeadlineChange ? (
            <input
              className="pl-in pv-b-deadline"
              placeholder="Sếp tự nhập deadline (vd 05/08)"
              value={deadline || ""}
              onChange={(e) => onDeadlineChange(e.target.value)}
            />
          ) : <span className="pv-b-val">{deadline || "Chưa đặt"}</span>}
        </div>
        <div className="pv-b-cell">
          <span className="pv-b-lb">💰 Tốn bao nhiêu</span>
          <span className="pv-b-val">
            {costRange
              ? <span title={costRange.note}>{fmtVND(costRange.min)} – {fmtVND(costRange.max)} <i style={{ fontWeight: 400, fontSize: 12 }}>(ước tính)</i></span>
              : <span style={{ color: "var(--muted)" }}>Chưa có đơn giá</span>}
          </span>
        </div>
        <div className="pv-b-cell">
          <span className="pv-b-lb">⚠️ Rủi ro</span>
          <span className="pv-b-val">{ruiRo}</span>
        </div>
      </div>

      <div className="pv-head">
        <span className="pv-tag" style={{ background: v.color }}>{v.tier}</span>
        <div>
          <div className="pv-title" style={{ color: v.color }}>{v.title}</div>
          <div className="pv-desc">{v.desc}</div>
          {v.tier !== "A" && (
            <div className="pv-desc" style={{ color: "var(--muted)", fontSize: 13 }}>
              ℹ️ Số "{plan.coveragePct}%/{v.tier === "C" ? "thiếu " + plan.gap : "đủ"}" tính cho <b>NGÀY ĐỈNH nhu cầu xe</b> (tính theo KG — có thể KHÁC ngày đỉnh sản lượng đơn ở trên) — các ngày khác thiếu/đủ khác nhau, xem 📅 Việc cần làm theo ngày bên dưới.
            </div>
          )}
        </div>
      </div>

      <div className="pv-kpis">
        <div className={"pv-kpi " + (kpiOk ? "ok" : "bad")}>
          <span className="pv-kpi-ic">{kpiOk ? "✅" : "⚠️"}</span>
          <span>KPI đáp ứng xe ≥95%: <b>{plan.coveragePct}%</b>{kpiOk ? " — đạt" : " — CHƯA đạt"}</span>
        </div>
        {elasticOk != null && (
          <div className={"pv-kpi " + (elasticOk ? "ok" : "warn")}>
            <span className="pv-kpi-ic">{elasticOk ? "✅" : "🔶"}</span>
            <span>Độ co giãn xe/hàng: xe +{plan.vehSurgePct}% so hàng +{plan.volSurgePct}%{elasticOk ? " — hợp lý" : " — xe tăng nhanh hơn hàng, xem lại ghép tải"}</span>
          </div>
        )}
      </div>

      {(v.tier !== "A" || nccFew) && (
        <div className="pv-risks">
          <div className="pv-sub">⚠️ Rủi ro cần lưu ý</div>
          <ul>
            {v.tier !== "A" && <li>Thiếu {plan.gap} xe{tonTxt && <> (<b>{tonTxt}</b>)</>} nếu không kịp bổ sung → rủi ro rớt cut-off, khách chờ hàng.</li>}
            {nccFew && <li>Chỉ đang phụ thuộc <b>{fleet!.ncc.length} NCC</b> — rủi ro nếu 1 NCC không đáp ứng kịp, nên phân tán thêm.</li>}
            <li>Xe nhà GHN dự phòng kỳ này ({plan.reserveGhn} xe, số THẬT đã book) phần lớn đã chạy &gt;300.000km, dễ hư — cần gara dự phòng sẵn sàng.</li>
          </ul>
        </div>
      )}

      <div className="pv-sub">🎯 Việc cần làm ngay</div>
      <ul className="pv-actions">
        {v.actions.map((a, i) => <li key={i}>{a}</li>)}
      </ul>

      <div className="pv-note">Chốt tự động từ số đã tính (không qua AI) — trợ lý bên dưới chỉ bổ sung nhận định diễn giải thêm, không phải nguồn quyết định.</div>
    </Reveal>
  );
}
