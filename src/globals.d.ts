// Mã bản build, do Vite define lúc build (xem vite.config.ts). Dùng để dò bản deploy mới.
declare const __BUILD_ID__: string;

// Biến môi trường Pha 1 (Supabase, xem supabase/README.md) — TUỲ CHỌN, không cấu hình vẫn chạy
// bình thường (src/lib/supabaseClient.ts tự fallback null).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_SHADOW_COMPARE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
