/* ============================================================
   Vercel Edge Function — Hỏi đáp / Góp ý (chat qua lại).
   Port từ functions/api/qa.ts (Cloudflare, KV "qa:list") sang cầu nối
   kv_store — xem api/_kv.ts + supabase/PHA3-PLAN.md.
   GET  /api/qa                                  -> { items, total, answered }
   POST /api/qa {name, msg}                       -> tạo câu hỏi mới
   POST /api/qa {action:"reply", id, text, by, name}  -> thêm tin nhắn vào thread
        (by="admin" cần header x-admin-token; by="user" thì không cần)
   POST /api/qa {action:"delete", id}             -> xoá thread (cần token)
   ============================================================ */
export const config = { runtime: "edge" };

import { json, kvGet, kvSet } from "./_kv";
import { isAdminReq } from "./_admin";

const KEY = "qa:list";
const MAX = 500;
const MAX_REPLIES = 200;

interface Reply { by: "user" | "admin"; name: string; text: string; ts: number }
interface QA { id: string; name: string; msg: string; ts: number; replies: Reply[] }

/** Chuẩn hoá + migrate dữ liệu cũ (field answer/answeredAt) sang replies[]. */
function normalize(raw: Partial<QA> & { answer?: string; answeredAt?: number }): QA {
  let replies: Reply[] = Array.isArray(raw?.replies) ? raw.replies : [];
  if (!Array.isArray(raw?.replies) && raw?.answer) {
    replies = [{ by: "admin", name: "M12SC", text: String(raw.answer), ts: raw.answeredAt || raw.ts || Date.now() }];
  }
  return {
    id: String(raw?.id || crypto.randomUUID()),
    name: String(raw?.name || "Ẩn danh"),
    msg: String(raw?.msg || ""),
    ts: Number(raw?.ts) || Date.now(),
    replies,
  };
}

async function load(): Promise<QA[]> {
  const arr = await kvGet<(Partial<QA> & { answer?: string; answeredAt?: number })[]>(KEY);
  return Array.isArray(arr) ? arr.map(normalize) : [];
}
async function save(list: QA[]): Promise<void> {
  await kvSet(KEY, list.slice(-MAX));
}
// "Đã trả lời" = thread đã có ít nhất 1 phản hồi (bất kể ai trả lời).
const isAnswered = (q: QA) => q.replies.length > 0;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const list = await load();
    const answered = list.filter(isAnswered).length;
    const items = [...list].sort((a, b) => b.ts - a.ts);
    return json({ items, total: list.length, answered });
  }

  if (req.method === "POST") {
    const body: Record<string, unknown> = await req.json().catch(() => ({}));
    const action = body?.action;
    const isAdmin = isAdminReq(req);

    if (action === "reply") {
      const by: "user" | "admin" = body?.by === "admin" ? "admin" : "user";
      if (by === "admin" && !isAdmin) return json({ error: "unauthorized" }, 401);
      const text = String(body?.text || "").trim().slice(0, 1500);
      if (text.length < 1) return json({ error: "empty" }, 400);
      const list = await load();
      const q = list.find((x) => x.id === body?.id);
      if (!q) return json({ error: "not_found" }, 404);
      const name = by === "admin" ? "M12SC" : String(body?.name || "").trim().slice(0, 60) || "Ẩn danh";
      q.replies.push({ by, name, text, ts: Date.now() });
      if (q.replies.length > MAX_REPLIES) q.replies = q.replies.slice(-MAX_REPLIES);
      await save(list);
      const answered = list.filter(isAnswered).length;
      return json({ ok: true, total: list.length, answered });
    }

    if (action === "delete") {
      if (!isAdmin) return json({ error: "unauthorized" }, 401);
      let list = await load();
      list = list.filter((x) => x.id !== body?.id);
      await save(list);
      const answered = list.filter(isAnswered).length;
      return json({ ok: true, total: list.length, answered });
    }

    const name = String(body?.name || "").trim().slice(0, 60);
    const msg = String(body?.msg || "").trim().slice(0, 1500);
    if (msg.length < 2) return json({ error: "empty" }, 400);
    const list = await load();
    list.push({ id: crypto.randomUUID(), name: name || "Ẩn danh", msg, ts: Date.now(), replies: [] });
    await save(list);
    return json({ ok: true, total: list.length });
  }

  return json({ error: "method_not_allowed" }, 405);
}
