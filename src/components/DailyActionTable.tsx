/* BẢNG HÀNH ĐỘNG THEO NGÀY — theo brief "giám đốc kho": biểu đồ "số xe cần theo ngày" đã có
   (PlanBoard) nhưng THIẾU cột "còn thiếu" + "hành động" + "owner" mỗi ngày để ra quyết định.
   "Còn thiếu" mỗi ngày TÁI DÙNG đúng công thức đã tính ở planEngine (activeNormal/availExtra) —
   CHỈ áp riêng cho vehNeeded của TỪNG ngày thay vì chỉ ngày đỉnh — không suy đoán số liệu mới.
   Owner = Sếp tự gõ tên, LƯU localStorage theo kỳ+ngày (không có nguồn dữ liệu "ai phụ trách"
   nào trong Sheet — đây là ô nhập tay, không phải số tính toán). */
import type { PlanResult } from "../lib/planEngine";
import { usePersistentLocal } from "../lib/usePersistent";
import { Reveal } from "./Reveal";

const dm = (d: string) => d.slice(8) + "/" + d.slice(5, 7);

export function DailyActionTable({ plan, periodKey }: { plan: PlanResult; periodKey: string }) {
  const [owners, setOwners] = usePersistentLocal<Record<string, string>>(`pe.owners.${periodKey}`, {});

  return (
    <Reveal className="section-card pe-fc-card" style={{ marginTop: 12 }}>
      <div className="pe-fc-sub">📅 Việc cần làm THEO NGÀY <span className="fc-src">· ai làm, ngày nào — không chỉ nhìn ngày đỉnh</span></div>
      <div className="tc-wrap">
        <table className="tc-grid ncc-grid">
          <thead>
            <tr>
              <th>Ngày</th>
              <th style={{ textAlign: "center" }}>Xe cần</th>
              <th style={{ textAlign: "center" }} title="Xe chạy cố định hàng ngày (không đổi theo ngày)">Đội nền</th>
              <th style={{ textAlign: "center" }} title="Xe đã book NCC + xe nhà GHN dự phòng — tổng CẢ KỲ (Sheet không tách được số NCC đặt riêng cho từng ngày)">NCC + GHN đã có</th>
              <th style={{ textAlign: "center" }}>Còn thiếu</th>
              <th>Hành động</th>
              <th style={{ width: 150 }} title="Sếp tự gõ tên, lưu lại trên trình duyệt này — không có nguồn dữ liệu tự động">Owner</th>
            </tr>
          </thead>
          <tbody>
            {plan.days.map((d) => {
              const dayExtra = Math.max(0, d.vehNeeded - plan.activeNormal);
              const dayGap = Math.max(0, dayExtra - plan.availExtra);
              const isPeak = plan.peakNeeded > 0 && d.vehNeeded === plan.peakNeeded;
              const action = dayGap > 0
                ? `Bù thêm ${dayGap} xe (NCC/thuê nóng)`
                : dayExtra > 0 ? "Đủ (đội nền + NCC/GHN đã book)" : "Đủ đội nền, không cần thêm";
              return (
                <tr key={d.date} style={isPeak ? { background: "#fff6f1" } : undefined}>
                  <td style={{ fontWeight: 700 }}>{dm(d.date)}{isPeak && <span title="Ngày cần NHIỀU XE NHẤT (tính theo kg) — có thể khác ngày nhiều đơn nhất" style={{ marginLeft: 4, color: "var(--red)" }}>▲đỉnh</span>}</td>
                  <td className="num" style={{ textAlign: "center", fontWeight: 800 }}>{d.vehNeeded}</td>
                  <td className="num" style={{ textAlign: "center", color: "var(--blue)" }}>{plan.activeNormal}</td>
                  <td className="num" style={{ textAlign: "center", color: "var(--green)" }}>{plan.availExtra}</td>
                  <td className="num" style={{ textAlign: "center", fontWeight: 800, color: dayGap > 0 ? "var(--red)" : "var(--green)" }}>{dayGap > 0 ? dayGap : "—"}</td>
                  <td style={{ fontSize: 13.5, color: dayGap > 0 ? "var(--red)" : "var(--ink-2)" }}>{action}</td>
                  <td>
                    <input
                      className="pl-in"
                      style={{ fontSize: 13, padding: "4px 8px" }}
                      placeholder="chưa gán"
                      value={owners[d.date] || ""}
                      onChange={(e) => setOwners((o) => ({ ...o, [d.date]: e.target.value }))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="pe-sub" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
        "NCC + GHN đã có" là tổng CẢ KỲ (Sheet không tách theo từng ngày) nên "Còn thiếu" mỗi ngày là ước tính giả định phân bổ đều — ngày đỉnh (▲) là số ĐÚNG NHẤT vì đã đối chiếu trực tiếp ở "Chốt phương án" phía trên.
      </p>
    </Reveal>
  );
}
