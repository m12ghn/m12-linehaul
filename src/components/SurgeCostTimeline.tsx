/* CHI PHÍ TĂNG CƯỜNG — SO SÁNH NHIỀU KỲ (T6→T7→T8...) — thay SurgeCostCompare.tsx (2026-07-21, v3).
   Sếp yêu cầu: lấy ĐỦ data tăng cường nhiều kỳ liên tiếp (không chỉ so 2 kỳ), chia chi tiết theo
   TỪNG NGÀY THẬT trong mỗi kỳ (vd kỳ 7/7 THỰC chạy 6/7-8/7, không phải khung 6 ngày giả định).
   Kỳ đã lưu trữ ("Lưu trữ TC Event") → bảng theo ngày thật. Kỳ đang chạy/sắp tới chưa lưu trữ →
   RÀ LẠI 2026-07-21 (v4): CŨNG bảng theo ngày thật (route live đã lọc đúng khung ngày kỳ + có
   from/to riêng, xem fleetMix.ts liveRoutes), chỉ khác 1 dòng cảnh báo "chưa lưu trữ, số sẽ còn
   tăng". Kỳ đã qua nhưng thiếu lưu trữ → báo rõ thiếu dữ liệu, không bịa.
   RÀ LẠI 2026-07-21 (v5, Sếp phản hồi ảnh chụp): thêm BẢNG SO SÁNH T6→T7→T8 THEO TẢI TRỌNG làm nội
   dung CHÍNH (trước đây chỉ có bảng theo ngày của 1 kỳ tại 1 thời điểm, phải bấm tab đổi qua lại,
   không so trực tiếp được) — bảng theo ngày cũ GIỮ LẠI làm phần drill-down bên dưới. */
import { useState } from "react";
import { Reveal } from "./Reveal";
import { TON_COLOR, type TonKey } from "../lib/fleetMix";

const fmtVND = (n: number) => Math.round(n).toLocaleString("vi-VN") + "đ";
const fmtVNDCompact = (n: number) => (n >= 1_000_000 ? (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "tr" : n >= 1_000 ? Math.round(n / 1000) + "k" : String(Math.round(n)));
/** Màu phần "Phát sinh" (không phải 1 tải trọng cụ thể) — tách biệt bảng màu TON_COLOR. */
const PHATSINH_COLOR = "#9b5de5";

export interface SurgeCostDay {
  dateIso: string; label: string;
  fixedCount: number; fixedCost: number;
  adhocCount: number; adhocCost: number;
  totalVeh: number; totalCost: number;
}
export interface SurgeCostTonRow { key: string; label: string; n: number; rate: number; cost: number }
export interface SurgeCostPeriodResult {
  key: string; label: string; periodLabel: string; status: "past" | "now" | "next";
  kind: "archived" | "live" | "none";
  fromIso?: string; toIso?: string;
  days?: SurgeCostDay[];
  totalVeh: number | null; totalCost: number | null;
  fixedTotal: number | null; adhocTotal: number | null;
  /** Breakdown xe CỐ ĐỊNH theo tải trọng, CỘNG DỒN qua các ngày active (khớp "Tổng kỳ" bên dưới). */
  byTon?: SurgeCostTonRow[];
  /** Lượt "xin tăng cường" ĐÃ ĐÁP ỨNG (coXe=Có xe) trong các ngày active — CHƯA trừ GHN dự phòng. */
  adhocFulfilled?: number; adhocRate?: number;
  /** Xe phát sinh CẦN THUÊ NCC sau khi trừ GHN dự phòng (10 xe, ~20-30 lượt/kỳ) — khoảng min/max. */
  adhocNetMin?: number; adhocNetMax?: number; adhocNetCostMin?: number; adhocNetCostMax?: number;
}

/** Biểu đồ cột chồng: mỗi kỳ 1 cột, chồng theo tải trọng (màu TON_COLOR dùng chung toàn Plan Event)
 *  + phần "Phát sinh" (màu riêng) trên cùng, tổng chi phí ghi đậm trên đỉnh cột. Thay bảng số cũ vì
 *  Sếp thấy bảng khó nhìn — nhìn cột là thấy ngay kỳ nào tốn hơn, tải nào chiếm phần lớn chi phí. */
function SurgeCostChart({ periods, tonKeys, tonLabelOf }: {
  periods: SurgeCostPeriodResult[]; tonKeys: string[]; tonLabelOf: (k: string) => string;
}) {
  const bars = periods.map((p) => {
    const segs = tonKeys
      .map((k) => {
        const row = p.byTon?.find((r) => r.key === k);
        return { key: k, label: tonLabelOf(k), n: row?.n ?? 0, cost: row?.cost ?? 0, color: TON_COLOR[k as TonKey] ?? "#8b98a8" };
      })
      .filter((s) => s.cost > 0);
    const phatSinhCost = p.adhocNetCostMax ?? 0;
    if (phatSinhCost > 0) {
      const nLabel = p.adhocNetMin === p.adhocNetMax ? `${p.adhocNetMax}` : `${p.adhocNetMin}–${p.adhocNetMax}`;
      segs.push({ key: "phatsinh", label: `Phát sinh (${nLabel} xe)`, n: p.adhocNetMax ?? 0, cost: phatSinhCost, color: PHATSINH_COLOR });
    }
    return { period: p, segs, total: segs.reduce((a, s) => a + s.cost, 0) };
  });
  const n = bars.length;
  if (!n) return null;

  const maxTotal = Math.max(1, ...bars.map((b) => b.total));
  const padL = 56, padR = 16, padTop = 30, padBot = 30, PH = 190;
  const bw = 84, gap = 44;
  const W = padL + n * bw + (n - 1) * gap + padR;
  const H = padTop + PH + padBot;
  const x = (i: number) => padL + i * (bw + gap);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W, width: "100%", height: H }}>
        {[0, 0.5, 1].map((g) => {
          const yy = padTop + PH - g * PH;
          return (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="var(--line)" strokeWidth={1} />
              <text x={padL - 6} y={yy + 3} textAnchor="end" fontSize={9} fill="var(--muted)">{fmtVNDCompact(g * maxTotal)}</text>
            </g>
          );
        })}
        {bars.map((b, i) => {
          let yCursor = padTop + PH;
          return (
            <g key={b.period.key}>
              {b.segs.map((s) => {
                const h = (s.cost / maxTotal) * PH;
                const y0 = yCursor - h;
                yCursor = y0;
                return (
                  <rect key={s.key} x={x(i)} y={y0} width={bw} height={Math.max(0, h)} fill={s.color} rx={2}>
                    <title>{`${s.label}: ${s.n} xe · ${fmtVND(s.cost)}`}</title>
                  </rect>
                );
              })}
              <text x={x(i) + bw / 2} y={padTop + PH - (b.total / maxTotal) * PH - 8} textAnchor="middle" fontSize={12.5} fontWeight={800} fill="var(--ink)">
                {fmtVND(b.total)}
              </text>
              <text x={x(i) + bw / 2} y={H - padBot + 16} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--ink)">
                {b.period.periodLabel}{b.period.kind === "live" ? " (live)" : ""}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4, fontSize: 12, color: "var(--ink-2)" }}>
        {tonKeys.map((k) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <i style={{ width: 10, height: 10, borderRadius: 2, background: TON_COLOR[k as TonKey] ?? "#8b98a8", display: "inline-block" }} />
            {tonLabelOf(k)}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <i style={{ width: 10, height: 10, borderRadius: 2, background: PHATSINH_COLOR, display: "inline-block" }} />
          Phát sinh (đã trừ GHN dự phòng)
        </span>
      </div>
    </div>
  );
}

export function SurgeCostTimeline({ data }: { data: SurgeCostPeriodResult[] | null }) {
  const withData = (data ?? []).filter((p) => p.kind !== "none");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  if (!data || !data.length) return null;

  const active = withData.find((p) => p.key === activeKey) ?? withData[withData.length - 1] ?? null;

  // Gộp mọi mức tải trọng XUẤT HIỆN Ở BẤT KỲ kỳ nào thành 1 danh sách dòng chung, để so đúng CÙNG
  // 1 hàng qua các cột kỳ (kỳ này có thể có Van, kỳ kia không — vẫn cần đứng cùng hàng để dễ đối chiếu).
  const tonKeys = [...new Set(withData.flatMap((p) => (p.byTon ?? []).map((r) => r.key)))];
  const tonLabelOf = (k: string) => withData.flatMap((p) => p.byTon ?? []).find((r) => r.key === k)?.label ?? k;
  const hasCompare = withData.some((p) => (p.byTon?.length ?? 0) > 0);

  return (
    <Reveal className="section-card pe-fc-card" style={{ marginTop: 12 }}>
      <div className="pe-fc-sub">📅 Chi phí tăng cường · so sánh theo kỳ <span className="fc-src">· {data.map((p) => p.label).join(" → ")}</span></div>

      {hasCompare && (
        <>
          <SurgeCostChart periods={withData} tonKeys={tonKeys} tonLabelOf={tonLabelOf} />
          <p className="pe-sub" style={{ margin: "8px 0 12px", fontSize: 12.5 }}>
            "Phát sinh (đã trừ GHN dự phòng)": xe nhà GHN dự phòng (10 xe, ước ~20-30 lượt LẤY HÀNG/kỳ — 2-3 lượt/xe/ngày, xem 🚨 Việc cần làm nếu phát sinh thêm) tự đáp ứng phần này KHÔNG tốn chi phí thuê ngoài, chỉ phần CÒN LẠI mới cần thuê NCC nóng (giá bình quân/xe của phần cố định cùng kỳ). Khoảng 20-30 lượt là ƯỚC TÍNH nên chi phí phát sinh hiện theo KHOẢNG tương ứng — KHÁC với "Tổng chi phí" ở bảng theo ngày bên dưới (chưa trừ GHN, xem đúng bảng nào tuỳ mục đích: bảng này để BÁO NGÂN SÁCH THỰC CẦN CHI, bảng theo ngày để xem NHỊP CHI TIÊU từng ngày).
          </p>
        </>
      )}

      <div className="pe-fc-sub" style={{ marginTop: hasCompare ? 4 : 0 }}>📋 Chi tiết theo ngày (1 kỳ)</div>
      {withData.length > 0 && (
        <div className="xtc-seg sm" style={{ marginBottom: 10 }}>
          {withData.map((p) => (
            <button key={p.key} className={active?.key === p.key ? "on" : ""} onClick={() => setActiveKey(p.key)}>{p.periodLabel}</button>
          ))}
        </div>
      )}

      {!active ? (
        <div className="sl-empty">Chưa có "Lưu trữ TC EVENT" hay số đang book cho kỳ nào trong chuỗi này.</div>
      ) : !active.days || !active.days.length ? (
        <div className="sl-empty">Không dựng được bảng theo ngày cho kỳ này (thiếu ngày Từ/Đến trên route).</div>
      ) : (
        <>
          {active.kind === "live" && (
            <div className="pe-comment" style={{ borderLeftColor: "var(--orange)", marginBottom: 8 }}>
              ⚠️ Kỳ <b>{active.periodLabel}</b> chưa kết thúc/chưa lưu trữ — bảng dưới là số ĐANG BOOK THẬT (sheet Tăng Cường live, đã lọc đúng khung ngày kỳ này) tính tới lúc này, SẼ CÒN TĂNG khi book thêm tới ngày event.
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="tc-grid ncc-grid">
              <thead><tr><th>Ngày</th><th>Xe cố định</th><th>Chi phí cố định</th><th>Xe phát sinh</th><th>Chi phí phát sinh</th><th>Tổng xe</th><th>Tổng chi phí</th></tr></thead>
              <tbody>
                {active.days.map((d) => (
                  <tr key={d.dateIso}>
                    <td>{d.label}</td>
                    <td>{d.fixedCount}</td>
                    <td>{fmtVND(d.fixedCost)}</td>
                    <td>{d.adhocCount}</td>
                    <td>{fmtVND(d.adhocCost)}</td>
                    <td><b>{d.totalVeh}</b></td>
                    <td><b>{fmtVND(d.totalCost)}</b></td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td>Tổng kỳ</td>
                  <td>{active.fixedTotal}</td>
                  <td>{fmtVND(active.days.reduce((a, d) => a + d.fixedCost, 0))}</td>
                  <td>{active.adhocTotal}</td>
                  <td>{fmtVND(active.days.reduce((a, d) => a + d.adhocCost, 0))}</td>
                  <td>{active.totalVeh}</td>
                  <td>{fmtVND(active.totalCost ?? 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="pe-sub" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
        Xe CỐ ĐỊNH = "Lưu trữ TC EVENT", mỗi route dùng ĐÚNG ngày Từ/Đến của chính nó (không phải khung ngày chung — các route cùng kỳ có thể chạy khác ngày nhau), KHÔNG tính xe nhà GHN (không phát sinh chi phí thuê ngoài). Xe PHÁT SINH = BC xin thêm ("Xin tăng cường") ĐÃ ĐÁP ỨNG (Có xe) khớp theo ngày nộp thật — đã bỏ các lượt "Không có xe"/hủy khỏi tính chi phí, KHÔNG có tải trọng riêng nên áp giá BÌNH QUÂN/xe của phần cố định CẢ KỲ (ổn định hơn tính riêng từng ngày mẫu nhỏ). Bảng này CHƯA trừ GHN dự phòng (xem bảng so sánh phía trên để có số đã trừ). Giá chưa VAT.
      </p>
    </Reveal>
  );
}
