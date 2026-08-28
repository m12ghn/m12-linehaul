/* ============================================================
   HỎI ĐÁP / GÓP Ý — port từ functions/api/qa.ts (KV "qa:list").
   GET  /api/qa                                        -> { items, total, answered }
   POST /api/qa { name, msg }                           -> tạo câu hỏi mới (không cần đăng nhập)
   POST /api/qa { action:"reply", id, text, by, name }   -> thêm tin nhắn vào luồng
        (by="admin" cần quyền; by="user" thì không)
   POST /api/qa { action:"delete", id }                  -> xoá luồng (cần quyền)

   Bản KV cũ nhồi cả danh sách luồng + mọi tin nhắn vào 1 blob JSON, giới hạn cứng
   500 luồng × 200 trả lời rồi cắt bớt. Nay tách 2 bảng, không phải cắt.
   ============================================================ */
import { select, insert, update, remove, json } from "./_lib/supabase";
import { actorOf, can } from "./_lib/session";

export const config = { runtime: "edge" };

const MAX_MSG = 4000;

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method === "GET") {
      const items = await select<any>("qa_threads", {
        select: "id,name,email,msg,answered,created_at,qa_messages(id,by_role,name,text,created_at)",
        order: "created_at.desc", limit: 300,
      });
      // Sắp tin nhắn trong luồng theo thời gian (PostgREST không đảm bảo thứ tự bảng lồng).
      for (const t of items) {
        (t.qa_messages || []).sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));
        t.replies = t.qa_messages;      // giữ tên cũ mà QABoard đang đọc
      }
      return json({
        ok: true, items,
        total: items.length,
        answered: items.filter((t: any) => t.answered).length,
      });
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const b: any = await req.json().catch(() => ({}));
    const actor = await actorOf(req);
    const isAdmin = !!actor && (await can(actor.roleId, "phan-quyen", "edit"));

    if (b?.action === "delete") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      if (!b?.id) return json({ error: "bad_request" }, 400);
      await remove("qa_threads", { id: "eq." + String(b.id) }, actor!.email);
      return json({ ok: true });
    }

    if (b?.action === "reply") {
      const byAdmin = String(b?.by || "user") === "admin";
      if (byAdmin && !isAdmin) return json({ error: "forbidden" }, 403);
      const text = String(b?.text || "").trim().slice(0, MAX_MSG);
      if (!b?.id || !text) return json({ error: "bad_request" }, 400);

      await insert("qa_messages", {
        thread_id: String(b.id),
        by_role: byAdmin ? "admin" : "user",
        name: String(b?.name || actor?.name || "").slice(0, 60),
        text,
      }, actor?.email);
      // Admin trả lời -> đánh dấu luồng đã được xử lý.
      if (byAdmin) await update("qa_threads", { id: "eq." + String(b.id) }, { answered: true }, actor?.email);
      return json({ ok: true });
    }

    // Tạo câu hỏi mới — CỐ Ý không bắt đăng nhập, giống bản cũ (ai cũng góp ý được).
    const msg = String(b?.msg || "").trim().slice(0, MAX_MSG);
    if (!msg) return json({ error: "empty" }, 400);
    const [row] = await insert<{ id: string }>("qa_threads", {
      name: String(b?.name || "").slice(0, 60),
      email: actor?.email || null,
      msg,
    }, actor?.email);
    return json({ ok: true, id: row.id });
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
