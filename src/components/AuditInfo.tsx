/* ============================================================
   Nút "(i)" xem LỊCH SỬ SỬA — thêm 03/09/2026 theo yêu cầu Sếp, hiện ở CẢ
   cấp tuyến lẫn từng điểm dừng (RouteCard).

   Tải THEO YÊU CẦU khi bấm mở (không tải sẵn hàng loạt) — gọi /api/audit,
   đọc lại từ audit_log (hạ tầng ghi đã có sẵn, xem api/audit.ts).
   ============================================================ */
import { useState } from "react";
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

/** table: bảng audit_log tương ứng ("routes" | "stops"); rowId: khoá chính (route.id / stop.sid). */
export function AuditInfo({ table, rowId }: { table: "routes" | "stops"; rowId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AuditState>({ status: "idle" });

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !open;
    setOpen(next);
    if (next && state.status === "idle") {
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
  }

  return (
    <span className="audit-info" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="audit-info-btn" title="Xem lịch sử sửa" onClick={toggle}>ⓘ</button>
      {open && (
        <div className="audit-info-pop">
          {state.status === "loading" && <div className="muted">Đang tải…</div>}
          {state.status === "error" && <div className="rc-err">Không tải được: {state.message}</div>}
          {state.status === "ok" && (
            <>
              <div><b>Tạo:</b> {fmt(state.created)}</div>
              <div><b>Sửa gần nhất:</b> {state.lastUpdate ? fmt(state.lastUpdate) : "chưa từng sửa sau khi tạo"}</div>
            </>
          )}
        </div>
      )}
      <style>{`
        .audit-info{position:relative;display:inline-block}
        .audit-info-btn{
          border:1px solid var(--border-subtle);background:var(--surface-card);color:var(--text-muted);
          border-radius:999px;width:18px;height:18px;line-height:1;font-size:11px;cursor:pointer;
          display:inline-flex;align-items:center;justify-content:center;padding:0;
        }
        .audit-info-btn:hover{color:var(--accent);border-color:var(--border-accent)}
        .audit-info-pop{
          position:absolute;z-index:30;top:22px;left:0;min-width:230px;
          background:var(--surface-card);border:1px solid var(--border-subtle);border-radius:10px;
          box-shadow:0 6px 20px rgba(0,0,0,.18);padding:10px 12px;font-size:12.5px;font-weight:600;
          color:var(--text-strong);white-space:normal;
        }
        .audit-info-pop b{font-weight:800}
      `}</style>
    </span>
  );
}
