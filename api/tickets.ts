/* ============================================================
   TICKET VẬN TẢI — trạng thái xử lý + ghi chú (07/09/2026, yêu cầu #4).
   Xem bối cảnh đầy đủ ở supabase/migrations/0007_ticket_trang_thai.sql.

   GET  /api/tickets
     -> { ok, status: { [ticketId]: {status, doneBy, doneAt, updatedBy, updatedAt} },
              notes:  { [ticketId]: [{author, note, at}, ...] } }
     ĐỌC MỞ (không cần đăng nhập) — cùng lý do api/roles.ts: dữ liệu cấu hình/trạng
     thái vận hành, không nhạy cảm, và trang Ticket Vận Tải cần có ngay lúc dựng
     khung. Toàn bộ (không phân trang) — số ticket có trạng thái/note còn nhỏ,
     xem lại nếu sau này phình to (giống tinh thần "để dành đợt sau" MVP ban đầu).

   POST /api/tickets { action:"set-status", ticketId, status } -> { ok }
   POST /api/tickets { action:"add-note",   ticketId, note }   -> { ok, note }
     Cả 2 đều cần quyền "ticket-vt":"edit" (guard) — Sếp bật cho vai trò phù hợp
     (vd "Giám sát vận tải") qua Phân quyền -> Ma trận Quyền.
   ============================================================ */
import { select, insert, upsert, json, SupabaseError } from "./_lib/supabase";
import { guard } from "./_lib/session";

export const config = { runtime: "edge" };

const MODULE = "ticket-vt";
const STATUSES = new Set(["open", "in_progress", "done"]);
const MAX_ID_LEN = 200;
const MAX_NOTE_LEN = 2000;

interface StatusRow {
  id: string; status: string; done_by: string | null; done_at: string | null;
  updated_by: string | null; updated_at: string;
}
interface NoteRow { ticket_id: string; author: string; note: string; created_at: string }

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method === "GET") {
      const [statusRows, noteRows] = await Promise.all([
        select<StatusRow>("ticket_status", { select: "id,status,done_by,done_at,updated_by,updated_at" }),
        select<NoteRow>("ticket_notes", { select: "ticket_id,author,note,created_at", order: "created_at.asc" }),
      ]);
      const status: Record<string, any> = {};
      for (const r of statusRows) {
        status[r.id] = { status: r.status, doneBy: r.done_by, doneAt: r.done_at, updatedBy: r.updated_by, updatedAt: r.updated_at };
      }
      const notes: Record<string, any[]> = {};
      for (const r of noteRows) {
        (notes[r.ticket_id] ||= []).push({ author: r.author, note: r.note, at: r.created_at });
      }
      return json({ ok: true, status, notes });
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const g = await guard(req, MODULE, "edit");
    if ("deny" in g) return g.deny;

    const b: any = await req.json().catch(() => ({}));
    const ticketId = String(b?.ticketId || "").trim();
    if (!ticketId || ticketId.length > MAX_ID_LEN) return json({ error: "bad_request", detail: "ticketId" }, 400);

    if (b?.action === "set-status") {
      const status = String(b?.status || "");
      if (!STATUSES.has(status)) return json({ error: "bad_request", detail: "status" }, 400);
      const now = new Date().toISOString();
      await upsert("ticket_status", {
        id: ticketId,
        status,
        updated_by: g.actor.email,
        updated_at: now,
        done_by: status === "done" ? g.actor.email : null,
        done_at: status === "done" ? now : null,
      }, "id", g.actor.email);
      return json({ ok: true });
    }

    if (b?.action === "add-note") {
      const note = String(b?.note || "").trim();
      if (!note || note.length > MAX_NOTE_LEN) return json({ error: "bad_request", detail: "note" }, 400);
      const rows = await insert<NoteRow>("ticket_notes", {
        ticket_id: ticketId, author: g.actor.email, note,
      }, g.actor.email);
      const r = rows[0];
      return json({ ok: true, note: r ? { author: r.author, note: r.note, at: r.created_at } : null });
    }

    return json({ error: "bad_request", detail: "action" }, 400);
  } catch (e: any) {
    if (e instanceof SupabaseError) return json({ error: "server_error", detail: e.message }, 500);
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
