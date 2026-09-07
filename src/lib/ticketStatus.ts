/* ============================================================
   TRẠNG THÁI XỬ LÝ + GHI CHÚ CỦA TICKET VẬN TẢI (07/09/2026, yêu cầu #4).
   Khớp API ở api/tickets.ts + bảng ticket_status/ticket_notes (xem
   supabase/migrations/0007_ticket_trang_thai.sql). Tách riêng khỏi lib/ticket.ts
   vì ticket.ts CHỈ đọc sống từ Sheet (không đụng, không thêm state) — phần
   trạng thái/note này đọc/ghi Supabase qua api/tickets.ts.
   ============================================================ */
import { adminHeaders, forceReauth } from "./useUser";

export type TicketStatusValue = "open" | "in_progress" | "done";

// cls khớp modifier có sẵn của .btbd-pill (xem index.css) — "" = mặc định (xanh lá),
// "due" = cam (đang xử lý, không phải lỗi nên KHÔNG dùng "warn"/đỏ), "ink" = xám (chưa xử lý).
export const TICKET_STATUS_META: Record<TicketStatusValue, { label: string; cls: string }> = {
  open: { label: "Mở", cls: "ink" },
  in_progress: { label: "Đang xử lý", cls: "due" },
  done: { label: "Đã xử lý", cls: "" },
};

export interface TicketStatusRow {
  status: TicketStatusValue;
  doneBy: string | null;
  doneAt: string | null;
  updatedBy: string | null;
  updatedAt: string;
}
export interface TicketNote { author: string; note: string; at: string }

export interface TicketStatusData {
  status: Record<string, TicketStatusRow>;
  notes: Record<string, TicketNote[]>;
}

export async function loadTicketStatus(signal?: AbortSignal): Promise<TicketStatusData> {
  const r = await fetch("/api/tickets", { signal, cache: "no-store" });
  const d = await r.json();
  if (!d?.ok) throw new Error(d?.error || "load_failed");
  return { status: d.status || {}, notes: d.notes || {} };
}

/** true = thành công. 401 (phiên hết hạn) tự đưa về màn đăng nhập giống saveRbac(). */
export async function setTicketStatus(ticketId: string, status: TicketStatusValue): Promise<boolean> {
  try {
    const r = await fetch("/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ action: "set-status", ticketId, status }),
    });
    if (r.status === 401) { forceReauth(); return false; }
    const d = await r.json();
    return !!d?.ok;
  } catch { return false; }
}

/** Trả về note vừa lưu (đã có timestamp thật từ server) để cập nhật UI ngay, hoặc null nếu lỗi. */
export async function addTicketNote(ticketId: string, note: string): Promise<TicketNote | null> {
  try {
    const r = await fetch("/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ action: "add-note", ticketId, note }),
    });
    if (r.status === 401) { forceReauth(); return null; }
    const d = await r.json();
    return d?.ok ? (d.note as TicketNote) : null;
  } catch { return null; }
}
