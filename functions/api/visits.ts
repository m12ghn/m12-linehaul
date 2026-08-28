/* ============================================================
   Cloudflare Pages Function — Bộ đếm lượt truy cập.
   GET  /api/visits          -> { total }            (chỉ đọc, không tăng)
   POST /api/visits          -> { total }            (tăng 1 rồi trả về)
   Lưu KV (binding QA_KV), key "visits:total".
   ============================================================ */
const KEY = "visits:total";

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function read(env: any): Promise<number> {
  const s = await env.QA_KV.get(KEY);
  const n = parseInt(s || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

export const onRequestGet = async ({ env }: any): Promise<Response> => {
  return json({ total: await read(env) });
};

export const onRequestPost = async ({ env }: any): Promise<Response> => {
  // read-modify-write (KV không có tăng nguyên tử; sai số nhỏ chấp nhận được)
  const total = (await read(env)) + 1;
  await env.QA_KV.put(KEY, String(total));
  return json({ total });
};
