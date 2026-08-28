/* ============================================================
   BỘ ĐẾM LƯỢT TRUY CẬP — port từ functions/api/visits.ts (KV "visits:total").
   GET  /api/visits  -> { total }   (chỉ đọc)
   POST /api/visits  -> { total }   (tăng 1 rồi trả về)

   KHÁC BẢN CŨ: bản KV làm read-modify-write, hai người vào cùng lúc là MẤT SỐ.
   Ở đây dùng hàm SQL bump_visits() — cộng nguyên tử trong 1 câu UPDATE.
   ============================================================ */
import { one, rpc, json } from "./_lib/supabase";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method === "POST") {
      const total = await rpc<number>("bump_visits");
      return json({ total: Number(total) || 0 });
    }
    const row = await one<{ value: { total?: number } }>("app_kv", {
      select: "value", filter: { key: "eq.visits:total" },
    });
    return json({ total: Number(row?.value?.total) || 0 });
  } catch {
    // Bộ đếm hỏng KHÔNG được làm vỡ giao diện -> trả 0 thay vì lỗi.
    return json({ total: 0 });
  }
}
