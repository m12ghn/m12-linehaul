/* ============================================================
   Cloudflare Pages Function — <MÔ TẢ CHỨC NĂNG>
   GET  /api/<ten>                 -> ...
   POST /api/<ten> {action:"x"}    -> ...
   Lưu KV (binding <TEN>_KV hoặc dùng chung QA_KV nếu dữ liệu nhỏ), key "<ten>:list".
   ============================================================ */
import { isAdminReq } from "./_admin";

const KEY = "<ten>:list";
const MAX = 500; // giới hạn số bản ghi lưu trong KV, tránh phình vô hạn

interface Item {
  id: string;
  // ... field khác
  ts: number;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function load(env: any): Promise<Item[]> {
  const s = await env.QA_KV.get(KEY); // đổi binding nếu dùng KV namespace riêng
  try {
    const arr = s ? JSON.parse(s) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
async function save(env: any, list: Item[]): Promise<void> {
  await env.QA_KV.put(KEY, JSON.stringify(list.slice(-MAX)));
}

export const onRequestGet = async ({ env }: any): Promise<Response> => {
  const list = await load(env);
  return json({ items: list, total: list.length });
};

export const onRequestPost = async ({ request, env }: any): Promise<Response> => {
  const body: any = await request.json().catch(() => ({}));
  const isAdmin = isAdminReq(request, env);

  // ----- Hành động cần quyền admin -----
  if (body?.action === "delete") {
    if (!isAdmin) return json({ error: "unauthorized" }, 401);
    let list = await load(env);
    list = list.filter((x) => x.id !== body?.id);
    await save(env, list);
    return json({ ok: true, total: list.length });
  }

  // ----- Validate input trước khi ghi -----
  // const value = String(body?.field || "").trim().slice(0, 1500);
  // if (value.length < 1) return json({ error: "empty" }, 400);

  const list = await load(env);
  list.push({ id: (crypto as any).randomUUID(), ts: Date.now() /* , ...field */ });
  await save(env, list);
  return json({ ok: true, total: list.length });
};
