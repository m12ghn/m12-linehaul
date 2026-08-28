/* ============================================================
   Bộ nhớ kiến thức của Trợ lý Lịch Tải (lưu vĩnh viễn trong KV).
   GET  /api/knowledge            -> { items:[{id,text,ts}] }
   POST /api/knowledge {text}      -> dạy 1 kiến thức
   POST /api/knowledge {action:"delete", id}
   Dùng chung KV QA_KV, key "kb:list".
   ============================================================ */
const KEY = "kb:list";
const MAX = 500;

interface Fact { id: string; text: string; cat?: string; ts: number; }

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
async function load(env: any): Promise<Fact[]> {
  const s = await env.QA_KV.get(KEY);
  try { return s ? JSON.parse(s) : []; } catch { return []; }
}
async function save(env: any, list: Fact[]) { await env.QA_KV.put(KEY, JSON.stringify(list.slice(-MAX))); }

export const onRequestGet = async ({ env }: any) => {
  return json({ items: (await load(env)).sort((a, b) => b.ts - a.ts) });
};

export const onRequestPost = async ({ request, env }: any) => {
  const body: any = await request.json().catch(() => ({}));
  const list = await load(env);
  if (body?.action === "delete") {
    const next = list.filter((x) => x.id !== body.id);
    await save(env, next);
    return json({ ok: true, items: next.sort((a, b) => b.ts - a.ts) });
  }
  const text = String(body?.text || "").trim().slice(0, 10000);
  const cat = String(body?.cat || "").trim().slice(0, 60) || "Khác";
  // Cập nhật/gộp vào 1 mục có sẵn
  if (body?.action === "update" && body?.id) {
    const f = list.find((x) => x.id === body.id);
    if (f) { f.text = text || f.text; f.cat = cat; f.ts = Date.now(); }
    await save(env, list);
    return json({ ok: true, items: list.sort((a, b) => b.ts - a.ts) });
  }
  if (text.length < 2) return json({ error: "empty" }, 400);
  list.push({ id: (crypto as any).randomUUID(), text, cat, ts: Date.now() });
  await save(env, list);
  return json({ ok: true, items: list.sort((a, b) => b.ts - a.ts) });
};
