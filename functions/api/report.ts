/* ============================================================
   Lưu/đọc BÁO CÁO đã chốt (vd Kế hoạch Plan Event) ở KV "report:<key>".
   - get: ai cũng đọc được (báo cáo public cho cả nhóm).
   - save: CHỈ admin (ADMIN_TOKEN + ADMIN_USER) — chỉ Sếp được soạn/cập nhật.
   POST { key, action:"get" } -> { text, at, by }
   POST { key, action:"save", text, user, token } -> { ok, at }
   ============================================================ */
import { isAdminReq } from "./_admin";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const onRequestPost = async ({ request, env }: any): Promise<Response> => {
  const b: any = await request.json().catch(() => ({}));
  const key = String(b?.key || "").slice(0, 80).replace(/[^\w.\-:]/g, "");
  const action = String(b?.action || "get");
  if (!key) return json({ ok: false, error: "thiếu key" }, 400);
  const KK = "report:" + key;

  if (action === "get") {
    try {
      const raw = env.QA_KV ? await env.QA_KV.get(KK) : null;
      const d = raw ? JSON.parse(raw) : null;
      return json({ ok: true, text: d?.text || "", at: d?.at || 0, by: d?.by || "" });
    } catch {
      return json({ ok: true, text: "", at: 0 });
    }
  }
  if (action === "save") {
    if (!(await isAdminReq(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
    if (!env.QA_KV) return json({ ok: false, error: "no_kv" }, 500);
    const by = String(b?.user || request.headers.get("x-user-email") || "");
    const rec = { text: String(b?.text || "").slice(0, 20000), at: Date.now(), by };
    await env.QA_KV.put(KK, JSON.stringify(rec));
    return json({ ok: true, at: rec.at });
  }
  return json({ ok: false, error: "action lạ" }, 400);
};
