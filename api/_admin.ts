/* ============================================================
   Xác thực ADMIN cho các Vercel Edge Function — port từ functions/api/_admin.ts.
   CHỈ có "khoá dự phòng" (x-admin-token = env.ADMIN_TOKEN) — phần kiểm tra
   PHIÊN ĐĂNG NHẬP vai trò admin (bản Cloudflare check qua _session.ts) CHƯA
   port: chờ quyết định thời điểm cutover đăng nhập sang Supabase Auth (xem
   supabase/PHA3-PLAN.md mục "Quyết định của Sếp"). Tới lúc đó, các thao tác
   admin trên nhánh Vercel chỉ dùng được qua header x-admin-token.
   ============================================================ */
declare const process: { env: Record<string, string | undefined> };

export function isAdminReq(req: Request): boolean {
  const tok = req.headers.get("x-admin-token") || "";
  return !!process.env.ADMIN_TOKEN && tok === process.env.ADMIN_TOKEN;
}
