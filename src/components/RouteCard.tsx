import { haversineKm } from "../lib/geo";
import { EditableCell } from "./EditableCell";
import { saveCell, type SaveResult } from "../lib/lichTaiEdit";
import type { Route, Stop } from "../types";

const LOAI_HINH_OPTIONS = ["Phân loại", "Lấy", "Giao", "Giao và lấy"];
const LOAD_OPTIONS = ["1900", "5000", "6500", "8000", "Van"];

/** Tổng đường chim bay (ước tính nhanh, không gọi OSRM). */
function totalHaversine(r: Route): number {
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
 */
export function RouteCard({
  route,
  open,
  onSelect,
  vehicle,
  gid,
  canEdit = false,
  onSaved,
  nccOptions,
}: {
  route: Route;
  open: boolean;
  onSelect: () => void;
  vehicle?: { bks: string; tx: string; sdt: string; ncc: string };
  gid?: string;
  canEdit?: boolean;
  onSaved?: () => void;
  nccOptions?: string[];
}) {
  const km = totalHaversine(route);
  const n = route.stops.length;
  const sum = `${n} điểm dừng${route.mappedCount > 1 ? ` · ~${km.toFixed(1)} km` : ""}`;
  // Biển số LẤY TỪ SHEET LỊCH TẢI (route.bks). SĐT + tài xế vẫn lấy từ workbook xe cũ
  // (sheet lịch tải không có 2 cột này) để không mất số gọi.
  const plate = route.bks || "";
  const driver = vehicle?.tx || "";
  const phone = vehicle?.sdt || "";
  const hasVeh = !!(plate || phone || driver);
  const editable = canEdit && !!gid;

  /** Sửa 1 trường theo TUYẾN (Tải trọng/NCC/BKS) — áp cho mọi dòng của tuyến trong tab đang xem. */
  function saveRouteField(field: "load" | "ncc" | "bks", oldValue: string) {
    return (value: string, force = false): Promise<SaveResult> =>
      saveCell({ gid: gid!, route: route.route, scope: "route", field, value, oldValue, force }).then((r) => {
        if (r.ok) onSaved?.();
        return r;
      });
  }
  /** Sửa 1 trường theo ĐIỂM DỪNG (Loại Hình/Đến/Rời) — khớp đúng dòng bằng chữ ký dedupe hiện có. */
  function saveStopField(field: "loaiHinh" | "toi" | "roi", stop: Stop, oldValue: string) {
    return (value: string, force = false): Promise<SaveResult> =>
      saveCell({
        gid: gid!, route: route.route, scope: "stop", field, value, oldValue, force,
        match: { kho: stop.kho, loaiHinh: stop.loaiHinh, toi: stop.toi, roi: stop.roi, id: stop.id || "" },
      }).then((r) => {
        if (r.ok) onSaved?.();
        return r;
      });
  }

  return (
    <div
      className={"route-card" + (open ? " open" : "") + (route.mappedCount > 0 ? " mapped" : "")}
      onClick={onSelect}
    >
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
              <th className="rc-th-tuyen">Tên Tuyến</th>
              <th className="rc-th-num"></th>
              <th className="rc-th-kho">
                Tên Kho <span className="rc-sep">|</span> <span className="rc-th-sum">{sum}</span>
                {(hasVeh || editable) && (
                  <>
                    {" "}<span className="rc-sep">|</span>{" "}
                    <span className="rc-th-veh" onClick={(e) => e.stopPropagation()}>
                      🚛 <EditableCell value={plate} editable={editable} kind="text" onSave={saveRouteField("bks", plate)} />
                      {driver && <> · <span className="rcv-driver">{driver}</span></>}
                      {phone && <> · <a className="rcv-phone" href={"tel:" + phone}>📞 {phone}</a></>}
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
                <tr key={i} className={isKho ? "rc-kho" : ""}>
                  {i === 0 && (
                    <td className="rc-td-tuyen" rowSpan={n}>
                      <div className="rc-name">{route.route || "—"}</div>
                      {(route.load || editable) && (
                        <div className="rc-loadtag">
                          ⚖ <EditableCell value={route.load} editable={editable} kind="text" options={LOAD_OPTIONS} onSave={saveRouteField("load", route.load)} /> kg
                        </div>
                      )}
                      {(route.ncc || editable) && (
                        <div className="rc-ncc" title="Nhà cung cấp" style={{ marginTop: 4, fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>
                          🏢 <EditableCell value={route.ncc || ""} editable={editable} kind="text" options={nccOptions} onSave={saveRouteField("ncc", route.ncc || "")} />
                        </div>
                      )}
                    </td>
                  )}
                  <td className="num">{i + 1}</td>
                  <td className="rc-diem">
                    {isKho ? "🏠 " : ""}{s.kho || "(Chưa rõ điểm)"}
                    {s.kho && !s.coord && <span className="nogeo" title="Chưa có toạ độ">⚠</span>}
                  </td>
                  <td className="rc-type">
                    <EditableCell value={s.loaiHinh} editable={editable} kind="select" options={LOAI_HINH_OPTIONS} onSave={saveStopField("loaiHinh", s, s.loaiHinh)} />
                  </td>
                  <td className="num">
                    <EditableCell value={s.toi} editable={editable} kind="time" onSave={saveStopField("toi", s, s.toi)} />
                  </td>
                  <td className="num">
                    <EditableCell value={s.roi} editable={editable} kind="time" onSave={saveStopField("roi", s, s.roi)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
