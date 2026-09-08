/* ============================================================
   TICKET XIN TĂNG CƯỜNG (09/2026) — tab mới, cùng cấp "TLLD Tuyến"/"Ticket
   Vận Tải" trên menu. Bản build đầu tiên: 2 sub-tab Nội thành / Nội vùng
   (khớp 2 sheet cùng tên bên project tai-tang-cuong-vercel), ƯU TIÊN Nội
   thành trước theo yêu cầu — Nội vùng để placeholder "sắp có".

   Nạp dữ liệu: khi Nội vùng làm xong sẽ đổi dropdown scope sang gọi lại API
   với scope="noi-vung". Nội thành lọc region = "Hồ Chí Minh" ở tầng API
   (xem api/ticket-xtc.ts).

   Sửa dữ liệu: mỗi dòng có buffer edit riêng (state `edits`), bấm "💾 Lưu"
   mới gọi API — tránh gọi PATCH liên tục theo từng phím gõ. Dòng đang sửa dở
   (khác dữ liệu server) tô màu nhạt bằng class .rc-dirty (tái dùng từ
   RouteEditor.tsx — xem .re-stops trong index.css).
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { usePersistentState } from "../lib/usePersistent";
import { useMyRole } from "../lib/usePermissions";
import { loadTicketXtc, saveTicketXtc, type AddonTripTicket, type AddonTripTicketPatch, type TicketXtcScope } from "../lib/ticketXtc";

const MODULE = "ticket-xtc";

type EditBuffer = Record<string, AddonTripTicketPatch>; // key = ticket_id

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

export function TicketXinTangCuong() {
  const [sub, setSub] = usePersistentState<TicketXtcScope>("xtc.sub", "noi-thanh");
  const { canDo } = useMyRole();
  const canEdit = canDo(MODULE, "edit");

  const [rows, setRows] = useState<AddonTripTicket[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<EditBuffer>({});
  const [saving, setSaving] = useState<string | null>(null); // ticket_id đang lưu

  async function reload(scope: TicketXtcScope) {
    setLoading(true); setError(null);
    try {
      const r = await loadTicketXtc(scope);
      setRows(r);
      setEdits({}); // đổi/tải lại danh sách -> bỏ buffer sửa dở (tránh lệch dòng)
    } catch (e: any) {
      setError(e?.message === "unauthorized" ? "Cần đăng nhập để xem danh sách." : "Không tải được danh sách — thử lại.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (sub === "noi-thanh") reload("noi-thanh");
    // "noi-vung" chưa gọi API — xem placeholder bên dưới.
  }, [sub]);

  const patchOf = (t: AddonTripTicket): AddonTripTicketPatch => edits[t.ticket_id] || {};
  function setField(t: AddonTripTicket, field: keyof AddonTripTicketPatch, value: unknown) {
    setEdits((e) => ({ ...e, [t.ticket_id]: { ...e[t.ticket_id], [field]: value } }));
  }
  function isDirty(t: AddonTripTicket): boolean {
    const p = edits[t.ticket_id];
    return !!p && Object.keys(p).length > 0;
  }
  function valueOf<K extends keyof AddonTripTicket>(t: AddonTripTicket, field: K): any {
    const p = edits[t.ticket_id] as any;
    return p && field in p ? p[field] : (t as any)[field];
  }

  async function save(t: AddonTripTicket) {
    const patch = patchOf(t);
    if (Object.keys(patch).length === 0) return;
    setSaving(t.ticket_id);
    const updated = await saveTicketXtc(t.ticket_id, patch);
    setSaving(null);
    if (!updated) { alert("Lưu thất bại — thử lại."); return; }
    setRows((rs) => (rs || []).map((r) => (r.ticket_id === t.ticket_id ? updated : r)));
    setEdits((e) => { const n = { ...e }; delete n[t.ticket_id]; return n; });
  }

  const summary = useMemo(() => {
    if (!rows) return null;
    const chua = rows.filter((r) => !r.trang_thai || r.trang_thai === "cho-duyet").length;
    const daTaoApp = rows.filter((r) => r.tao_app_trigger).length;
    return { tong: rows.length, chua, daTaoApp };
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
                Tổng <b>{summary.tong}</b> ticket · <b>{summary.chua}</b> chưa duyệt · <b>{summary.daTaoApp}</b> đã bật cờ "Tạo App"
              </p>
            )}
            {!canEdit && (
              <p style={{ fontSize: 13.5, color: "var(--orange)" }}>
                🔒 Vai trò của bạn chưa có quyền <b>Sửa</b> mục này — chỉ xem được, không lưu được thay đổi.
              </p>
            )}
            <button className="btn-ghost" onClick={() => reload("noi-thanh")} disabled={loading}>
              {loading ? "Đang tải…" : "🔄 Tải lại"}
            </button>
          </div>

          {error && <div className="section-card" style={{ color: "var(--red, #c0392b)" }}>{error}</div>}

          {!error && rows && rows.length === 0 && (
            <div className="section-card" style={{ textAlign: "center", color: "var(--muted)" }}>
              Chưa có ticket nào trong bảng — nạp dữ liệu mẫu 1 lần để bắt đầu dựng/kiểm thử giao diện.
            </div>
          )}

          {!error && rows && rows.length > 0 && (
            <div className="section-card rt-wrap">
              <table className="re-stops">
                <thead>
                  <tr>
                    <th>Ticket_id</th>
                    <th>Lộ trình</th>
                    <th>MSNV</th>
                    <th>Ngày · Giờ MM</th>
                    <th>Trạng thái</th>
                    <th>BKS</th>
                    <th>Thông tin tài xế</th>
                    <th>Giờ tới</th>
                    <th>Ngày duyệt</th>
                    <th>Tên NCC</th>
                    <th>Tải trọng</th>
                    <th>Về KTC</th>
                    <th>Thứ tự điểm</th>
                    <th>Warehouse (ad hoc)</th>
                    <th>Tạo App</th>
                    <th>Mã chuyến</th>
                    <th>Đã tạo app</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const dirty = isDirty(t);
                    return (
                      <tr key={t.ticket_id} className={dirty ? "rc-dirty" : ""}>
                        <td>{t.ticket_id}</td>
                        <td>{t.lo_trinh || "—"}</td>
                        <td>{t.msnv || "—"}</td>
                        <td>{t.ngay_mong_muon || "—"} {t.gio_mong_muon || ""}</td>
                        <td>
                          <input className="pl-in" disabled={!canEdit} value={valueOf(t, "trang_thai") || ""}
                            onChange={(e) => setField(t, "trang_thai", e.target.value)} placeholder="Có xe / Không có xe…" />
                        </td>
                        <td>
                          <input className="pl-in" disabled={!canEdit} value={valueOf(t, "bks") || ""}
                            onChange={(e) => setField(t, "bks", e.target.value)} placeholder="51C-12345" />
                        </td>
                        <td>
                          <input className="pl-in" disabled={!canEdit} value={valueOf(t, "thong_tin_tx") || ""}
                            onChange={(e) => setField(t, "thong_tin_tx", e.target.value)} placeholder="Tên: SĐT" />
                        </td>
                        <td>
                          <input className="pl-in" disabled={!canEdit} value={valueOf(t, "gio_toi") || ""}
                            onChange={(e) => setField(t, "gio_toi", e.target.value)} placeholder="HH:mm" />
                        </td>
                        <td>
                          <input className="pl-in" disabled={!canEdit} value={valueOf(t, "ngay_duyet") || ""}
                            onChange={(e) => setField(t, "ngay_duyet", e.target.value)} />
                        </td>
                        <td>
                          <input className="pl-in" disabled={!canEdit} value={valueOf(t, "ten_ncc") || ""}
                            onChange={(e) => setField(t, "ten_ncc", e.target.value)} />
                        </td>
                        <td>
                          <input className="pl-in" disabled={!canEdit} value={valueOf(t, "tai_trong") || ""}
                            onChange={(e) => setField(t, "tai_trong", e.target.value)} />
                        </td>
                        <td>
                          <input className="pl-in" disabled={!canEdit} value={valueOf(t, "ve_ktc") || ""}
                            onChange={(e) => setField(t, "ve_ktc", e.target.value)} placeholder="HCM01 / HCM20…" />
                        </td>
                        <td>
                          <input className="pl-in" type="number" disabled={!canEdit} value={valueOf(t, "thu_tu_diem") ?? ""}
                            onChange={(e) => setField(t, "thu_tu_diem", e.target.value === "" ? null : Number(e.target.value))} />
                        </td>
                        <td>
                          <input className="pl-in" disabled={!canEdit} value={valueOf(t, "warehouse") || ""}
                            onChange={(e) => setField(t, "warehouse", e.target.value)} />
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <input type="checkbox" disabled={!canEdit} checked={!!valueOf(t, "tao_app_trigger")}
                            onChange={(e) => setField(t, "tao_app_trigger", e.target.checked)} />
                        </td>
                        <td>
                          <input className="pl-in" disabled={!canEdit} value={valueOf(t, "ma_chuyen") || ""}
                            onChange={(e) => setField(t, "ma_chuyen", e.target.value)} placeholder="Bot điền sau khi tạo" />
                        </td>
                        <td>
                          <input className="pl-in" disabled={!canEdit} value={valueOf(t, "da_tao_app") || ""}
                            onChange={(e) => setField(t, "da_tao_app", e.target.value)} placeholder="Bot điền sau khi tạo" />
                        </td>
                        <td className="rc-actions">
                          <button className="btn-violet sm" disabled={!canEdit || !dirty || saving === t.ticket_id}
                            onClick={() => save(t)}>
                            {saving === t.ticket_id ? "…" : "💾 Lưu"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="rt-note">
                Cập nhật gần nhất: {rows[0] ? fmtTime(rows[0].updated_at) : "—"} · Ticket_id/Lộ trình/MSNV/Ngày·Giờ chỉ đọc (thuộc luồng
                đăng ký gốc) — các cột còn lại là phần GSVT phản hồi + bot Playwright.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
