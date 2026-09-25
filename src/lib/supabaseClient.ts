/* ============================================================
   Kết nối Supabase phía TRÌNH DUYỆT (Pha 1 — đọc SONG SONG với Google
   Sheet để đối chiếu trước khi cutover, xem supabase/README.md).
   Dùng anon key — an toàn để lộ ra client vì RLS chỉ cho SELECT trên
   các bảng Silver (xem phần RLS trong supabase/schema.sql).
   CHƯA cấu hình (.env thiếu VITE_SUPABASE_URL/ANON_KEY) -> getSupabase()
   trả null, nơi gọi PHẢI tự bỏ qua — KHÔNG được làm vỡ app khi Pha 1
   chưa bật (mặc định dashboard vẫn chạy 100% từ Sheet như cũ).
   ============================================================ */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;
if (URL && ANON_KEY) {
  client = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
}

/** null khi Pha 1 chưa cấu hình — nơi gọi phải tự fallback (không throw). */
export function getSupabase(): SupabaseClient | null {
  return client;
}

export const supabaseConfigured = !!client;
