/* ============================================================
   Vercel Edge Function — Bộ đếm lượt truy cập.
   Port từ functions/api/visits.ts (Cloudflare Pages Function, KV
   "visits:total") sang cầu nối bảng kv_store — xem api/_kv.ts +
   supabase/PHA3-PLAN.md mục "Quyết định kiến trúc: kv_store".
   GET  /api/visits  -> { total }            (chỉ đọc, không tăng)
   POST /api/visits  -> { total }            (tăng 1 rồi trả về)

   Đây là bản Vercel SONG SONG với functions/api/visits.ts (Cloudflare) —
   thư mục /api (root) chỉ Vercel nhận, /functions/api chỉ Cloudflare
   nhận, 2 bên KHÔNG đụng nhau cho tới khi có quyết định cutover.
   ============================================================ */
export const config = { runtime: "edge" };

import { json, kvGet, kvSet } from "./_kv";

const KEY = "visits:total";

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const cur = await kvGet<{ total?: number }>(KEY);
    return json({ total: cur?.total ?? 0 });
  }

  if (req.method === "POST") {
    // Đọc-tăng-ghi không có transaction riêng (edge function đơn giản) — chấp nhận race hiếm gặp
    // (bộ đếm lượt truy cập không cần chính xác tuyệt đối), giống mức chính xác của bản KV cũ.
    const cur = await kvGet<{ total?: number }>(KEY);
    const total = (cur?.total ?? 0) + 1;
    await kvSet(KEY, { total });
    return json({ total });
  }

  return json({ error: "method_not_allowed" }, 405);
}
