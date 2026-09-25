/* ============================================================
   Vercel Edge Function — Ghi nhận người dùng đã đăng nhập (email).
   Port từ functions/api/users.ts (Cloudflare, KV "users:list") sang
   cầu nối kv_store — xem api/_kv.ts + supabase/PHA3-PLAN.md.
   POST { email, name } -> cập nhật/thêm (dedupe theo email).
   GET (admin — x-admin-token) -> danh sách.
   ============================================================ */
export const config = { runtime: "edge" };

import { json, kvGet, kvSet } from "./_kv";
import { isAdminReq } from "./_admin";

const KEY = "users:list";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserRec { e: string; n: string; f: number; t: number; c: number }

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "POST") {
    const b: Record<string, unknown> = await req.json().catch(() => ({}));
    const email = String(b?.email || "").trim().toLowerCase().slice(0, 120);
    const name = String(b?.name || "").trim().slice(0, 60);
    if (!email || !EMAIL_RE.test(email)) return json({ ok: false }, 400);

    const list = (await kvGet<UserRec[]>(KEY)) || [];
    const now = Date.now();
    const i = list.findIndex((u) => u.e === email);
    if (i >= 0) {
      if (name) list[i].n = name;
      list[i].t = now;
      list[i].c = (list[i].c || 1) + 1;
    } else {
      list.push({ e: email, n: name, f: now, t: now, c: 1 });
    }
    if (list.length > 2000) list.splice(0, list.length - 2000); // chặn phình
    await kvSet(KEY, list);
    return json({ ok: true, count: i >= 0 ? list[i].c : 1 });
  }

  if (req.method === "GET") {
    if (!isAdminReq(req)) return json({ error: "unauthorized" }, 401);
    const list = (await kvGet<UserRec[]>(KEY)) || [];
    return json({ ok: true, total: list.length, users: list.slice(-500) });
  }

  return json({ error: "method_not_allowed" }, 405);
}
