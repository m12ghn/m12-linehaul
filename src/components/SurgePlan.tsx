/* ============================================================
   DỰ TRÙ TĂNG CƯỜNG PHÁT SINH + chiến lược xe nhà dự phòng.
   Dựa trên số đã tính ở planEngine (KHÔNG bịa): độ co giãn xe/hàng,
   book NCC cố định theo cot, giữ xe nhà GHN dự phòng.
   ============================================================ */
import type { PlanResult } from "../lib/planEngine";
import { SURGE_BUFFER } from "../lib/planEngine";
import { RESERVE_PICKUP_IDLE, RESERVE_PICKUP_TRIPS_PER_VEH_MIN, RESERVE_PICKUP_TRIPS_PER_VEH_MAX, RESERVE_PICKUP_TRIPS_TOTAL_MIN, RESERVE_PICKUP_TRIPS_TOTAL_MAX } from "../lib/fleetMix";
import { Reveal } from "./Reveal";
import { Collapsible } from "./Collapsible";

export function SurgePlan({ plan }: { plan: PlanResult }) {
  return (
    <Reveal className="section-card" style={{ marginTop: 12 }}>
      <div className="pe-sech">⚡ Dự trù tăng cường PHÁT SINH &amp; xe nhà dự phòng</div>

      <div className="pe-kpis" style={{ marginTop: 8 }}>
        <div className="pe-kpi"><span className="l">Dự trù phát sinh</span><b style={{ color: "var(--orange)" }}>~{Math.round(SURGE_BUFFER * 100)}%</b><span className="u">đơn/xe ngoài kế hoạch</span></div>
        <div className="pe-kpi" title="= đúng bằng xe tăng cường cần đỉnh ở 🧮 Kế hoạch đội xe phía trên (chiến lược: book đủ 100% qua NCC)."><span className="l">Book NCC cố định (cot)</span><b style={{ color: "var(--blue)" }}>{plan.bookFixed}</b><span className="u">= xe tăng cường cần đỉnh ở 🧮 Kế hoạch đội xe</span></div>
        <div className="pe-kpi"><span className="l">Xe nhà GHN dự phòng</span><b style={{ color: "var(--green)" }}>{plan.reserveGhn}</b><span className="u">giữ cho phát sinh gấp</span></div>
        <div className="pe-kpi"><span className="l">Xe phát sinh chuẩn bị</span><b style={{ color: "var(--red)" }}>~{plan.phatSinhVeh}</b><span className="u">NCC bỏ cot / thuê nóng</span></div>
      </div>

      {/* Checklist — bọc Collapsible đóng mặc định: đây là 1 trong 3 danh sách "cần làm gì" trên trang
          (cùng PlanVerdict.actions + DailyActionTable), tên gọi RÀ LẠI 2026-07-21 (v2) nhấn chữ
          "NẾU"/"dự phòng" để tự nói rõ scope RIÊNG cho phần phát sinh — không phải việc bắt buộc song
          song 2 danh sách kia. Đã bỏ hẳn ElasticityBar (chart vẽ lại đúng 2 số đã có ở KPI chip "🔶 Độ
          co giãn" của PlanVerdict, không thêm ngưỡng/breakdown gì mới — xác nhận trùng lặp thật, khác
          coveragePct/CoverageBar vốn có thêm màu ngưỡng nên hợp lý giữ 2 nơi). */}
      <Collapsible
        title="🚨 Việc cần làm NẾU phát sinh thêm (dự phòng)"
        sub="Chỉ áp dụng khi tải vượt dự kiến — xem nhanh 4 số ở trên là đủ cho phần lớn trường hợp"
        defaultOpen={false}
        style={{ marginTop: 12 }}
      >
        <p className="pe-sub" style={{ margin: "0 0 10px", fontSize: 13 }}>🔶 Độ co giãn xe/hàng đã đánh giá ở 🎯 Chốt phương án phía trên.</p>
        <div className="pe-fc-sub">🎯 Cần làm gì với phần phát sinh</div>
        <ul className="surge-todo">
          <li><b>Book 100% phần tăng cường qua NCC cố định theo cot:</b> chốt <b>{plan.bookFixed} xe</b> NCC vào đúng các cot (khung giờ) event để phủ phần tăng cường đã tính — không để nước tới chân. Đây là phương án CHÍNH đã chọn (100% qua NCC), xe nhà GHN CHỈ để dự phòng, không tính vào phần tăng cường chính.</li>
          <li><b>Giữ xe nhà GHN đã book kỳ này (~{plan.reserveGhn} xe, số THẬT) làm dự phòng:</b> KHÔNG xếp cứng vào lịch; để cơ động phủ đơn phát sinh gấp (gọi là chạy ngay, không phụ thuộc NCC). <i>Riêng ngoài số này</i> — theo tham chiếu thủ công (không đổi theo kỳ) — ước tính có <b>~{RESERVE_PICKUP_IDLE} xe trống</b> dự phòng riêng cho <b>LẤY HÀNG</b>, mỗi xe chạy được <b>{RESERVE_PICKUP_TRIPS_PER_VEH_MIN}-{RESERVE_PICKUP_TRIPS_PER_VEH_MAX} lượt/ngày</b> → thêm <b>~{RESERVE_PICKUP_TRIPS_TOTAL_MIN}-{RESERVE_PICKUP_TRIPS_TOTAL_MAX} lượt lấy hàng</b> dự phòng.</li>
          <li><b>Deal điều khoản với NCC:</b> thỏa thuận trước "bỏ cot / thêm xe nóng" — báo trước ~2–4 giờ, đơn giá cao điểm, cam kết số xe tối thiểu để NCC giữ chỗ; phân tán qua ≥2–3 NCC tránh phụ thuộc 1 mối.</li>
          <li><b>Chốt với BC lớn:</b> bưu cục khối lượng lớn chốt số xe &amp; khung giờ trước 1–2 ngày; ưu tiên xe 5.000kg cho điểm hàng nhiều.</li>
          <li><b>Ngưỡng kích hoạt:</b> khi đáp ứng tụt &lt;95% hoặc tồn &gt;24h tăng &gt;10% → kích xe nhà dự phòng → gọi NCC bỏ cot → thuê nóng.</li>
        </ul>
      </Collapsible>
    </Reveal>
  );
}
