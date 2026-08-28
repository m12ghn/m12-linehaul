/* Bảng kế hoạch tải EVENT — sống động: KPI gradient + gauge đáp ứng +
   biểu đồ xe theo ngày + heatmap rủi ro. Mọi số từ planEngine (thật). */
import { useState } from "react";
import type { PlanResult } from "../lib/planEngine";
import type { FleetMix } from "../lib/fleetMix";
import { ChartGradients, gradOf } from "./ChartGradients";
import { Reveal } from "./Reveal";

const fmtVN = (v: number) => Math.round(v).toLocaleString("vi-VN");
const dm = (d: string) => d.slice(8) + "/" + d.slice(5, 7);

/** Màu theo độ căng tải (ratio so ngày thường). */
function ratioColor(r: number): string {
  if (r >= 1.3) return "#e23b3b";
  if (r >= 1.1) return "#f15a24";
  if (r >= 0.95) return "#1faa59";
  return "#9fb0c0";
}

/** Biểu đồ cột: NHU CẦU ƯỚC TÍNH theo 1 hướng (Lấy/Giao) — CÓ đội nền/trần THẬT.
 *  RÀ LẠI 2026-07-21 (v3 — sửa nhận định SAI ở v2): v2 nói "Lịch Tải cố định không có cột Lấy/Giao"
 *  để bỏ hẳn đường nền/trần — nhận định đó SAI (dựa trên báo cáo Explore agent chưa đọc kỹ). Đã xác
 *  minh trực tiếp: cột "Loại tuyến" trong Lịch Tải CÓ giá trị thật "Lấy HCM01/HCM20/2 Kho/Chiều/MBH
 *  TT/ST/Q7" (Lấy) vs "Nội thành CA1/CA2/01_FW_20/GHN" (Giao/khác) — xem fleetMix.ts isLayCategory()/
 *  fixedByDir (đếm tuyến LIVE, không hardcode). Dùng số đó làm đội nền/trần THẬT riêng từng chiều,
 *  khôi phục tô 2 màu nền/vượt nền như tab Tổng.
 *  RÀ LẠI 2026-07-21 (v4, Sếp bắt lỗi qua ảnh chụp "+316 xe Lấy vô lý"): v3 ƯU TIÊN tỷ lệ NCC ĐANG
 *  BOOK kỳ này để tách d.vehNeeded (tổng, forecast KHÔNG tách hướng) — SAI vì tỷ lệ đó phản ánh THỨ
 *  TỰ/ĐỘ SẴN CÓ lúc book NCC (72 Lấy/23 Giao ~76%, một snapshot đang book dở), KHÔNG phải bằng chứng
 *  hàng Lấy tăng nhiều hơn — áp tỷ lệ này lên CẢ phần "vượt nền" khiến số tăng thêm bị khuếch đại vô
 *  căn cứ. Đã đổi LUÔN dùng fixedShare (tỷ lệ đội nền CỐ ĐỊNH thật từ Lịch Tải, ổn định, không đổi
 *  theo tiến độ book NCC) làm tỷ lệ tách DUY NHẤT — vẫn là ước tính (forecast gốc không tách hướng)
 *  nhưng có cơ sở vận hành thật ổn định hơn nhiều so với tỷ lệ book đang biến động. */
function VehBarsDir({ r, fleet, dir }: { r: PlanResult; fleet: FleetMix | null; dir: "lay" | "giao" }) {
  const W = 540, H = 226, padL = 34, padR = 12, padT = 38, padB = 30;
  const cw = W - padL - padR, ch = H - padT - padB;
  const n = r.days.length || 1, slot = cw / n, bw = Math.min(46, slot * 0.56);

  const fixedLay = fleet?.fixedByDir.lay ?? 0, fixedOther = fleet?.fixedByDir.other ?? 0;
  const fixedTotal = fixedLay + fixedOther;
  const layShare = fixedTotal > 0 ? fixedLay / fixedTotal : 0.5;
  const ratio = dir === "lay" ? layShare : 1 - layShare;
  const dirLabel = dir === "lay" ? "Lấy" : "Giao";
  const ceilingDir = dir === "lay" ? fixedLay : fixedOther;
  const BASE_COL = dir === "lay" ? "#1668c7" : "#f15a24", EXTRA_COL = "#e23b3b";

  const needs = r.days.map((d) => Math.round(d.vehNeeded * ratio));
  const yMax = Math.max(...needs, ceilingDir, 1) * 1.16;
  const yOf = (v: number) => padT + ch - (v / yMax) * ch;

  return (
    <svg className="sl-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 250 }}>
      <ChartGradients />
      {[0, 0.5, 1].map((f, i) => <line key={i} x1={padL} y1={yOf(f * yMax)} x2={W - padR} y2={yOf(f * yMax)} stroke="#eef1f5" />)}
      {ceilingDir > 0 && <line x1={padL} y1={yOf(ceilingDir)} x2={W - padR} y2={yOf(ceilingDir)} stroke="#e23b3b" strokeDasharray="5 4" />}
      {r.days.map((d, i) => {
        const need = needs[i];
        const base = ceilingDir > 0 ? Math.min(need, ceilingDir) : need;
        const extra = ceilingDir > 0 ? Math.max(0, need - ceilingDir) : 0;
        const x = padL + i * slot + (slot - bw) / 2;
        const yNeed = yOf(need), yBaseTop = yOf(base);
        const hBase = padT + ch - yBaseTop, hExtra = yBaseTop - yNeed;
        return (
          <g key={d.date}>
            <rect x={x} y={yBaseTop} width={bw} height={Math.max(0, hBase)} rx={3} fill={gradOf(BASE_COL)} className="fx-spring" style={{ animationDelay: `${i * 0.07}s` }}><title>{`${dm(d.date)} · ${dirLabel} ước tính cần ~${need} xe${ceilingDir > 0 ? ` (đội nền ${dirLabel} thật: ${ceilingDir} tuyến/ngày, từ Lịch Tải)` : ""}`}</title></rect>
            {extra > 0 && <rect x={x} y={yNeed} width={bw} height={Math.max(0, hExtra)} rx={3} fill={gradOf(EXTRA_COL)} className="fx-spring" style={{ animationDelay: `${i * 0.07 + 0.03}s` }}><title>{`${dm(d.date)}: vượt nền ${dirLabel} +${extra} xe`}</title></rect>}
            <text x={x + bw / 2} y={yNeed - (extra > 0 ? 15 : 5)} textAnchor="middle" className="sl-barval">{need}</text>
            {extra > 0 && <text x={x + bw / 2} y={yNeed - 4} textAnchor="middle" className="sl-barval" style={{ fill: "var(--red)", fontSize: 10.5 }}>+{extra}</text>}
            <text x={x + bw / 2} y={H - padB + 15} textAnchor="middle" className="sl-xlb">{dm(d.date)}</text>
          </g>
        );
      })}
      <line x1={padL} y1={padT + ch} x2={W - padR} y2={padT + ch} stroke="#cdd6e0" />
    </svg>
  );
}

/** Cột đơn giản khi CHƯA tách được Lấy/Giao (chưa có book NCC kỳ này) — vẫn giữ tô 2 màu
 *  nền/tăng thêm + nhãn "+N", chỉ khác là dùng thẳng đội nền TỔNG (không chia theo hướng). */
function VehBarsTotal({ r }: { r: PlanResult }) {
  const W = 540, H = 226, padL = 34, padR = 12, padT = 38, padB = 30;
  const cw = W - padL - padR, ch = H - padT - padB;
  const ceiling = r.activeNormal + r.availExtra;
  const yMax = Math.max(r.peakNeeded, ceiling) * 1.16;
  const n = r.days.length || 1, slot = cw / n, bw = Math.min(46, slot * 0.56);
  const yOf = (v: number) => padT + ch - (v / yMax) * ch;
  const BASE_COL = "#1668c7", EXTRA_COL = "#e23b3b";

  return (
    <svg className="sl-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 250 }}>
      <ChartGradients />
      {[0, 0.5, 1].map((f, i) => <line key={i} x1={padL} y1={yOf(f * yMax)} x2={W - padR} y2={yOf(f * yMax)} stroke="#eef1f5" />)}
      <line x1={padL} y1={yOf(r.activeNormal)} x2={W - padR} y2={yOf(r.activeNormal)} stroke="#1668c7" strokeDasharray="5 4" />
      <line x1={padL} y1={yOf(ceiling)} x2={W - padR} y2={yOf(ceiling)} stroke="#e23b3b" strokeDasharray="5 4" />
      {r.days.map((d, i) => {
        const x = padL + i * slot + (slot - bw) / 2;
        const base = Math.min(d.vehNeeded, r.activeNormal);
        const extra = Math.max(0, d.vehNeeded - r.activeNormal);
        const yNeed = yOf(d.vehNeeded), yBaseTop = yOf(base);
        const hBase = padT + ch - yBaseTop, hExtra = yBaseTop - yNeed;
        return (
          <g key={d.date}>
            <rect x={x} y={yBaseTop} width={bw} height={Math.max(0, hBase)} rx={3} fill={gradOf(BASE_COL)} className="fx-spring" style={{ animationDelay: `${i * 0.07}s` }}><title>{`${dm(d.date)}: cần ${d.vehNeeded} xe · ${fmtVN(d.demandKg)} kg`}</title></rect>
            {extra > 0 && <rect x={x} y={yNeed} width={bw} height={Math.max(0, hExtra)} rx={3} fill={gradOf(EXTRA_COL)} className="fx-spring" style={{ animationDelay: `${i * 0.07 + 0.03}s` }}><title>{`${dm(d.date)}: vượt nền +${extra} xe`}</title></rect>}
            <text x={x + bw / 2} y={yNeed - (extra > 0 ? 15 : 5)} textAnchor="middle" className="sl-barval">{d.vehNeeded}</text>
            {extra > 0 && <text x={x + bw / 2} y={yNeed - 4} textAnchor="middle" className="sl-barval" style={{ fill: "var(--red)", fontSize: 10.5 }}>+{extra}</text>}
            <text x={x + bw / 2} y={H - padB + 15} textAnchor="middle" className="sl-xlb">{dm(d.date)}</text>
          </g>
        );
      })}
      <line x1={padL} y1={padT + ch} x2={W - padR} y2={padT + ch} stroke="#cdd6e0" />
    </svg>
  );
}

/** Gauge/bullet đáp ứng: năng lực (nền+idle+NCC) so với nhu cầu đỉnh. */
function CoverageBar({ r }: { r: PlanResult }) {
  const total = Math.max(r.peakNeeded, r.activeNormal + r.availExtra) || 1;
  const pc = (v: number) => (v / total) * 100;
  const covered = r.gap === 0;
  return (
    <div className="pb-cov">
      <div className="pb-cov-track">
        <div className="pb-seg pb-seg-base" style={{ width: pc(r.activeNormal) + "%" }} title={`Đội nền ${r.activeNormal} xe`} />
        <div className="pb-seg pb-seg-ncc" style={{ width: pc(r.nccBooked) + "%" }} title={`Đã book NCC ${r.nccBooked}`} />
        {r.gap > 0 && <div className="pb-seg pb-seg-gap" style={{ width: pc(r.gap) + "%" }} title={`Thiếu ${r.gap}`} />}
        {/* mốc nhu cầu đỉnh */}
        <div className="pb-marker" style={{ left: pc(r.peakNeeded) + "%" }} title={`Cần đỉnh ${r.peakNeeded} xe`}>
          <span className="pb-marker-lb">▼ Cần đỉnh {r.peakNeeded}</span>
        </div>
      </div>
      <div className="pb-cov-leg">
        <span><i style={{ background: "#1668c7" }} />Đội nền {r.activeNormal}</span>
        <span><i style={{ background: "#1faa59" }} />NCC đã book {r.nccBooked}</span>
        {r.gap > 0 && <span><i style={{ background: "#e23b3b" }} />Thiếu {r.gap}</span>}
        <b style={{ marginLeft: "auto", color: covered ? "#1faa59" : "#e23b3b" }}>{covered ? "✓ Đủ năng lực" : `⚠ Thiếu ${r.gap} xe`} · đáp ứng {r.coveragePct}%</b>
      </div>
    </div>
  );
}

/** Heatmap rủi ro: kho × ngày, màu theo độ căng tải. */
function RiskHeat({ r }: { r: PlanResult }) {
  const rows: { name: string; key: "hcmRatio" | "stRatio" }[] = [
    { name: "🏢 HCM20", key: "hcmRatio" },
    { name: "🏬 Sóng Thần", key: "stRatio" },
  ];
  return (
    <div className="pb-heat-wrap">
      <table className="pb-heat">
        <thead>
          <tr><th></th>{r.days.map((d) => <th key={d.date}>{dm(d.date)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="pb-heat-name">{row.name}</td>
              {r.days.map((d, i) => {
                const v = d[row.key];
                return <td key={d.date} className="pb-heat-cell fx-cell" style={{ background: ratioColor(v), animationDelay: `${i * 0.05}s` }} title={`${dm(d.date)}: ${Math.round(v * 100)}% so ngày thường`}>{Math.round((v - 1) * 100) >= 0 ? "+" : ""}{Math.round((v - 1) * 100)}%</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pb-heat-leg"><span><i style={{ background: "#1faa59" }} />≤+10%</span><span><i style={{ background: "#f15a24" }} />+10→30%</span><span><i style={{ background: "#e23b3b" }} />&gt;+30% căng</span></div>
    </div>
  );
}

export function PlanBoard({ plan, fleet }: { plan: PlanResult | null; fleet: FleetMix | null }) {
  const [dir, setDir] = useState<"tong" | "lay" | "giao">("tong");
  if (!plan) return null;
  const r = plan;
  // Có tab Lấy/Giao khi có đội nền cố định thật (Lịch Tải, luôn có) HOẶC đã book NCC kỳ này.
  const hasLayGiao = !!fleet && (fleet.fixedByDir.lay + fleet.fixedByDir.other > 0 || fleet.layTon.total + fleet.giaoTon.total > 0);
  return (
    <div className="pb">
      {/* CHỈ 1 số CHƯA hiện ở đâu khác trên trang (Ngày đỉnh/Xe cần đỉnh/Đáp ứng đã có ở
          Chốt phương án + Forecast phía trên — bỏ để khỏi lặp, xem chi tiết ở gauge dưới). */}
      <div className="pb-kpis" style={{ gridTemplateColumns: "minmax(200px, 280px)" }}>
        <div className="pb-kpi pb-k3">
          <span className="pb-kl">Xe tăng cường cần (đỉnh)</span>
          <b>{r.peakExtra}</b>
          <span className="pb-ku">dư địa sẵn {r.availExtra} xe</span>
        </div>
      </div>

      {/* Gauge đáp ứng */}
      <Reveal className="section-card pb-card">
        <div className="pb-h">🚚 Năng lực đáp ứng đội xe — nhu cầu đỉnh vs nguồn xe</div>
        <CoverageBar r={r} />
        <div className="pb-note">Năng lực hiệu chỉnh <b>{fmtVN(r.effectiveCap)} kg/xe/ngày</b>{r.calibrated ? " (tự suy từ ngày thường thật)" : " (ước lượng)"} · thứ tự huy động: <b>đội nền → book NCC cố định theo cot → xe nhà GHN dự phòng → thuê nóng</b>.</div>
      </Reveal>

      <div className="pb-grid2">
        {/* Biểu đồ xe theo ngày */}
        <Reveal className="section-card pb-card">
          <div className="pb-h" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span>📊 Số xe cần theo ngày</span>
            {hasLayGiao && (
              <div className="xtc-seg sm">
                <button type="button" className={dir === "tong" ? "on" : ""} onClick={() => setDir("tong")}>Tổng</button>
                <button type="button" className={dir === "lay" ? "on" : ""} onClick={() => setDir("lay")}>📥 Lấy</button>
                <button type="button" className={dir === "giao" ? "on" : ""} onClick={() => setDir("giao")}>📤 Giao</button>
              </div>
            )}
          </div>
          {!hasLayGiao || dir === "tong" ? <VehBarsTotal r={r} /> : <VehBarsDir r={r} fleet={fleet} dir={dir} />}
          {!hasLayGiao || dir === "tong" ? (
            <>
              <div className="pb-reflegend">
                <span><i className="pb-dash" style={{ background: "#1668c7" }} />Trong nền</span>
                <span><i className="pb-dash" style={{ background: "#e23b3b" }} />Vượt nền (tăng thêm)</span>
                <span><i className="pb-dash" style={{ background: "#e23b3b", opacity: 0.5 }} />Trần năng lực <b>{r.activeNormal + r.availExtra}</b> xe</span>
              </div>
              <div className="pb-note">
                Mỗi cột: phần <span style={{ color: "#1668c7", fontWeight: 700 }}>trong nền</span> (đội xe cố định) + phần <span style={{ color: "#e23b3b", fontWeight: 700 }}>tăng thêm</span> (số "+N" ghi trên cột) là phần vượt nền, cần tăng cường; vượt luôn trần năng lực = phải thuê thêm. Đây là số TỔNG CẢ 2 CHIỀU Lấy+Giao theo năng lực hiệu chỉnh (kg/xe/ngày) — xem tab Lấy/Giao để tách riêng theo đội nền thật từng chiều (đếm tuyến từ Lịch Tải).
              </div>
            </>
          ) : (
            <>
              <div className="pb-reflegend">
                <span><i className="pb-dash" style={{ background: dir === "lay" ? "#1668c7" : "#f15a24" }} />Trong nền</span>
                <span><i className="pb-dash" style={{ background: "#e23b3b" }} />Vượt nền (tăng thêm)</span>
                <span><i className="pb-dash" style={{ background: "#e23b3b", opacity: 0.5 }} />Trần năng lực <b>{dir === "lay" ? fleet!.fixedByDir.lay : fleet!.fixedByDir.other}</b> xe</span>
              </div>
              <div className="pb-note">
                Đang xem hướng <b>{dir === "lay" ? "LẤY" : "GIAO"}</b> — đội nền/trần năng lực = số tuyến THẬT đang chạy hàng ngày trong Lịch Tải, phân theo "Loại tuyến" ({dir === "lay" ? "Lấy HCM01/HCM20/2 Kho/Chiều/MBH" : "Nội thành CA1/CA2/01_FW_20/GHN"}). Số cần MỖI NGÀY (cột) = ƯỚC TÍNH từ tổng xe cần cả kỳ (planEngine, forecast KHÔNG tách hướng) chia theo tỷ lệ đội nền CỐ ĐỊNH ({fleet ? `${fleet.fixedByDir.lay}/${fleet.fixedByDir.lay + fleet.fixedByDir.other}` : "—"} Lấy) — giả định tỷ lệ Lấy/Giao trong phần tăng thêm cũng giống ngày thường, KHÔNG phải dự báo riêng theo hướng (chưa có dữ liệu forecast tách Lấy/Giao).
              </div>
            </>
          )}
        </Reveal>
        {/* Heatmap rủi ro */}
        <Reveal className="section-card pb-card">
          <div className="pb-h">🔥 Độ căng tải theo kho × ngày</div>
          <RiskHeat r={r} />
          <div className="pb-note">Ô càng đỏ = sản lượng vượt ngày thường càng nhiều, kho/ngày đó cần ưu tiên xe.</div>
        </Reveal>
      </div>
    </div>
  );
}
