import { useState } from "react";
import { haversineKm } from "../lib/geo";
import { AuditInfo } from "./AuditInfo";
import { RouteEditor } from "./RouteEditor";
import type { DbRoute } from "../lib/db/lichTaiApi";
import type { Route, Stop } from "../types";

/** RouteCard dùng chung cho cả Lịch Tải (dữ liệu Supabase, sửa được, có `id`/`sid`)
 *  lẫn GSVT (dữ liệu chỉ đọc, KHÔNG có `id`/`sid`) — nới lỏng 2 trường này thành optional
 *  để 1 component phục vụ được cả 2 nơi; các tính năng sửa/audit chỉ bật khi có `id`. */
interface CardStop extends Stop {
  sid?: string;
  rev?: string;
}
interface CardRoute extends Omit<Route, "stops"> {
  id?: string;
  rev?: string;
  stops: CardStop[];
}

/** Tổng đường chim bay (ước tính nhanh, không gọi OSRM). */
function totalHaversine(r: CardRoute): number {
  let sum = 0;
  for (let i = 1; i < r.stops.length; i++) {
    const a = r.stops[i - 1].coord;
    const b = r.stops[i].coord;
    if (a && b) sum += haversineKm(a, b);
  }
  return sum;
}

/**
 * Thẻ 1 tuyến — dạng bảng: cột Tên Tuyến (gộp dòng) bên trái, rồi #, Tên Kho,
 * Loại Hình, Đến, Rời. Cột cố định để các thẻ thẳng hàng. Bấm để xem trên bản đồ.
 *
 * 03/09/2026: bỏ EditableCell/saveCell (gọi endpoint /api/lichtai-edit đã KHÔNG
 * còn tồn tại trên Vercel — sửa tại chỗ kiểu cũ này thực ra đang lỗi âm thầm
 * trên production). Thay bằng nút ✎ mở NGUYÊN <RouteEditor> (đã dùng ổn ở tab
 * Nhập liệu cũ) ngay trong thẻ — bỏ hẳn tab "✏️ Nhập liệu" riêng. Thêm nút "ⓘ"
 * xem lịch sử sửa (audit_log, đã có sẵn hạ tầng ghi).
 *
 * 03/09 tối, theo phản hồi Sếp:
 *  - Nút "ⓘ" CHỈ còn ở cấp TUYẾN (bỏ hẳn ở từng điểm dừng — quá rối mắt).
 *  - Nút "ⓘ" hiện cho MỌI người dùng đã đăng nhập xem được Lịch Tải (chỉ cần
 *    tuyến có `id` thật từ Supabase), TÁCH RIÊNG khỏi quyền sửa.
 *  - Nút "✎ Sửa" (mở RouteEditor) CHỈ hiện cho đúng vai trò `admin` — `canEditRoute`
 *    truyền từ App.tsx (`useAdmin().isAdmin`), không dùng chung với quyền RBAC
 *    "lich-tai/edit" nữa (quyền đó vẫn giữ cho "+ Tuyến mới"/"Xuất Google Sheet").
 */
export function RouteCard({
  route,
  open,
  onSelect,
  vehicle,
  canEditRoute = false,
  khoNames = [],
  onSaved,
}: {
  route: CardRoute;
  open: boolean;
  onSelect: () => void;
  vehicle?: { bks: string; tx: string; sdt: string; ncc: string };
  canEditRoute?: boolean;
  /** Danh sách tên kho gợi ý khi sửa điểm dừng — truyền tiếp cho RouteEditor (xem đó). */
  khoNames?: string[];
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const hasDbId = !!route.id;
  const editable = canEditRoute && hasDbId;
  const km = totalHaversine(route);
  const n = route.stops.length;
  const sum = `${n} điểm dừng${route.mappedCount > 1 ? ` · ~${km.toFixed(1)} km` : ""}`;
  // Biển số LẤY TỪ SHEET LỊCH TẢI (route.bks). SĐT + tài xế vẫn lấy từ workbook xe cũ
  // (sheet lịch tải không có 2 cột này) để không mất số gọi.
  const plate = route.bks || "";
  const driver = vehicle?.tx || "";
  const phone = vehicle?.sdt || "";
  const hasVeh = !!(plate || phone || driver);

  return (
    <div
      className={"route-card" + (open ? " open" : "") + (route.mappedCount > 0 ? " mapped" : "")}
      onClick={onSelect}
    >
      {editing && editable ? (
        <div onClick={(e) => e.stopPropagation()}>
          <RouteEditor
            route={route as DbRoute}
            canEdit={editable}
            khoNames={khoNames}
            onChanged={() => { onSaved?.(); }}
          />
          <button className="rc-edit-close" onClick={() => setEditing(false)}>✓ Xong, đóng sửa</button>
        </div>
      ) : (
      <div className="rc-sched">
        <table className="rc-sched-tbl">
          <colgroup>
            <col className="c-tuyen" />
            <col className="c-num" />
            <col className="c-kho" />
            <col className="c-loai" />
            <col className="c-den" />
            <col className="c-roi" />
          </colgroup>
          <thead>
            <tr>
              <th className="rc-th-tuyen">
                Tên Tuyến
                {hasDbId && (
                  <span onClick={(e) => e.stopPropagation()} style={{ marginLeft: 6 }}>
                    <AuditInfo table="routes" rowId={route.id!} />
                  </span>
                )}
              </th>
              <th className="rc-th-num"></th>
              <th className="rc-th-kho">
                Tên Kho <span className="rc-sep">|</span> <span className="rc-th-sum">{sum}</span>
                {hasVeh && (
                  <>
                    {" "}<span className="rc-sep">|</span>{" "}
                    <span className="rc-th-veh">
                      🚛 {plate || "—"}
                      {driver && <> · <span className="rcv-driver">{driver}</span></>}
                      {phone && <> · <a className="rcv-phone" href={"tel:" + phone} onClick={(e) => e.stopPropagation()}>📞 {phone}</a></>}
                    </span>
                  </>
                )}
              </th>
              <th>Loại Hình</th>
              <th>Đến</th>
              <th>Rời</th>
            </tr>
          </thead>
          <tbody>
            {route.stops.map((s, i) => {
              const isKho = /kho/i.test(s.kho);
              return (
                <tr key={s.sid || i} className={isKho ? "rc-kho" : ""}>
                  {i === 0 && (
                    <td className="rc-td-tuyen" rowSpan={n}>
                      <div className="rc-name">{route.route || "—"}</div>
                      {route.load && <div className="rc-loadtag">⚖ {route.load} kg</div>}
                      {route.ncc && (
                        <div className="rc-ncc" title="Nhà cung cấp" style={{ marginTop: 4, fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>
                          🏢 {route.ncc}
                        </div>
                      )}
                      {editable && (
                        <button
                          className="rc-edit-btn"
                          title="Sửa tuyến này"
                          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                        >
                          ✎ Sửa
                        </button>
                      )}
                    </td>
                  )}
                  <td className="num">{i + 1}</td>
                  <td className="rc-diem">
                    {isKho ? "🏠 " : ""}
                    {s.id && <span className="rc-extid">{s.id} - </span>}
                    {s.kho || "(Chưa rõ điểm)"}
                    {s.kho && !s.coord && <span className="nogeo" title="Chưa có toạ độ">⚠</span>}
                  </td>
                  <td className="rc-type">{s.loaiHinh || "—"}</td>
                  <td className="num">{s.toi || "—"}</td>
                  <td className="num">{s.roi || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      <style>{`
        .rc-edit-btn{
          margin-top:6px;border:1px solid var(--border-accent,var(--border-subtle));background:var(--surface-card);
          color:var(--accent);font-size:12px;font-weight:700;border-radius:7px;padding:3px 9px;cursor:pointer;
        }
        .rc-edit-btn:hover{background:var(--accent-soft,var(--surface-sunken))}
        .rc-edit-close{
          margin:8px 0 2px;border:none;background:var(--accent);color:var(--text-onaccent);
          font-size:12.5px;font-weight:700;border-radius:8px;padding:6px 14px;cursor:pointer;
        }
      `}</style>
    </div>
  );
}
