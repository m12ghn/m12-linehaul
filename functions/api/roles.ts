/* ============================================================
   Cloudflare Pages Function — Vai trò & Ma trận quyền (RBAC).
   GET  /api/roles                          -> { roles, matrix } (đọc mở, để client khoá menu)
   POST /api/roles { action:"save", roles, matrix }  (ADMIN) -> { ok }
   Lưu KV key "rbac:v1". Không có KV -> trả rỗng, client dùng mặc định.
   ============================================================ */
import { isAdminReq } from "./_admin";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const KEY = "rbac:v1";

export const onRequestGet = async ({ env }: any): Promise<Response> => {
  try {
    const raw = env.QA_KV ? await env.QA_KV.get(KEY) : null;
    if (!raw) return json({ ok: true, roles: null, matrix: null }); // client tự dùng mặc định
    const d = JSON.parse(raw);
    return json({ ok: true, roles: d?.roles ?? null, matrix: d?.matrix ?? null });
  } catch {
    return json({ ok: true, roles: null, matrix: null });
  }
};

export const onRequestPost = async ({ request, env }: any): Promise<Response> => {
  const body: any = await request.json().catch(() => ({}));
  if (body?.action !== "save") return json({ error: "bad_request" }, 400);
  // Chỉ ADMIN (x-admin-token = ADMIN_TOKEN) mới được sửa quyền.
  if (!(await isAdminReq(request, env))) return json({ error: "unauthorized" }, 401);
  if (!env.QA_KV) return json({ error: "no_kv" }, 500);

  const roles = Array.isArray(body?.roles) ? body.roles : null;
  const matrix = body?.matrix && typeof body.matrix === "object" ? body.matrix : null;
  if (!roles || !matrix) return json({ error: "invalid_payload" }, 400);

  try {
    await env.QA_KV.put(KEY, JSON.stringify({ roles, matrix, at: Date.now() }));
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 500);
  }
};
