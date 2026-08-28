/* ============================================================
   BÁO CÁO ĐÃ CHỐT — port từ functions/api/report.ts (KV "report:<key>").
   POST { key, action:"get" }                -> { text, at, by }   (ai cũng đọc được)
   POST { key, action:"save", text }         -> { ok, at }         (plan-event:edit)
   ============================================================ */
import { one, upsert, json } from "./_lib/supabase";
import { guard } from "./_lib/session";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const b: any = await req.json().catch(() => ({}));
    // Giữ nguyên luật làm sạch key của bản cũ (chống chèn ký tự lạ vào tên bản ghi).
    const key = String(b?.key || "").slice(0, 80).replace(/[^\w.\-:]/g, "");
    if (!key) return json({ error: "bad_key" }, 400);

    if (String(b?.action || "get") === "get") {
      const row = await one<any>("reports", {
        select: "text,by_email,updated_at", filter: { key: "eq." + key },
      });
      return json({
        ok: true,
        text: row?.text || "",
        at: row?.updated_at ? Date.parse(row.updated_at) : null,
        by: row?.by_email || "",
      });
    }

    const g = await guard(req, "plan-event", "edit");
    if ("deny" in g) return g.deny;
    const text = String(b?.text || "").slice(0, 200_000);
    await upsert("reports", { key, text, by_email: g.actor.email, updated_at: new Date().toISOString() },
                 "key", g.actor.email);
    return json({ ok: true, at: Date.now() });
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
