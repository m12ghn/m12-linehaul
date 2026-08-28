/* ============================================================
   Xác thực ADMIN cho các API. (File tiền tố "_" -> KHÔNG phải route, chỉ để import.)
   Quy ước MỚI (đăng nhập thật):
   - ADMIN = phiên đăng nhập hợp lệ có vai trò "admin" (token phiên ký HMAC).
   - Giữ ADMIN_TOKEN làm KHOÁ DỰ PHÒNG bootstrap (header x-admin-token) để không
     bị khoá ngoài khi KV/tài khoản gặp sự cố.
   isAdminReq nay là ASYNC -> nơi gọi phải `await`.
   ============================================================ */
import { getSession } from "./_session";

export function isGhnEmail(email: string): boolean {
  // GHN đang đổi domain email: chấp nhận cả @giaohangnhanh.vn (mới) lẫn @ghn.* (cũ, còn dùng trong lúc chuyển tiếp).
  return /@(giaohangnhanh\.vn|ghn\.(vn|com|com\.vn))$/i.test((email || "").trim());
}

export async function isAdminReq(request: Request, env: any): Promise<boolean> {
  // Khoá dự phòng: token khớp ADMIN_TOKEN.
  const tok = request.headers.get("x-admin-token") || "";
  if (env?.ADMIN_TOKEN && tok === env.ADMIN_TOKEN) return true;
  // Phiên đăng nhập có vai trò admin.
  const s = await getSession(request, env);
  return !!s && s.roleId === "admin";
}
