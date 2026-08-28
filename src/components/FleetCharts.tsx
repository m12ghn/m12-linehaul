/* Biểu đồ + bảng đội xe cho Plan Event — số liệu THẬT, realtime.
   1) Xe đang dùng theo tải trọng (lịch tải toàn cụm)
   2) Đội xe nền (tham chiếu kỳ event gần đây) — không còn xe nằm bãi
   3) BẢNG xe book NCC — TÁCH Lấy/Giao × tải trọng + so EVENT T6 + donut tỷ trọng */
import {
  type FleetMix, TON_LABEL, TON_SHORT, TON_ORDER, TON_COLOR, type TonKey,
  BASE_FLEET, BASE_FLEET_TOTAL,
} from "../lib/fleetMix";
import { ChartGradients, gradOf } from "./ChartGradients";
import { Donut } from "./Donut";
import { Reveal } from "./Reveal";
import { Collapsible } from "./Collapsible";

const fmtVN = (v: number) => Math.round(v).toLocaleString("vi-VN");
// Bảng màu cho donut NCC (xoay vòng).
const NCC_PALETTE = ["#1668c7", "#f15a24", "#1faa59", "#9b5de5", "#f5a623", "#e23b3b", "#00b8a9", "#6a7b8c"];

/** Biểu đồ cột đứng đơn giản (label + value). */
function VBars({ items, unit = "xe" }: { items: { label: string; val: number; col: string }[]; unit?: string }) {
  const W = 380, H = 184, padL = 30, padR = 10, padT = 22, padB = 36;
  const cw = W - padL - padR, ch = H - padT - padB;
  const yMax = Math.max(1, ...items.map((d) => d.val)) * 1.18;
  const n = items.length || 1, slot = cw / n, bw = Math.min(54, slot * 0.56);
  const yOf = (v: number) => padT + ch - (v / yMax) * ch;
  return (
    <svg className="sl-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 210 }}>
      <ChartGradients />
      {[0, 0.5, 1].map((f, i) => <line key={i} x1={padL} y1={yOf(f * yMax)} x2={W - padR} y2={yOf(f * yMax)} stroke="#eef1f5" />)}
      {items.map((d, i) => {
        const x = padL + i * slot + (slot - bw) / 2, y = yOf(d.val), h = padT + ch - y;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={bw} height={Math.max(0, h)} rx={3} fill={gradOf(d.col)} className="fx-drop" style={{ animationDelay: `${i * 0.07}s` }}>
              <title>{`${d.label}: ${fmtVN(d.val)} ${unit}`}</title>
            </rect>
            <text x={x + bw / 2} y={y - 5} textAnchor="middle" className="sl-barval">{fmtVN(d.val)}</text>
            <text x={x + bw / 2} y={H - padB + 15} textAnchor="middle" className="sl-xlb">{d.label}</text>
          </g>
        );
      })}
      <line x1={padL} y1={padT + ch} x2={W - padR} y2={padT + ch} stroke="#cdd6e0" />
    </svg>
  );
}

/** BẢNG NCC dạng Excel: NCC · tổng xe · Lấy theo tải trọng · Giao theo tải trọng.
 *  Ẩn cột tải trọng nào KHÔNG xe nào dùng (vd hiện tại chưa NCC nào chạy Van) để đỡ rối bảng. */
function NccTable({ ncc, ghnTC, activeTons }: { ncc: FleetMix["ncc"]; ghnTC: number; activeTons: TonKey[] }) {
  const totalLay = activeTons.reduce((a, k) => { a[k] = ncc.reduce((s, x) => s + x.layTon[k], 0); return a; }, {} as Record<TonKey, number>);
  const totalGiao = activeTons.reduce((a, k) => { a[k] = ncc.reduce((s, x) => s + x.giaoTon[k], 0); return a; }, {} as Record<TonKey, number>);
  return (
    <div>
      <p className="pe-sub" style={{ margin: "0 0 8px", fontSize: 13 }}>
        Mỗi ô = số xe NCC đó đã book, tách theo chiều <b style={{ color: "var(--blue)" }}>📥 Lấy</b> (chở hàng từ bưu cục về kho) / <b style={{ color: "var(--red)" }}>📤 Giao</b> (chở hàng từ kho đến bưu cục) và tải trọng xe. "—" = NCC đó không có xe tải trọng này. Sắp xếp theo tổng xe giảm dần.
      </p>
      <div className="tc-wrap">
        <table className="tc-grid ncc-grid">
          <thead>
            <tr>
              <th rowSpan={2} style={{ width: 28 }}>#</th>
              <th rowSpan={2}>Nhà cung cấp (NCC)</th>
              <th rowSpan={2} style={{ width: 48, textAlign: "center" }}>Tổng</th>
              <th colSpan={activeTons.length} style={{ textAlign: "center" }} title="Xe LẤY hàng từ bưu cục, tách theo tải trọng">📥 Lấy</th>
              <th colSpan={activeTons.length} style={{ textAlign: "center" }} title="Xe GIAO hàng tới bưu cục, tách theo tải trọng">📤 Giao</th>
            </tr>
            <tr>
              {activeTons.map((k) => <th key={"l" + k} style={{ width: 40, textAlign: "center", fontSize: 12 }}>{TON_SHORT[k]}</th>)}
              {activeTons.map((k) => <th key={"g" + k} style={{ width: 40, textAlign: "center", fontSize: 12 }}>{TON_SHORT[k]}</th>)}
            </tr>
          </thead>
          <tbody>
            {ncc.map((x, i) => (
              <tr key={x.name}>
                <td className="num" style={{ color: "var(--muted)" }}>{i + 1}</td>
                <td style={{ fontWeight: 700 }}>{x.name}</td>
                <td className="num" style={{ textAlign: "center", fontWeight: 800, color: "var(--orange)" }}>{x.count}</td>
                {activeTons.map((k) => <td key={"l" + k} className="num" style={{ textAlign: "center", color: "var(--blue)" }}>{x.layTon[k] || "—"}</td>)}
                {activeTons.map((k) => <td key={"g" + k} className="num" style={{ textAlign: "center", color: "var(--red)" }}>{x.giaoTon[k] || "—"}</td>)}
              </tr>
            ))}
            {ghnTC > 0 && (
              <tr style={{ background: "var(--green-soft)" }}>
                <td className="num" style={{ color: "var(--muted)" }}>—</td>
                <td style={{ fontWeight: 800, color: "#157a40" }}>GHN (xe nhà) 🏠</td>
                <td className="num" style={{ textAlign: "center", fontWeight: 800, color: "#157a40" }}>{ghnTC}</td>
                <td className="num" style={{ textAlign: "center" }} colSpan={activeTons.length * 2}>giữ làm dự phòng phát sinh</td>
              </tr>
            )}
            <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 800 }}>
              <td /><td>TỔNG (NCC, không gồm GHN)</td>
              <td className="num" style={{ textAlign: "center" }}>{ncc.reduce((a, x) => a + x.count, 0)}</td>
              {activeTons.map((k) => <td key={"tl" + k} className="num" style={{ textAlign: "center", color: "var(--blue)" }}>{totalLay[k] || "—"}</td>)}
              {activeTons.map((k) => <td key={"tg" + k} className="num" style={{ textAlign: "center", color: "var(--red)" }}>{totalGiao[k] || "—"}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FleetCharts({ fm }: { fm: FleetMix | null }) {
  if (!fm) return <div className="section-card sl-empty">Đang tải dữ liệu đội xe…</div>;

  const topTon = TON_ORDER.reduce((m, k) => (fm.inUse[k] > fm.inUse[m] ? k : m), "van" as TonKey);
  const cmtUse = `Toàn cụm đang dùng <b>${fmtVN(fm.totalInUse)}</b> chuyến/tuyến, chủ lực là xe <b>${TON_LABEL[topTon]}</b> (${fmtVN(fm.inUse[topTon])} chuyến). ${fm.unknownLoad ? `Còn ${fm.unknownLoad} tuyến chưa ghi tải (phần lớn là Van nội thành).` : ""}`;
  const fixedLay = fm.fixedByDir.lay, fixedOther = fm.fixedByDir.other, fixedTotal = fixedLay + fixedOther;
  const cmtBase = `Đội nền ~<b>${fmtVN(BASE_FLEET_TOTAL)}</b> xe (tham chiếu thủ công theo tải trọng), hiện <b>chạy hết</b> — không còn xe nằm bãi. Tăng cường dựa vào <b>book NCC</b>; giữ xe nhà GHN làm dự phòng.`
    + (fixedTotal ? ` Riêng theo <b>Lịch Tải THẬT</b> (đếm tuyến/ngày, tách theo Loại tuyến): <b style="color:var(--blue)">📥 Lấy ${fixedLay}</b> tuyến · <b style="color:var(--red)">📤 Giao/khác ${fixedOther}</b> tuyến (tổng ${fixedTotal}) — số LIVE, không phải tham chiếu thủ công.` : "");

  // Tải trọng nào ĐANG CÓ dữ liệu kỳ này -> chỉ hiện KPI/cột cho tải trọng thật sự có xe (tránh bịa
  // cột trống — vd chưa NCC nào chạy Van cho kỳ tăng cường thì ẩn cột Van đi cho gọn).
  // RÀ LẠI 2026-07-21: bỏ hẳn so sánh "EVENT T6" ở đây (đã có TrucCompare bên dưới làm nguồn so
  // KỲ TRƯỚC DUY NHẤT — đúng kỳ liền trước qua "Lưu trữ TC Event", có breakdown theo từng NCC; so
  // T6 ở đây dùng field `fm.eventT6` cứng, kém chính xác hơn, đứng cạnh TrucCompare gây trùng lặp).
  const activeTons = TON_ORDER.filter((k) => fm.layTon[k] + fm.giaoTon[k] > 0);
  const topSharePct = fm.totalNcc ? Math.round(((fm.ncc[0]?.count || 0) / fm.totalNcc) * 100) : 0;

  const cmtNcc = fm.totalNcc
    ? `Kỳ này book <b>${fm.totalNcc}</b> xe từ <b>${fm.ncc.length}</b> NCC${fm.ghnTC ? ` + ${fm.ghnTC} GHN nhà (dự phòng)` : ""} — <b style="color:var(--blue)">📥 Lấy ${fm.layTon.total}</b> xe · <b style="color:var(--red)">📤 Giao ${fm.giaoTon.total}</b> xe. `
      + `Phụ thuộc nhiều nhất <b>${fm.ncc[0]?.name}</b> (${fm.ncc[0]?.count} xe, ${topSharePct}%)${fm.ncc.length >= 3 && topSharePct >= 30 ? " — nên phân tán bớt rủi ro." : fm.ncc.length >= 3 ? "." : " — còn ít NCC, rủi ro tập trung cao."} `
      + `So kỳ trước theo từng NCC/tải trọng — xem 🚛 Book NCC theo NCC × tải trọng bên dưới.`
    : "Chưa có dữ liệu book NCC cho kỳ này (kiểm tra tab Tăng Cường Lấy).";

  const useItems = TON_ORDER.map((k) => ({ label: TON_LABEL[k], val: fm.inUse[k], col: TON_COLOR[k] }));
  // Nhãn "GHN (cũ)" thay vì bare "GHN" — tránh lẫn với "GHN đã book kỳ này" (số LIVE, khác hẳn,
  // xem cmtNcc/PlanVerdict) và "GHN rảnh lấy hàng" (RESERVE_PICKUP_IDLE) — 3 số GHN KHÁC NGHĨA
  // (brief người mới đọc "lúc 0, lúc 9, lúc ~10" tưởng mâu thuẫn — thật ra là 3 khái niệm khác nhau).
  const baseItems = BASE_FLEET.map((r) => ({ label: r.label.replace("kg", "").replace(" tự có", r.label.includes("GHN") ? " (cũ)" : ""), val: r.n, col: TON_COLOR[r.ton] }));

  // Xe RIÊNG BIỆT (biển số): Cố định (Lịch Tải) vs Event (Tăng Cường) — 1 xe có thể chạy nhiều chuyến/vòng.
  const fx = fm.fixed, ev = fm.event;
  const multiTxt = [
    fx.veh.multiRouteBks ? `${fx.veh.multiRouteBks} xe cố định` : "",
    ev.veh.multiRouteBks ? `${ev.veh.multiRouteBks} xe event` : "",
  ].filter(Boolean).join(" và ");
  const lowCovTxt = [
    fx.veh.coveragePct < 50 ? `cố định mới ghi biển số ${fx.veh.coveragePct}% chuyến` : "",
    ev.veh.coveragePct < 50 ? `event mới ghi biển số ${ev.veh.coveragePct}% chuyến` : "",
  ].filter(Boolean).join(", ");
  // Xe GHN (nhà) hầu như KHÔNG được ghi biển số theo dòng ở cả 2 sheet (xe cố định, coi như đã biết) —
  // khác với NCC (thuê ngoài) LUÔN cần ghi biển số để đối soát/thanh toán. "0 xe riêng biệt" ở phần GHN
  // vì vậy KHÔNG có nghĩa GHN không chạy xe nào — chỉ là sheet không tách được xe theo biển số cho GHN.
  const ghnNoPlateTxt = (fx.ghnVeh.routes > 0 && fx.ghnVeh.distinctBks === 0) || (ev.ghnVeh.routes > 0 && ev.ghnVeh.distinctBks === 0)
    ? `Xe GHN (nhà) hầu như không ghi biển số theo dòng (mặc định xe cố định, đã biết sẵn) nên hiện "0 xe riêng biệt" — KHÔNG phải GHN không chạy xe, chỉ là sheet chưa tách được theo biển số. `
    : "";
  const cmtVeh = `${multiTxt ? `<b>${multiTxt}</b> chạy ≥2 chuyến/tuyến khác nhau trong mẫu đã ghi biển số (1 xe nhiều vòng) — nên số <b>CHUYẾN</b> cao hơn số <b>XE</b> thật. ` : ""}${ghnNoPlateTxt}${lowCovTxt ? `⚠️ ${lowCovTxt} — số xe riêng biệt bên dưới chỉ là quan sát trên phần đã ghi, CHƯA đại diện toàn bộ, cần ghi đủ biển số hơn để chính xác. ` : ""}Không cộng dồn Cố định + Event thành "tổng xe cụm" — 1 xe có thể vừa chạy lịch cố định vừa được đặt thêm event nên sẽ trùng.`;

  // Donut tỷ trọng NCC — 1 TỔNG QUÁT (mọi tải trọng gộp) + 1 CHI TIẾT riêng mỗi tải trọng đang
  // hoạt động (vd 8T/5T/1.9T) để thấy NCC nào GÁNH tải nặng vs tải nhẹ (tổng quát 1 mình không
  // phân biệt được điều này — 1 NCC có thể đông xe nhưng toàn xe nhỏ, hoặc ít xe nhưng toàn 8T).
  // Màu 1 NCC GIỮ NGUYÊN xuyên suốt mọi donut (xếp theo hạng ở donut tổng quát) để dễ đối chiếu mắt.
  const TOP_N = 6;
  const nccColor = new Map(fm.ncc.map((x, i) => [x.name, NCC_PALETTE[i % NCC_PALETTE.length]]));
  const colorOf = (name: string) => nccColor.get(name) || "#c2cbd6";
  const top = fm.ncc.slice(0, TOP_N);
  const restCount = fm.ncc.slice(TOP_N).reduce((a, x) => a + x.count, 0);
  const donutItems = [
    ...top.map((x) => ({ label: x.name, value: x.count, color: colorOf(x.name) })),
    ...(restCount > 0 ? [{ label: "NCC khác", value: restCount, color: "#c2cbd6" }] : []),
    ...(fm.ghnTC > 0 ? [{ label: "GHN (xe nhà)", value: fm.ghnTC, color: "#1faa59" }] : []),
  ];
  const TON_DONUT_ORDER: TonKey[] = ["t80", "t50", "t19", "van"];
  const tonDonuts = TON_DONUT_ORDER.filter((k) => activeTons.includes(k)).map((k) => {
    const rows = fm.ncc.map((x) => ({ name: x.name, value: x.layTon[k] + x.giaoTon[k] })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    const total = rows.reduce((a, r) => a + r.value, 0);
    const topRows = rows.slice(0, TOP_N);
    const rest = rows.slice(TOP_N).reduce((a, r) => a + r.value, 0);
    const items = [
      ...topRows.map((r) => ({ label: r.name, value: r.value, color: colorOf(r.name) })),
      ...(rest > 0 ? [{ label: "NCC khác", value: rest, color: "#c2cbd6" }] : []),
    ];
    return { k, total, items };
  }).filter((d) => d.total > 0);

  return (
    <>
      <div className="pe-sech" style={{ marginTop: 4 }}>🚚 Hiện trạng &amp; kế hoạch đội xe</div>
      <div className="pe-fc-grid">
        <Reveal className="section-card pe-fc-card">
          <div className="pe-fc-sub">🚚 Xe đang dùng theo tải trọng <span className="fc-src">· Lịch Tải toàn cụm (realtime)</span></div>
          <VBars items={useItems} unit="chuyến" />
          <div className="pe-comment">🤖 <span dangerouslySetInnerHTML={{ __html: cmtUse }} /></div>
        </Reveal>

        <Reveal className="section-card pe-fc-card">
          <div className="pe-fc-sub">🅿️ Đội xe nền <span className="fc-src">· tham chiếu (10/10, 11/11)</span></div>
          <VBars items={baseItems} unit="xe" />
          <div className="pe-comment">🤖 <span dangerouslySetInnerHTML={{ __html: cmtBase }} /></div>
        </Reveal>
      </div>

      {/* Xe RIÊNG BIỆT theo biển số: CỐ ĐỊNH (lịch tải) vs EVENT (tăng cường) — đối chiếu multi-round + GHN/NCC */}
      <Reveal className="section-card pe-fc-card" style={{ marginTop: 12 }}>
        <div className="pe-fc-sub">🚗 Xe RIÊNG BIỆT theo biển số <span className="fc-src">· Cố định vs Event (mẫu đã ghi biển số)</span></div>
        <div className="pe-kpis" style={{ marginBottom: 10 }}>
          <div className="pe-kpi"><span className="l">Cố định · tổng xe riêng biệt</span><b style={{ color: "var(--blue)" }}>{fmtVN(fx.veh.distinctBks)}</b><span className="u">/{fx.veh.routes} chuyến · {fx.veh.coveragePct}% có biển số</span></div>
          <div className="pe-kpi"><span className="l">Cố định · GHN (xe nhà)</span><b style={{ color: "#157a40" }}>{fmtVN(fx.ghnVeh.routes)}</b><span className="u">chuyến/ngày · chưa ghi biển số riêng</span></div>
          <div className="pe-kpi"><span className="l">Cố định · NCC (thuê ngoài)</span><b style={{ color: "var(--blue)" }}>{fmtVN(fx.nccVeh.distinctBks)}</b><span className="u">xe riêng biệt /{fx.nccVeh.routes} chuyến</span></div>
          <div className="pe-kpi"><span className="l">Event · tổng xe riêng biệt</span><b style={{ color: "var(--orange)" }}>{fmtVN(ev.veh.distinctBks)}</b><span className="u">/{ev.veh.routes} chuyến · {ev.veh.coveragePct}% có biển số</span></div>
          <div className="pe-kpi"><span className="l">Event · GHN (xe nhà)</span><b style={{ color: "#157a40" }}>{fmtVN(ev.ghnVeh.routes)}</b><span className="u">chuyến · chưa ghi biển số riêng</span></div>
          <div className="pe-kpi"><span className="l">Event · NCC (thuê ngoài)</span><b style={{ color: "var(--orange)" }}>{fmtVN(ev.nccVeh.distinctBks)}</b><span className="u">xe riêng biệt /{ev.nccVeh.routes} chuyến</span></div>
        </div>
        <div className="pe-comment">🤖 <span dangerouslySetInnerHTML={{ __html: cmtVeh }} /></div>
      </Reveal>

      {/* Lớp 2: Xe book NCC — tách tải nhỏ/lớn + bảng + donut (so kỳ trước xem TrucCompare bên dưới) */}
      <Reveal className="section-card pe-fc-card" style={{ marginTop: 12 }}>
        <div className="pe-fc-sub">🤝 Lớp 2 · Xe book NCC <span className="fc-src">· Tăng Cường Lấy + Giao{fm.tcDate ? ` ${fm.tcDate}` : ""}</span></div>
        {fm.ncc.length > 0 && (
          <div className="pe-kpis" style={{ marginBottom: 10 }}>
            <div className="pe-kpi"><span className="l">Tổng xe book NCC</span><b style={{ color: "var(--orange)" }}>{fmtVN(fm.totalNcc)}</b><span className="u">📥{fm.layTon.total} · 📤{fm.giaoTon.total} · +{fm.ghnTC} GHN dự phòng</span></div>
          </div>
        )}
        {fm.ncc.length ? (
          <>
            <Collapsible title="📋 Bảng chi tiết theo NCC — Lấy/Giao × tải trọng" sub={`${fm.ncc.length} NCC`}>
              <NccTable ncc={fm.ncc} ghnTC={fm.ghnTC} activeTons={activeTons} />
            </Collapsible>
            <div className="ncc-donut-row">
              <div className="ncc-donut-card">
                <div className="ncc-donut-card-h">Tổng quát <span className="fc-src">· mọi tải trọng</span></div>
                <Donut items={donutItems} center={String(fm.totalNcc)} centerSub="xe NCC" />
              </div>
              {tonDonuts.map((d) => (
                <div className="ncc-donut-card" key={d.k}>
                  <div className="ncc-donut-card-h">Tải {TON_LABEL[d.k]}kg <span className="fc-src">· chi tiết</span></div>
                  <Donut items={d.items} center={String(d.total)} centerSub="xe" />
                </div>
              ))}
            </div>
          </>
        ) : <div className="sl-empty">Chưa có dữ liệu NCC.</div>}
        <div className="pe-comment">🤖 <span dangerouslySetInnerHTML={{ __html: cmtNcc }} /></div>
      </Reveal>
    </>
  );
}
