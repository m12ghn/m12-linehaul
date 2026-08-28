/* ============================================================
   MÀN "NHẬP LIỆU LỊCH TẢI" — nguồn dữ liệu là Supabase, sửa trực tiếp tại đây.

   CỐ Ý tách thành màn riêng thay vì sửa đè lên views/LichTai.tsx:
   trong lúc chuyển đổi, màn Lịch Tải cũ (đọc Google Sheet) VẪN chạy song song
   để đối chiếu số liệu. Khi số liệu 2 bên khớp, đổi App.tsx dùng useLichTai
   cho cả màn cũ rồi bỏ hẳn nhánh đọc Sheet.
   ============================================================ */
import { useMemo, useState } from "react";
import { useLichTai } from "../lib/db/useLichTai";
import { RouteEditor, RegionToolbar } from "../components/RouteEditor";
import { normSearch } from "../lib/normalize";
import { VISIBLE_SHEETS } from "../config";

export function LichTaiNhap({ canEdit, canExport }: { canEdit: boolean; canExport: boolean }) {
  const [regionKey, setRegionKey] = useState(VISIBLE_SHEETS[0].key);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const { data, refreshing, refresh } = useLichTai(regionKey);

  const region = VISIBLE_SHEETS.find((s) => s.key === regionKey) ?? VISIBLE_SHEETS[0];

  const shown = useMemo(() => {
    const q = normSearch(search);
    return data.routes.filter((r) => {
      if (category && r.category !== category) return false;
      if (!q) return true;
      return normSearch(r.route).includes(q)
          || normSearch(r.ncc || "").includes(q)
          || normSearch(r.bks || "").includes(q)
          || r.stops.some((s) => normSearch(s.kho).includes(q));
    });
  }, [data.routes, search, category]);

  return (
    <>
      <div className="sub-tabs re-regions">
        {VISIBLE_SHEETS.map((s) => (
          <button key={s.key} className={s.key === regionKey ? "active" : ""}
            onClick={() => { setRegionKey(s.key); setCategory(""); }}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="re-filters">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm mã tuyến, kho, NCC, biển số…" />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Tất cả loại tuyến</option>
          {data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={refresh} disabled={refreshing}>
          {refreshing ? "Đang tải…" : "Làm mới"}
        </button>
        <span className="muted">
          {shown.length}/{data.routes.length} tuyến
          {data.lastSync && ` · cập nhật ${new Date(data.lastSync).toLocaleTimeString("vi-VN")}`}
        </span>
      </div>

      <RegionToolbar regionKey={regionKey} regionLabel={region.label}
        canEdit={canEdit} canExport={canExport} onChanged={refresh} />

      {data.error && (
        <div className="state">
          <div className="big">Không tải được dữ liệu</div>
          <div><code>{data.error}</code></div>
          <button className="retry-btn" onClick={refresh}>Thử lại</button>
        </div>
      )}

      {data.loading && data.routes.length === 0 && (
        <div className="state"><div className="spinner" /><div className="big">Đang tải từ Supabase…</div></div>
      )}

      {!data.loading && shown.length === 0 && !data.error && (
        <div className="state">
          <div className="big">Chưa có tuyến nào</div>
          <div>Bấm <b>+ Tuyến mới</b> để tạo, hoặc chạy <code>node scripts/import-sheets.mjs</code> để nạp dữ liệu cũ từ Google Sheet.</div>
        </div>
      )}

      {shown.map((r) => (
        <RouteEditor key={r.id} route={r} canEdit={canEdit} onChanged={refresh} />
      ))}

      {data.missingGeo.length > 0 && (
        <div className="muted" style={{ marginTop: 12 }}>
          ⚠ {data.missingGeo.length} tên kho chưa khớp toạ độ — thêm bí danh vào bảng
          <code> warehouse_aliases</code> để hiện đúng trên bản đồ.
        </div>
      )}
    </>
  );
}
