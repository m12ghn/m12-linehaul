/* ============================================================
   KHO KIẾN THỨC CỦA TRỢ LÝ — port từ functions/api/knowledge.ts (KV "kb:list").
   GET  /api/knowledge                          -> { items:[{id,text,cat,ts}] }
   POST /api/knowledge { text, cat? }            -> dạy 1 kiến thức  (sap-lich-tai:edit)
   POST /api/knowledge { action:"delete", id }   -> xoá              (sap-lich-tai:delete)
   ============================================================ */
import { select, insert, remove, json } from "./_lib/supabase";
import { guard } from "./_lib/session";

export const config = { runtime: "edge" };

const MAX_LEN = 4000;

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method === "GET") {
      const rows = await select<any>("knowledge", {
        select: "id,text,cat,source,created_at", order: "created_at.desc", limit: 500,
      });
      // Giữ tên trường `ts` như bản cũ để component dạy kiến thức không phải sửa.
      return json({ ok: true, items: rows.map((r) => ({ ...r, ts: Date.parse(r.created_at) })) });
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const b: any = await req.json().catch(() => ({}));

    if (b?.action === "delete") {
      const g = await guard(req, "sap-lich-tai", "delete");
      if ("deny" in g) return g.deny;
      if (!b?.id) return json({ error: "bad_request" }, 400);
      await remove("knowledge", { id: "eq." + String(b.id) }, g.actor.email);
      return json({ ok: true });
    }

    const g = await guard(req, "sap-lich-tai", "edit");
    if ("deny" in g) return g.deny;
    const text = String(b?.text || "").trim().slice(0, MAX_LEN);
    if (!text) return json({ error: "empty" }, 400);
    const [row] = await insert<{ id: string }>("knowledge", {
      text, cat: b?.cat ? String(b.cat).slice(0, 40) : null, source: "nhap-tay",
    }, g.actor.email);
    return json({ ok: true, id: row.id });
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
