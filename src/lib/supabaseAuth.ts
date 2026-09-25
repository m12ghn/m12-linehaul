/* ============================================================
   Helper đăng nhập qua Supabase Auth (OTP email) — PHA 3, hạ tầng.
   ⚠️ CHƯA WIRE vào App.tsx/useUser.ts — đăng nhập thật của Dash vẫn
   dùng functions/api/_session.ts (Cloudflare) như cũ. Đổi cơ chế đăng
   nhập ảnh hưởng trực tiếp người dùng thật -> CHỈ bật sau khi Sếp xác
   nhận thời điểm cutover (xem supabase/PHA3-PLAN.md mục "Cần Sếp
   quyết định"). File này tồn tại sẵn để không phải viết lại từ đầu
   khi tới lúc đó.
   ============================================================ */
import { getSupabase } from "./supabaseClient";

/* PHẢI khớp isGhnEmail() trong functions/api/_admin.ts — cùng 1 quy tắc domain nội bộ GHN,
   duplicate vì 1 bên chạy browser (Vite), 1 bên chạy Cloudflare Function, không share module được. */
function isGhnMail(email: string): boolean {
  return /@(giaohangnhanh\.vn|ghn\.(vn|com|com\.vn))$/i.test((email || "").trim());
}

/** Gửi mã OTP qua email — CHỈ cho email nội bộ GHN (khớp isGhnEmail() ở _admin.ts). */
export async function requestOtp(email: string): Promise<{ ok: boolean; error?: string }> {
  const db = getSupabase();
  if (!db) return { ok: false, error: "Supabase chưa cấu hình (.env thiếu VITE_SUPABASE_URL/ANON_KEY)" };
  if (!isGhnMail(email)) return { ok: false, error: "Chỉ chấp nhận email nội bộ GHN (@ghn.vn / @giaohangnhanh.vn)" };
  const { error } = await db.auth.signInWithOtp({ email: email.trim().toLowerCase() });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Xác thực mã OTP người dùng nhập -> tạo phiên đăng nhập Supabase Auth. */
export async function verifyOtp(email: string, code: string): Promise<{ ok: boolean; error?: string }> {
  const db = getSupabase();
  if (!db) return { ok: false, error: "Supabase chưa cấu hình" };
  const { error } = await db.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signOut(): Promise<void> {
  const db = getSupabase();
  if (db) await db.auth.signOut();
}
