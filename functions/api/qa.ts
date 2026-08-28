/* ============================================================
   Cloudflare Pages Function — Hỏi đáp / Góp ý (chat qua lại)
   GET  /api/qa                                  -> { items, total, answered }
   POST /api/qa {name, msg}                       -> tạo câu hỏi mới
   POST /api/qa {action:"reply", id, text, by, name}  -> thêm tin nhắn vào thread
        (by="admin" cần header x-admin-token; by="user" thì không cần)
   POST /api/qa {action:"delete", id}             -> xoá thread (cần token)
   Lưu KV (binding QA_KV), key "qa:list".
   ============================================================ */
import { isAdminReq } from "./_admin";

const KEY = "qa:list";
const MAX = 500;
const MAX_REPLIES = 200;

interface Reply {
  by: "user" | "admin";
  name: string;
  text: string;
  ts: number;
}
interface QA {
  id: string;
  name: string;
  msg: string;
  ts: number;
  replies: Reply[];
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Chuẩn hoá + migrate dữ liệu cũ (field answer/answeredAt) sang replies[]. */
function normalize(raw: any): QA {
  let replies: Reply[] = Array.isArray(raw?.replies) ? raw.replies : [];
  if (!Array.isArray(raw?.replies) && raw?.answer) {
    replies = [{ by: "admin", name: "M12SC", text: String(raw.answer), ts: raw.answeredAt || raw.ts || Date.now() }];
  }
  return {
    id: String(raw?.id || (crypto as any).randomUUID()),
    name: String(raw?.name || "Ẩn danh"),
    msg: String(raw?.msg || ""),
    ts: Number(raw?.ts) || Date.now(),
    replies,
  };
}

async function load(env: any): Promise<QA[]> {
  const s = await env.QA_KV.get(KEY);
  try {
    const arr = s ? JSON.parse(s) : [];
    return Array.isArray(arr) ? arr.map(normalize) : [];
  } catch {
    return [];
  }
}
async function save(env: any, list: QA[]): Promise<void> {
  await env.QA_KV.put(KEY, JSON.stringify(list.slice(-MAX)));
}
// "Đã trả lời" = thread đã có ít nhất 1 phản hồi (bất kể ai trả lời).
const isAnswered = (q: QA) => q.replies.length > 0;

export const onRequestGet = async ({ env }: any): Promise<Response> => {
  const list = await load(env);
  const answered = list.filter(isAnswered).length;
  const items = [...list].sort((a, b) => b.ts - a.ts);
  return json({ items, total: list.length, answered });
};

export const onRequestPost = async ({ request, env }: any): Promise<Response> => {
  const body: any = await request.json().catch(() => ({}));
  const action = body?.action;
  const isAdmin = await isAdminReq(request, env); // admin = phiên đăng nhập vai trò admin (hoặc token dự phòng)

  // ----- Thêm tin nhắn vào thread -----
  if (action === "reply") {
    const by: "user" | "admin" = body?.by === "admin" ? "admin" : "user";
    if (by === "admin" && !isAdmin) return json({ error: "unauthorized" }, 401);
    const text = String(body?.text || "").trim().slice(0, 1500);
    if (text.length < 1) return json({ error: "empty" }, 400);
    const list = await load(env);
    const q = list.find((x) => x.id === body?.id);
    if (!q) return json({ error: "not_found" }, 404);
    const name = by === "admin" ? "M12SC" : String(body?.name || "").trim().slice(0, 60) || "Ẩn danh";
    q.replies.push({ by, name, text, ts: Date.now() });
    if (q.replies.length > MAX_REPLIES) q.replies = q.replies.slice(-MAX_REPLIES);
    await save(env, list);
    const answered = list.filter(isAnswered).length;
    return json({ ok: true, total: list.length, answered });
  }

  // ----- Xoá thread (admin) -----
  if (action === "delete") {
    if (!isAdmin) return json({ error: "unauthorized" }, 401);
    let list = await load(env);
    list = list.filter((x) => x.id !== body?.id);
    await save(env, list);
    const answered = list.filter(isAnswered).length;
    return json({ ok: true, total: list.length, answered });
  }

  // ----- Câu hỏi mới -----
  const name = String(body?.name || "").trim().slice(0, 60);
  const msg = String(body?.msg || "").trim().slice(0, 1500);
  if (msg.length < 2) return json({ error: "empty" }, 400);
  const list = await load(env);
  list.push({ id: (crypto as any).randomUUID(), name: name || "Ẩn danh", msg, ts: Date.now(), replies: [] });
  await save(env, list);
  return json({ ok: true, total: list.length });
};
