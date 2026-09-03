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
import { useRef, useState } from "react";
import {
  createRoute, updateRoute, deleteRoute,
  createStop, updateStop, deleteStop, reorderStops,
  exportToSheet, editErrorText,
  type DbRoute, type DbStop, type MutResult,
} from "../lib/db/lichTaiApi";
import { exportLichTai } from "../lib/exportExcel";
import {
  parseBulkGrid, readWorkbookFile, uploadBulkRoutes,
  type BulkParseResult, type BulkUploadResponse,
} from "../lib/bulkImportLichTai";
import { SuggestDrop } from "./SuggestDrop";

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
// Ô nhập "Tên kho" có gợi ý (dropdown) — tái dùng SuggestDrop (đã dùng cho ô tìm kiếm
// Lịch Tải) để gõ vài chữ/số là ra danh sách kho khớp, đỡ gõ sai/trùng tên. Thêm 03/09/2026
// theo yêu cầu Sếp: "gõ 123 thì suggest dropdown các kho có regex là 123". `khoNames` là
// danh sách tên kho ĐÃ TỪNG xuất hiện trong vùng (dựng ở LichTai.tsx từ data.routes) — không
// gọi thêm API nào, tái dùng đúng dữ liệu vùng đang tải sẵn cho khung Lịch Tải.
// ------------------------------------------------------------
function KhoInput({
  value, onChange, khoNames, placeholder,
}: {
  value: string; onChange: (v: string) => void; khoNames: string[]; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="kho-input-box">
      <input
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      <SuggestDrop value={value} names={khoNames} show={open} onPick={(n) => { onChange(n); setOpen(false); }} />
    </div>
  );
}

// ------------------------------------------------------------
// Một dòng điểm dừng — sửa tại chỗ
// ------------------------------------------------------------
function StopRow({
  stop, index, total, canEdit, khoNames, onChanged, onMove,
}: {
  stop: DbStop; index: number; total: number; canEdit: boolean; khoNames: string[];
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
        <td>{stop.id && <span className="rc-extid">{stop.id} - </span>}{stop.kho}</td><td>{stop.loaiHinh || "—"}</td>
        <td>{stop.toi || "—"}</td><td>{stop.roi || "—"}</td><td />
      </tr>
    );
  }

  return (
    <>
      <tr className={dirty ? "rc-dirty" : ""}>
        <td>{index + 1}</td>
        <td>
          {/* ID điểm dừng (cột "ID" cũ trên Sheet) — CHỈ HIỆN, không sửa được ở đây (chưa hỗ
              trợ ghi ext_id qua API, chỉ nạp được lúc import/tải lên hàng loạt). */}
          {stop.id && <div className="rc-extid re-kho-id">{stop.id}</div>}
          <KhoInput value={draft.kho} onChange={(v) => setDraft({ ...draft, kho: v })} khoNames={khoNames} placeholder="Tên kho / BC" />
        </td>
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
  route, canEdit, khoNames = [], onChanged,
}: {
  route: DbRoute; canEdit: boolean;
  /** Danh sách tên kho đã từng dùng trong vùng — cho ô "Tên kho" gợi ý dropdown khi gõ
   *  (SuggestDrop, xem KhoInput). Không truyền -> không có gợi ý, không lỗi gì (mặc định []). */
  khoNames?: string[];
  onChanged: () => void;
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
              canEdit={canEdit} khoNames={khoNames} onChanged={onChanged} onMove={(d) => handleMove(i, d)} />
          ))}
          {route.stops.length === 0 && (
            <tr><td colSpan={6} className="muted">Tuyến chưa có điểm dừng nào.</td></tr>
          )}
        </tbody>
      </table>

      {canEdit && (adding ? (
        <div className="re-add">
          <KhoInput value={newStop.kho} khoNames={khoNames} placeholder="Tên kho / BC"
            onChange={(v) => setNewStop({ ...newStop, kho: v })} />
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
// TẢI LÊN HÀNG LOẠT (bulk upload) — thêm 03/09/2026. CHỈ admin (canBulkUpload,
// gate từ useAdmin() ở App.tsx, SIẾT hơn quyền RBAC "edit" của canEdit/canExport
// ở trên — bulk upload ghi đè nhiều tuyến 1 lúc, rủi ro cao hơn sửa từng dòng).
//
// 3 bước: (1) chọn file -> đọc + gộp thành danh sách tuyến/điểm dừng NGAY TRÊN
// TRÌNH DUYỆT (parseBulkGrid, chưa gửi đi gì) -> hiện xem trước (mấy tuyến MỚI/
// mấy tuyến sẽ SỬA, dò theo mã đã có trong `existingCodes`) -> (2) Sếp bấm Xác
// nhận mới thật sự gửi lên /api/lichtai-bulk -> (3) hiện đúng câu Sếp yêu cầu:
// "Nhận xx Tuyến, đã tải lên thành công xx tuyến; không thành công xx tuyến."
// ------------------------------------------------------------
function BulkUploadPanel({
  regionKey, regionLabel, existingCodes, onChanged,
}: {
  regionKey: string; regionLabel: string; existingCodes: Set<string>; onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<BulkParseResult | null>(null);
  const [readErr, setReadErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkUploadResponse | null>(null);

  function reset() {
    setFileName(""); setParsed(null); setReadErr(""); setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onPickFile(f: File | undefined) {
    setResult(null); setReadErr(""); setParsed(null);
    if (!f) return;
    setFileName(f.name);
    try {
      const grid = await readWorkbookFile(f);
      const p = parseBulkGrid(grid);
      if (!p.routes.length) setReadErr("Không đọc được tuyến nào từ file — kiểm tra lại đúng file/định dạng.");
      setParsed(p);
    } catch (e) {
      setReadErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirmUpload() {
    if (!parsed || !parsed.routes.length) return;
    setBusy(true);
    const r = await uploadBulkRoutes(regionKey, parsed.routes);
    setBusy(false);
    setResult(r);
    if (r.ok && r.success > 0) onChanged();
  }

  const newCount = parsed ? parsed.routes.filter((r) => !existingCodes.has(r.code)).length : 0;
  const editCount = parsed ? parsed.routes.length - newCount : 0;
  const failedRows = result?.results.filter((r) => r.status === "error") || [];

  return (
    <div className="re-new re-bulk">
      <div className="muted">
        Tải lên hàng loạt cho vùng <b>{regionLabel}</b> — đúng bố cục cột nút <b>"Tải Lịch (Excel)"</b> phía
        dưới (Tên tuyến / Tải trọng / ID / Tên kho / Loại hình / Tới điểm / Rời điểm). Tuyến đã có mã sẽ
        được SỬA (thay toàn bộ điểm dừng cũ), tuyến chưa có sẽ được TẠO MỚI.
      </div>
      <div className="re-bulk-actions">
        <button type="button" className="re-btn" onClick={() => exportLichTai([], regionLabel)}>⬇ Tải file trống (mẫu)</button>
        <button type="button" className="re-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
          📄 Chọn file Excel…
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
          onChange={(e) => onPickFile(e.target.files?.[0])} />
        {fileName && <span className="muted">{fileName}</span>}
      </div>

      {readErr && <div className="rc-err">{readErr}</div>}

      {parsed && !readErr && !result && (
        <div className="re-bulk-preview">
          <div>
            Đọc được <b>{parsed.routes.length}</b> tuyến, <b>{parsed.totalStops}</b> điểm dừng —
            {" "}<b>{newCount}</b> tuyến MỚI, <b>{editCount}</b> tuyến sẽ SỬA (trùng mã đã có).
          </div>
          {parsed.warnings.map((w, i) => <div key={i} className="rc-err">{w}</div>)}
          <div className="re-bulk-actions">
            <button className="pl-calc" disabled={busy || !parsed.routes.length} onClick={confirmUpload}>
              {busy ? "Đang tải lên…" : `Xác nhận tải lên ${parsed.routes.length} tuyến`}
            </button>
            <button type="button" className="re-btn" onClick={reset} disabled={busy}>Huỷ</button>
          </div>
        </div>
      )}

      {result && (
        <div className="re-bulk-result">
          {result.ok ? (
            <>
              <div className={failedRows.length ? "rc-err" : "muted"}>
                Nhận <b>{result.total}</b> tuyến, đã tải lên thành công <b>{result.success}</b> tuyến;
                không thành công <b>{result.failed}</b> tuyến.
              </div>
              {failedRows.length > 0 && (
                <ul className="re-bulk-fail-list">
                  {failedRows.slice(0, 50).map((r, i) => (
                    <li key={i}><b>{r.code}</b>: {r.error}</li>
                  ))}
                  {failedRows.length > 50 && <li>… và {failedRows.length - 50} tuyến lỗi khác.</li>}
                </ul>
              )}
            </>
          ) : (
            <div className="rc-err">
              Không tải lên được: {result.detail || result.error}
            </div>
          )}
          <button type="button" className="re-btn" onClick={reset}>Tải file khác</button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Thanh công cụ vùng: tạo tuyến mới + xuất ra Sheet + tải lên hàng loạt
// ------------------------------------------------------------
export function RegionToolbar({
  regionKey, regionLabel, canEdit, canExport, canBulkUpload, existingCodes, onChanged,
}: {
  regionKey: string; regionLabel: string; canEdit: boolean; canExport: boolean;
  /** CHỈ admin — xem comment ở BulkUploadPanel. Mặc định false nếu không truyền (view khác, vd GSVT,
   *  chưa cần tính năng này). */
  canBulkUpload?: boolean;
  /** Mã tuyến đang có sẵn trong vùng (để xem trước MỚI/SỬA trước khi tải lên) — chỉ cần khi canBulkUpload. */
  existingCodes?: Set<string>;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [form, setForm] = useState({ code: "", category: "", load: "", ncc: "", bks: "" });
  const [exportMsg, setExportMsg] = useState("");
  const { busy, err, run } = useBusy();

  return (
    <div className="re-toolbar">
      {canEdit && (
        <button className="pl-calc" onClick={() => { setOpen((v) => !v); setBulkOpen(false); }}>
          {open ? "Đóng" : "+ Tuyến mới"}
        </button>
      )}
      {canBulkUpload && (
        <button className="re-btn" onClick={() => { setBulkOpen((v) => !v); setOpen(false); }}>
          {bulkOpen ? "Đóng" : "📤 Tải lên hàng loạt"}
        </button>
      )}
      {canExport && (
        <button className="re-btn" disabled={busy} onClick={async () => {
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

      {bulkOpen && canBulkUpload && (
        <BulkUploadPanel
          regionKey={regionKey} regionLabel={regionLabel}
          existingCodes={existingCodes || new Set()}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
