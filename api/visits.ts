/* ============================================================
   Vercel Edge Function — Bộ đếm lượt truy cập.
   Port từ functions/api/visits.ts (Cloudflare Pages Function, KV
   "visits:total") sang cầu nối bảng kv_store trong Supabase — xem
   supabase/PHA3-PLAN.md mục "Quyết định kiến trúc: kv_store".
   GET  /api/visits  -> { total }            (chỉ đọc, không tăng)
   POST /api/visits  -> { total }            (tăng 1 rồi trả về)

   Đây là bản Vercel SONG SONG với functions/api/visits.ts (Cloudflare) —
   thư mục /api (root) chỉ Vercel nhận, /functions/api chỉ Cloudflare
   nhận, 2 bên KHÔNG đụng nhau cho tới khi có quyết định cutover.
   ============================================================ */
export const config = { runtime: "edge" };

import { createClient } from "@supabase/supabase-js";

// process do Vercel Edge Runtime cấp lúc chạy; khai báo tối thiểu để khỏi cần @types/node
// (cùng cách vite.config.ts đang làm — dự án này không cài @types/node).
declare const process: { env: Record<string, string | undefined> };

const KEY = "visits:total";

function db() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  // service_role key -> CHỈ dùng phía server (Edge Function), KHÔNG BAO GIỜ lộ ra client.
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const supa = db();
  if (!supa) return json({ error: "not_configured", total: 0 }, 200);

  if (req.method === "GET") {
    const { data, error } = await supa.from("kv_store").select("value").eq("key", KEY).maybeSingle();
    if (error) return json({ error: error.message, total: 0 }, 500);
    return json({ total: (data?.value as { total?: number })?.total ?? 0 });
  }

  if (req.method === "POST") {
    // Đọc-tăng-ghi không có transaction riêng (edge function đơn giản) — chấp nhận race hiếm gặp
    // (bộ đếm lượt truy cập không cần chính xác tuyệt đối), giống mức chính xác của bản KV cũ.
    const { data: cur } = await supa.from("kv_store").select("value").eq("key", KEY).maybeSingle();
    const total = ((cur?.value as { total?: number })?.total ?? 0) + 1;
    const { error } = await supa.from("kv_store").upsert({ key: KEY, value: { total }, updated_at: new Date().toISOString() });
    if (error) return json({ error: error.message, total: 0 }, 500);
    return json({ total });
  }

  return json({ error: "method_not_allowed" }, 405);
}
