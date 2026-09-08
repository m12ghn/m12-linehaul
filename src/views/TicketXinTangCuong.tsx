/* ============================================================
   TICKET XIN TĂNG CƯỜNG (09/2026) — tab mới, cùng cấp "TLLD Tuyến"/"Ticket
   Vận Tải" trên menu. Bản build đầu tiên: 2 sub-tab Nội thành / Nội vùng
   (khớp 2 sheet cùng tên bên project tai-tang-cuong-vercel), ƯU TIÊN Nội
   thành trước theo yêu cầu — Nội vùng để placeholder "sắp có".

   Nạp dữ liệu: khi Nội vùng làm xong sẽ đổi dropdown scope sang gọi lại API
   với scope="noi-vung". Nội thành lọc region = "Hồ Chí Minh" ở tầng API
   (xem api/ticket-xtc.ts).

   09/2026 — "build lại giống với sheet": bảng hiển thị ĐỦ layout của sheet
   "Nội thành" gốc (trừ cột "Date" — trùng lặp với Timestamp/created_at nên
   bỏ, đã chốt lúc làm CSV import).

   09/2026 (v2) — "còn khá nhiều chỗ trống, cần giống sheet hơn": bản đầu để
   MỖI cột GSVT sửa là 1 ô <input> riêng trong bảng -> bảng quá rộng (32 cột,
   nhiều cột input padding lớn), lại đẩy các cột cần nhập lùi xa bên phải,
   trông như "thiếu cột nhập liệu". Đổi cách: TOÀN BỘ bảng giờ hiển thị dữ
   liệu dạng chữ thường (đặc, giống ô sheet thật — xem RoCell/BoolBadge),
   không còn input rải rác theo cột nữa; nhóm GSVT phản hồi + bot ad hoc gộp
   lại thành 1 nút "✏️ Nhập/Sửa" mở modal (khung trống điền thông tin, đúng ý
   "ko cần theo cột; làm nút hoặc khung trống để điền").

   09/2026 (v3) — thêm 2 bộ lọc theo yêu cầu:
   - "Ẩn ticket đã duyệt" (mặc định BẬT — ẩn): định nghĩa "đã duyệt" = đã có
     Trạng thái (trang_thai khác rỗng), tức GSVT đã phản hồi/xử lý xong, bất
     kể kết quả (Có xe/Không có xe/Hủy…) — vì mục đích lọc là giảm rối, tập
     trung vào ticket CÒN CẦN xử lý. Lọc client-side trên rows đã tải (không
     cần gọi lại API). Có toggle để hiện lại khi cần soát lịch sử.
   - Khoảng ngày (mặc định "2 ngày gần nhất") lọc theo created_at — chuyển
     xuống tầng API (xem api/ticket-xtc.ts + loadTicketXtc) để KHÔNG kéo hết
     3700+ dòng lịch sử mỗi lần mở trang; đổi ngày -> gọi lại API.
   Đồng thời fix khung bảng cao cố định + cuộn dọc RIÊNG bên trong khung (xem
   .xtc-scroll trong index.css) — trước đó bảng dài hết theo số dòng nên phải
   cuộn hết trang xuống dưới cùng mới thấy thanh cuộn ngang.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { usePersistentState } from "../lib/usePersistent";
import { useMyRole } from "../lib/usePermissions";
import { loadTicketXtc, saveTicketXtc, type AddonTripTicket, type AddonTripTicketPatch, type TicketXtcScope } from "../lib/ticketXtc";

const MODULE = "ticket-xtc";

/** "YYYY-MM-DD" theo giờ máy người dùng (đội vận hành đều ở VN +07:00). */
function toDateStr(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
/** Mặc định "2 ngày gần nhất" = hôm qua -> hôm nay. */
function defaultDateRange(): { from: string; to: string } {
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  return { from: toDateStr(yesterday), to: toDateStr(today) };
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

/** Cell chỉ đọc dùng chung cho MỌI cột trong bảng chính (kể cả nhóm GSVT/ad
 *  hoc — giờ chỉ hiển thị tóm tắt, sửa qua modal "✏️ Nhập/Sửa" bên dưới) —
 *  tránh lặp JSX cho từng cột, và giữ ô đặc/gọn giống sheet thật thay vì
 *  input rỗng chiếm nhiều chỗ. */
function RoCell({ value }: { value: string | number | null | undefined }) {
  return <span className="xtc-ro">{value === null || value === undefined || value === "" ? "—" : value}</span>;
}

function BoolBadge({ on }: { on: boolean }) {
  return <span className={"xtc-pill" + (on ? " on" : "")}>{on ? "Có" : "Không"}</span>;
}

/** Khung trống (modal) để GSVT nhập/sửa — gộp toàn bộ cột trước đây là input
 *  rải trong bảng (Trạng thái..Thông tin tài xế) + phần bot ad hoc (Thứ tự
 *  điểm/Warehouse/Tạo App/Đã tạo app) vào 1 form duy nhất theo yêu cầu "ko
 *  cần theo cột; làm nút hoặc khung trống để điền thông tin vào". */
function GsvtEditModal({ ticket, onClose, onSaved }: {
  ticket: AddonTripTicket;
  onClose: () => void;
  onSaved: (updated: AddonTripTicket) => void;
}) {
  const [draft, setDraft] = useState<AddonTripTicketPatch>({
    trang_thai: ticket.trang_thai,
    ngay_duyet: ticket.ngay_duyet,
    gio_toi: ticket.gio_toi,
    ma_chuyen: ticket.ma_chuyen,
    ten_ncc: ticket.ten_ncc,
    bks: ticket.bks,
    tai_trong: ticket.tai_trong,
    thong_tin_tx: ticket.thong_tin_tx,
    ve_ktc: ticket.ve_ktc,
    thu_tu_diem: ticket.thu_tu_diem,
    warehouse: ticket.warehouse,
    tao_app_trigger: ticket.tao_app_trigger,
    da_tao_app: ticket.da_tao_app,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof AddonTripTicketPatch>(k: K, v: AddonTripTicketPatch[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  async function onSave() {
    setSaving(true); setErr(null);
    const updated = await saveTicketXtc(ticket.ticket_id, draft);
    setSaving(false);
    if (!updated) { setErr("Lưu thất bại — thử lại."); return; }
    onSaved(updated);
  }

  return (
    <div className="xtc-modal-backdrop" onClick={onClose}>
      <div className="xtc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="xtc-modal-head">
          <h3>✏️ Nhập/Sửa GSVT · {ticket.ticket_id}</h3>
          <button className="btn-ghost sm" onClick={onClose}>✕</button>
        </div>
        <p className="xtc-modal-sub">
          {ticket.lo_trinh || "—"} · {ticket.warehouse_name || "—"} · {ticket.ngay_mong_muon || "—"} {ticket.gio_mong_muon || ""}
        </p>

        <div className="xtc-modal-grid">
          <label>Trạng thái
            <input className="pl-in" value={draft.trang_thai || ""} onChange={(e) => set("trang_thai", e.target.value)}
              placeholder="Có xe / Không có xe…" />
          </label>
          <label>Ngày duyệt
            <input className="pl-in" value={draft.ngay_duyet || ""} onChange={(e) => set("ngay_duyet", e.target.value)} placeholder="DD/MM" />
          </label>
          <label>Giờ tới
            <input className="pl-in" value={draft.gio_toi || ""} onChange={(e) => set("gio_toi", e.target.value)} placeholder="HH:mm" />
          </label>
          <label>Mã chuyến
            <input className="pl-in" value={draft.ma_chuyen || ""} onChange={(e) => set("ma_chuyen", e.target.value)} placeholder="Bot điền sau khi tạo" />
          </label>
          <label>Tên NCC
            <input className="pl-in" value={draft.ten_ncc || ""} onChange={(e) => set("ten_ncc", e.target.value)} />
          </label>
          <label>BKS
            <input className="pl-in" value={draft.bks || ""} onChange={(e) => set("bks", e.target.value)} placeholder="51C-12345" />
          </label>
          <label>Tải trọng
            <input className="pl-in" value={draft.tai_trong || ""} onChange={(e) => set("tai_trong", e.target.value)} />
          </label>
          <label>Thông tin tài xế
            <input className="pl-in" value={draft.thong_tin_tx || ""} onChange={(e) => set("thong_tin_tx", e.target.value)} placeholder="Tên: SĐT" />
          </label>
          <label>Về KTC
            <input className="pl-in" value={draft.ve_ktc || ""} onChange={(e) => set("ve_ktc", e.target.value)} placeholder="HCM01 / HCM20…" />
          </label>
        </div>

        <p className="xtc-modal-section">🤖 Phần bot Playwright (tạo chuyến ad hoc)</p>
        <div className="xtc-modal-grid">
          <label>Thứ tự điểm
            <input className="pl-in" type="number" value={draft.thu_tu_diem ?? ""}
              onChange={(e) => set("thu_tu_diem", e.target.value === "" ? null : Number(e.target.value))} />
          </label>
          <label>Warehouse (ad hoc)
            <input className="pl-in" value={draft.warehouse || ""} onChange={(e) => set("warehouse", e.target.value)} />
          </label>
          <label>Đã tạo app
            <input className="pl-in" value={draft.da_tao_app || ""} onChange={(e) => set("da_tao_app", e.target.value)} placeholder="Bot điền sau khi tạo" />
          </label>
          <label className="xtc-check">
            <input type="checkbox" checked={!!draft.tao_app_trigger} onChange={(e) => set("tao_app_trigger", e.target.checked)} />
            Tạo App
          </label>
        </div>

        {err && <p className="rc-err">{err}</p>}
        <div className="xtc-modal-actions">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Huỷ</button>
          <button className="btn-violet" onClick={onSave} disabled={saving}>{saving ? "Đang lưu…" : "💾 Lưu"}</button>
        </div>
      </div>
    </div>
  );
}

export function TicketXinTangCuong() {
  const [sub, setSub] = usePersistentState<TicketXtcScope>("xtc.sub", "noi-thanh");
  const { canDo } = useMyRole();
  const canEdit = canDo(MODULE, "edit");

  const [rows, setRows] = useState<AddonTripTicket[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AddonTripTicket | null>(null);

  // Bộ lọc: "Ẩn đã duyệt" nhớ theo trình duyệt (usePersistentState) vì là gu xem của
  // từng người; khoảng ngày KHÔNG nhớ — luôn mở lại đúng mặc định "2 ngày gần nhất".
  const [hideApproved, setHideApproved] = usePersistentState<boolean>("xtc.hideApproved", true);
  const [dateRange, setDateRange] = useState(defaultDateRange);

  async function reload(scope: TicketXtcScope, range: { from: string; to: string }) {
    setLoading(true); setError(null);
    try {
      const r = await loadTicketXtc(scope, range);
      setRows(r);
    } catch (e: any) {
      setError(e?.message === "unauthorized" ? "Cần đăng nhập để xem danh sách." : "Không tải được danh sách — thử lại.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (sub === "noi-thanh") reload("noi-thanh", dateRange);
    // "noi-vung" chưa gọi API — xem placeholder bên dưới.
  }, [sub, dateRange.from, dateRange.to]);

  function onSaved(updated: AddonTripTicket) {
    setRows((rs) => (rs || []).map((r) => (r.ticket_id === updated.ticket_id ? updated : r)));
    setEditing(null);
  }

  const visibleRows = useMemo(() => {
    if (!rows) return null;
    return hideApproved ? rows.filter((r) => !r.trang_thai) : rows;
  }, [rows, hideApproved]);

  const summary = useMemo(() => {
    if (!rows) return null;
    const daDuyet = rows.filter((r) => !!r.trang_thai).length;
    const daTaoApp = rows.filter((r) => r.tao_app_trigger).length;
    return { tong: rows.length, daDuyet, chua: rows.length - daDuyet, daTaoApp };
  }, [rows]);

  return (
    <div>
      <div className="sub-tabs">
        <button className={sub === "noi-thanh" ? "active" : ""} onClick={() => setSub("noi-thanh")}>🏙️ Nội thành</button>
        <button className={sub === "noi-vung" ? "active" : ""} onClick={() => setSub("noi-vung")}>🌾 Nội vùng</button>
      </div>

      {sub === "noi-vung" ? (
        <div className="section-card" style={{ textAlign: "center", color: "var(--muted)" }}>
          🚧 Đang ưu tiên hoàn thiện <b>Nội thành</b> trước — Nội vùng sẽ mở sau khi Nội thành chốt xong (cùng cấu trúc,
          chỉ đổi bộ lọc vùng).
        </div>
      ) : (
        <>
          <div className="section-card" style={{ marginBottom: 12 }}>
            <h2>🚛 Ticket xin tăng cường · Nội thành</h2>
            <p className="lead">
              Bản build song song với Google Sheet "Nội thành" (project tai-tang-cuong-vercel) — dữ liệu nạp tạm 1 lần
              để dựng giao diện, CHƯA phải nguồn sự thật chính thức. Sheet vẫn là bản chính cho tới khi chốt qua đây.
            </p>
            {summary && (
              <p style={{ fontSize: 14, color: "var(--muted)" }}>
                Tổng <b>{summary.tong}</b> ticket (trong khoảng ngày đã chọn) · <b>{summary.chua}</b> chưa duyệt ·{" "}
                <b>{summary.daDuyet}</b> đã duyệt{hideApproved ? " (đang ẩn)" : ""} · <b>{summary.daTaoApp}</b> đã bật cờ "Tạo App"
              </p>
            )}
            {!canEdit && (
              <p style={{ fontSize: 13.5, color: "var(--orange)" }}>
                🔒 Vai trò của bạn chưa có quyền <b>Sửa</b> mục này — chỉ xem được, không nhập/sửa được.
              </p>
            )}

            <div className="xtc-filters">
              <label className="xtc-hide-approved">
                <input type="checkbox" checked={hideApproved} onChange={(e) => setHideApproved(e.target.checked)} />
                Ẩn ticket đã duyệt
              </label>
              <label className="xtc-daterange">
                Từ
                <input type="date" className="pl-in" value={dateRange.from} max={dateRange.to}
                  onChange={(e) => setDateRange((r) => ({ ...r, from: e.target.value }))} />
              </label>
              <label className="xtc-daterange">
                đến
                <input type="date" className="pl-in" value={dateRange.to} min={dateRange.from}
                  onChange={(e) => setDateRange((r) => ({ ...r, to: e.target.value }))} />
              </label>
              <button className="btn-ghost sm" onClick={() => setDateRange(defaultDateRange())} disabled={loading}>
                2 ngày gần nhất
              </button>
              <button className="btn-ghost" onClick={() => reload("noi-thanh", dateRange)} disabled={loading}>
                {loading ? "Đang tải…" : "🔄 Tải lại"}
              </button>
            </div>
          </div>

          {error && <div className="section-card" style={{ color: "var(--red, #c0392b)" }}>{error}</div>}

          {!error && rows && rows.length === 0 && (
            <div className="section-card" style={{ textAlign: "center", color: "var(--muted)" }}>
              Không có ticket nào trong khoảng ngày đã chọn — thử nới rộng khoảng ngày, hoặc "Tải lại" nếu vừa nạp dữ liệu mẫu.
            </div>
          )}

          {!error && rows && rows.length > 0 && visibleRows && visibleRows.length === 0 && (
            <div className="section-card" style={{ textAlign: "center", color: "var(--muted)" }}>
              {summary?.tong} ticket trong khoảng ngày này đều đã duyệt — đang bị ẩn bởi bộ lọc "Ẩn ticket đã duyệt" ở trên.
            </div>
          )}

          {!error && visibleRows && visibleRows.length > 0 && (
            <div className="section-card xtc-card">
              {/* Bọc riêng phần cuộn (.xtc-scroll) KHÔNG mang border-radius — để chung với
                  .section-card (bo góc + overflow) là tổ hợp hay gây lỗi vẽ sai header dính
                  ở Chromium (đã thấy khi test: 1 mảnh nút "Nhập/Sửa" của dòng liền kề lấn lên
                  trên header dù z-index/thứ tự DOM đúng) — tách ra là cách sửa chuẩn. */}
              <div className="xtc-scroll">
              <table className="re-stops xtc-table">
                <thead>
                  <tr>
                    {/* --- Nhóm đăng ký gốc (khớp cột A-M sheet Nội thành) --- */}
                    <th>Timestamp</th>
                    <th>Ticket_id</th>
                    <th>Vùng</th>
                    <th>Warehouse</th>
                    <th>Tên BC khác</th>
                    <th>Lộ trình</th>
                    <th>MSNV</th>
                    <th>Telegram</th>
                    <th>SĐT</th>
                    <th>SL kiện</th>
                    <th>Thể tích cần</th>
                    <th>Ngày · Giờ MM</th>
                    <th>Ghi chú</th>
                    {/* --- Nhóm GSVT phản hồi (tóm tắt — sửa qua nút ✏️) --- */}
                    <th>Trạng thái</th>
                    <th>Ngày duyệt</th>
                    <th>Giờ tới</th>
                    <th>Mã chuyến</th>
                    <th>Tên NCC</th>
                    <th>BKS</th>
                    <th>Tải trọng</th>
                    <th>Thông tin tài xế</th>
                    {/* --- Nhóm tự động (Apps Script điền) --- */}
                    <th>Note</th>
                    <th>Về KTC</th>
                    <th>Đã báo tele</th>
                    <th>bl</th>
                    <th>Blacklist</th>
                    {/* --- Nhóm bot Playwright ad hoc (tóm tắt) --- */}
                    <th>Thứ tự điểm</th>
                    <th>Warehouse (ad hoc)</th>
                    <th>Tạo App</th>
                    <th>Đã tạo app</th>
                    <th>Hình kho</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((t) => (
                    <tr key={t.ticket_id}>
                      <td><RoCell value={fmtTime(t.created_at)} /></td>
                      <td><RoCell value={t.ticket_id} /></td>
                      <td><RoCell value={t.region} /></td>
                      <td><RoCell value={t.warehouse_name} /></td>
                      <td><RoCell value={t.warehouse_khac} /></td>
                      <td><RoCell value={t.lo_trinh} /></td>
                      <td><RoCell value={t.msnv} /></td>
                      <td><RoCell value={t.telegram} /></td>
                      <td><RoCell value={t.sdt} /></td>
                      <td><RoCell value={t.so_kien} /></td>
                      <td><RoCell value={t.the_tich} /></td>
                      <td><RoCell value={[t.ngay_mong_muon, t.gio_mong_muon].filter(Boolean).join(" ") || null} /></td>
                      <td><RoCell value={t.ghi_chu} /></td>
                      <td><RoCell value={t.trang_thai} /></td>
                      <td><RoCell value={t.ngay_duyet} /></td>
                      <td><RoCell value={t.gio_toi} /></td>
                      <td><RoCell value={t.ma_chuyen} /></td>
                      <td><RoCell value={t.ten_ncc} /></td>
                      <td><RoCell value={t.bks} /></td>
                      <td><RoCell value={t.tai_trong} /></td>
                      <td><RoCell value={t.thong_tin_tx} /></td>
                      <td><RoCell value={t.note} /></td>
                      <td><RoCell value={t.ve_ktc} /></td>
                      <td><BoolBadge on={t.da_thong_bao_tele} /></td>
                      <td><BoolBadge on={t.bl} /></td>
                      <td><RoCell value={t.blacklist} /></td>
                      <td><RoCell value={t.thu_tu_diem} /></td>
                      <td><RoCell value={t.warehouse} /></td>
                      <td><BoolBadge on={t.tao_app_trigger} /></td>
                      <td><RoCell value={t.da_tao_app} /></td>
                      <td>
                        {t.hinh_kho ? <a href={t.hinh_kho} target="_blank" rel="noreferrer">🖼️ Xem ảnh</a> : <RoCell value={null} />}
                      </td>
                      <td className="rc-actions">
                        <button className="btn-violet sm" disabled={!canEdit} onClick={() => setEditing(t)}>✏️ Nhập/Sửa</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <p className="rt-note">
                Đang hiện <b>{visibleRows.length}</b>/{summary?.tong ?? visibleRows.length} ticket (khoảng ngày đã chọn{hideApproved ? ", đã ẩn ticket đã duyệt" : ""}).
                Bấm <b>✏️ Nhập/Sửa</b> ở cuối mỗi dòng để GSVT nhập trạng thái, BKS, tài xế… và phần bot Playwright ad hoc — các cột còn
                lại (đăng ký gốc + tự động) chỉ xem, không sửa qua bảng.
              </p>
            </div>
          )}
        </>
      )}

      {editing && <GsvtEditModal ticket={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  );
}
