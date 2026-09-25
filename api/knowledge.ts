/* ============================================================
   Vercel Edge Function — Bộ nhớ kiến thức của Trợ lý Lịch Tải.
   Port từ functions/api/knowledge.ts (Cloudflare, KV "kb:list") sang
   cầu nối kv_store — xem api/_kv.ts + supabase/PHA3-PLAN.md.
   GET  /api/knowledge            -> { items:[{id,text,cat,ts}] }
   POST /api/knowledge {text,cat}       -> dạy 1 kiến thức
   POST /api/knowledge {action:"update", id, text, cat}
   POST /api/knowledge {action:"delete", id}
   ============================================================ */
export const config = { runtime: "edge" };

import { json, kvGet, kvSet } from "./_kv";

const KEY = "kb:list";
const MAX = 500;

interface Fact { id: string; text: string; cat?: string; ts: number }

async function load(): Promise<Fact[]> {
  const arr = await kvGet<Fact[]>(KEY);
  return Array.isArray(arr) ? arr : [];
}
async function save(list: Fact[]): Promise<void> {
  await kvSet(KEY, list.slice(-MAX));
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    return json({ items: (await load()).sort((a, b) => b.ts - a.ts) });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body: Record<string, unknown> = await req.json().catch(() => ({}));
  const list = await load();

  if (body?.action === "delete") {
    const next = list.filter((x) => x.id !== body.id);
    await save(next);
    return json({ ok: true, items: next.sort((a, b) => b.ts - a.ts) });
  }

  const text = String(body?.text || "").trim().slice(0, 10000);
  const cat = String(body?.cat || "").trim().slice(0, 60) || "Khác";

  if (body?.action === "update" && body?.id) {
    const f = list.find((x) => x.id === body.id);
    if (f) { f.text = text || f.text; f.cat = cat; f.ts = Date.now(); }
    await save(list);
    return json({ ok: true, items: list.sort((a, b) => b.ts - a.ts) });
  }

  if (text.length < 2) return json({ error: "empty" }, 400);
  list.push({ id: crypto.randomUUID(), text, cat, ts: Date.now() });
  await save(list);
  return json({ ok: true, items: list.sort((a, b) => b.ts - a.ts) });
}
