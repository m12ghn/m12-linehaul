/* ============================================================
   Vercel Edge Function — Vai trò & Ma trận quyền (RBAC).
   Port từ functions/api/roles.ts (Cloudflare, KV "rbac:v1") sang cầu
   nối kv_store — xem api/_kv.ts + supabase/PHA3-PLAN.md.
   GET  /api/roles                          -> { roles, matrix } (đọc mở, để client khoá menu)
   POST /api/roles { action:"save", roles, matrix }  (admin — x-admin-token) -> { ok }
   ============================================================ */
export const config = { runtime: "edge" };

import { json, kvGet, kvSet } from "./_kv";
import { isAdminReq } from "./_admin";

const KEY = "rbac:v1";

interface RbacRec { roles: unknown[]; matrix: Record<string, unknown> }

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const d = await kvGet<RbacRec>(KEY);
    return json({ ok: true, roles: d?.roles ?? null, matrix: d?.matrix ?? null });
  }

  if (req.method === "POST") {
    const body: Record<string, unknown> = await req.json().catch(() => ({}));
    if (body?.action !== "save") return json({ error: "bad_request" }, 400);
    if (!isAdminReq(req)) return json({ error: "unauthorized" }, 401);

    const roles = Array.isArray(body?.roles) ? body.roles : null;
    const matrix = body?.matrix && typeof body.matrix === "object" ? body.matrix : null;
    if (!roles || !matrix) return json({ error: "invalid_payload" }, 400);

    await kvSet(KEY, { roles, matrix, at: Date.now() });
    return json({ ok: true });
  }

  return json({ error: "method_not_allowed" }, 405);
}
