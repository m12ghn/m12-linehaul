/* ============================================================
   DỮ LIỆU NẠP THÊM CHO TRỢ LÝ — port từ functions/api/dashdata.ts (KV "extra:<id>").
   POST { id, action }:
     get                    -> { items:[{id,at,source,chars}] }
     addUrl { url }         -> tải link (Google Sheet -> CSV, web khác -> bóc chữ), lưu lại
     add    { source,text } -> lưu đoạn dán tay
     remove { itemId }      -> xoá 1 nguồn
     clear                  -> xoá hết nguồn của mục này
   ============================================================ */
import { select, insert, remove, json } from "./_lib/supabase";
import { guard } from "./_lib/session";

export const config = { runtime: "edge" };

const MAX_TEXT = 60_000;

/** Tải nội dung 1 link thành chữ — giữ nguyên cách xử lý của bản cũ. */
async function fetchUrlText(url: string): Promise<string> {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  const target = m
    ? `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`
    : url;
  const r = await fetch(target, { headers: { "user-agent": "Mozilla/5.0 (M12 Dashboard)" } });
  if (!r.ok) throw new Error("fetch_failed:" + r.status);
  const raw = await r.text();
  if (m) return raw.slice(0, MAX_TEXT);
  // Trang web thường -> bỏ script/style rồi bóc chữ.
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const b: any = await req.json().catch(() => ({}));
    const scope = String(b?.id || "").slice(0, 60).replace(/[^\w.\-:]/g, "");
    if (!scope) return json({ error: "bad_request" }, 400);
    const action = String(b?.action || "get");

    if (action === "get") {
      const items = await select("ai_context_sources", {
        select: "id,source,chars,created_at",
        filter: { scope: "eq." + scope }, order: "created_at.desc", limit: 100,
      });
      return json({ ok: true, items });
    }

    const g = await guard(req, "sap-lich-tai", "edit");
    if ("deny" in g) return g.deny;

    if (action === "clear") {
      await remove("ai_context_sources", { scope: "eq." + scope }, g.actor.email);
      return json({ ok: true });
    }

    if (action === "remove") {
      if (!b?.itemId) return json({ error: "bad_request" }, 400);
      await remove("ai_context_sources", { id: "eq." + String(b.itemId) }, g.actor.email);
      return json({ ok: true });
    }

    let source: string, text: string;
    if (action === "addUrl") {
      const url = String(b?.url || "").trim();
      if (!/^https?:\/\//i.test(url)) return json({ error: "bad_url" }, 400);
      source = url;
      try { text = await fetchUrlText(url); }
      catch (e: any) { return json({ error: "fetch_failed", detail: String(e?.message || e) }, 502); }
    } else if (action === "add") {
      source = String(b?.source || "Nhập tay").slice(0, 200);
      text = String(b?.text || "").slice(0, MAX_TEXT);
    } else {
      return json({ error: "bad_request" }, 400);
    }

    if (!text.trim()) return json({ error: "empty" }, 400);
    const [row] = await insert<{ id: string; chars: number }>("ai_context_sources",
      { scope, source, text }, g.actor.email);
    return json({ ok: true, id: row.id, chars: row.chars });
  } catch (e: any) {
    return json({ error: "server_error", detail: String(e?.message || e) }, 500);
  }
}
