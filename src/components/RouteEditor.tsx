/* ============================================================
   BẢNG NHẬP LIỆU LỊCH TẢI — phần "đảo chiều" nhìn thấy được trên màn hình.

   Bản cũ chỉ sửa được 6 ô có sẵn (EditableCell -> ghi ngược vào Sheet).
   Bản này làm được đủ việc mà trước đây phải mở Google Sheet ra làm:
     • Thêm tuyến mới / sửa / xoá tuyến
     • Thêm, sửa, xoá, ĐỔI THỨ TỰ điểm dừng trong tuyến
     • Chặn ghi đè nhau bằng `rev` (bản ghi đã bị người khác sửa -> báo, không ghi bừa)
     • Xuất ra Google Sheet khi cần bản để xem/gửi đi

   Mọi thao tác đều lạc quan-nhưng-an-toàn: gọi API xong mới refresh, lỗi thì hiện
   nguyên văn tiếng Việt ngay tại dòng đó.
   ============================================================ */
import { useState } from "react";
import {
  createRoute, updateRoute, deleteRoute,
  createStop, updateStop, deleteStop, reorderStops,
  exportToSheet, editErrorText,
  type DbRoute, type DbStop, type MutResult,
} from "../lib/db/lichTaiApi";

const LOAI_HINH = ["Phân loại", "Lấy", "Giao", "Giao và lấy"];

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /** Chạy 1 thao tác ghi: khoá nút, hiện lỗi nếu có, gọi onDone khi thành công. */
  async function run(fn: () => Promise<MutResult>, onDone?: () => void): Promise<boolean> {
    setBusy(true); setErr("");
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setErr(editErrorText(r.error, r)); return false; }
    onDone?.();
    return true;
  }
  return { busy, err, setErr, run };
}

// ------------------------------------------------------------
// Một dòng điểm dừng — sửa tại chỗ
// ------------------------------------------------------------
function StopRow({
  stop, index, total, canEdit, onChanged, onMove,
}: {
  stop: DbStop; index: number; total: number; canEdit: boolean;
  onChanged: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const [draft, setDraft] = useState({
    kho: stop.kho, loaiHinh: stop.loaiHinh || "", toi: stop.toi || "", roi: stop.roi || "",
  });
  const dirty = draft.kho !== stop.kho || draft.loaiHinh !== (stop.loaiHinh || "")
             || draft.toi !== (stop.toi || "") || draft.roi !== (stop.roi || "");
  const { busy, err, run } = useBusy();

  if (!canEdit) {
    return (
      <tr>
        <td>{index + 1}</td>
        <td>{stop.kho}</td><td>{stop.loaiHinh || "—"}</td>
        <td>{stop.toi || "—"}</td><td>{stop.roi || "—"}</td><td />
      </tr>
    );
  }

  return (
    <>
      <tr className={dirty ? "rc-dirty" : ""}>
        <td>{index + 1}</td>
        <td><input value={draft.kho} onChange={(e) => setDraft({ ...draft, kho: e.target.value })} placeholder="Tên kho / BC" /></td>
        <td>
          <select value={draft.loaiHinh} onChange={(e) => setDraft({ ...draft, loaiHinh: e.target.value })}>
            <option value="">—</option>
            {LOAI_HINH.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </td>
        <td><input value={draft.toi} onChange={(e) => setDraft({ ...draft, toi: e.target.value })} placeholder="20:00" size={5} /></td>
        <td><input value={draft.roi} onChange={(e) => setDraft({ ...draft, roi: e.target.value })} placeholder="21:30" size={5} /></td>
        <td className="rc-actions">
          {dirty && (
            <button disabled={busy} onClick={() => run(() => updateStop(stop.sid, draft, stop.rev), onChanged)}>
              {busy ? "…" : "Lưu"}
            </button>
          )}
          <button title="Lên"   disabled={busy || index === 0}         onClick={() => onMove(-1)}>↑</button>
          <button title="Xuống" disabled={busy || index === total - 1} onClick={() => onMove(1)}>↓</button>
          <button title="Xoá điểm dừng" className="danger" disabled={busy}
            onClick={() => { if (confirm(`Xoá điểm dừng "${stop.kho}"?`)) run(() => deleteStop(stop.sid), onChanged); }}>
            ✕
          </button>
        </td>
      </tr>
      {err && <tr><td colSpan={6} className="rc-err">{err}</td></tr>}
    </>
  );
}

// ------------------------------------------------------------
// Một tuyến — sửa thông tin tuyến + danh sách điểm dừng
// ------------------------------------------------------------
export function RouteEditor({
  route, canEdit, onChanged,
}: {
  route: DbRoute; canEdit: boolean; onChanged: () => void;
}) {
  const [draft, setDraft] = useState({
    code: route.route, category: route.category || "",
    load: route.load || "", ncc: route.ncc || "", bks: route.bks || "",
  });
  const [adding, setAdding] = useState(false);
  const [newStop, setNewStop] = useState({ kho: "", loaiHinh: "", toi: "", roi: "" });
  const { busy, err, run } = useBusy();

  const dirty = draft.code !== route.route || draft.category !== (route.category || "")
             || draft.load !== (route.load || "") || draft.ncc !== (route.ncc || "")
             || draft.bks !== (route.bks || "");

  // Đổi thứ tự điểm dừng: hoán vị trong mảng id rồi gửi CẢ mảng đi 1 lần
  // -> server ghi seq = vị trí, không bao giờ có 2 điểm cùng số thứ tự.
  function handleMove(index: number, dir: -1 | 1) {
    const ids = route.stops.map((s) => s.sid);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    run(() => reorderStops(route.id, ids), onChanged);
  }

  return (
    <div className="section-card route-editor">
      <div className="re-head">
        <input className="re-code" value={draft.code} disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="Mã tuyến" />
        <input value={draft.category} disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="Loại tuyến" />
        <input value={draft.load} disabled={!canEdit} size={6}
          onChange={(e) => setDraft({ ...draft, load: e.target.value })} placeholder="Tải (kg / Van)" />
        <input value={draft.ncc} disabled={!canEdit}
          onChange={(e) => setDraft({ ...draft, ncc: e.target.value })} placeholder="NCC" />
        <input value={draft.bks} disabled={!canEdit} size={10}
          onChange={(e) => setDraft({ ...draft, bks: e.target.value })} placeholder="Biển số" />
        {canEdit && dirty && (
          <button className="pl-calc" disabled={busy}
            onClick={() => run(() => updateRoute(route.id, draft, route.rev), onChanged)}>
            {busy ? "Đang lưu…" : "Lưu tuyến"}
          </button>
        )}
        {canEdit && (
          <button className="danger" disabled={busy}
            onClick={() => { if (confirm(`Xoá tuyến "${route.route}"? (ẩn khỏi dashboard, vẫn giữ lịch sử)`)) run(() => deleteRoute(route.id), onChanged); }}>
            Xoá tuyến
          </button>
        )}
      </div>
      {err && <div className="rc-err">{err}</div>}

      <table className="re-stops">
        <thead>
          <tr><th>#</th><th>Tên kho</th><th>Loại hình</th><th>Tới</th><th>Rời</th><th /></tr>
        </thead>
        <tbody>
          {route.stops.map((s, i) => (
            <StopRow key={s.sid} stop={s} index={i} total={route.stops.length}
              canEdit={canEdit} onChanged={onChanged} onMove={(d) => handleMove(i, d)} />
          ))}
          {route.stops.length === 0 && (
            <tr><td colSpan={6} className="muted">Tuyến chưa có điểm dừng nào.</td></tr>
          )}
        </tbody>
      </table>

      {canEdit && (adding ? (
        <div className="re-add">
          <input autoFocus value={newStop.kho} placeholder="Tên kho / BC"
            onChange={(e) => setNewStop({ ...newStop, kho: e.target.value })} />
          <select value={newStop.loaiHinh} onChange={(e) => setNewStop({ ...newStop, loaiHinh: e.target.value })}>
            <option value="">—</option>
            {LOAI_HINH.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <input size={5} value={newStop.toi} placeholder="Tới"
            onChange={(e) => setNewStop({ ...newStop, toi: e.target.value })} />
          <input size={5} value={newStop.roi} placeholder="Rời"
            onChange={(e) => setNewStop({ ...newStop, roi: e.target.value })} />
          <button className="pl-calc" disabled={busy || !newStop.kho.trim()}
            onClick={async () => {
              const ok = await run(() => createStop(route.id, newStop), onChanged);
              if (ok) { setNewStop({ kho: "", loaiHinh: "", toi: "", roi: "" }); setAdding(false); }
            }}>Thêm</button>
          <button onClick={() => setAdding(false)}>Huỷ</button>
        </div>
      ) : (
        <button className="re-add-btn" onClick={() => setAdding(true)}>+ Thêm điểm dừng</button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// Thanh công cụ vùng: tạo tuyến mới + xuất ra Sheet
// ------------------------------------------------------------
export function RegionToolbar({
  regionKey, regionLabel, canEdit, canExport, onChanged,
}: {
  regionKey: string; regionLabel: string; canEdit: boolean; canExport: boolean; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", category: "", load: "", ncc: "", bks: "" });
  const [exportMsg, setExportMsg] = useState("");
  const { busy, err, run } = useBusy();

  return (
    <div className="re-toolbar">
      {canEdit && (
        <button className="pl-calc" onClick={() => setOpen((v) => !v)}>
          {open ? "Đóng" : "+ Tuyến mới"}
        </button>
      )}
      {canExport && (
        <button disabled={busy} onClick={async () => {
          setExportMsg("Đang xuất…");
          const r = await exportToSheet(regionKey);
          setExportMsg(r.ok ? `Đã xuất ${r.rows} dòng ra Google Sheet.`
                            : `Không xuất được: ${r.error === "not_configured" ? "chưa cấu hình tài khoản ghi Sheet" : r.error}`);
        }}>Xuất ra Google Sheet</button>
      )}
      {exportMsg && <span className="muted">{exportMsg}</span>}

      {open && (
        <div className="re-new">
          <div className="muted">Tuyến mới trong vùng <b>{regionLabel}</b></div>
          <input autoFocus placeholder="Mã tuyến *" value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <input placeholder="Loại tuyến" value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input placeholder="Tải trọng" size={8} value={form.load}
            onChange={(e) => setForm({ ...form, load: e.target.value })} />
          <input placeholder="NCC" value={form.ncc}
            onChange={(e) => setForm({ ...form, ncc: e.target.value })} />
          <input placeholder="Biển số" size={10} value={form.bks}
            onChange={(e) => setForm({ ...form, bks: e.target.value })} />
          <button className="pl-calc" disabled={busy || !form.code.trim()}
            onClick={async () => {
              const ok = await run(() => createRoute(regionKey, form), onChanged);
              if (ok) { setForm({ code: "", category: "", load: "", ncc: "", bks: "" }); setOpen(false); }
            }}>{busy ? "Đang tạo…" : "Tạo tuyến"}</button>
          {err && <div className="rc-err">{err}</div>}
        </div>
      )}
    </div>
  );
}
