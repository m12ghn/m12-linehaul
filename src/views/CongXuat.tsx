import { useMemo, useState } from "react";
import { useCongXuat } from "../lib/useCongXuat";
import { useTlld } from "../lib/useTlld";
import { normCode } from "../lib/tlld";
import { usePersistentState } from "../lib/usePersistent";
import { normSearch } from "../lib/normalize";
import { usePlaceIds } from "../lib/allRoutes";

type Ca = "ngay" | "dem" | "all";
const CA_LABEL: Record<Ca, string> = { ngay: "CA NGÀY", dem: "CA ĐÊM", all: "TỔNG" };

const congNum = (c: string) => { const n = parseInt(c, 10); return Number.isFinite(n) ? n : 9999; };
const fmtN = (n: number) => Math.round(n).toLocaleString("vi-VN");
const fmtKg = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 0 });

/**
 * Cổng Xuất: bảng cổng xuất theo tab Nội Thành HCM. 3 ca (Ngày/Đêm/ALL).
 * Chọn cổng -> tiêu đề "HCM CA NGÀY | CỔNG n" + bảng bưu cục của cổng đó.
 */
export function CongXuat() {
  const { data, refreshing } = useCongXuat();
  const [ca, setCa] = usePersistentState<Ca>("cx.ca", "ngay");
  const [cong, setCong] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Cho phép gõ MÃ ID bưu cục để tìm ra dòng — CongEntry không tự có cột ID, tra chéo qua tên kho.
  const placeIds = usePlaceIds();

  const all = data?.entries ?? [];
  const byCa = useMemo(() => (ca === "all" ? all : all.filter((e) => e.ca === ca)), [all, ca]);

  // Danh sách cổng (sắp theo số) trong ca đang chọn
  const congs = useMemo(() => {
    const set = new Set(byCa.map((e) => e.cong).filter(Boolean));
    return [...set].sort((a, b) => congNum(a) - congNum(b));
  }, [byCa]);

  // Cổng đang chọn (mặc định cổng đầu)
  const selCong = cong && congs.includes(cong) ? cong : congs[0] ?? null;

  // Có tìm kiếm -> tìm TRÊN TẤT CẢ CỔNG (không bó trong 1 cổng, tránh "không có thông tin").
  // Không tìm kiếm -> chỉ hiện cổng đang chọn.
  const q = normSearch(search);
  const searching = !!q;
  const rows = useMemo(() => {
    let r = searching ? byCa.slice() : byCa.filter((e) => e.cong === selCong);
    if (q) r = r.filter((e) => normSearch([e.tuyen, e.kho, e.maPort, e.so, "cong " + e.cong, "cổng " + e.cong, placeIds.get(e.kho) || ""].join(" ")).includes(q));
    return r.sort((a, b) =>
      searching
        ? congNum(a.cong) - congNum(b.cong) || a.tuyen.localeCompare(b.tuyen) || (a.toiHCM20 || "").localeCompare(b.toiHCM20 || "")
        : (a.toiHCM20 || "").localeCompare(b.toiHCM20 || "") || a.tuyen.localeCompare(b.tuyen) || congNum(a.so) - congNum(b.so)
    );
  }, [byCa, selCong, q, searching]);
  // Các cổng có kết quả khớp (để gợi ý khi tìm).
  const hitCongs = useMemo(() => (searching ? [...new Set(rows.map((e) => e.cong))].sort((a, b) => congNum(a) - congNum(b)) : []), [rows, searching]);

  const totalDiem = byCa.length;
  const totalTuyen = new Set(byCa.map((e) => e.tuyen)).size;

  // Sản lượng (số đơn + kg) của cổng đang chọn — dựa vào tuyến xuất, từ dữ liệu TLLD.
  const { index } = useTlld();
  const stats = useMemo(() => {
    if (!index || !selCong) return null;
    const tuyens = [...new Set(byCa.filter((e) => e.cong === selCong).map((e) => e.tuyen))];
    const dayTotal = (d: string) => {
      let don = 0, kg = 0;
      for (const t of tuyens) {
        const e = index.volByCode.get(normCode(t))?.get(d);
        if (e) { don += e.soDon; kg += e.kg; }
      }
      return { don, kg };
    };
    const n1 = index.refDate ? dayTotal(index.refDate) : { don: 0, kg: 0 };
    const days = index.last7.map(dayTotal).filter((x) => x.don > 0 || x.kg > 0);
    const avg = days.length
      ? { don: days.reduce((a, x) => a + x.don, 0) / days.length, kg: days.reduce((a, x) => a + x.kg, 0) / days.length }
      : { don: 0, kg: 0 };
    return { n1, avg, days: days.length, refDate: index.refDate };
  }, [index, selCong, byCa]);

  return (
    <div>
      <div className="sub-tabs">
        <button className={ca === "ngay" ? "active" : ""} onClick={() => setCa("ngay")}>☀️ Ca Ngày</button>
        <button className={ca === "dem" ? "active" : ""} onClick={() => setCa("dem")}>🌙 Ca Đêm</button>
        <button className={ca === "all" ? "active" : ""} onClick={() => setCa("all")}>📋 ALL</button>
      </div>

      <div className="section-card cx-head">
        <div className="cx-title">HCM {CA_LABEL[ca]}{selCong ? ` · CỔNG ${selCong}` : ""}</div>
        <p className="lead" style={{ margin: "2px 0 0", fontSize: 14 }}>
          <b>Phạm vi: Nội Thành HCM</b> (không gồm Sóng Thần/ngoại thành) · {congs.length} cổng · {totalTuyen} tuyến · {totalDiem} điểm có cổng
          {data?.lastSync ? ` · cập nhật ${new Date(data.lastSync).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : ""}
          {refreshing ? " · đồng bộ…" : ""}
        </p>

        {/* Chọn cổng */}
        {congs.length > 0 && (
          <div className="cx-gates">
            {congs.map((c) => (
              <button key={c} className={"cx-gate" + (c === selCong ? " active" : "")} onClick={() => setCong(c)}>
                Cổng {c}
                <span className="n">{byCa.filter((e) => e.cong === c).length}</span>
              </button>
            ))}
          </div>
        )}
        <input
          className="pl-in"
          style={{ marginTop: 10 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 Tìm tuyến / bưu cục / mã ID / mã port trên TẤT CẢ cổng…"
        />
        {searching && (
          <div style={{ marginTop: 6, fontSize: 13.5, color: "var(--muted)" }}>
            Kết quả cho “<b>{search}</b>”: <b>{rows.length}</b> dòng
            {hitCongs.length > 0 && <> ở cổng {hitCongs.map((c) => (
              <button key={c} className="cx-hit-tag" onClick={() => { setCong(c); setSearch(""); }} title={`Mở Cổng ${c}`}>Cổng {c}</button>
            ))}</>}
          </div>
        )}
      </div>

      {/* Sản lượng cổng đang chọn (số đơn + kg) N-1 & TB 7 ngày — đặt ngay cạnh tóm tắt đầu trang */}
      {stats && (
        <div className="cx-stats">
          <div className="cx-stats-title">📦 Sản lượng Cổng {selCong} <span>(theo tuyến xuất)</span></div>
          <table>
            <thead><tr><th></th><th>N-1</th><th>TB 7 ngày</th></tr></thead>
            <tbody>
              <tr><td>Số đơn</td><td className="num">{fmtN(stats.n1.don)}</td><td className="num">{fmtN(stats.avg.don)}</td></tr>
              <tr><td>Khối lượng</td><td className="num">{fmtKg(stats.n1.kg)} kg</td><td className="num">{fmtKg(stats.avg.kg)} kg</td></tr>
            </tbody>
          </table>
          <div className="cx-stats-note">
            {stats.days > 0 ? `${stats.days} ngày có dữ liệu` : "chưa có dữ liệu TLLD cho cổng này"}
          </div>
        </div>
      )}

      {!data ? (
        <div className="section-card" style={{ marginTop: 12, textAlign: "center", color: "var(--muted)" }}>Đang tải dữ liệu cổng xuất…</div>
      ) : congs.length === 0 ? (
        <div className="section-card" style={{ marginTop: 12, textAlign: "center", color: "var(--muted)" }}>Không có cổng nào trong {CA_LABEL[ca].toLowerCase()}.</div>
      ) : (
        <div className="section-card cx-wrap scroll-frame" style={{ marginTop: 12 }}>
          <div className="cx-banner">HCM {CA_LABEL[ca]} | {searching ? `TÌM: “${search}”` : `CỔNG ${selCong}`}</div>
          {rows.length === 0 ? (
            <div style={{ padding: "22px 12px", textAlign: "center", color: "var(--muted)", fontSize: 14.5 }}>
              {searching ? <>Không tìm thấy “<b>{search}</b>” ở cổng nào trong <b>{CA_LABEL[ca]}</b>. Thử <b>đổi ca</b> (Ngày/Đêm/ALL) hoặc gõ 1 phần mã tuyến. Nếu vẫn trống thì tuyến này <b>chưa được gán cổng</b> trong bảng Cổng Xuất (kiểm tra lại ở mục Lịch Tải).</> : "Cổng này chưa có dòng nào."}
            </div>
          ) : (
          <table className="cx-table">
            <thead>
              <tr>{searching && <th>Cổng</th>}<th>Tới điểm</th><th>Tên tuyến</th><th>Số</th><th>Mã port</th><th>Tên kho</th></tr>
            </thead>
            <tbody>
              {rows.map((e, i) => {
                const newRoute = i === 0 || rows[i - 1].tuyen !== e.tuyen || (searching && rows[i - 1].cong !== e.cong);
                return (
                  <tr key={e.cong + e.tuyen + e.maPort + i} className={newRoute ? "cx-route-first" : ""}>
                    {searching && <td className="num cx-so">{newRoute ? <b style={{ color: "var(--orange)" }}>{e.cong}</b> : ""}</td>}
                    <td className="num cx-toi">{newRoute ? e.toiHCM20 || "—" : ""}</td>
                    <td className="cx-tuyen">{newRoute ? e.tuyen : ""}</td>
                    <td className="num cx-so">{e.so || "—"}</td>
                    <td className="num">{e.maPort}</td>
                    <td>{/kho/i.test(e.kho) ? "🏠 " : ""}{e.kho}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
        </div>
      )}
    </div>
  );
}
