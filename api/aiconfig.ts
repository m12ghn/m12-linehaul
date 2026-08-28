/* ============================================================
   KHOÁ CẤU HÌNH AI / BẢN ĐỒ — port từ functions/api/aiconfig.ts (KV "cfg:*").
   GET  /api/aiconfig                              -> { hasKey: { gemini, gmaps } }
   POST /api/aiconfig { action:"set-key", provider, key }   (phan-quyen:admin ~ chỉ admin)

   KHOÁ KHÔNG BAO GIỜ TRẢ VỀ CLIENT — chỉ trả "đã có / chưa có".
   Bảng app_secrets có trigger ghi audit_log mỗi lần đổi khoá, nhưng KHÔNG ghi giá trị.
   ============================================================ */
import { select, upsert, json } from "./_lib/supabase";
import { guard } from "./_lib/session";

export const config = { runtime: "edge" };

const PROVIDERS = ["gemini", "gmaps"];

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method === "GET") {
      const rows = await select<{ key: string }>("app_secrets", { select: "key" });
      const have = new Set(rows.map((r) => r.key));
      const env = (globalThis as any).process?.env || {};
      return json({
        ok: true,
        hasKey: {
          gemini: have.has("gemini") || !!env.GEMINI_API_KEY,
          gmaps: have.has("gmaps") || !!env.GOOGLE_MAPS_KEY,
        },
      });
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const g = await guard(req, "phan-quyen", "edit");
    if ("deny" in g) return g.deny;

    const b: any = await req.json().catch(() => ({}));
    if (b?.action !== "set-key") return json({ error: "bad_request" }, 400);
    const provider = String(b?.provider || "gemini");
    if (!PROVIDERS.includes(provider)) return json({ error: "unknown_provider" }, 400);
    const key = String(b?.key || "").trim();
    if (!key) return json({ error: "empty_key" }, 400);

    await upsert("app_secrets", { key: provider, value: key, updated_by: g.actor.email },
                 "key", g.actor.email);
    return json({ ok: true });
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
