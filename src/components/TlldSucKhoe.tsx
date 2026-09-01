/* ============================================================
   TLLD SỨC KHOẺ VẬN HÀNH — khung "Tổng Quan" mới của tab TLLD Tuyến, 01/09/2026.

   Sếp yêu cầu rebuild TLLD Tuyến với các góc nhìn:
   - 2 CHỈ SỐ song song: TLLD theo THỂ TÍCH (số đơn) và theo KHỐI LƯỢNG (weight) —
     xem thêm src/lib/tlld.ts (TlldRoute.tlldVol, thêm 01/09).
   - Scorecard TLLD (vol/weight) N-1 so N-2 (hôm kia) và so CÙNG THỨ tuần trước,
     kèm SỐ CHUYẾN (trip_code) — xem buildTongQuanTlld() ở tlld.ts.
   - "Lịch tải/chuyến TLLD thấp" — góc nhìn TỪNG CHUYẾN (1 mã tuyến/lịch tải có
     nhiều chuyến theo từng ngày), khác các nơi khác trong app vốn chỉ tính theo
     TB TUYẾN — xem danhSachChuyenThap().
   - Lệch TLLD khối lượng vs thể tích (đơn nhẹ-cồng kềnh hoặc nặng-gọn) — xem
     computeLechKhoiLuongTheTich().
   - Bấm 1 chuyến TLLD thấp -> tải CHI TIẾT TỪNG ĐIỂM DỪNG (mức thấp nhất,
     tlld_daily) theo yêu cầu, KHÔNG tải sẵn hàng loạt (nặng) — fetchDiemDungChuyen().

   Đặt ở ĐẦU khung "Tổng Quan" (view=tong-quan) của TlldTuyen.tsx, TRƯỚC danh sách
   duyệt/tìm tuyến — không đụng "🌐 Tổng TLLD của Cụm" (TlldClusterReport, ở tab
   "Báo Cáo") vốn đã rất đầy đủ ở mức khối lượng theo Ngày/Tuần/Tháng, chỉ CHƯA có
   thể tích + góc nhìn chuyến/điểm dừng — bổ sung đúng phần còn thiếu, không làm
   lại phần đã có.

   TẤT CẢ số liệu tính THẲNG từ dữ liệu TLLD thật (Data API -> Supabase) — không
   suy diễn khi thiếu (đúng quy tắc dự án, xem skill m12-conventions mục 2).
   ============================================================ */
import { useMemo, useState } from "react";
import {
  buildTongQuanTlld,
  danhSachChuyenThap,
  computeLechKhoiLuongTheTich,
  fetchDiemDungChuyen,
  type TlldIndex,
  type TlldChuyen,
  type TlldDiemDung,
  type SoSanhNgay,
} from "../lib/tlld";

const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");
const fillColor = (v: number | null) =>
  v == null ? "var(--muted)" : v >= 0.85 ? "var(--green)" : v >= 0.6 ? "var(--orange)" : "var(--red)";
const ddmm = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const VN_DOW = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const dowVN = (iso: string | null) => (iso ? VN_DOW[new Date(iso + "T00:00:00").getDay()] : "—");

/** 1 dòng so sánh trong scorecard: nhãn kỳ đối chiếu + delta màu theo dấu. */
function DongSoSanh({ nhan, sosanh, kieu }: { nhan: string; sosanh: SoSanhNgay; kieu: "pct" | "count" }) {
  const co = sosanh.giaTri != null && sosanh.giaTriKia != null;
  const tang = (sosanh.delta ?? 0) >= 0;
  const mau = !co ? "var(--muted)" : tang ? "var(--green)" : "var(--red)";
  return (
    <div className="tq-cmp-row">
      <span className="tq-cmp-lb">{nhan} ({ddmm(sosanh.ngayKia)})</span>
      {!co ? (
        <b style={{ color: "var(--muted)" }}>chưa đủ dữ liệu</b>
      ) : kieu === "pct" ? (
        <b style={{ color: mau }}>
          {tang ? "▲" : "▼"}{Math.abs(Math.round((sosanh.delta ?? 0) * 100))}đ
          <span className="tq-cmp-sub"> ({pct(sosanh.giaTriKia)} → {pct(sosanh.giaTri)})</span>
        </b>
      ) : (
        <b style={{ color: mau }}>
          {tang ? "▲" : "▼"}{Math.abs(sosanh.delta ?? 0)} chuyến
          <span className="tq-cmp-sub"> ({sosanh.giaTriKia} → {sosanh.giaTri}{sosanh.deltaPct != null ? `, ${sosanh.deltaPct >= 0 ? "+" : ""}${Math.round(sosanh.deltaPct * 100)}%` : ""})</span>
        </b>
      )}
    </div>
  );
}

/** 1 thẻ scorecard: giá trị N-1 lớn + 2 dòng so sánh (N-2, cùng thứ tuần trước). */
function TheScorecard({
  ic, title, giaTriN1, kieu, soN2, soTuanTruoc, thuTuanTruoc,
}: {
  ic: string; title: string; giaTriN1: number | null; kieu: "pct" | "count";
  soN2: SoSanhNgay; soTuanTruoc: SoSanhNgay; thuTuanTruoc: string;
}) {
  return (
    <div className="section-card tq-card">
      <div className="lbl">{ic} {title}</div>
      <div className="val" style={{ color: kieu === "pct" ? fillColor(giaTriN1) : "var(--ink)" }}>
        {kieu === "pct" ? pct(giaTriN1) : (giaTriN1 ?? "—")}
      </div>
      <div className="tq-cmp-list">
        <DongSoSanh nhan="So hôm kia (N-2)" sosanh={soN2} kieu={kieu} />
        <DongSoSanh nhan={`So ${thuTuanTruoc} tuần trước`} sosanh={soTuanTruoc} kieu={kieu} />
      </div>
    </div>
  );
}

/** 1 dòng chuyến TLLD thấp — bấm để mở/đóng chi tiết TỪNG ĐIỂM DỪNG (tải theo yêu cầu). */
function DongChuyenThap({
  c, theo, open, onToggle, diem, diemLoading, diemErr,
}: {
  c: TlldChuyen; theo: "weight" | "vol"; open: boolean; onToggle: () => void;
  diem: TlldDiemDung[] | null; diemLoading: boolean; diemErr: string | null;
}) {
  const v = theo === "weight" ? c.tlldWeight : c.tlldVol;
  return (
    <>
      <tr className="tq-chuyen-row" onClick={onToggle} style={{ cursor: "pointer" }}>
        <td>{open ? "▾" : "▸"} {c.maChuyen}</td>
        <td>{c.code || "—"}</td>
        <td>{ddmm(c.date || null)}</td>
        <td className="num" style={{ fontWeight: 800, color: fillColor(v) }}>{pct(v)}</td>
        <td className="num">{theo === "weight" ? pct(c.tlldVol) : pct(c.tlldWeight)}</td>
        <td>{c.bienSo || "—"}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ background: "var(--surface-sunken)", padding: "8px 12px" }}>
            {diemLoading ? (
              <span style={{ color: "var(--muted)" }}>Đang tải chi tiết điểm dừng…</span>
            ) : diemErr ? (
              <span style={{ color: "var(--red)" }}>Lỗi tải điểm dừng: {diemErr}</span>
            ) : !diem || diem.length === 0 ? (
              <span style={{ color: "var(--muted)" }}>Không có dữ liệu điểm dừng.</span>
            ) : (
              <table className="tc-grid" style={{ width: "100%" }}>
                <thead>
                  <tr><th>#</th><th>Kho</th><th>Loại tải</th><th>TLLD KL (điểm)</th><th>TLLD TT (điểm)</th><th>Khối lượng</th><th>Số đơn</th></tr>
                </thead>
                <tbody>
                  {diem.map((d) => (
                    <tr key={d.thuTu}>
                      <td className="num">{d.thuTu}</td>
                      <td>{d.kho || "—"}</td>
                      <td>{d.loaiTai || "—"}</td>
                      <td className="num" style={{ color: fillColor(d.tlldWeightDiem) }}>{pct(d.tlldWeightDiem)}</td>
                      <td className="num" style={{ color: fillColor(d.tlldVolDiem) }}>{pct(d.tlldVolDiem)}</td>
                      <td className="num">{d.khoiluongKg != null ? d.khoiluongKg + " kg" : "—"}</td>
                      <td className="num">{d.soDonHang ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function TlldSucKhoe({ index }: { index: TlldIndex | null }) {
  const tq = useMemo(() => (index ? buildTongQuanTlld(index) : null), [index]);
  const [theoChuyen, setTheoChuyen] = useState<"weight" | "vol">("weight");
  const chuyenThap = useMemo(
    () => (index ? danhSachChuyenThap(index, { theo: theoChuyen, n: 20 }) : []),
    [index, theoChuyen]
  );
  const lech = useMemo(() => (index ? computeLechKhoiLuongTheTich(index) : []), [index]);

  // Điểm dừng của chuyến đang mở — tải theo yêu cầu (không tải sẵn hàng loạt).
  const [openChuyen, setOpenChuyen] = useState<string | null>(null);
  const [diem, setDiem] = useState<TlldDiemDung[] | null>(null);
  const [diemLoading, setDiemLoading] = useState(false);
  const [diemErr, setDiemErr] = useState<string | null>(null);

  async function toggleChuyen(maChuyen: string) {
    if (openChuyen === maChuyen) { setOpenChuyen(null); return; }
    setOpenChuyen(maChuyen);
    setDiem(null); setDiemErr(null); setDiemLoading(true);
    try {
      const rows = await fetchDiemDungChuyen(maChuyen);
      setDiem(rows);
    } catch (e) {
      setDiemErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDiemLoading(false);
    }
  }

  if (!index || !tq) return null;

  const thuTuanTruoc = dowVN(tq.cungThuTuanTruoc);

  return (
    <div className="tlld-suckhoe">
      <div className="pe-sech" style={{ marginBottom: 2 }}>🩺 Sức khoẻ vận hành TLLD</div>
      <p className="pe-sub" style={{ margin: "0 0 10px" }}>
        Ngày N-1: <b>{ddmm(tq.refDate)}</b> ({dowVN(tq.refDate)}) · so hôm kia (N-2) và so đúng <b>{thuTuanTruoc}</b> tuần
        trước (cùng thứ, để tránh lệch do thói quen giao hàng khác nhau giữa ngày thường/cuối tuần).
      </p>

      <div className="tq-grid">
        <TheScorecard
          ic="⚖️" title="TLLD theo KHỐI LƯỢNG" kieu="pct" thuTuanTruoc={thuTuanTruoc}
          giaTriN1={tq.weightSoN2.giaTri} soN2={tq.weightSoN2} soTuanTruoc={tq.weightSoTuanTruoc}
        />
        <TheScorecard
          ic="📦" title="TLLD theo THỂ TÍCH (số đơn)" kieu="pct" thuTuanTruoc={thuTuanTruoc}
          giaTriN1={tq.volSoN2.giaTri} soN2={tq.volSoN2} soTuanTruoc={tq.volSoTuanTruoc}
        />
        <TheScorecard
          ic="🚚" title="Số chuyến tải" kieu="count" thuTuanTruoc={thuTuanTruoc}
          giaTriN1={tq.soChuyenN1} soN2={tq.soChuyenSoN2} soTuanTruoc={tq.soChuyenSoTuanTruoc}
        />
      </div>
      <p className="pe-sub" style={{ margin: "6px 0 14px", fontSize: 12.5 }}>
        "TLLD theo khối lượng/thể tích" = TB đơn giản qua các tuyến CÓ CHẠY ngày đó (không trọng số
        theo tải trọng/số chuyến) — cùng quy ước tính "TB lấp đầy" dùng xuyên suốt dashboard. Ngày N-1
        mới <b>{tq.soTuyenN1 ?? "—"}</b> tuyến có dữ liệu.
      </p>

      <div className="section-card" style={{ marginTop: 4 }}>
        <div className="tq-sub" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>⚠️ Chuyến TLLD thấp <span style={{ color: "var(--muted)", fontWeight: 600 }}>({chuyenThap.length} chuyến, &lt;60% — bấm 1 dòng để xem chi tiết điểm dừng)</span></span>
          <div style={{ display: "flex", gap: 6 }}>
            <button className={"cat-chip" + (theoChuyen === "weight" ? " active" : "")} onClick={() => setTheoChuyen("weight")}>Theo khối lượng</button>
            <button className={"cat-chip" + (theoChuyen === "vol" ? " active" : "")} onClick={() => setTheoChuyen("vol")}>Theo thể tích</button>
          </div>
        </div>
        {chuyenThap.length === 0 ? (
          <div className="sl-empty">Không có chuyến nào TLLD {theoChuyen === "weight" ? "khối lượng" : "thể tích"} dưới 60%.</div>
        ) : (
          <div className="tc-wrap scroll-frame" style={{ marginTop: 8 }}>
            <table className="tc-grid">
              <thead>
                <tr>
                  <th>Mã chuyến</th><th>Mã tuyến</th><th>Ngày</th>
                  <th style={{ width: 90 }}>{theoChuyen === "weight" ? "TLLD KL" : "TLLD TT"}</th>
                  <th style={{ width: 90 }}>{theoChuyen === "weight" ? "TLLD TT" : "TLLD KL"}</th>
                  <th>Biển số</th>
                </tr>
              </thead>
              <tbody>
                {chuyenThap.map((c) => (
                  <DongChuyenThap
                    key={c.maChuyen}
                    c={c}
                    theo={theoChuyen}
                    open={openChuyen === c.maChuyen}
                    onToggle={() => toggleChuyen(c.maChuyen)}
                    diem={openChuyen === c.maChuyen ? diem : null}
                    diemLoading={openChuyen === c.maChuyen && diemLoading}
                    diemErr={openChuyen === c.maChuyen ? diemErr : null}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="section-card" style={{ marginTop: 12 }}>
        <div className="tq-sub">
          🔀 Lệch TLLD khối lượng ↔ thể tích <span style={{ color: "var(--muted)", fontWeight: 600 }}>({lech.length} tuyến lệch ≥15 điểm % · TB 7 ngày, hoặc N-1 nếu chưa đủ 7 ngày)</span>
        </div>
        <p className="pe-sub" style={{ margin: "4px 0 8px", fontSize: 12.5 }}>
          Khối lượng thấp hơn thể tích rõ = đơn CỒNG KỀNH-NHẸ CÂN (chiếm chỗ nhưng không nặng — xe đầy
          chỗ mà vẫn còn dư tải trọng). Ngược lại = đơn NẶNG-GỌN (còn dư chỗ nhưng đã đầy cân).
        </p>
        {lech.length === 0 ? (
          <div className="sl-empty">Không có tuyến nào lệch đáng kể giữa 2 chỉ số.</div>
        ) : (
          <div className="tc-wrap scroll-frame">
            <table className="tc-grid">
              <thead>
                <tr><th>Mã tuyến</th><th style={{ width: 90 }}>TLLD KL</th><th style={{ width: 90 }}>TLLD TT</th><th style={{ width: 110 }}>Lệch</th><th>Hướng</th></tr>
              </thead>
              <tbody>
                {lech.slice(0, 30).map((x) => (
                  <tr key={x.code}>
                    <td style={{ fontWeight: 700 }}>{x.code}</td>
                    <td className="num" style={{ color: fillColor(x.weight) }}>{pct(x.weight)}</td>
                    <td className="num" style={{ color: fillColor(x.volume) }}>{pct(x.volume)}</td>
                    <td className="num" style={{ fontWeight: 800, color: x.lech < 0 ? "var(--orange)" : "var(--blue)" }}>
                      {x.lech >= 0 ? "+" : ""}{Math.round(x.lech * 100)}đ
                    </td>
                    <td style={{ fontSize: 12.5, color: "var(--muted)" }}>
                      {x.lech < 0 ? "Cồng kềnh · nhẹ cân" : "Nặng · còn dư chỗ"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lech.length > 30 && <div className="sl-empty" style={{ padding: "6px 0 0" }}>+{lech.length - 30} tuyến khác…</div>}
          </div>
        )}
      </div>
    </div>
  );
}
