/* ============================================================
   HỒ SƠ NĂNG LỰC NCC — phần MỚI trong Performance NCC (trước là
   DS NCC VT, chỉ có danh bạ liên hệ). 2 khối:
   1) Hồ sơ NCC tự khai (6 cột mới ở tab TT NCC — text thô, không suy diễn).
   2) Năng lực cấp xe CỐ ĐỊNH — TÍNH TỪ LỊCH TẢI THẬT (không phải tự khai),
      xem src/lib/nccFixedCapacity.ts để biết quy tắc loại trừ.
   ============================================================ */
import { Collapsible } from "./Collapsible";
import type { NccVT } from "../lib/nccVT";
import type { NccUsageRow, NccCapacityCell } from "../lib/nccFixedCapacity";
import { TON_LABEL } from "../lib/fleetMix";
import type { NccConfidence } from "../lib/nccName";

function pickFirst(vals: string[]): string {
  return vals.find((v) => v && v.trim()) || "";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="npc-field">
      <div className="npc-field-lb">{label}</div>
      {value ? <div className="npc-field-val">{value}</div> : <div className="npc-field-empty">Đang bổ sung…</div>}
    </div>
  );
}

export function NccProfileCard({
  rows, usage, capacity, matchConfidence,
}: {
  rows: NccVT[];
  usage: NccUsageRow | null;
  capacity: NccCapacityCell[];
  matchConfidence: NccConfidence | null;
}) {
  const xeTheoTaiTrong = pickFirst(rows.map((r) => r.xeTheoTaiTrong));
  const nangLucThucThi = pickFirst(rows.map((r) => r.nangLucThucThi));
  const event = pickFirst(rows.map((r) => r.event));
  const phamViHoatDong = pickFirst(rows.map((r) => r.phamViHoatDong));
  const cacLoiDangCo = pickFirst(rows.map((r) => r.cacLoiDangCo));
  const giaCa = pickFirst(rows.map((r) => r.giaCa));

  let capTotal = 0;
  for (const c of capacity) capTotal += c.cot;

  return (
    <div className="npc">
      {usage ? (
        <div className="npc-usage">
          🚚 NCC đang chạy thật <b>{usage.routes}</b> tuyến ({usage.stops} điểm dừng) trên toàn cụm M12 — xếp theo mức dùng.
          {matchConfidence === "ambiguous" && (
            <span className="npc-warn"> ⚠ Tên khớp chưa chắc chắn (trùng cụm từ với &gt;1 công ty trong TT NCC) — kiểm tra lại tên công ty.</span>
          )}
        </div>
      ) : (
        <div className="npc-usage">Chưa thấy NCC này chạy tuyến nào trong lịch tải hiện tại (hoặc tên chưa khớp được — kiểm tra chính tả tên công ty).</div>
      )}

      <Collapsible title="📋 Hồ sơ năng lực (NCC tự khai)" defaultOpen={false}>
        <div className="npc-grid">
          <Field label="⚖ Tổng số xe theo tải trọng" value={xeTheoTaiTrong} />
          <Field label="✅ Năng lực thực thi cố định" value={nangLucThucThi} />
          <Field label="🎪 Năng lực cấp xe vào Event" value={event} />
          <Field label="🗺️ Phạm vi hoạt động" value={phamViHoatDong} />
          <Field label="⚠️ Các lỗi đang có" value={cacLoiDangCo} />
          <Field label="💰 Giá cả" value={giaCa} />
        </div>
      </Collapsible>

      <Collapsible
        title="📐 Năng lực cấp xe cố định — tính từ lịch tải thật"
        sub={capTotal > 0 ? `${capTotal} cột` : undefined}
        defaultOpen={false}
      >
        {capacity.length === 0 ? (
          <div className="tc-empty">Chưa có tuyến cố định nào khớp NCC này (ngoài các tuyến M12 không phụ trách).</div>
        ) : (
          <>
            <p className="lead" style={{ fontSize: 13, margin: "0 0 8px" }}>
              "Cột" = 1 điểm dừng trong lịch tải thật. Đã loại tuyến Nội Vùng HCM, tuyến có điểm đầu Kho HCM01,
              và loại tuyến CK1/CK2/01_FW_20 — các tuyến này M12 không phụ trách.
            </p>
            <table className="tc-grid">
              <thead><tr><th>Vùng</th><th>Tải trọng</th><th style={{ width: 70 }}>Số cột</th></tr></thead>
              <tbody>
                {capacity.map((c, i) => (
                  <tr key={i}><td>{c.region}</td><td>{TON_LABEL[c.ton]}</td><td className="num">{c.cot}</td></tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 800 }}>
                  <td colSpan={2}>TỔNG</td><td className="num">{capTotal}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </Collapsible>
    </div>
  );
}
