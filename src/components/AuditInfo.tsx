/* ============================================================
   Nút "(i)" xem LỊCH SỬ SỬA — thêm 03/09/2026, CHỈ ở cấp TUYẾN (Sếp yêu cầu
   03/09 tối: bỏ nút này ở từng điểm dừng, giữ lại 1 chỗ duy nhất trên tuyến).

   Tải THEO YÊU CẦU khi bấm mở (không tải sẵn hàng loạt) — gọi /api/audit,
   đọc lại từ audit_log (hạ tầng ghi đã có sẵn, xem api/audit.ts).

   03/09 tối (sửa bug "bị che"): khung nội dung giờ render qua PORTAL thẳng
   vào <body>, định vị `position:fixed` theo toạ độ thật của nút (không còn
   nằm trong DOM của thẻ tuyến -> không còn bị `overflow`/`z-index` của khung
   cuộn danh sách che mất). Tự ẩn khi rê chuột ra khỏi cả nút lẫn khung (có
   trễ nhỏ để rê chuột từ nút SANG khung không bị tắt giữa chừng).
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { adminHeaders } from "../lib/useUser";

type AuditPoint = { at: string; actor: string | null } | null;
type AuditState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; created: AuditPoint; lastUpdate: AuditPoint }
  | { status: "error"; message: string };

function fmt(p: AuditPoint): string {
  if (!p) return "—";
  const d = new Date(p.at);
  const when = isNaN(d.getTime()) ? p.at : d.toLocaleString("vi-VN");
  return `${when}${p.actor ? " · " + p.actor : ""}`;
}

const POP_W = 240; // khớp min-width CSS bên dưới, dùng để tự tránh tràn mép phải màn hình

/** table: bảng audit_log tương ứng ("routes" | "stops"); rowId: khoá chính (route.id / stop.sid). */
export function AuditInfo({ table, rowId }: { table: "routes" | "stops"; rowId: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [state, setState] = useState<AuditState>({ status: "idle" });
  const btnRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelClose() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 220);
  }

  function computePos() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(r.left, window.innerWidth - POP_W - 8);
    setPos({ top: r.bottom + 6, left: Math.max(8, left) });
  }

  async function openPanel(e: React.MouseEvent) {
    e.stopPropagation();
    cancelClose();
    computePos();
    setOpen(true);
    if (state.status !== "idle") return; // đã tải/đang tải rồi -> khỏi gọi lại
    setState({ status: "loading" });
    try {
      const r = await fetch(`/api/audit?table=${table}&row_id=${encodeURIComponent(rowId)}`, {
        headers: adminHeaders(),
      });
      const d: any = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) throw new Error(d?.error || "HTTP " + r.status);
      setState({ status: "ok", created: d.created, lastUpdate: d.lastUpdate });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  // Đóng khi cuộn/đổi cỡ màn hình (toạ độ đã tính không còn đúng nữa).
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => () => cancelClose(), []);

  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        className="audit-info-btn"
        title="Xem lịch sử sửa"
        onClick={openPanel}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        ⓘ
      </button>
      {open && pos && createPortal(
        <div
          className="audit-info-pop"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onClick={(e) => e.stopPropagation()}
        >
          {state.status === "loading" && <div className="muted">Đang tải…</div>}
          {state.status === "error" && <div className="rc-err">Không tải được: {state.message}</div>}
          {state.status === "ok" && (
            <>
              <div><b>Tạo:</b> {fmt(state.created)}</div>
              <div><b>Sửa gần nhất:</b> {state.lastUpdate ? fmt(state.lastUpdate) : "chưa từng sửa sau khi tạo"}</div>
            </>
          )}
        </div>,
        document.body
      )}
      <style>{`
        .audit-info-btn{
          border:1px solid var(--border-subtle);background:var(--surface-card);color:var(--text-muted);
          border-radius:999px;width:18px;height:18px;line-height:1;font-size:11px;cursor:pointer;
          display:inline-flex;align-items:center;justify-content:center;padding:0;
        }
        .audit-info-btn:hover{color:var(--accent);border-color:var(--border-accent)}
        .audit-info-pop{
          position:fixed;z-index:9999;min-width:240px;max-width:280px;
          background:var(--surface-card);border:1px solid var(--border-subtle);border-radius:10px;
          box-shadow:0 8px 28px rgba(0,0,0,.22);padding:10px 12px;font-size:12.5px;font-weight:600;
          color:var(--text-strong);white-space:normal;
        }
        .audit-info-pop b{font-weight:800}
      `}</style>
    </span>
  );
}
